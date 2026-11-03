// 빈 페이지 찾기·삭제 + 파일철 구멍 자국 인식·지우기 (© 2026 GLORY KIM)
import { S, h, toast, busy, modal } from './state.js';
import * as core from './pdfcore.js';
import * as D from './doc.js';
import { needDoc, err, row, seg } from './tools.js';
import { sampleRegion } from './layout.js';

// 무엇을 「빈 쪽」으로 볼지 (삭제 대상 범위)
//  pure  : 아주 작은 점 하나도 없는 완전한 백지만
//  normal: 백지 + 스캔 먼지·가장자리 그림자·파일철 구멍 자국만 있는 쪽 (권장)
//  loose : normal + 쪽 번호·머리글·흐린 자국만 있는 쪽
const MODES = {
  pure: { delta: 18, minArea: 1, maxInk: 0, maxComps: 0, ignoreHoles: false, ignoreTB: false },
  normal: { delta: 40, minArea: 25, maxInk: 0, maxComps: 0, ignoreHoles: true, ignoreTB: false },
  loose: { delta: 55, minArea: 30, maxInk: 0.0006, maxComps: 12, ignoreHoles: true, ignoreTB: true },
};

// 한 쪽 그림을 분석한다. 반환: {blank, ink, comps, holes:[{x,y,w,h}] (그림 픽셀 기준)}
export function analyzeBlank(cv, mode) {
  const P = MODES[mode] || MODES.normal;
  const w = cv.width, hgt = cv.height, N = w * hgt;
  const d = cv.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, hgt).data;
  const g = new Uint8Array(N), hist = new Uint32Array(256);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) { const v = (d[i] * 77 + d[i + 1] * 151 + d[i + 2] * 28) >> 8; g[j] = v; hist[v]++; }
  let bg = 255, best = -1;
  for (let v = 0; v < 256; v++) if (hist[v] > best) { best = hist[v]; bg = v; }       // 바탕 밝기 = 가장 많은 밝기
  if (bg < 120) return { blank: false, ink: 1, comps: 99, holes: [] };               // 거의 검은 쪽은 빈 쪽이 아님
  const thr = bg - P.delta;
  const bx = Math.round(w * 0.03), by = P.ignoreTB ? Math.round(hgt * 0.07) : Math.round(hgt * 0.03);   // 가장자리 그림자는 항상 무시
  const lab = new Uint8Array(N);
  const stack = new Int32Array(N);
  const comps = [], holes = [];
  const sc = (w / 830) ** 2;
  for (let y = by; y < hgt - by; y++) {
    for (let x = bx; x < w - bx; x++) {
      const p = y * w + x;
      if (lab[p] || g[p] >= thr) continue;
      let sp = 0, area = 0, x0 = x, x1 = x, y0 = y, y1 = y;
      stack[sp++] = p; lab[p] = 1;
      while (sp) {
        const q = stack[--sp], qy = (q / w) | 0, qx = q - qy * w;
        area++;
        if (qx < x0) x0 = qx; if (qx > x1) x1 = qx; if (qy < y0) y0 = qy; if (qy > y1) y1 = qy;
        for (let dy = -1; dy <= 1; dy++) {
          const ny = qy + dy; if (ny < by || ny >= hgt - by) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const nx = qx + dx; if (nx < bx || nx >= w - bx) continue;
            const np = ny * w + nx;
            if (!lab[np] && g[np] < thr) { lab[np] = 1; stack[sp++] = np; }
          }
        }
      }
      const bw = x1 - x0 + 1, bh = y1 - y0 + 1, cx = (x0 + x1) / 2;
      const round = bw >= 0.012 * w && bw <= 0.10 * w && bh >= 0.012 * w && bh <= 0.10 * w && Math.abs(bw - bh) / Math.max(bw, bh) < 0.3 && area / (bw * bh) > 0.55;
      if (round && (cx < 0.16 * w || cx > 0.84 * w)) {            // 가장자리의 동그란 덩어리 = 파일철 구멍
        holes.push({ x: x0, y: y0, w: bw, h: bh });
        if (P.ignoreHoles) continue;                              // 「완전한 백지만」일 땐 구멍도 내용으로 센다
      }
      if (area >= P.minArea * sc) comps.push(area);
    }
  }
  const ink = comps.reduce((a, b) => a + b, 0) / N;
  const blank = comps.length <= P.maxComps && ink <= P.maxInk;
  return { blank, ink, comps: comps.length, holes };
}

