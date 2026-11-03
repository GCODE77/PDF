// PDF 처리 코어 (pdf-lib / pdf.js 래퍼). 모든 처리는 브라우저 안에서만 이루어집니다.
const L = window.PDFLib;
const { PDFDocument, degrees, rgb, BlendMode, LineCapStyle, beginMarkedContent, endMarkedContent, decodePDFRawStream, PDFName, PDFRawStream, PDFArray, PDFDict } = L;

export const WM_TAG = 'JVMWM';
export const FS = 4 / 3;                     // 100% 배율 = 1pt 당 4/3 css px (96dpi)
export const LH = 1.3;                       // 텍스트 줄 간격(배)
export const BASE = 1.086;                   // 첫 줄 기준선 위치(배) — Noto Sans KR 기준

// ---------- 폰트 ----------
const fbytes = {};
async function fontData(bold) {
  const k = bold ? 'b' : 'r';
  if (!fbytes[k]) {
    const r = await fetch(`vendor/fonts/NotoSansKR-${bold ? 'Bold' : 'Regular'}.ttf`);
    if (!r.ok) throw new Error('글꼴을 불러오지 못했습니다');
    fbytes[k] = new Uint8Array(await r.arrayBuffer());
  }
  return fbytes[k];
}
// 사용한 글자만 남긴 TrueType 서브셋을 직접 만든다 (글리프 번호는 원본과 동일하게 유지)
const fkCache = {};
export async function subsetFont(bold, text) {
  const data = await fontData(bold);
  const fk = fkCache[bold ? 1 : 0] || (fkCache[bold ? 1 : 0] = window.fontkit.create(data));
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const T = {};
  for (let i = 0, n = dv.getUint16(4); i < n; i++) {
    const o = 12 + i * 16;
    T[String.fromCharCode(...data.subarray(o, o + 4))] = { off: dv.getUint32(o + 8), len: dv.getUint32(o + 12) };
  }
  const locFmt = dv.getInt16(T.head.off + 50), numGlyphs = dv.getUint16(T.maxp.off + 4);
  const loca = [];
  for (let i = 0; i <= numGlyphs; i++) loca.push(locFmt ? dv.getUint32(T.loca.off + i * 4) : dv.getUint16(T.loca.off + i * 2) * 2);
  const keep = new Set();
  const add = id => {
    if (keep.has(id) || id >= numGlyphs) return;
    keep.add(id);
    const s = loca[id], e = loca[id + 1];
    if (e - s < 10) return;
    const go = T.glyf.off + s;
    if (dv.getInt16(go) < 0) {            // 합성 글리프: 구성 요소도 포함
      let p = go + 10;
      for (;;) {
        const fl = dv.getUint16(p); add(dv.getUint16(p + 2));
        p += 4 + (fl & 1 ? 4 : 2);
        if (fl & 8) p += 2; else if (fl & 0x40) p += 4; else if (fl & 0x80) p += 8;
        if (!(fl & 0x20)) break;
      }
    }
  };
  add(0);
  const cmap = [];
  for (const ch of new Set(text)) {
    const cp = ch.codePointAt(0), g = fk.glyphForCodePoint(cp);
    if (g && g.id) { cmap.push([cp, g.id]); add(g.id); }
  }
  cmap.sort((a, b) => a[0] - b[0]);
  // glyf / loca
  const parts = [], nl = new Uint32Array(numGlyphs + 1);
  let pos = 0;
  for (let i = 0; i < numGlyphs; i++) {
    nl[i] = pos;
    if (!keep.has(i)) continue;
    const s = loca[i], e = loca[i + 1];
    if (e <= s) continue;
    parts.push(data.subarray(T.glyf.off + s, T.glyf.off + e)); pos += e - s;
    const pad = (4 - pos % 4) % 4;
    if (pad) { parts.push(new Uint8Array(pad)); pos += pad; }
  }
  nl[numGlyphs] = pos;
  const glyf = new Uint8Array(pos); let q = 0;
  for (const p of parts) { glyf.set(p, q); q += p.length; }
  const locaB = new Uint8Array((numGlyphs + 1) * 4), ldv = new DataView(locaB.buffer);
  nl.forEach((v, i) => ldv.setUint32(i * 4, v));
  const head = data.slice(T.head.off, T.head.off + T.head.len);
  new DataView(head.buffer).setInt16(50, 1); new DataView(head.buffer).setUint32(8, 0);
  // cmap (format 12)
  const cm = new Uint8Array(12 + 16 + cmap.length * 12), cd = new DataView(cm.buffer);
  cd.setUint16(2, 1); cd.setUint16(4, 3); cd.setUint16(6, 10); cd.setUint32(8, 12);
  cd.setUint16(12, 12); cd.setUint32(16, 16 + cmap.length * 12); cd.setUint32(24, cmap.length);
  cmap.forEach(([cp, gid], i) => { const o = 28 + i * 12; cd.setUint32(o, cp); cd.setUint32(o + 4, cp); cd.setUint32(o + 8, gid); });
  const tabs = { head, cmap: cm, glyf, loca: locaB };
  for (const t of ['OS/2', 'hhea', 'hmtx', 'maxp', 'name', 'post', 'prep', 'cvt ', 'fpgm'])
    if (T[t]) tabs[t] = data.subarray(T[t].off, T[t].off + T[t].len);
  const tags = Object.keys(tabs).sort(), n = tags.length;
  let off = 12 + n * 16;
  const out = new Uint8Array(off + tags.reduce((a, t) => a + ((tabs[t].length + 3) & ~3), 0)), od = new DataView(out.buffer);
  od.setUint32(0, 0x00010000); od.setUint16(4, n);
  const es = Math.floor(Math.log2(n));
  od.setUint16(6, 16 << es); od.setUint16(8, es); od.setUint16(10, n * 16 - (16 << es));
  tags.forEach((t, i) => {
    const b = tabs[t], r = 12 + i * 16;
    for (let k = 0; k < 4; k++) out[r + k] = t.charCodeAt(k);
    let sum = 0;
    const padded = new Uint8Array((b.length + 3) & ~3); padded.set(b);
    const pd = new DataView(padded.buffer);
    for (let k = 0; k < padded.length; k += 4) sum = (sum + pd.getUint32(k)) >>> 0;
    od.setUint32(r + 4, sum); od.setUint32(r + 8, off); od.setUint32(r + 12, b.length);
    out.set(padded, off); off += padded.length;
  });
  return out;
}
export async function embedKR(doc, bold, text) {
  if (!doc.__fk) { doc.registerFontkit(window.fontkit); doc.__fk = true; }
  return doc.embedFont(await subsetFont(bold, text), { subset: false });
}

