// 새 도구용 PDF 처리: 머리글·쪽번호 · 자르기 · 나누기 · 속성 · 빈 문서/글→PDF · 양식 · 교정 (© 2026 GLORY KIM)
import { embedKR, geom, hex, renderCanvas } from './pdfcore.js';

const L = window.PDFLib;
const { PDFDocument, degrees, rgb, PDFTextField, PDFCheckBox, PDFDropdown, PDFRadioGroup, PDFOptionList } = L;
const fieldType = f => (f instanceof PDFTextField ? 'text' : f instanceof PDFCheckBox ? 'check' : f instanceof PDFDropdown ? 'drop' : f instanceof PDFRadioGroup ? 'radio' : f instanceof PDFOptionList ? 'list' : 'other');
const todayStr = () => new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\s/g, '');

// 머리글·바닥글·쪽 번호. opts: {idx, header:{l,c,r}, footer:{l,c,r}, size, color, margin, start, name}
export async function addHeaderFooter(bytes, opts) {
  const doc = await PDFDocument.load(bytes);
  const pages = doc.getPages();
  const total = pages.length;
  const fill = (t, i) => String(t || '').replace(/\{n\}/g, String(i + opts.start)).replace(/\{N\}/g, String(total)).replace(/\{date\}/g, todayStr()).replace(/\{name\}/g, opts.name || '');
  const sets = opts.idx.map((i, k) => ({ i, t: ['header', 'footer'].flatMap(kind => ['l', 'c', 'r'].map(a => ({ kind, a, text: fill(opts[kind]?.[a], k) }))).filter(x => x.text) }));
  const all = sets.flatMap(s => s.t.map(x => x.text)).join('');
  if (!all) throw new Error('넣을 글자를 입력해 주세요');
  const font = await embedKR(doc, false, all);
  for (const { i, t } of sets) {
    const page = pages[i], g = geom(page);
    for (const x of t) {
      const w = font.widthOfTextAtSize(x.text, opts.size);
      const dx = x.a === 'l' ? opts.margin : x.a === 'c' ? (g.dw - w) / 2 : g.dw - opts.margin - w;
      const dy = x.kind === 'header' ? opts.margin + opts.size * 0.8 : g.dh - opts.margin;
      const [px, py] = g.d2p(dx, dy);
      page.drawText(x.text, { x: px, y: py, size: opts.size, font, color: hex(opts.color), rotate: degrees(g.r) });
    }
  }
  return doc.save();
}

// 쪽 자르기: 표시 영역(CropBox)을 줄인다. m = {t,r,b,l} (pt, 화면 기준)
export async function cropPages(bytes, idx, m) {
  const doc = await PDFDocument.load(bytes);
  const pages = doc.getPages();
  for (const i of idx) {
    const page = pages[i], g = geom(page);
    const w = g.dw - m.l - m.r, h2 = g.dh - m.t - m.b;
    if (w < 20 || h2 < 20) throw new Error('자르는 여백이 너무 큽니다');
    const a = g.d2p(m.l, m.t + h2), c = g.d2p(m.l + w, m.t);
    page.setCropBox(Math.min(a[0], c[0]), Math.min(a[1], c[1]), Math.abs(c[0] - a[0]), Math.abs(c[1] - a[1]));
  }
  return doc.save();
}

// 나누기: groups = [[0,1,2],[3,4]] → [{bytes, pages}]
export async function splitPdf(bytes, groups) {
  const src = await PDFDocument.load(bytes);
  const out = [];
  for (const g of groups) {
    const d = await PDFDocument.create();
    (await d.copyPages(src, g)).forEach(p => d.addPage(p));
    out.push({ bytes: await d.save(), pages: g });
  }
  return out;
}

