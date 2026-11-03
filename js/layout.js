// 페이지 분석: 글(줄·문단) · 표 · 그림을 찾아 Word/PPT/엑셀/HTML 변환기와 본문 수정이 함께 쓴다 (© 2026 GLORY KIM)
// 좌표는 모두 "화면 기준 pt" (왼쪽 위가 원점, 아래로 증가)

const NUM = (v, d = 0) => (Number.isFinite(v) ? v : d);
const HEX = n => n.toString(16).padStart(2, '0');
const toHex = (r, g, b) => '#' + HEX(r) + HEX(g) + HEX(b);
const isHangul = ch => /[ᄀ-ᇿ㄰-㆏가-힯]/.test(ch || '');
const isCJK = ch => /[぀-ヿ㐀-鿿豈-﫿]/.test(ch || '');

// ---------- 글꼴 이름 → Word 글꼴 ----------
const KO = { malgungothic: '맑은 고딕', nanumgothic: '나눔고딕', nanumbarungothic: '나눔바른고딕', nanummyeongjo: '나눔명조', batang: '바탕', gulim: '굴림', dotum: '돋움', gungsuh: '궁서', hamchorom: '함초롬바탕', hcrbatang: '함초롬바탕', hcrdotum: '함초롬돋움', notosanskr: 'Noto Sans KR', applesdgothicneo: 'Apple SD Gothic Neo', applegothic: 'Apple SD Gothic Neo', hysmyeongjo: '바탕', myeongjo: '바탕' };
const LAT = { arial: 'Arial', timesnewroman: 'Times New Roman', times: 'Times New Roman', calibri: 'Calibri', cambria: 'Cambria', couriernew: 'Courier New', courier: 'Courier New', helvetica: 'Arial', verdana: 'Verdana', tahoma: 'Tahoma', georgia: 'Georgia', segoeui: 'Segoe UI', consolas: 'Consolas', malgun: '맑은 고딕' };
export function fontInfo(rawName) {
  const raw = String(rawName || '');
  const base = raw.replace(/^[A-Z]{6}\+/, '').replace(/-\d{3,5}$/, '');
  const key = base.toLowerCase().replace(/[^a-z0-9]/g, '');
  const bold = /bold|black|heavy|semibold|demi|extrabold|[-,]bd\b/i.test(base);
  const italic = /italic|oblique|[-,]it\b/i.test(base);
  let family = null, ko = false;
  for (const [k, v] of Object.entries(KO)) if (key.startsWith(k) || key.includes(k)) { family = v; ko = true; break; }
  if (!family) for (const [k, v] of Object.entries(LAT)) if (key.startsWith(k)) { family = v; break; }
  if (!family && base) {
    const clean = base.replace(/[-,_].*$/, '').replace(/(MT|PS|Std|Pro)$/i, '').replace(/([a-z])([A-Z])/g, '$1 $2').trim();
    if (clean.length > 1) family = clean;
  }
  return { family, ko, bold, italic, serif: /times|serif|batang|myeongjo|georgia|cambria|명조|바탕/i.test(base) };
}