export const hex = c => {
  const m = /^#?([0-9a-f]{6})$/i.exec(c || '') || [0, '000000'];
  const n = parseInt(m[1], 16);
  return rgb((n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255);
};

// ---------- 페이지 좌표 (화면 좌표(좌상단, pt) -> PDF 사용자 좌표) ----------
export function geom(page) {
  const b = page.getCropBox();
  const r = ((page.getRotation().angle % 360) + 360) % 360;
  const { x: x0, y: y0, width: W, height: H } = b;
  const dw = r % 180 ? H : W, dh = r % 180 ? W : H;
  const d2p = (dx, dy) => r === 0 ? [x0 + dx, y0 + H - dy]
    : r === 90 ? [x0 + dy, y0 + dx]
    : r === 180 ? [x0 + W - dx, y0 + dy]
    : [x0 + W - dy, y0 + H - dx];
  return { r, dw, dh, d2p };
}

const dataToBytes = d => Uint8Array.from(atob(d.split(',')[1]), c => c.charCodeAt(0));

// ---------- 편집 내용(텍스트·서명·도형 등)을 PDF에 굽기 ----------
export async function flatten(bytes, overlays, imgs) {
  const doc = await PDFDocument.load(bytes);
  const pages = doc.getPages();
  const imgCache = {};
  const need = [new Set(), new Set()], kr = [];
  for (const list of Object.values(overlays)) for (const o of list) if (o.type === 'text') for (const ch of o.text) need[o.bold ? 1 : 0].add(ch);
  for (const k of [0, 1]) if (need[k].size) kr[k] = await embedKR(doc, !!k, [...need[k]].join(''));
  for (const [pi, list] of Object.entries(overlays)) {
    const page = pages[+pi];
    if (!page || !list.length) continue;
    const g = geom(page);
    // 본문 수정·교정: 원본 글자를 PDF 내부에서 실제로 지운다 (실패해도 위에 덮는 방식으로 가려짐)
    const kills = list.filter(o => (o.type === 'whiteout' && o.edit) || o.type === 'redact');
    if (kills.length) { try { stripPageText(doc, page, kills.map(o => ({ x: o.x, y: o.y, w: o.w, h: o.h, by: o.type === 'whiteout' ? o.by : undefined, size: o.size }))); } catch (e) { console.warn('원본 글자 제거 실패', e); } }
    for (const o of list) {
      const ang = degrees(g.r);
      if (o.type === 'highlight' && o.ls) {
        const yy = o.ls === 'underline' ? o.y + o.h * 0.92 : o.y + o.h * 0.55;
        const a = g.d2p(o.x, yy), c = g.d2p(o.x + o.w, yy);
        page.drawLine({ start: { x: a[0], y: a[1] }, end: { x: c[0], y: c[1] }, thickness: Math.max(0.8, o.h * 0.07), color: hex(o.color) });
      } else if (o.type === 'shape') {
        const sw = o.sw || 2, col = hex(o.color);
        if (o.shape === 'rect') { const [px, py] = g.d2p(o.x, o.y + o.h); page.drawRectangle({ x: px, y: py, width: o.w, height: o.h, rotate: ang, borderColor: col, borderWidth: sw }); }
        else if (o.shape === 'ellipse') { const [cx, cy] = g.d2p(o.x + o.w / 2, o.y + o.h / 2); const sw90 = g.r % 180; page.drawEllipse({ x: cx, y: cy, xScale: (sw90 ? o.h : o.w) / 2, yScale: (sw90 ? o.w : o.h) / 2, borderColor: col, borderWidth: sw }); }
        else {
          const s0 = [o.fx ? o.x + o.w : o.x, o.fy ? o.y + o.h : o.y], e0 = [o.fx ? o.x : o.x + o.w, o.fy ? o.y : o.y + o.h];
          const a = g.d2p(...s0), c = g.d2p(...e0);
          page.drawLine({ start: { x: a[0], y: a[1] }, end: { x: c[0], y: c[1] }, thickness: sw, color: col, lineCap: LineCapStyle.Round });
          if (o.shape === 'arrow') {
            const an = Math.atan2(e0[1] - s0[1], e0[0] - s0[0]), Ln = Math.max(8, sw * 4);
            for (const d of [-0.45, 0.45]) { const t = g.d2p(e0[0] - Ln * Math.cos(an + d), e0[1] - Ln * Math.sin(an + d)); page.drawLine({ start: { x: c[0], y: c[1] }, end: { x: t[0], y: t[1] }, thickness: sw, color: col, lineCap: LineCapStyle.Round }); }
          }
        }
      } else if (o.type === 'whiteout' || o.type === 'highlight' || o.type === 'redact') {
        const [px, py] = g.d2p(o.x, o.y + o.h);
        page.drawRectangle({
          x: px, y: py, width: o.w, height: o.h, rotate: ang, color: hex(o.color),
          opacity: o.type === 'highlight' ? 0.4 : 1,
          blendMode: o.type === 'highlight' ? BlendMode.Multiply : BlendMode.Normal,
        });
      } else if (o.type === 'text') {
        const font = kr[o.bold ? 1 : 0];
        const pad = o.bg ? 4 : 2;
        if (o.bg) {
          const [px, py] = g.d2p(o.x, o.y + o.h);
          page.drawRectangle({ x: px, y: py, width: o.w, height: o.h, rotate: ang, color: hex(o.bg), borderColor: hex('#e0c200'), borderWidth: 0.5 });
        }
        o.text.split('\n').forEach((line, i) => {
          if (!line.trim()) return;
          const [px, py] = g.d2p(o.x + pad, o.y + pad + i * LH * o.size + BASE * o.size);
          page.drawText(line, { x: px, y: py, size: o.size, font, color: hex(o.color), rotate: ang });
        });
      } else if (o.type === 'image') {
        const d = imgs[o.img];
        if (!d) continue;
        if (!imgCache[o.img]) imgCache[o.img] = /^data:image\/png/.test(d) ? await doc.embedPng(dataToBytes(d)) : await doc.embedJpg(dataToBytes(d));
        const [px, py] = g.d2p(o.x, o.y + o.h);
        page.drawImage(imgCache[o.img], { x: px, y: py, width: o.w, height: o.h, rotate: ang, opacity: o.opacity ?? 1 });
      } else if (o.type === 'ink') {
        const p = o.pts.map(([x, y]) => g.d2p(x, y));
        for (let i = 1; i < p.length; i++)
          page.drawLine({ start: { x: p[i - 1][0], y: p[i - 1][1] }, end: { x: p[i][0], y: p[i][1] }, thickness: o.sw, color: hex(o.color), lineCap: LineCapStyle.Round });
        if (p.length === 1) page.drawCircle({ x: p[0][0], y: p[0][1], size: o.sw / 2, color: hex(o.color) });
      }
    }
  }
  return doc.save();
}

// ---------- 페이지 구성 ----------
// plan: [{src, rot}] 또는 [{blank:true,w,h}]
export async function applyPlan(bytes, plan) {
  const src = await PDFDocument.load(bytes);
  const simple = plan.every((p, i) => !p.blank && (i === 0 || p.src > plan[i - 1].src));
  if (simple) {
    const pages = src.getPages();      // removePage 이후에는 캐시가 어긋날 수 있어 먼저 회전 적용
    plan.forEach(p => { if (p.rot) pages[p.src].setRotation(degrees((pages[p.src].getRotation().angle + p.rot + 360) % 360)); });
    const keep = new Set(plan.map(p => p.src));
    for (let i = pages.length - 1; i >= 0; i--) if (!keep.has(i)) src.removePage(i);
    return src.save();
  }
  const out = await PDFDocument.create();
  for (const it of plan) {
    if (it.blank) { out.addPage([it.w, it.h]); continue; }
    const [p] = await out.copyPages(src, [it.src]);
    if (it.rot) p.setRotation(degrees((p.getRotation().angle + it.rot + 360) % 360));
    out.addPage(p);
  }
  return out.save();
}

export const extractPages = (bytes, idxs) => applyPlan(bytes, idxs.map(src => ({ src, rot: 0 })));

export async function mergePdfs(list) {
  const out = await PDFDocument.create();
  for (const b of list) {
    const d = await PDFDocument.load(b);
    const pages = await out.copyPages(d, d.getPageIndices());
    pages.forEach(p => out.addPage(p));
  }
  return out.save();
}

export async function insertPdf(bytes, atIndex, otherBytes) {
  const doc = await PDFDocument.load(bytes);
  const o = await PDFDocument.load(otherBytes);
  const pages = await doc.copyPages(o, o.getPageIndices());
  pages.forEach((p, i) => doc.insertPage(atIndex + i, p));
  return doc.save();
}

// ---------- 사진 -> PDF ----------
export async function toCanvas(file, rot = 0, maxDim = 3200) {
  let bmp;
  try { bmp = await createImageBitmap(file); }
  catch { throw new Error(`'${file.name}' 형식을 읽을 수 없습니다 (JPG·PNG·WEBP·BMP·GIF 지원)`); }
  const k = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
  const sw = rot % 180 ? h : w, sh = rot % 180 ? w : h;
  const cv = document.createElement('canvas');
  cv.width = sw; cv.height = sh;
  const c = cv.getContext('2d');
  c.fillStyle = '#fff'; c.fillRect(0, 0, sw, sh);
  c.translate(sw / 2, sh / 2); c.rotate(rot * Math.PI / 180);
  c.drawImage(bmp, -w / 2, -h / 2, w, h);
  bmp.close?.();
  return cv;
}
export const canvasBytes = async (cv, q = 0.9) => new Uint8Array(await (await new Promise(r => cv.toBlob(r, 'image/jpeg', q))).arrayBuffer());

export async function imagesToPdf(items, { size = 'fit', margin = 0, quality = 0.9 }, prog) {
  const out = await PDFDocument.create();
  let i = 0;
  for (const it of items) {
    prog?.(i / items.length, `${i + 1} / ${items.length} 변환 중`);
    const cv = await toCanvas(it.file, it.rot || 0);
    const img = await out.embedJpg(await canvasBytes(cv, quality));
    let pw = cv.width * 0.75, ph = cv.height * 0.75;
    if (size === 'a4') { [pw, ph] = cv.width > cv.height ? [841.89, 595.28] : [595.28, 841.89]; }
    const page = out.addPage([pw, ph]);
    const m = size === 'a4' ? margin : 0;
    const aw = pw - m * 2, ah = ph - m * 2;
    const k = Math.min(aw / cv.width, ah / cv.height);
    const w = cv.width * k, h = cv.height * k;
    page.drawImage(img, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
    cv.width = 0;
    i++;
    await new Promise(r => setTimeout(r));
  }
  return out.save();
}

// ---------- 워터마크 ----------
export async function addWatermark(bytes, o) {
  const doc = await PDFDocument.load(bytes);
  const pages = doc.getPages();
  const font = o.kind === 'text' ? await embedKR(doc, true, o.text) : null;
  let img = null, ih = 1, iw = 1;
  if (o.kind === 'image') {
    img = /^data:image\/png/.test(o.img) ? await doc.embedPng(dataToBytes(o.img)) : await doc.embedJpg(dataToBytes(o.img));
    iw = img.width; ih = img.height;
  }
  const th = o.angle * Math.PI / 180;
  const u = [Math.cos(th), -Math.sin(th)], n = [-Math.sin(th), -Math.cos(th)];
  const idxs = o.pages || pages.map((_, i) => i);
  for (const i of idxs) {
    const page = pages[i];
    const g = geom(page);
    let w, hgt;
    if (o.kind === 'text') { w = font.widthOfTextAtSize(o.text, o.size); hgt = o.size; }
    else { w = Math.min(g.dw, g.dh) * o.scale; hgt = w * ih / iw; }
    const centers = [];
    if (o.layout === 'tile') {
      const sx = w * 1.5 + 30, sy = hgt * 3 + 40;
      let row = 0;
      for (let y = sy / 2; y < g.dh + sy; y += sy, row++)
        for (let x = (row % 2 ? sx / 2 : 0); x < g.dw + sx; x += sx) centers.push([x - sx / 4, y - sy / 4]);
    } else centers.push([g.dw / 2, g.dh / 2]);
    page.pushOperators(beginMarkedContent(WM_TAG));
    for (const [cx, cy] of centers) {
      const ox = o.kind === 'text' ? hgt * 0.35 : hgt / 2;
      const ax = cx - u[0] * w / 2 - n[0] * ox, ay = cy - u[1] * w / 2 - n[1] * ox;
      const [px, py] = g.d2p(ax, ay);
      const rot = degrees(o.angle + g.r);
      if (o.kind === 'text') page.drawText(o.text, { x: px, y: py, size: o.size, font, color: hex(o.color), opacity: o.opacity, rotate: rot });
      else page.drawImage(img, { x: px, y: py, width: w, height: hgt, opacity: o.opacity, rotate: rot });
    }
    page.pushOperators(endMarkedContent());
  }
  return doc.save();
}

// 이 앱이 넣은 워터마크(표식 포함) + PDF 표준 Watermark 주석을 제거
export async function removeWatermark(bytes) {
  const doc = await PDFDocument.load(bytes);
  const ctx = doc.context;
  let removed = 0;
  const re = new RegExp(`/${WM_TAG} BMC[\\s\\S]*?EMC`, 'g');
  for (const page of doc.getPages()) {
    const raw = page.node.get(PDFName.of('Contents'));
    const c = raw && ctx.lookup(raw);
    const refs = [];
    if (c instanceof PDFArray) for (let i = 0; i < c.size(); i++) refs.push(c.get(i));
    else if (raw) refs.push(raw);
    for (const r of refs) {
      const st = ctx.lookup(r);
      if (!(st instanceof PDFRawStream)) continue;
      let txt;
      try { txt = new TextDecoder('latin1').decode(decodePDFRawStream(st).decode()); } catch { continue; }
      if (!txt.includes(`/${WM_TAG} BMC`)) continue;
      const cleaned = txt.replace(re, () => { removed++; return ''; });
      const arr = Uint8Array.from(cleaned, ch => ch.charCodeAt(0));
      ctx.assign(r, ctx.flateStream(arr));
    }
    const an = page.node.Annots();
    if (an) {
      for (let i = an.size() - 1; i >= 0; i--) {
        const a = ctx.lookupMaybe(an.get(i), PDFDict);
        if (a && a.get(PDFName.of('Subtype')) === PDFName.of('Watermark')) { an.remove(i); removed++; }
      }
    }
  }
  return { bytes: await doc.save(), removed };
}

// ---------- 보안 ----------
export async function encryptPdf(bytes, { user, owner, print, copy, edit }) {
  const doc = await PDFDocument.load(bytes);
  await doc.encrypt({
    userPassword: user || '',
    ownerPassword: owner || user,
    permissions: { printing: print ? 'highResolution' : false, modifying: edit, copying: copy, annotating: edit, fillingForms: edit, contentAccessibility: true, documentAssembly: edit },
  });
  return doc.save({ useObjectStreams: false });
}

export async function optimize(bytes) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  doc.setTitle(''); doc.setAuthor(''); doc.setSubject(''); doc.setKeywords([]); doc.setProducer(''); doc.setCreator('');
  return doc.save({ useObjectStreams: true });
}

// ---------- pdf.js 렌더 ----------
export async function renderCanvas(pdf, num, scale, cv) {
  const page = await pdf.getPage(num);
  const vp = page.getViewport({ scale });
  cv = cv || document.createElement('canvas');
  cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
  const c = cv.getContext('2d', { willReadFrequently: false });
  c.fillStyle = '#fff'; c.fillRect(0, 0, cv.width, cv.height);
  await page.render({ canvasContext: c, viewport: vp }).promise;
  page.cleanup();
  return cv;
}

// 선택한 페이지를 그림으로 다시 만들어 문서를 재구성 (압축·배경 정리·암호 해제용)
export async function rasterRebuild(bytes, pdf, { indices = null, scale = 1.5, quality = 0.7, filter = null }, prog) {
  const sel = indices ? new Set(indices) : null;
  const src = sel && sel.size < pdf.numPages ? await PDFDocument.load(bytes) : null;
  const out = await PDFDocument.create();
  for (let i = 0; i < pdf.numPages; i++) {
    if (prog && prog(i / pdf.numPages, `${i + 1} / ${pdf.numPages} 페이지 처리 중`) === false) throw new Error('취소되었습니다');
    if (sel && !sel.has(i)) { const [p] = await out.copyPages(src, [i]); out.addPage(p); continue; }
    const page = await pdf.getPage(i + 1);
    const v1 = page.getViewport({ scale: 1 });
    const cv = await renderCanvas(pdf, i + 1, scale);
    if (filter) filter(cv);
    const jpg = await out.embedJpg(await canvasBytes(cv, quality));
    cv.width = 0;
    const np = out.addPage([v1.width, v1.height]);
    np.drawImage(jpg, { x: 0, y: 0, width: v1.width, height: v1.height });
    await new Promise(r => setTimeout(r));
  }
  return out.save();
}

// ---------- 배경 정리 필터 ----------
export function cleanCanvas(cv, { mode = 'color', strength = 50 }) {
  const w = cv.width, h = cv.height, ctx = cv.getContext('2d');
  const img = ctx.getImageData(0, 0, w, h), d = img.data;
  const k = 16, sw = Math.max(2, Math.ceil(w / k)), sh = Math.max(2, Math.ceil(h / k));
  const sm = document.createElement('canvas'); sm.width = sw; sm.height = sh;
  const sc = sm.getContext('2d'); sc.drawImage(cv, 0, 0, sw, sh);
  const s = sc.getImageData(0, 0, sw, sh).data;
  const maxf = (src, r) => {          // 분리형 최대값 필터 (종이 밝기 추정)
    const t = new Uint8ClampedArray(src.length), o = new Uint8ClampedArray(src.length);
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) for (let c = 0; c < 3; c++) {
      let m = 0; for (let dx = -r; dx <= r; dx++) { const xx = Math.min(sw - 1, Math.max(0, x + dx)); m = Math.max(m, src[(y * sw + xx) * 4 + c]); }
      t[(y * sw + x) * 4 + c] = m;
    }
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) for (let c = 0; c < 3; c++) {
      let m = 0; for (let dy = -r; dy <= r; dy++) { const yy = Math.min(sh - 1, Math.max(0, y + dy)); m = Math.max(m, t[(yy * sw + x) * 4 + c]); }
      o[(y * sw + x) * 4 + c] = m; o[(y * sw + x) * 4 + 3] = 255;
    }
    return o;
  };
  const bgSmall = new ImageData(maxf(s, 3), sw, sh);
  sc.putImageData(bgSmall, 0, 0);
  const big = document.createElement('canvas'); big.width = w; big.height = h;
  const bc = big.getContext('2d'); bc.imageSmoothingEnabled = true; bc.imageSmoothingQuality = 'high'; bc.drawImage(sm, 0, 0, w, h);
  const bg = bc.getImageData(0, 0, w, h).data;
  const hi = 255 - strength * 0.9, lo = strength * 0.3, span = Math.max(20, hi - lo);
  for (let i = 0; i < d.length; i += 4) {
    let r = Math.min(255, 255 * d[i] / Math.max(40, bg[i])), g = Math.min(255, 255 * d[i + 1] / Math.max(40, bg[i + 1])), b = Math.min(255, 255 * d[i + 2] / Math.max(40, bg[i + 2]));
    if (mode !== 'color') { r = g = b = 0.299 * r + 0.587 * g + 0.114 * b; }
    if (mode === 'bw') { const v = r > (hi + lo) / 2 ? 255 : 0; r = g = b = v; }
    else { r = (r - lo) / span * 255; g = (g - lo) / span * 255; b = (b - lo) / span * 255; }
    d[i] = r < 0 ? 0 : r > 255 ? 255 : r; d[i + 1] = g < 0 ? 0 : g > 255 ? 255 : g; d[i + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
  }
  ctx.putImageData(img, 0, 0);
  big.width = 0; sm.width = 0;
}