export async function blankPagesDialog() {
  if (!await needDoc()) return;
  const mode = seg('bmode', [
    ['pure', '진짜 빈 페이지만', '작은 점·구멍 자국도 없는 완전한 백지'],
    ['normal', '빈 페이지 + 먼지·구멍만 있는 쪽 (권장)', '스캔 먼지, 가장자리 그림자, 파일철 구멍 자국만 있는 쪽'],
    ['loose', '쪽 번호·흐린 자국만 있는 쪽까지', '내용이 거의 없는 쪽을 넓게 찾습니다'],
  ], 'normal');
  const chk = (label, on) => { const i = h('input', { type: 'checkbox', checked: on }); return { i, el: h('label', { class: 'chk' }, i, label) }; };
  const erase = chk('남는 쪽의 파일철 구멍 자국도 지우기', true);
  const review = chk('지우기 전에 찾은 쪽을 보고 확인하기', true);
  modal({
    title: '빈 페이지 찾기 · 삭제', wide: true,
    body: [h('p', { class: 'muted' }, '스캔한 문서에서 내용이 없는 쪽을 찾아 한꺼번에 지웁니다. 어떤 쪽까지 「빈 쪽」으로 볼지 고르세요. 삭제 후에도 실행 취소(Ctrl+Z)로 되돌릴 수 있습니다.'),
      mode.el, row('옵션', erase.el, review.el)],
    actions: [{ label: '취소' }, {
      label: '빈 페이지 찾기', kind: 'primary', run: async () => {
        const m = mode.get();
        const b = busy('빈 페이지를 찾는 중…');
        let done = false;
        try {
          await D.flush();
          const found = [], withHoles = [];
          for (let i = 0; i < S.n; i++) {
            if (b.cancelled) throw new Error('취소되었습니다');
            b.set(`${i + 1} / ${S.n} 쪽 분석 중`, i / S.n);
            const pg = await S.pdf.getPage(i + 1);
            const vw = pg.getViewport({ scale: 1 }).width;
            const cv = await core.renderCanvas(S.pdf, i + 1, 830 / vw);
            const r = analyzeBlank(cv, m);
            if (r.blank) {
              const th = document.createElement('canvas'); th.width = 110; th.height = Math.round(110 * cv.height / cv.width);
              th.getContext('2d').drawImage(cv, 0, 0, th.width, th.height);
              found.push({ i, th, holes: r.holes.length });
            } else if (r.holes.length && erase.i.checked) {
              const k = vw / cv.width;
              withHoles.push({ i, boxes: r.holes.map(o => {
                const pad = Math.max(o.w, o.h) * 0.3;
                const bgc = sampleRegion(cv, o.x - o.w * 0.8, o.y - o.h * 0.8, o.w * 2.6, o.h * 2.6).bg;
                return { x: (o.x - pad) * k, y: (o.y - pad) * k, w: (o.w + pad * 2) * k, h: (o.h + pad * 2) * k, color: bgc };
              }) });
            }
            cv.width = 0; await new Promise(r2 => setTimeout(r2, 0));
          }
          b.close(); done = true;
          if (!found.length && !withHoles.length) {
            toast(m === 'pure' ? '완전한 빈 페이지는 없었습니다. 「먼지·구멍만 있는 쪽」까지 고르면 더 찾습니다' : '빈 페이지도 구멍 자국도 찾지 못했습니다', 'ok');
            return;
          }
          if (review.i.checked) showResult(found, withHoles);
          else await applyBlank(found, withHoles, new Set(found.map(f => f.i)), withHoles.length > 0);
        } catch (e) { err(e); } finally { if (!done) b.close(); }
      },
    }],
  });
}

async function applyBlank(found, withHoles, del, doHoles) {
  if (!del.size && !doHoles) { toast('적용할 내용이 없습니다'); return false; }
  if (del.size >= S.n) { toast('모든 쪽이 비어 있어 지울 수 없습니다', 'err'); return false; }
  const b = busy('적용하는 중…');
  try {
    let bytes = S.bytes;
    if (doHoles) {
      const ov = {};
      for (const x of withHoles) if (!del.has(x.i)) ov[x.i] = x.boxes.map((bx, n) => ({ id: 'h' + x.i + '_' + n, type: 'whiteout', x: bx.x, y: bx.y, w: bx.w, h: bx.h, color: bx.color }));
      if (Object.keys(ov).length) bytes = await core.flatten(bytes, ov, {});
    }
    if (del.size) bytes = await core.applyPlan(bytes, Array.from({ length: S.n }, (_, i) => i).filter(i => !del.has(i)).map(i => ({ src: i, rot: 0 })));
    await D.applyBytes(bytes);
    const parts = [];
    if (del.size) parts.push(`빈 페이지 ${del.size}쪽 삭제`);
    if (doHoles) parts.push('구멍 자국 정리');
    toast(parts.join(' · ') + ' 완료 (Ctrl+Z로 되돌리기)', 'ok');
    return true;
  } catch (e) { err(e); return false; } finally { b.close(); }
}

function showResult(found, withHoles) {
  const checks = found.map(() => h('input', { type: 'checkbox', checked: true }));
  const holeCount = withHoles.reduce((a, x) => a + x.boxes.length, 0);
  const eraseHoles = h('input', { type: 'checkbox', checked: true });
  const label = h('b', {}, '');
  const upd = () => { label.textContent = `${checks.filter(c => c.checked).length} / ${checks.length}쪽 삭제 선택`; };
  checks.forEach(c => c.addEventListener('change', upd)); upd();
  const grid = h('div', { class: 'blankgrid' }, found.map((f, k) => h('label', { class: 'bcell', title: `${f.i + 1}쪽` }, checks[k], f.th, h('span', {}, `${f.i + 1}쪽${f.holes ? ' · 구멍' : ''}`))));
  const body = [
    h('p', {}, found.length ? `빈 페이지 ${found.length}쪽을 찾았습니다. 지우지 않을 쪽은 체크를 풀어 주세요.` : '삭제할 빈 페이지는 없었습니다.'),
    found.length ? h('div', { class: 'btnrow' }, h('button', { class: 'btn small', onclick: () => { checks.forEach(c => { c.checked = true; }); upd(); } }, '모두 선택'), h('button', { class: 'btn small', onclick: () => { checks.forEach(c => { c.checked = false; }); upd(); } }, '모두 해제'), label) : null,
    found.length ? grid : null,
    holeCount ? h('label', { class: 'chk' }, eraseHoles, `남는 ${withHoles.length}쪽의 파일철 구멍 자국 ${holeCount}곳 지우기`) : null,
  ];
  modal({
    title: '찾은 결과', wide: true, body,
    actions: [{ label: '닫기' }, {
      label: '적용', kind: 'primary',
      run: async () => ((await applyBlank(found, withHoles, new Set(found.filter((_, k) => checks[k].checked).map(f => f.i)), !!holeCount && eraseHoles.checked)) === false ? false : undefined),
    }],
  });
}