// ---------- 색 표본 ----------
export function sampleRegion(cv, x, y, w, h) {
  x = Math.max(0, Math.floor(x)); y = Math.max(0, Math.floor(y));
  w = Math.min(cv.width - x, Math.ceil(w)); h = Math.min(cv.height - y, Math.ceil(h));
  if (w < 1 || h < 1) return { bg: '#ffffff', ink: '#000000', has: false };
  const d = cv.getContext('2d', { willReadFrequently: true }).getImageData(x, y, w, h).data;
  const cnt = new Map();
  for (let i = 0; i < d.length; i += 4) {
    const k = ((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4);
    const e = cnt.get(k);
    if (e) { e.n++; e.r += d[i]; e.g += d[i + 1]; e.b += d[i + 2]; } else cnt.set(k, { n: 1, r: d[i], g: d[i + 1], b: d[i + 2] });
  }
  let best = null;
  for (const e of cnt.values()) if (!best || e.n > best.n) best = e;
  const br = Math.round(best.r / best.n), bg = Math.round(best.g / best.n), bb = Math.round(best.b / best.n);
  const far = [];
  for (let i = 0; i < d.length; i += 4) {
    const dist = Math.hypot(d[i] - br, d[i + 1] - bg, d[i + 2] - bb);
    if (dist > 90) far.push([dist, d[i], d[i + 1], d[i + 2]]);
  }
  let ink = '#000000';
  if (far.length) {
    far.sort((a, b) => b[0] - a[0]);
    const top = far.slice(0, Math.max(1, Math.ceil(far.length * 0.3)));
    const s = top.reduce((a, p) => [a[0] + p[1], a[1] + p[2], a[2] + p[3]], [0, 0, 0]);
    ink = toHex(...s.map(v => Math.round(v / top.length)));
  }
  return { bg: toHex(br, bg, bb), ink, has: far.length > 0 };
}
const nearWhite = hex => { const n = parseInt(hex.slice(1), 16); return (n >> 16 & 255) > 244 && (n >> 8 & 255) > 244 && (n & 255) > 244; };

// ---------- 글자 조각 → 줄 ----------
export async function pageItems(page, lib, vp) {
  try { await page.getOperatorList(); } catch { /* 글꼴 정보 없이 진행 */ }
  const tc = await page.getTextContent();
  const fcache = {};
  const items = [];
  for (const it of tc.items) {
    if (typeof it.str !== 'string' || !it.str.length) continue;
    const m = lib.Util.transform(vp.transform, it.transform);
    const size = Math.hypot(m[2], m[3]);
    if (!(size > 1) || Math.abs(m[1]) > Math.abs(m[0]) * 0.2) continue;      // 세로·기울어진 글자는 건너뜀
    if (!it.str.trim()) continue;       // pdf.js가 글자 사이에 끼워 넣는 공백 조각은 간격으로 다시 계산한다
    let fi = fcache[it.fontName];
    if (!fi) {
      let raw = '';
      try { raw = page.commonObjs.get(it.fontName)?.name || ''; } catch { /* 없음 */ }
      fcache[it.fontName] = fi = fontInfo(raw);
      fi.raw = raw;
    }
    const w = it.width * Math.hypot(vp.transform[0], vp.transform[1]);
    items.push({ str: it.str, x: m[4], by: m[5], size, w, x1: m[4] + w, font: fi, flip: m[0] < 0 });
  }
  return items;
}

function toLines(items) {
  const sorted = [...items].sort((a, b) => a.by - b.by || a.x - b.x);
  const clusters = [];
  for (const it of sorted) {
    const c = clusters.find(c => Math.abs(c.by - it.by) < 0.42 * Math.max(c.size, it.size));
    if (c) { c.items.push(it); if (it.size > c.size) { c.size = it.size; c.by = it.by; } } else clusters.push({ by: it.by, size: it.size, items: [it] });
  }
  clusters.sort((a, b) => a.by - b.by);
  const lines = [];
  for (const c of clusters) {
    c.items.sort((a, b) => a.x - b.x);
    const segs = [];
    let cur = null;
    for (const it of c.items) {
      const gap = cur ? it.x - cur.x1 : 0;
      if (!cur || gap > 1.3 * c.size) { cur = { x: it.x, x1: it.x1, items: [it] }; segs.push(cur); continue; }
      cur.items.push(it); cur.x1 = Math.max(cur.x1, it.x1);
    }
    for (const s of segs) {
      const runs = [];
      let prev = null;
      for (const it of s.items) {
        let t = it.str;
        if (prev) {
          const gap = it.x - prev.x1;
          if (gap > 0.17 * it.size && !/\s$/.test(prev.str) && !/^\s/.test(t)) t = ' ' + t;
        }
        const last = runs[runs.length - 1];
        const key = (it.font.raw || '') + '|' + Math.round(it.size * 2) + '|' + it.font.bold + it.font.italic;
        if (last && last.key === key) last.text += t;
        else runs.push({ key, text: t, size: it.size, font: it.font, bold: it.font.bold, italic: it.font.italic, color: '#000000' });
        prev = it;
      }
      s.runs = runs; s.size = Math.max(...runs.map(r => r.size));
      s.text = runs.map(r => r.text).join('');
      s.blank = !s.text.trim();
    }
    const live = segs.filter(s => !s.blank);
    if (live.length) lines.push({ by: c.by, size: c.size, segs: live, x: live[0].x, x1: live[live.length - 1].x1 });
  }
  return lines;
}

// ---------- 줄 → 문단 ----------
function buildParas(lines, left, right, pageW) {
  const paras = [];
  const rightMax = right ?? percentile(lines.filter(l => l.segs.length === 1 && l.segs[0].text.length > 14).map(l => l.x1), 0.9) ?? Math.max(...lines.map(l => l.x1));
  const leftMin = left ?? Math.min(...lines.map(l => l.x));
  const cw = Math.max(50, rightMax - leftMin), center = (leftMin + rightMax) / 2;
  const alignOf = l => {
    if (l.segs.length !== 1) return 'left';
    const w = l.x1 - l.x;
    const mid = (l.x + l.x1) / 2;
    if ((Math.abs(mid - center) < 0.025 * cw || (pageW && Math.abs(mid - pageW / 2) < 0.015 * pageW)) && l.x - leftMin > 2 * l.size && Math.abs(l.x - leftMin) > 0.08 * cw) return 'center';
    if (l.x1 >= rightMax - 0.6 * l.size && l.x - leftMin > 0.25 * cw && w < 0.6 * cw) return 'right';
    return 'left';
  };
  let cur = null;
  const close = () => { if (cur) { finishPara(cur); paras.push(cur); cur = null; } };
  for (const l of lines) {
    const al = alignOf(l);
    if (cur && l.segs.length === 1 && cur.lines[cur.lines.length - 1].segs.length === 1 && al === 'left' && cur.align === 'left') {
      const p = cur.lines[cur.lines.length - 1];
      const dy = l.by - p.by, sz = Math.max(p.size, l.size);
      const okSize = Math.abs(p.size - l.size) < 1.2 || Math.min(p.size, l.size) / sz > 0.88;
      const okPitch = cur.lines.length >= 2 ? Math.abs(dy - cur.pitch) < 0.3 * cur.pitch + 1 : dy > 0.85 * sz && dy < 1.95 * sz;
      const base = cur.lines.length >= 2 ? cur.left : Math.min(cur.lines[0].x, l.x);
      const okLeft = Math.abs(l.x - base) < 0.7 * sz || (cur.lines.length === 1 && l.x < p.x + 0.7 * sz && l.x > p.x - 3.5 * sz);
      const full = p.x1 >= rightMax - 4 * sz;
      if (okSize && okPitch && okLeft && full) {
        if (cur.lines.length === 1) cur.pitch = dy;
        cur.lines.push(l); cur.left = cur.lines.length === 2 ? Math.min(cur.lines[0].x, l.x) : cur.left;
        continue;
      }
    }
    close();
    cur = { type: 'p', lines: [l], align: al, left: l.x, pitch: l.size * 1.3 };
  }
  close();
  return paras;
}
function finishPara(p) {
  const first = p.lines[0], last = p.lines[p.lines.length - 1];
  p.size = Math.max(...p.lines.map(l => l.size));
  p.x = p.lines.length > 1 ? p.left : first.x;
  p.first = first.x - p.x;
  p.x1 = Math.max(...p.lines.map(l => l.x1));
  p.by0 = first.by; p.byN = last.by;
  p.top = first.by - first.size * 0.88; p.bottom = last.by + last.size * 0.26;
  if (p.lines.length === 1) p.pitch = p.size * 1.3;
  // 줄 합치기
  if (first.segs.length > 1) { p.segs = first.segs.map(s => ({ x: s.x, x1: s.x1, runs: s.runs })); p.runs = null; }
  else {
    const runs = [];
    p.lines.forEach((l, i) => {
      const rs = l.segs[0].runs.map(r => ({ ...r }));
      if (i) {
        const prevTxt = runs[runs.length - 1]?.text || '', nextTxt = rs[0]?.text || '';
        const a = prevTxt.slice(-1), b = nextTxt[0];
        if (!(isCJK(a) && isCJK(b)) && !/\s$/.test(prevTxt) && !/^\s/.test(nextTxt)) rs[0].text = ' ' + rs[0].text;
      }
      for (const r of rs) {
        const last2 = runs[runs.length - 1];
        if (last2 && last2.key === r.key) last2.text += r.text; else runs.push(r);
      }
    });
    p.runs = runs;
  }
  p.text = p.segs ? p.segs.map(s => s.runs.map(r => r.text).join('')).join('\t') : p.runs.map(r => r.text).join('');
}
function percentile(a, q) {
  if (!a.length) return null;
  a = [...a].sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.floor(a.length * q))];
}