// 흰 배경을 투명하게 (서명·도장 이미지용)
export function whiteToAlpha(cv, thr = 235) {
  const ctx = cv.getContext('2d'), img = ctx.getImageData(0, 0, cv.width, cv.height), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const m = Math.min(d[i], d[i + 1], d[i + 2]);
    if (m >= thr) d[i + 3] = 0;
    else if (m > thr - 40) d[i + 3] = Math.round(255 * (thr - m) / 40);
  }
  ctx.putImageData(img, 0, 0);
}

// ---------- 텍스트 추출 ----------
export async function pageText(pdf, num) {
  const page = await pdf.getPage(num);
  const tc = await page.getTextContent();
  let out = '', lastY = null, lastEnd = null, lastH = 10;
  for (const it of tc.items) {
    if (!it.str && !it.hasEOL) continue;
    const y = it.transform[5], x = it.transform[4], hgt = Math.abs(it.transform[3]) || lastH;
    if (lastY !== null) {
      const dy = Math.abs(y - lastY);
      if (dy > hgt * 1.7) out += '\n\n';
      else if (dy > hgt * 0.5) out += '\n';
      else if (x - lastEnd > hgt * 0.25) out += ' ';
    }
    out += it.str;
    lastY = y; lastEnd = x + it.width; lastH = hgt;
    if (it.hasEOL) { out += '\n'; lastY = null; }
  }
  page.cleanup();
  return out.replace(/[ \t]+\n/g, '\n').trim();
}