export async function getMeta(bytes) {
  const d = await PDFDocument.load(bytes, { updateMetadata: false });
  return { title: d.getTitle() || '', author: d.getAuthor() || '', subject: d.getSubject() || '', keywords: d.getKeywords() || '', creator: d.getCreator() || '', producer: d.getProducer() || '', pages: d.getPageCount() };
}
export async function setMeta(bytes, m) {
  const d = await PDFDocument.load(bytes, { updateMetadata: false });
  d.setTitle(m.title || ''); d.setAuthor(m.author || ''); d.setSubject(m.subject || '');
  d.setKeywords((m.keywords || '').split(/[,;]\s*/).filter(Boolean));
  d.setCreator(m.creator || ''); d.setProducer(m.producer || 'PDF 공작소');
  d.setModificationDate(new Date());
  return d.save();
}

// 빈 문서 · 글에서 PDF 만들기
export const PAGE_SIZES = { a4: [595.28, 841.89], a3: [841.89, 1190.55], a5: [419.53, 595.28], letter: [612, 792], legal: [612, 1008] };
export async function blankPdf(size, landscape, count) {
  const d = await PDFDocument.create();
  let [w, h2] = PAGE_SIZES[size] || PAGE_SIZES.a4;
  if (landscape) [w, h2] = [h2, w];
  for (let i = 0; i < count; i++) d.addPage([w, h2]);
  return d.save();
}
export async function textToPdf(text, o = {}) {
  const d = await PDFDocument.create();
  const size = o.size || 11, margin = o.margin || 56;
  const [pw, ph] = PAGE_SIZES[o.page || 'a4'];
  const font = await embedKR(d, false, text + '…');
  const bold = await embedKR(d, true, text + '…');
  const maxW = pw - margin * 2;
  let page = d.addPage([pw, ph]), y = ph - margin;
  const newPage = () => { page = d.addPage([pw, ph]); y = ph - margin; };
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const head = /^(#{1,3})\s+(.*)$/.exec(raw);
    const fs = head ? size * (head[1].length === 1 ? 1.8 : head[1].length === 2 ? 1.4 : 1.2) : size, f = head ? bold : font, line = head ? head[2] : raw;
    const step = fs * 1.55;
    if (!line.trim()) { y -= size * 0.9; if (y < margin) newPage(); continue; }
    let cur = '';
    const lines = [];
    for (const ch of [...line]) {
      if (f.widthOfTextAtSize(cur + ch, fs) > maxW) { lines.push(cur); cur = ch.trimStart(); } else cur += ch;
    }
    lines.push(cur);
    if (head) y -= fs * 0.4;
    for (const l of lines) {
      if (y - fs < margin) newPage();
      page.drawText(l, { x: margin, y: y - fs, size: fs, font: f, color: rgb(0.08, 0.08, 0.08) });
      y -= step;
    }
  }
  return d.save();
}