// ---------- 줄 그림 · 선 → 표 ----------
function walkOps(ol, lib, vp, pageW, pageH) {
  const O = lib.OPS;
  const stack = [];
  let ctm = vp.transform.slice();
  const H = [], V = [], imgs = [];
  const map = (x, y) => [ctm[0] * x + ctm[2] * y + ctm[4], ctm[1] * x + ctm[3] * y + ctm[5]];
  const addSeg = (p, q) => {
    const dx = Math.abs(p[0] - q[0]), dy = Math.abs(p[1] - q[1]);
    if (dy < 0.8 && dx >= 3) H.push({ y: (p[1] + q[1]) / 2, a: Math.min(p[0], q[0]), b: Math.max(p[0], q[0]) });
    else if (dx < 0.8 && dy >= 3) V.push({ x: (p[0] + q[0]) / 2, a: Math.min(p[1], q[1]), b: Math.max(p[1], q[1]) });
  };
  const doPath = (op, data) => {
    const stroke = op === O.stroke || op === O.closeStroke || op === O.fillStroke || op === O.eoFillStroke || op === O.closeFillStroke || op === O.closeEOFillStroke;
    const fill = op === O.fill || op === O.eoFill || op === O.fillStroke || op === O.eoFillStroke || op === O.closeFillStroke || op === O.closeEOFillStroke;
    if (!stroke && !fill) return;
    const arr = Array.from(data);
    const subs = [];
    let cur = null, i = 0;
    while (i < arr.length) {
      const c = arr[i++];
      if (c === 0) { cur = { pts: [map(arr[i], arr[i + 1])], closed: false }; subs.push(cur); i += 2; }
      else if (c === 1) { cur?.pts.push(map(arr[i], arr[i + 1])); i += 2; }
      else if (c === 2) { cur?.pts.push(map(arr[i + 4], arr[i + 5])); cur && (cur.curve = true); i += 6; }
      else if (c === 3) { cur?.pts.push(map(arr[i + 2], arr[i + 3])); cur && (cur.curve = true); i += 4; }
      else if (c === 4) { if (cur) cur.closed = true; }
      else break;
    }
    for (const s of subs) {
      const p = s.pts;
      if (s.curve || p.length < 2) continue;
      const rect = (p.length === 4 || (p.length === 5 && Math.hypot(p[0][0] - p[4][0], p[0][1] - p[4][1]) < 0.5)) && (s.closed || p.length === 5)
        && ((Math.abs(p[0][0] - p[1][0]) < 0.8 && Math.abs(p[1][1] - p[2][1]) < 0.8) || (Math.abs(p[0][1] - p[1][1]) < 0.8 && Math.abs(p[1][0] - p[2][0]) < 0.8));
      if (rect) {
        const xs = p.map(q => q[0]), ys = p.map(q => q[1]);
        const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
        const w = x1 - x0, h = y1 - y0;
        if (!stroke && fill) {
          if (h < 2.4 && w >= 3) H.push({ y: (y0 + y1) / 2, a: x0, b: x1 });
          else if (w < 2.4 && h >= 3) V.push({ x: (x0 + x1) / 2, a: y0, b: y1 });
        } else if (w >= 3 || h >= 3) {
          H.push({ y: y0, a: x0, b: x1 }, { y: y1, a: x0, b: x1 }); V.push({ x: x0, a: y0, b: y1 }, { x: x1, a: y0, b: y1 });
        }
      } else if (stroke) {
        for (let k = 1; k < p.length; k++) addSeg(p[k - 1], p[k]);
        if (s.closed && p.length > 2) addSeg(p[p.length - 1], p[0]);
      }
    }
  };
  for (let i = 0; i < ol.fnArray.length; i++) {
    const f = ol.fnArray[i], a = ol.argsArray[i];
    if (f === O.save) stack.push(ctm.slice());
    else if (f === O.restore) { if (stack.length) ctm = stack.pop(); }
    else if (f === O.transform) ctm = lib.Util.transform(ctm, a);
    else if (f === O.constructPath) {
      if (Array.isArray(a) && typeof a[0] === 'number' && a[1] && a[1][0] != null && typeof a[1][0] === 'object') { /* 신형: [paintOp, [data], minMax] */ doPath(a[0], a[1][0]); }
      else if (Array.isArray(a) && typeof a[0] === 'number' && a[1] && typeof a[1].length === 'number' && typeof a[1][0] === 'number') doPath(a[0], a[1]);
    } else if (f === O.paintImageXObject || f === O.paintInlineImageXObject || f === O.paintImageMaskXObject || f === O.paintJpegXObject) {
      const mask = f === O.paintImageMaskXObject;
      const pts = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => map(x, y));
      const xs = pts.map(q => q[0]), ys = pts.map(q => q[1]);
      imgs.push({ id: typeof a[0] === 'string' ? a[0] : null, inline: f === O.paintInlineImageXObject ? a[0] : null, mask, x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) });
    }
  }
  return { H, V, imgs };
}