// ---------- DOCX (글자만) ----------
export async function makeDocx(pagesText) {
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
  const rpr = '<w:rPr><w:rFonts w:ascii="맑은 고딕" w:hAnsi="맑은 고딕" w:eastAsia="맑은 고딕"/><w:sz w:val="21"/></w:rPr>';
  const paras = [];
  pagesText.forEach((t, i) => {
    t.split(/\n/).forEach(line => paras.push(`<w:p><w:r>${rpr}<w:t xml:space="preserve">${esc(line)}</w:t></w:r></w:p>`));
    if (i < pagesText.length - 1) paras.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
  });
  const z = new window.JSZip();
  z.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  z.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  z.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paras.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>`);
  return z.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

// ---------- OCR 글자를 보이지 않는 텍스트로 얹기 (검색 가능한 PDF) ----------
export async function addInvisibleText(bytes, results) {
  const doc = await PDFDocument.load(bytes);
  const font = await embedKR(doc, false, results.map(r => r.words.map(w => w.text).join('')).join(''));
  const pages = doc.getPages();
  for (const r of results) {
    const page = pages[r.index], g = geom(page);
    const k = g.dw / r.cw;                                // 캔버스 px -> pt
    for (const w of r.words) {
      const t = (w.text || '').trim();
      if (!t) continue;
      const size = Math.max(4, (w.y1 - w.y0) * k * 0.85);
      const [px, py] = g.d2p(w.x0 * k, w.y1 * k - (w.y1 - w.y0) * k * 0.2);
      try { page.drawText(t, { x: px, y: py, size, font, opacity: 0, rotate: degrees(g.r) }); } catch { /* 지원하지 않는 글자 건너뜀 */ }
    }
  }
  return doc.save();
}

// ======================== 원본 글자 실제 제거 (본문 수정 · 교정) ========================
// 콘텐츠 스트림을 읽어 지정한 영역에서 시작하는 글자 출력 명령(Tj/TJ/'/")을 지운다.
const WS = ' \t\r\n\f\0';
const DELIM = '()<>[]{}/%';
function tokenize(str) {
  const toks = [];
  let i = 0;
  const n = str.length;
  while (i < n) {
    const c = str[i];
    if (WS.includes(c)) { i++; continue; }
    const s = i;
    if (c === '%') { while (i < n && str[i] !== '\n' && str[i] !== '\r') i++; continue; }
    if (c === '(') {
      let depth = 1; i++;
      while (i < n && depth) { const d = str[i]; if (d === '\\') i += 2; else { if (d === '(') depth++; else if (d === ')') depth--; i++; } }
      toks.push({ t: 'str', s, e: i }); continue;
    }
    if (c === '<' && str[i + 1] === '<') { i += 2; toks.push({ t: 'dict<', s, e: i }); continue; }
    if (c === '>' && str[i + 1] === '>') { i += 2; toks.push({ t: 'dict>', s, e: i }); continue; }
    if (c === '<') { i++; while (i < n && str[i] !== '>') i++; i++; toks.push({ t: 'str', s, e: i }); continue; }
    if (c === '[') { i++; toks.push({ t: '[', s, e: i }); continue; }
    if (c === ']') { i++; toks.push({ t: ']', s, e: i }); continue; }
    if (c === '/') { i++; while (i < n && !WS.includes(str[i]) && !DELIM.includes(str[i])) i++; toks.push({ t: 'name', s, e: i }); continue; }
    if (c === '{' || c === '}' || c === ')' || c === '>') { i++; continue; }
    while (i < n && !WS.includes(str[i]) && !DELIM.includes(str[i])) i++;
    const w = str.slice(s, i);
    if (/^[-+]?(\d+\.?\d*|\.\d+)$/.test(w)) toks.push({ t: 'num', s, e: i, v: parseFloat(w) });
    else {
      toks.push({ t: 'op', s, e: i, v: w });
      if (w === 'BI') {                               // 인라인 이미지: ID 뒤 이진 데이터는 건너뜀
        const idp = str.indexOf('ID', i);
        if (idp < 0) break;
        let k = idp + 3, found = -1;
        for (;;) { k = str.indexOf('EI', k); if (k < 0) break; if (WS.includes(str[k - 1] || ' ') && (k + 2 >= n || WS.includes(str[k + 2]))) { found = k; break; } k += 2; }
        if (found < 0) break;
        toks.push({ t: 'op', s: found, e: found + 2, v: 'EI' }); i = found + 2;
      }
    }
  }
  return toks;
}
const mul = (a, b) => [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3], a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5]];

// rects: [{x,y,w,h, by?, size?}] 화면 좌표(pt). by 가 있으면 "그 줄"만, 없으면 영역 안의 모든 글자
export function stripTextOps(src, rects, u2d) {
  const toks = tokenize(src);
  const out = [];
  let last = 0, dropped = 0;
  let ctm = [1, 0, 0, 1, 0, 0]; const stack = [];
  let tm = [1, 0, 0, 1, 0, 0], tlm = [1, 0, 0, 1, 0, 0], tl = 0, rise = 0, tfs = 1;
  let args = [];
  const inRect = () => {
    const m = mul([1, 0, 0, 1, 0, rise], mul(tm, ctm));
    const [dx, dy] = u2d(m[4], m[5]);
    return rects.some(r => r.by != null
      ? Math.abs(dy - r.by) < Math.max(2, 0.32 * (r.size || 10)) && dx >= r.x - 2 && dx <= r.x + r.w + 2
      : dx >= r.x - 1 && dx <= r.x + r.w + 1 && dy >= r.y - 1 && dy <= r.y + r.h + 1);
  };
  for (let ti = 0; ti < toks.length; ti++) {
    const tk = toks[ti];
    if (tk.t !== 'op') { args.push(tk); continue; }
    const op = tk.v, nums = args.filter(a => a.t === 'num').map(a => a.v);
    const startPos = args.length ? args[0].s : tk.s;
    const drop = repl => { out.push(src.slice(last, startPos), repl); last = tk.e; dropped++; };
    switch (op) {
      case 'q': stack.push(ctm.slice()); break;
      case 'Q': if (stack.length) ctm = stack.pop(); break;
      case 'cm': if (nums.length === 6) ctm = mul(nums, ctm); break;
      case 'BT': tm = [1, 0, 0, 1, 0, 0]; tlm = tm.slice(); break;
      case 'Td': if (nums.length === 2) { tlm = mul([1, 0, 0, 1, nums[0], nums[1]], tlm); tm = tlm.slice(); } break;
      case 'TD': if (nums.length === 2) { tl = -nums[1]; tlm = mul([1, 0, 0, 1, nums[0], nums[1]], tlm); tm = tlm.slice(); } break;
      case 'Tm': if (nums.length === 6) { tm = nums.slice(); tlm = nums.slice(); } break;
      case 'T*': tlm = mul([1, 0, 0, 1, 0, -tl], tlm); tm = tlm.slice(); break;
      case 'TL': if (nums.length) tl = nums[0]; break;
      case 'Ts': if (nums.length) rise = nums[0]; break;
      case 'Tf': if (nums.length) tfs = nums[nums.length - 1]; break;
      case 'Tj': case 'TJ': if (inRect()) drop(''); break;
      case "'": tlm = mul([1, 0, 0, 1, 0, -tl], tlm); tm = tlm.slice(); if (inRect()) drop('T*'); break;
      case '"': {
        tlm = mul([1, 0, 0, 1, 0, -tl], tlm); tm = tlm.slice();
        if (inRect()) drop(nums.length >= 2 ? `${nums[0]} Tw ${nums[1]} Tc T*` : 'T*');
        break;
      }
      default: break;
    }
    void tfs;
    args = [];
  }
  out.push(src.slice(last));
  return { text: out.join(''), dropped };
}

const lat1 = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return s; };
const unlat1 = s => { const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 255; return u; };

// 한 쪽의 글자 출력을 영역별로 지운다. 지운 개수를 돌려준다
export function stripPageText(doc, page, rects) {
  const b = page.getCropBox();
  const r = ((page.getRotation().angle % 360) + 360) % 360;
  const { x: x0, y: y0, width: W, height: H } = b;
  const u2d = (ux, uy) => r === 0 ? [ux - x0, y0 + H - uy] : r === 90 ? [uy - y0, ux - x0] : r === 180 ? [x0 + W - ux, uy - y0] : [y0 + H - uy, x0 + W - ux];
  const c = page.node.Contents();
  let streams = [];
  if (c instanceof PDFRawStream) streams = [c];
  else if (c instanceof PDFArray) streams = c.asArray().map(ref => doc.context.lookup(ref)).filter(s => s instanceof PDFRawStream);
  else return 0;
  if (!streams.length) return 0;
  const joined = streams.map(s => lat1(decodePDFRawStream(s).decode())).join('\n');
  const res = stripTextOps(joined, rects, u2d);
  if (!res.dropped) return 0;
  const ref = doc.context.register(doc.context.flateStream(unlat1(res.text)));
  page.node.set(PDFName.of('Contents'), ref);
  return res.dropped;
}