// ---------- 양식 필드 ----------
export async function listFormFields(bytes) {
  const d = await PDFDocument.load(bytes);
  let fields;
  try { fields = d.getForm().getFields(); } catch { return []; }
  const pages = d.getPages();
  return fields.map(f => {
    const kind = fieldType(f);
    let value = '', options = [];
    try {
      if (kind === 'text') value = f.getText() || '';
      else if (kind === 'check') value = f.isChecked();
      else if (kind === 'radio') { options = f.getOptions(); value = f.getSelected() || ''; }
      else if (kind === 'drop' || kind === 'list') { options = f.getOptions(); value = f.getSelected()[0] || ''; }
    } catch { /* 읽기 불가 */ }
    let page = 0;
    try { const pr = f.acroField.getWidgets()[0].P(); page = Math.max(0, pages.findIndex(p => p.ref === pr)); } catch { /* 쪽 모름 */ }
    return { name: f.getName(), kind, value, options, page };
  });
}
export async function fillFormFields(bytes, values, flat) {
  const d = await PDFDocument.load(bytes);
  const form = d.getForm();
  const font = await embedKR(d, false, Object.values(values).filter(v => typeof v === 'string').join('') + '✓');
  for (const [name, v] of Object.entries(values)) {
    let f; try { f = form.getField(name); } catch { continue; }
    const t = fieldType(f);
    try {
      if (t === 'text') f.setText(v);
      else if (t === 'check') { if (v) f.check(); else f.uncheck(); }
      else if (v && (t === 'drop' || t === 'radio' || t === 'list')) f.select(v);
    } catch (e) { console.warn('필드 채우기 실패', name, e); }
  }
  form.updateFieldAppearances(font);
  if (flat) form.flatten();
  return d.save();
}
export async function flattenForm(bytes) {
  const d = await PDFDocument.load(bytes);
  try { d.getForm().flatten(); } catch { /* 양식 없음 */ }
  return d.save();
}
// 필드 개체(overlay type 'field') → 진짜 양식 필드 (flatten 뒤에 호출)
export async function addFormFields(bytes, overlays) {
  const d = await PDFDocument.load(bytes);
  const form = d.getForm();
  const pages = d.getPages();
  const font = await embedKR(d, false, '서명날짜');
  const used = new Set(form.getFields().map(f => f.getName()));
  const uniq = n => { const base = n || 'field'; let k = base, i = 1; while (used.has(k)) k = base + '_' + (++i); used.add(k); return k; };
  const radios = {};
  let ro = 0;
  for (const [pi, list] of Object.entries(overlays)) {
    const page = pages[+pi], g = geom(page);
    for (const o of list) {
      if (o.type !== 'field') continue;
      const a = g.d2p(o.x, o.y + o.h), c = g.d2p(o.x + o.w, o.y);
      const box = { x: Math.min(a[0], c[0]), y: Math.min(a[1], c[1]), width: Math.abs(c[0] - a[0]), height: Math.abs(c[1] - a[1]) };
      const style = { borderWidth: 1, borderColor: rgb(0.1, 0.45, 0.9), backgroundColor: rgb(0.93, 0.96, 1) };
      if (o.kind === 'text') { const f = form.createTextField(uniq(o.name)); f.addToPage(page, { ...box, ...style, font }); if (o.multiline) f.enableMultiline(); }
      else if (o.kind === 'check') { const f = form.createCheckBox(uniq(o.name)); f.addToPage(page, { ...box, ...style }); }
      else if (o.kind === 'drop') { const f = form.createDropdown(uniq(o.name)); f.addOptions((o.options || 'A,B,C').split(/\s*,\s*/).filter(Boolean)); f.addToPage(page, { ...box, ...style, font }); }
      else if (o.kind === 'radio') { const key = o.name || 'radio'; const r = radios[key] || (radios[key] = form.createRadioGroup(uniq(key))); r.addOptionToPage('선택' + (++ro), page, { ...box, ...style }); }
      else if (o.kind === 'sign') {
        page.drawRectangle({ ...box, borderColor: rgb(0.32, 0.35, 0.89), borderWidth: 1, borderDashArray: [4, 3], color: rgb(0.95, 0.95, 1) });
        page.drawText(o.name || '서명', { x: box.x + 4, y: box.y + box.height / 2 - 4, size: Math.min(12, Math.max(6, box.height * 0.5)), font, color: rgb(0.32, 0.35, 0.89) });
      }
    }
  }
  form.updateFieldAppearances(font);
  return d.save();
}

// 지정한 쪽을 그림으로 바꾼다 (교정 후 완전 삭제). pdf: pdf.js 문서
export async function rasterizePages(bytes, pdf, idx, scale = 2.2, onProg) {
  const src = await PDFDocument.load(bytes);
  const out = await PDFDocument.create();
  const set = new Set(idx);
  const n = src.getPageCount();
  for (let i = 0; i < n; i++) {
    if (!set.has(i)) { const [p] = await out.copyPages(src, [i]); out.addPage(p); continue; }
    onProg?.(i, n);
    const pg = await pdf.getPage(i + 1);
    const vp = pg.getViewport({ scale: 1 });
    const cv = await renderCanvas(pdf, i + 1, scale);
    const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.92));
    cv.width = 0;
    const img = await out.embedJpg(new Uint8Array(await blob.arrayBuffer()));
    const page = out.addPage([vp.width, vp.height]);
    page.drawImage(img, { x: 0, y: 0, width: vp.width, height: vp.height });
  }
  return out.save();
}