function mergeLines(list, key, a, b) {
  list = list.map(s => ({ ...s })).sort((p, q) => p[key] - q[key] || p[a] - q[a]);
  const out = [];
  for (const s of list) {
    const m = out.find(o => Math.abs(o[key] - s[key]) < 1.6 && s[a] <= o[b] + 2.5 && s[b] >= o[a] - 2.5);
    if (m) { m[a] = Math.min(m[a], s[a]); m[b] = Math.max(m[b], s[b]); } else out.push(s);
  }
  // 합치고 나서 새로 이어진 것들을 한 번 더 정리
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < out.length && !changed; i++) for (let j = i + 1; j < out.length; j++) {
      if (Math.abs(out[i][key] - out[j][key]) < 1.6 && out[j][a] <= out[i][b] + 2.5 && out[j][b] >= out[i][a] - 2.5) {
        out[i][a] = Math.min(out[i][a], out[j][a]); out[i][b] = Math.max(out[i][b], out[j][b]); out.splice(j, 1); changed = true; break;
      }
    }
  }
  return out;
}
const uniq = (vals, tol = 2) => {
  const s = [...vals].sort((a, b) => a - b), out = [];
  for (const v of s) { if (out.length && v - out[out.length - 1].sum / out[out.length - 1].n < tol) { const o = out[out.length - 1]; o.sum += v; o.n++; } else out.push({ sum: v, n: 1 }); }
  return out.map(o => o.sum / o.n);
};

function findRuledTables(H, V, pageW, pageH) {
  H = mergeLines(H, 'y', 'a', 'b'); V = mergeLines(V, 'x', 'a', 'b');
  const all = [...H.map(l => ({ ...l, t: 'h' })), ...V.map(l => ({ ...l, t: 'v' }))];
  const par = all.map((_, i) => i);
  const find = i => (par[i] === i ? i : (par[i] = find(par[i])));
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
    const p = all[i], q = all[j];
    if (p.t === q.t) continue;
    const h = p.t === 'h' ? p : q, v = p.t === 'h' ? q : p;
    if (v.x >= h.a - 2.5 && v.x <= h.b + 2.5 && h.y >= v.a - 2.5 && h.y <= v.b + 2.5) par[find(i)] = find(j);
  }
  const comps = new Map();
  all.forEach((l, i) => { const r = find(i); (comps.get(r) || comps.set(r, []).get(r)).push(l); });
  const tables = [];
  for (const ls of comps.values()) {
    const hs = ls.filter(l => l.t === 'h'), vs = ls.filter(l => l.t === 'v');
    if (hs.length < 2 || vs.length < 2) continue;
    const xs = uniq(vs.map(l => l.x)), ys = uniq(hs.map(l => l.y));
    if (xs.length < 2 || ys.length < 2 || (xs.length - 1) * (ys.length - 1) < 2) continue;
    const x0 = xs[0], x1 = xs[xs.length - 1], y0 = ys[0], y1 = ys[ys.length - 1];
    if ((x1 - x0) > pageW * 0.97 && (y1 - y0) > pageH * 0.95) continue;       // 쪽 테두리
    const edgeV = (x, a, b) => vs.some(v => Math.abs(v.x - x) < 2.5 && v.a <= a + 3 && v.b >= b - 3);
    const edgeH = (y, a, b) => hs.some(h => Math.abs(h.y - y) < 2.5 && h.a <= a + 3 && h.b >= b - 3);
    const nr = ys.length - 1, nc = xs.length - 1;
    const used = Array.from({ length: nr }, () => Array(nc).fill(false));
    const cells = [];
    for (let r = 0; r < nr; r++) for (let c = 0; c < nc; c++) {
      if (used[r][c]) continue;
      let cs = 1, rs = 1;
      while (c + cs < nc && !used[r][c + cs] && !edgeV(xs[c + cs], ys[r], ys[r + 1])) cs++;
      for (;;) {
        if (r + rs >= nr) break;
        let ok = true;
        for (let k = c; k < c + cs; k++) if (used[r + rs][k] || edgeH(ys[r + rs], xs[k], xs[k + 1])) { ok = false; break; }
        if (!ok) break;
        rs++;
      }
      for (let i = r; i < r + rs; i++) for (let j = c; j < c + cs; j++) used[i][j] = true;
      cells.push({ r, c, rs, cs });
    }
    tables.push({ type: 'table', ruled: true, x0, y0, x1, y1, xs, ys, cells });
  }
  return tables;
}

// 선이 없는 표: 줄마다 칸이 2개 이상이고 칸 위치가 세로로 맞는 연속된 줄
function findAlignedTables(lines) {
  const res = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i].segs.length < 2) { i++; continue; }
    let j = i + 1;
    while (j < lines.length && lines[j].segs.length >= 2 && lines[j].by - lines[j - 1].by < 2.4 * Math.max(lines[j].size, lines[j - 1].size)) j++;
    const rows = lines.slice(i, j);
    if (rows.length >= 3) {
      const xsAll = rows.flatMap(r => r.segs.map(s => s.x));
      const cols = uniq(xsAll, 8);
      const rowCount = col => rows.filter(r => r.segs.some(s => Math.abs(s.x - col) < 9)).length;
      const keep = cols.filter(c => rowCount(c) >= Math.ceil(rows.length * 0.6));
      const fit = rows.reduce((a, r) => a + r.segs.filter(s => keep.some(c => Math.abs(s.x - c) < 9)).length, 0) / xsAll.length;
      if (keep.length >= 2 && fit >= 0.8) { res.push({ from: i, to: j, cols: keep }); i = j; continue; }
    }
    i = j;
  }
  return res;
}

// ---------- 그림 추출 ----------
async function extractImage(page, im, cache) {
  const key = im.id || null;
  if (key && cache.has(key)) return cache.get(key);
  let o = null;
  try {
    if (im.id) { o = await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('timeout')), 4000); const store = im.id.startsWith('g_') ? page.commonObjs : page.objs; store.get(im.id, v => { clearTimeout(t); res(v); }); }); }
    else if (im.inline && typeof im.inline === 'object') o = im.inline;
  } catch { return null; }
  if (!o || !(o.width > 0)) return null;
  const cv = document.createElement('canvas');
  cv.width = o.width; cv.height = o.height;
  const ctx = cv.getContext('2d');
  try {
    if (o.bitmap) ctx.drawImage(o.bitmap, 0, 0);
    else if (o.data) {
      const n = o.width * o.height, img = ctx.createImageData(o.width, o.height), d = img.data, s = o.data;
      if (s.length === n * 4) d.set(s);
      else if (s.length === n * 3) for (let i = 0, k = 0; i < n; i++, k += 3) { d[i * 4] = s[k]; d[i * 4 + 1] = s[k + 1]; d[i * 4 + 2] = s[k + 2]; d[i * 4 + 3] = 255; }
      else if (o.kind === 1 || s.length === ((o.width + 7) >> 3) * o.height) {
        const rb = (o.width + 7) >> 3;
        for (let y = 0; y < o.height; y++) for (let x = 0; x < o.width; x++) { const v = (s[y * rb + (x >> 3)] >> (7 - (x & 7))) & 1 ? 255 : 0; const k = (y * o.width + x) * 4; d[k] = d[k + 1] = d[k + 2] = v; d[k + 3] = 255; }
      } else return null;
      ctx.putImageData(img, 0, 0);
    } else return null;
  } catch { return null; }
  let scale = 1;
  const maxPx = 2200;
  if (cv.width > maxPx || cv.height > maxPx) scale = maxPx / Math.max(cv.width, cv.height);
  let src = cv;
  if (scale < 1) { src = document.createElement('canvas'); src.width = Math.round(cv.width * scale); src.height = Math.round(cv.height * scale); src.getContext('2d').drawImage(cv, 0, 0, src.width, src.height); }
  const big = src.width * src.height > 700000;
  let out = src;
  if (big) { out = document.createElement('canvas'); out.width = src.width; out.height = src.height; const c2 = out.getContext('2d'); c2.fillStyle = '#fff'; c2.fillRect(0, 0, out.width, out.height); c2.drawImage(src, 0, 0); }
  const blob = await new Promise(r => out.toBlob(r, big ? 'image/jpeg' : 'image/png', 0.88));
  if (!blob) return null;
  const res = { data: new Uint8Array(await blob.arrayBuffer()), mime: blob.type, pw: src.width, ph: src.height, ext: blob.type === 'image/jpeg' ? 'jpeg' : 'png' };
  if (key) cache.set(key, res);
  return res;
}

// ======================== 페이지 분석 (공개) ========================
// opts: { color: true, images: true, imgCache: Map }
export async function analyzePage(pdf, lib, num, opts = {}) {
  const { color = true, images = true } = opts;
  const imgCache = opts.imgCache || new Map();
  const page = await pdf.getPage(num);
  const vp = page.getViewport({ scale: 1 });
  const W = vp.width, Hh = vp.height;
  const items = await pageItems(page, lib, vp);
  const ol = await page.getOperatorList();
  const { H, V, imgs } = walkOps(ol, lib, vp, W, Hh);
  let cv = null;
  if (color) {
    try {
      const k = 1.5;
      cv = document.createElement('canvas'); cv.width = Math.ceil(W * k); cv.height = Math.ceil(Hh * k);
      const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
      await page.render({ canvasContext: ctx, viewport: page.getViewport({ scale: k }) }).promise;
      cv._k = k;
    } catch { cv = null; }
  }
  const sample = (x, y, w, h) => (cv ? sampleRegion(cv, x * cv._k, y * cv._k, w * cv._k, h * cv._k) : { bg: '#ffffff', ink: '#000000', has: false });

  const blocks = [];
  // 선이 있는 표
  const rtables = findRuledTables(H, V, W, Hh);
  const inTable = it => rtables.find(t => it.x + it.w / 2 >= t.x0 - 2 && it.x + it.w / 2 <= t.x1 + 2 && it.by - it.size * 0.3 >= t.y0 - 2 && it.by - it.size * 0.3 <= t.y1 + 2);
  const free = [];
  const cellItems = new Map();
  for (const it of items) {
    const t = inTable(it);
    if (!t) { free.push(it); continue; }
    const cx = it.x + it.w / 2, cy = it.by - it.size * 0.3;
    const cell = t.cells.find(c => cx >= t.xs[c.c] - 1 && cx <= t.xs[c.c + c.cs] + 1 && cy >= t.ys[c.r] - 1 && cy <= t.ys[c.r + c.rs] + 1);
    if (!cell) continue;
    (cellItems.get(cell) || cellItems.set(cell, []).get(cell)).push(it);
  }
  for (const t of rtables) {
    for (const c of t.cells) {
      const its = cellItems.get(c) || [];
      const ls = its.length ? toLines(its) : [];
      c.paras = ls.length ? buildParas(ls, t.xs[c.c] + 2, t.xs[c.c + c.cs] - 2) : [];
      c.x = t.xs[c.c]; c.x1 = t.xs[c.c + c.cs]; c.y = t.ys[c.r]; c.y1 = t.ys[c.r + c.rs];
      const sm = sample(c.x + 1.5, c.y + 1.5, 4, 4);
      c.fill = nearWhite(sm.bg) ? null : sm.bg;
      for (const p of c.paras) colorize(p, sample);
    }
    t.top = t.y0; t.bottom = t.y1; t.x = t.x0;
    blocks.push(t);
  }

  // 나머지 글
  const lines = toLines(free);
  const aligned = findAlignedTables(lines);
  const taken = new Set();
  for (const at of aligned) {
    const rows = lines.slice(at.from, at.to);
    rows.forEach((_, k) => taken.add(at.from + k));
    const cols = at.cols;
    const x1 = Math.max(...rows.flatMap(r => r.segs.map(s => s.x1))) + 2;
    const xs = [...cols.map(c => c - 2), x1];
    xs[0] = Math.max(0, xs[0]);
    const ys = [rows[0].by - rows[0].size * 1.0];
    for (let k = 0; k < rows.length - 1; k++) ys.push((rows[k].by + rows[k + 1].by) / 2 + rows[k].size * 0.2);
    ys.push(rows[rows.length - 1].by + rows[rows.length - 1].size * 0.35);
    const cells = [];
    rows.forEach((row, r) => {
      const perCol = new Map();
      for (const s of row.segs) {
        let ci = 0, bd = 1e9;
        cols.forEach((c, idx) => { const d = Math.abs(c - s.x); if (d < bd) { bd = d; ci = idx; } });
        (perCol.get(ci) || perCol.set(ci, []).get(ci)).push(s);
      }
      for (let c = 0; c < cols.length; c++) {
        const segs = perCol.get(c) || [];
        const ln = segs.length ? [{ by: row.by, size: row.size, segs: [{ x: segs[0].x, x1: segs[segs.length - 1].x1, runs: segs.flatMap((s, k) => (k ? [{ ...s.runs[0], text: ' ' + s.runs[0].text }, ...s.runs.slice(1)] : s.runs)), size: row.size, text: segs.map(s => s.text).join(' ') }], x: segs[0].x, x1: segs[segs.length - 1].x1 }] : [];
        cells.push({ r, c, rs: 1, cs: 1, paras: ln.length ? buildParas(ln, xs[c], xs[c + 1]) : [], x: xs[c], x1: xs[c + 1], y: ys[r], y1: ys[r + 1], fill: null });
      }
    });
    cells.forEach(c => c.paras.forEach(p => colorize(p, sample)));
    blocks.push({ type: 'table', ruled: false, x0: xs[0], y0: ys[0], x1: xs[xs.length - 1], y1: ys[ys.length - 1], xs, ys, cells, top: ys[0], bottom: ys[ys.length - 1], x: xs[0] });
  }
  const restLines = lines.filter((_, i) => !taken.has(i));
  // 표가 중간을 갈라놓아도 같은 문단 규칙을 쓰도록, 표 경계마다 줄 묶음을 나눈다
  const tops = blocks.filter(b => b.type === 'table').map(b => [b.top, b.bottom]).sort((a, b) => a[0] - b[0]);
  const groups = [[]];
  for (const l of restLines) {
    const g = groups[groups.length - 1];
    const prev = g[g.length - 1];
    if (prev && tops.some(([a, b]) => prev.by < a + 1 && l.by > b - 1)) groups.push([l]); else g.push(l);
  }
  const pageLeft = restLines.length ? Math.min(...restLines.map(l => l.x)) : 0;
  const pageRight = percentile(restLines.filter(l => l.segs.length === 1 && l.segs[0].text.length > 14).map(l => l.x1), 0.9) ?? (restLines.length ? Math.max(...restLines.map(l => l.x1)) : W);
  for (const g of groups) if (g.length) for (const p of buildParas(g, pageLeft, pageRight, W)) { colorize(p, sample); blocks.push(p); }

  // 그림
  const textLen = items.reduce((a, i) => a + i.str.trim().length, 0);
  const seen = new Set();
  if (images) {
    for (const im of imgs) {
      if (im.mask || im.w < 6 || im.h < 6) continue;
      const k = [im.id, Math.round(im.x), Math.round(im.y), Math.round(im.w), Math.round(im.h)].join('|');
      if (seen.has(k)) continue;
      seen.add(k);
      const bg = im.w * im.h > 0.8 * W * Hh;
      if (bg && textLen >= 20) continue;                 // 글자가 있는 쪽의 전체 배경 그림은 버림
      const data = await extractImage(page, im, imgCache);
      if (!data) continue;
      blocks.push({ type: 'img', x: im.x, x1: im.x + im.w, w: im.w, h: im.h, top: im.y, bottom: im.y + im.h, data, bg });
    }
  }
  blocks.sort((a, b) => a.top - b.top || a.x - b.x);
  if (cv) { cv.width = 0; cv.height = 0; }
  page.cleanup();
  return { w: W, h: Hh, blocks, items, textLen, lines };
}

function colorize(p, sample) {
  const segs = p.segs || [{ x: p.x, x1: p.x1, runs: p.runs, line: p.lines[0] }];
  if (p.segs) {
    p.segs.forEach(s => { const c = sample(s.x, p.by0 - p.size * 0.9, s.x1 - s.x, p.size * 1.2).ink; s.runs.forEach(r => { r.color = c; }); });
    return;
  }
  // 줄마다 색을 재서 첫 글자 색을 문단 색으로 삼는다 (문단 안에서 색이 다르면 줄 단위로 따로 적용)
  const colors = p.lines.map(l => sample(l.x, l.by - l.size * 0.9, l.x1 - l.x, l.size * 1.2).ink);
  const first = colors[0];
  p.runs.forEach(r => { r.color = first; });
  p.color = first;
  void segs;
}

// ======================== 본문 수정용: 줄 목록 ========================
// 한 줄(같은 기준선 위에서 가까운 글자 묶음)마다 편집 상자를 만든다
export async function editableLines(page, lib) {
  const vp = page.getViewport({ scale: 1 });
  const items = await pageItems(page, lib, vp);
  const lines = toLines(items);
  const out = [];
  for (const l of lines) for (const s of l.segs) {
    const dom = s.runs.reduce((a, r) => (r.text.length > a.text.length ? r : a), s.runs[0]);
    out.push({
      x: s.x, w: s.x1 - s.x, by: l.by, size: s.size, text: s.text,
      top: l.by - s.size * 0.95, h: s.size * 1.22,
      bold: dom.bold, italic: dom.italic, font: dom.font,
    });
  }
  return out;
}
