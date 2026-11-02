// 뷰어(페이지 표시 · 확대/축소) + 편집 개체(텍스트·메모·서명·이미지·형광펜·펜·가리기)
import { S, $, $$, h, icon, emit, on, toast, uid } from './state.js';
import { FS, LH, whiteToAlpha } from './pdfcore.js';
import * as D from './doc.js';

const GAP = 14, PAD = 16;
const PALETTE = ['#111111', '#e1251b', '#1473e6', '#1f9d55', '#f59e0b', '#7c3aed'];
const HL_PALETTE = ['#ffe14d', '#7ee787', '#7cc7ff', '#ff9ec7', '#ffb26b'];
const WO_PALETTE = ['#ffffff', '#f5f5f5', '#fff7d6', '#000000'];

let viewerEl, pagesEl, pdfjsLib, barEl;
let info = [];           // 페이지별 {w,h,el,canvas,textEl,hlEl,ovEl,rendered,rendering,gen,task}
let tops = [];
let gen = 0, pointerDown = false;
const scale = () => S.zoom * FS;
export const isPhone = () => matchMedia('(max-width: 820px)').matches;

// ======================== 초기화 ========================
export async function initViewer() {
  viewerEl = $('#viewer'); pagesEl = $('#pages'); barEl = $('#objbar');
  pdfjsLib = await D.getPdfjs();
  on('doc-loaded', build);
  on('overlays-changed', renderOverlays);
  viewerEl.addEventListener('scroll', () => requestAnimationFrame(kick), { passive: true });
  new ResizeObserver(() => { if (S.fit && S.pdf) fit(S.fit, true); else kick(); }).observe(viewerEl);
  viewerEl.addEventListener('pointerdown', e => {
    pointerDown = true;
    if (!e.target.closest('.obj, #objbar, .hd')) deselect();
    if (S.tool === 'hand') startPan(e);
  });
  addEventListener('pointerup', () => { pointerDown = false; });
  viewerEl.addEventListener('wheel', e => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX, e.clientY);
  }, { passive: false });
  initPinch();
  initHighlightSelection();
  addEventListener('keydown', onKey);
  on('tool', updateBar);
  on('selection', updateBar);
}

function onKey(e) {
  if (!S.pdf || e.target.closest('input, textarea, select') || e.target.isContentEditable) return;
  if ((e.key === 'Delete' || e.key === 'Backspace') && S.selected) { e.preventDefault(); removeSelected(); }
  else if (e.key === 'Escape') { deselect(); setTool('select'); }
}

// ======================== 페이지 구성 ========================
async function build({ keepPage, fresh }) {
  const keep = keepPage ? S.curPage : 1;
  gen++;
  info.forEach(p => p.task?.cancel?.());
  pagesEl.replaceChildren(); info = [];
  const sizes = await Promise.all(Array.from({ length: S.n }, (_, i) => S.pdf.getPage(i + 1).then(p => { const v = p.getViewport({ scale: 1 }); return [v.width, v.height]; })));
  sizes.forEach(([w, hh], i) => {
    const p = { w, h: hh, rendered: false, rendering: false, gen: 0 };
    p.canvas = h('canvas');
    p.textEl = h('div', { class: 'textLayer' });
    p.hlEl = h('div', { class: 'hlLayer' });
    p.ovEl = h('div', { class: 'ovl' });
    p.el = h('div', { class: 'page', 'data-p': i }, p.canvas, p.textEl, p.hlEl, p.ovEl, h('span', { class: 'pno' }, String(i + 1)));
    bindPage(p, i);
    pagesEl.append(p.el);
    info.push(p);
  });
  tops = [];
  if (fresh) S.fit = 'auto';
  S.curPage = Math.min(keep, S.n);
  if (S.fit) fit(S.fit, true); else layout();
  scrollToPage(S.curPage);
  renderOverlays();
  emit('pages-built');
}

function layout() {
  const k = scale();
  let y = PAD; tops = [];
  info.forEach(p => {
    p.el.style.width = p.w * k + 'px'; p.el.style.height = p.h * k + 'px';
    tops.push(y); y += p.h * k + GAP;
  });
  $$('.obj', pagesEl).forEach(el => { const f = findObj(el.dataset.id); if (f) styleObj(el, f.o); });
  info.forEach(p => { p.gen++; p.task?.cancel?.(); p.rendered = false; p.rendering = false; p.textEl.replaceChildren(); });
  kick();
  emit('zoom');
}

export function fit(mode, soft) {
  if (!info.length) return;
  S.fit = mode;
  const p = info[Math.max(0, S.curPage - 1)] || info[0];
  const aw = viewerEl.clientWidth - (isPhone() ? 12 : 56), ah = viewerEl.clientHeight - 32;
  if (aw <= 0) return;
  let z = aw / p.w / FS;
  if (mode === 'page') z = Math.min(z, ah / p.h / FS);
  if (mode === 'auto' && !isPhone()) z = Math.min(z, 1.15);
  z = Math.max(0.2, Math.min(5, z));
  if (soft && Math.abs(z - S.zoom) < 0.002 && tops.length) { kick(); return; }
  S.zoom = z;
  layout();
}

export function setZoom(z, cx, cy) {
  z = Math.max(0.2, Math.min(5, z));
  if (Math.abs(z - S.zoom) < 0.001) return;
  const r = viewerEl.getBoundingClientRect();
  cx = cx == null ? r.width / 2 : cx - r.left; cy = cy == null ? r.height / 2 : cy - r.top;
  const ratio = z / S.zoom;
  const px = viewerEl.scrollLeft + cx, py = viewerEl.scrollTop + cy;
  S.fit = null; S.zoom = z;
  layout();
  viewerEl.scrollLeft = px * ratio - cx; viewerEl.scrollTop = py * ratio - cy;
}
export const zoomBy = (f, cx, cy) => setZoom(S.zoom * f, cx, cy);

export function scrollToPage(n, smooth = false) {
  n = Math.max(1, Math.min(S.n, n));
  viewerEl.scrollTo({ top: Math.max(0, tops[n - 1] - 8), behavior: smooth ? 'smooth' : 'instant' });
  S.curPage = n; emit('page-changed');
}

// 보이는 페이지만 그리고 멀리 있는 페이지는 메모리에서 비움
function kick() {
  if (!tops.length || !S.pdf) return;
  const top = viewerEl.scrollTop, vh = viewerEl.clientHeight;
  let cur = 0;
  for (let i = 0; i < tops.length; i++) {
    if (tops[i] <= top + vh * 0.35) cur = i; else break;
  }
  if (S.curPage !== cur + 1) { S.curPage = cur + 1; emit('page-changed'); }
  const lo = top - vh * 1.2, hi = top + vh * 2.2;
  info.forEach((p, i) => {
    const t = tops[i], b = t + p.h * scale();
    if (b > lo && t < hi) { if (!p.rendered && !p.rendering) renderPage(i); }
    else if (p.rendered && (b < top - vh * 4 || t > top + vh * 5)) release(p);
  });
}
function release(p) { p.rendered = false; p.canvas.width = 0; p.canvas.height = 0; p.textEl.replaceChildren(); }

async function renderPage(i) {
  const p = info[i], g = p.gen, sc = scale();
  p.rendering = true;
  try {
    const page = await S.pdf.getPage(i + 1);
    if (g !== p.gen) return;
    const vp = page.getViewport({ scale: sc });
    let ratio = Math.min(devicePixelRatio || 1, 2);
    while (vp.width * vp.height * ratio * ratio > 14e6 && ratio > 0.5) ratio -= 0.25;
    const cv = p.canvas;
    cv.width = Math.floor(vp.width * ratio); cv.height = Math.floor(vp.height * ratio);
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
    const task = page.render({ canvasContext: ctx, viewport: page.getViewport({ scale: sc * ratio }) });
    p.task = task;
    await task.promise;
    if (g !== p.gen) return;
    p.textEl.style.setProperty('--total-scale-factor', sc);
    p.textEl.style.setProperty('--scale-factor', sc);
    p.textEl.replaceChildren();
    const tl = new pdfjsLib.TextLayer({ textContentSource: page.streamTextContent(), container: p.textEl, viewport: vp });
    await tl.render();
    if (g !== p.gen) return;
    p.rendered = true;
    drawHighlights(i);
  } catch (e) {
    if (e?.name !== 'RenderingCancelledException') console.warn('렌더링 실패', e);
  } finally {
    if (g === p.gen) p.rendering = false;
  }
}

// ======================== 검색 강조 ========================
export function drawHighlights(i) {
  const p = info[i]; if (!p) return;
  p.hlEl.replaceChildren();
  const s = S.search; if (!s) return;
  const k = scale();
  s.results.forEach((r, idx) => {
    if (r.page !== i) return;
    for (const [x, y, w, hh] of r.rects || []) {
      p.hlEl.append(h('i', { class: idx === s.cur ? 'cur' : '', style: { left: x * k + 'px', top: y * k + 'px', width: w * k + 'px', height: hh * k + 'px' } }));
    }
  });
}
export function redrawAllHighlights() { info.forEach((_, i) => drawHighlights(i)); }
export function pagePtOffset(i) { return tops[i]; }
export function scrollToRect(i, rect) {
  const k = scale();
  viewerEl.scrollTo({ top: Math.max(0, tops[i] + rect[1] * k - viewerEl.clientHeight * 0.3), behavior: 'smooth' });
}

// ======================== 도구 ========================
export function setTool(t) {
  S.tool = t;
  viewerEl.className = 'tool-' + t;
  if (t !== 'select') deselect();
  emit('tool');
}

function startPan(e) {
  const sx = e.clientX, sy = e.clientY, l = viewerEl.scrollLeft, t = viewerEl.scrollTop;
  viewerEl.setPointerCapture(e.pointerId);
  const mv = ev => { viewerEl.scrollLeft = l - (ev.clientX - sx); viewerEl.scrollTop = t - (ev.clientY - sy); };
  const up = () => { viewerEl.removeEventListener('pointermove', mv); viewerEl.removeEventListener('pointerup', up); };
  viewerEl.addEventListener('pointermove', mv); viewerEl.addEventListener('pointerup', up);
}

// 두 손가락 확대/축소
function initPinch() {
  let d0 = 0, z0 = 1, cx = 0, cy = 0, ratio = 1, on_ = false;
  const dist = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  viewerEl.addEventListener('touchstart', e => {
    if (e.touches.length === 2) {
      on_ = true; d0 = dist(e.touches); z0 = S.zoom; ratio = 1;
      const r = viewerEl.getBoundingClientRect();
      cx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left; cy = (e.touches[0].clientY + e.touches[1].clientY) / 2 - r.top;
      pagesEl.style.transformOrigin = `${viewerEl.scrollLeft + cx}px ${viewerEl.scrollTop + cy}px`;
    }
  }, { passive: true });
  viewerEl.addEventListener('touchmove', e => {
    if (!on_ || e.touches.length !== 2) return;
    e.preventDefault();
    ratio = Math.max(0.2 / z0, Math.min(5 / z0, dist(e.touches) / d0));
    pagesEl.style.transform = `scale(${ratio})`;
  }, { passive: false });
  const end = () => {
    if (!on_) return;
    on_ = false;
    pagesEl.style.transform = ''; pagesEl.style.transformOrigin = '';
    const px = viewerEl.scrollLeft + cx, py = viewerEl.scrollTop + cy;
    S.fit = null; S.zoom = z0 * ratio;
    layout();
    viewerEl.scrollLeft = px * ratio - cx; viewerEl.scrollTop = py * ratio - cy;
  };
  viewerEl.addEventListener('touchend', e => { if (e.touches.length < 2) end(); });
  viewerEl.addEventListener('touchcancel', end);
}

// ======================== 개체 관리 ========================
export function findObj(id) {
  for (const [pi, list] of Object.entries(S.overlays)) { const o = list.find(x => x.id === id); if (o) return { o, pi: +pi, list }; }
  return null;
}
const objEl = id => pagesEl.querySelector(`.obj[data-id="${id}"]`);

function renderOverlays() {
  if (!info.length) return;
  info.forEach((p, i) => {
    p.ovEl.replaceChildren();
    (S.overlays[i] || []).forEach(o => mountObj(i, o));
  });
  if (S.selected) { const el = objEl(S.selected.id); if (el) el.classList.add('sel'); else S.selected = null; }
  updateBar();
}

function addObj(pi, o) {
  (S.overlays[pi] ||= []).push(o);
  return mountObj(pi, o);
}

function mountObj(pi, o) {
  let el;
  if (o.type === 'text') { el = h('div', { class: 'obj otext' + (o.bg ? ' note' : '') }); el.textContent = o.text; }
  else if (o.type === 'image') el = h('div', { class: 'obj oimg' }, h('img', { src: S.imgs[o.img], draggable: 'false', alt: '' }));
  else if (o.type === 'ink') el = h('div', { class: 'obj oink' });
  else el = h('div', { class: 'obj o' + o.type });
  el.dataset.id = o.id; el.dataset.page = pi;
  if (o.type === 'image' || o.type === 'whiteout' || o.type === 'highlight')
    ['nw', 'ne', 'sw', 'se'].forEach(c => el.append(h('b', { class: 'hd ' + c, 'data-c': c })));
  info[pi].ovEl.append(el);
  styleObj(el, o);
  bindObj(el, o, pi);
  return el;
}

function styleObj(el, o) {
  const k = scale(), st = el.style;
  st.left = o.x * k + 'px'; st.top = o.y * k + 'px';
  if (o.type === 'text') {
    st.fontSize = o.size * k + 'px'; st.color = o.color; st.fontWeight = o.bold ? 700 : 400;
    st.padding = (o.bg ? 4 : 2) * k + 'px'; st.background = o.bg || 'transparent';
    if (o.bg) st.border = Math.max(1, 0.5 * k) + 'px solid #e0c200';
    st.minWidth = o.size * 0.6 * k + 'px';
    if (!el.isContentEditable) { o.w = el.offsetWidth / k; o.h = el.offsetHeight / k; }
  } else {
    st.width = o.w * k + 'px'; st.height = o.h * k + 'px';
    if (o.type === 'whiteout' || o.type === 'highlight') st.background = o.color;
    if (o.type === 'image') el.firstChild.style.opacity = o.opacity ?? 1;
    if (o.type === 'ink') {
      const d = o.pts.map(([x, y], i) => (i ? 'L' : 'M') + (x - o.x).toFixed(2) + ' ' + (y - o.y).toFixed(2)).join(' ') + (o.pts.length === 1 ? ' l0.01 0' : '');
      el.innerHTML = `<svg viewBox="0 0 ${o.w} ${o.h}" preserveAspectRatio="none" width="100%" height="100%"><path d="${d}" fill="none" stroke="${o.color}" stroke-width="${o.sw}" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    }
  }
}

function bindObj(el, o, pi) {
  el.addEventListener('pointerdown', e => {
    if (el.isContentEditable) return;
    if (e.target.classList.contains('hd')) { startResize(e, el, o, e.target.dataset.c); return; }
    if (S.tool !== 'select') return;
    e.stopPropagation();
    const wasSel = S.selected?.id === o.id;
    select(o.id, pi);
    startDrag(e, el, o, wasSel);
  });
  if (o.type === 'text') el.addEventListener('dblclick', () => editText(el, o));
}

function startDrag(e, el, o, wasSel) {
  const k = scale(), sx = e.clientX, sy = e.clientY, ox = o.x, oy = o.y;
  const pts0 = o.pts ? o.pts.map(p => [...p]) : null;
  let moved = false;
  el.setPointerCapture(e.pointerId);
  const pg = info[+el.dataset.page];
  const mv = ev => {
    const dx = (ev.clientX - sx) / k, dy = (ev.clientY - sy) / k;
    if (!moved && Math.hypot(dx, dy) * k < 4) return;
    if (!moved) { moved = true; D.snap(); }
    o.x = Math.max(-o.w * 0.8, Math.min(pg.w - o.w * 0.2, ox + dx)); o.y = Math.max(-o.h * 0.8, Math.min(pg.h - o.h * 0.2, oy + dy));
    if (pts0) o.pts = pts0.map(([x, y]) => [x + (o.x - ox), y + (o.y - oy)]);
    styleObj(el, o);
  };
  const up = () => {
    el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up);
    if (!moved && wasSel && o.type === 'text') editText(el, o);
  };
  el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up);
}

function startResize(e, el, o, c) {
  e.stopPropagation(); e.preventDefault();
  const k = scale(), sx = e.clientX, sy = e.clientY, { x, y, w, hh = o.h } = { x: o.x, y: o.y, w: o.w, hh: o.h };
  const ratio = o.h / o.w, keep = o.type === 'image';
  let began = false;
  el.setPointerCapture(e.pointerId);
  const mv = ev => {
    if (!began) { began = true; D.snap(); }
    let dx = (ev.clientX - sx) / k, dy = (ev.clientY - sy) / k;
    let nw = c.includes('e') ? w + dx : w - dx;
    nw = Math.max(10, nw);
    let nh = keep ? nw * ratio : Math.max(10, c.includes('s') ? hh + dy : hh - dy);
    o.w = nw; o.h = nh;
    o.x = c.includes('e') ? x : x + w - nw; o.y = c.includes('s') ? y : y + hh - nh;
    styleObj(el, o);
  };
  const up = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); };
  el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up);
}

export function select(id, pi) {
  $$('.obj.sel', pagesEl).forEach(e => e.classList.remove('sel'));
  S.selected = { id, page: pi };
  objEl(id)?.classList.add('sel');
  emit('selection');
}
export function deselect() {
  if (!S.selected) return;
  $$('.obj.sel', pagesEl).forEach(e => e.classList.remove('sel'));
  S.selected = null;
  emit('selection');
}
export function removeSelected() {
  const f = S.selected && findObj(S.selected.id);
  if (!f) return;
  D.snap();
  f.list.splice(f.list.indexOf(f.o), 1);
  objEl(f.o.id)?.remove();
  S.selected = null;
  emit('selection');
}

function editText(el, o) {
  select(o.id, +el.dataset.page);
  el.contentEditable = 'true';
  el.classList.add('editing');
  el.focus();
  const r = document.createRange(); r.selectNodeContents(el); r.collapse(false);
  const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
  const paste = ev => { ev.preventDefault(); document.execCommand('insertText', false, ev.clipboardData.getData('text/plain')); };
  const done = () => {
    el.removeEventListener('blur', done); el.removeEventListener('paste', paste);
    el.contentEditable = 'false'; el.classList.remove('editing');
    o.text = el.innerText.replace(/\n+$/, '');
    if (!o.text.trim()) {
      const f = findObj(o.id);
      if (f) f.list.splice(f.list.indexOf(o), 1);
      el.remove();
      if (o._fresh) S.hist.pop();
      S.selected = null; emit('selection'); emit('history');
      return;
    }
    delete o._fresh;
    el.textContent = o.text;
    styleObj(el, o);
  };
  el.addEventListener('paste', paste);
  el.addEventListener('blur', done);
  el.addEventListener('keydown', ev => { if (ev.key === 'Escape') el.blur(); });
}

// ---------- 페이지에서 직접 만들기 ----------
function bindPage(p, i) {
  const ov = p.ovEl;
  ov.addEventListener('pointerdown', e => {
    if (e.target !== ov || e.button > 0) return;
    const k = scale(), r = ov.getBoundingClientRect();
    const pt = [(e.clientX - r.left) / k, (e.clientY - r.top) / k];
    if (S.tool === 'text' || S.tool === 'note') {
      e.preventDefault();
      D.snap();
      const note = S.tool === 'note';
      const o = { id: uid(), type: 'text', x: Math.max(0, pt[0] - 4), y: Math.max(0, pt[1] - S.style.size * 0.7), size: S.style.size, color: S.style.color, bold: S.style.bold, text: '', bg: note ? S.style.note : null, w: 20, h: 20, _fresh: true };
      const el = addObj(i, o);
      setTool('select');
      setTimeout(() => editText(el, o), 0);
    } else if (S.tool === 'pen') drawInk(e, i, ov);
    else if (S.tool === 'whiteout') drawRect(e, i, ov);
  });
}

function drawInk(e, i, ov) {
  e.preventDefault();
  const k = scale(), r = ov.getBoundingClientRect();
  const pts = [[(e.clientX - r.left) / k, (e.clientY - r.top) / k]];
  const sv = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  sv.setAttribute('class', 'draw'); sv.setAttribute('width', ov.clientWidth); sv.setAttribute('height', ov.clientHeight);
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('fill', 'none'); path.setAttribute('stroke', S.style.ink); path.setAttribute('stroke-width', S.style.inkW * k);
  path.setAttribute('stroke-linecap', 'round'); path.setAttribute('stroke-linejoin', 'round');
  sv.append(path); ov.append(sv);
  ov.setPointerCapture(e.pointerId);
  const upd = () => path.setAttribute('d', pts.map(([x, y], j) => (j ? 'L' : 'M') + x * k + ' ' + y * k).join(' ') + (pts.length === 1 ? 'l0.1 0' : ''));
  upd();
  const mv = ev => { const a = (ev.getCoalescedEvents?.() || [ev]); for (const q of a) pts.push([(q.clientX - r.left) / k, (q.clientY - r.top) / k]); upd(); };
  const up = () => {
    ov.removeEventListener('pointermove', mv); ov.removeEventListener('pointerup', up); ov.removeEventListener('pointercancel', up);
    sv.remove();
    const pad = S.style.inkW;
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    const x = Math.min(...xs) - pad, y = Math.min(...ys) - pad;
    D.snap();
    const o = { id: uid(), type: 'ink', x, y, w: Math.max(...xs) + pad - x, h: Math.max(...ys) + pad - y, pts, color: S.style.ink, sw: S.style.inkW };
    addObj(i, o);
  };
  ov.addEventListener('pointermove', mv); ov.addEventListener('pointerup', up); ov.addEventListener('pointercancel', up);
}

function drawRect(e, i, ov) {
  e.preventDefault();
  const k = scale(), r = ov.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top;
  const box = h('div', { class: 'obj owhiteout draft', style: { left: sx + 'px', top: sy + 'px', background: S.style.wo, pointerEvents: 'none' } });
  ov.append(box);
  ov.setPointerCapture(e.pointerId);
  const mv = ev => {
    const x = ev.clientX - r.left, y = ev.clientY - r.top;
    Object.assign(box.style, { left: Math.min(sx, x) + 'px', top: Math.min(sy, y) + 'px', width: Math.abs(x - sx) + 'px', height: Math.abs(y - sy) + 'px' });
  };
  const up = ev => {
    ov.removeEventListener('pointermove', mv); ov.removeEventListener('pointerup', up);
    box.remove();
    const x = ev.clientX - r.left, y = ev.clientY - r.top;
    const w = Math.abs(x - sx) / k, hh = Math.abs(y - sy) / k;
    if (w < 4 || hh < 4) return;
    D.snap();
    const o = { id: uid(), type: 'whiteout', x: Math.min(sx, x) / k, y: Math.min(sy, y) / k, w, h: hh, color: S.style.wo };
    addObj(i, o);
    select(o.id, i);
    setTool('select');
  };
  ov.addEventListener('pointermove', mv); ov.addEventListener('pointerup', up);
}

// ---------- 형광펜: 글자를 드래그해서 선택 ----------
function initHighlightSelection() {
  let timer;
  document.addEventListener('selectionchange', () => {
    if (S.tool !== 'highlight') return;
    clearTimeout(timer);
    timer = setTimeout(() => { if (!pointerDown) applyHighlight(); }, 450);
  });
  addEventListener('pointerup', () => { if (S.tool === 'highlight') setTimeout(applyHighlight, 60); });
}
function applyHighlight() {
  const sel = getSelection();
  if (S.tool !== 'highlight' || !sel.rangeCount || sel.isCollapsed) return;
  const rects = [...sel.getRangeAt(0).getClientRects()].filter(r => r.width > 2 && r.height > 2);
  if (!rects.length) return;
  const k = scale();
  const made = [];
  info.forEach((p, i) => {
    const pr = p.el.getBoundingClientRect();
    rects.filter(r => r.bottom > pr.top && r.top < pr.bottom && r.right > pr.left && r.left < pr.right).forEach(r => {
      made.push([i, { id: uid(), type: 'highlight', x: (r.left - pr.left) / k, y: (r.top - pr.top) / k, w: r.width / k, h: r.height / k, color: S.style.hl }]);
    });
  });
  // 같은 줄은 중복 제거
  const uniq = made.filter(([i, a], idx) => !made.some(([j, b], jdx) => jdx < idx && i === j && Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1 && Math.abs(a.w - b.w) < 1));
  if (!uniq.length) return;
  D.snap();
  uniq.forEach(([i, o]) => addObj(i, o));
  sel.removeAllRanges();
  toast('형광펜을 칠했습니다');
}

// ---------- 서명 · 이미지 삽입 ----------
export function currentCenter() {
  const i = Math.max(0, Math.min(info.length - 1, S.curPage - 1));
  const p = info[i], k = scale();
  const vy = viewerEl.scrollTop + viewerEl.clientHeight / 2 - tops[i];
  return { i, p, x: p.w / 2, y: Math.max(0, Math.min(p.h, vy / k)) };
}
export function addImage(dataUrl, nw, nh, opts = {}) {
  const c = currentCenter();
  const w = Math.min(opts.width || 180, c.p.w * 0.6), hh = w * nh / nw;
  const imgId = 'img' + (S.uid++);
  S.imgs[imgId] = dataUrl;
  const o = { id: uid(), type: 'image', img: imgId, x: Math.max(0, c.x - w / 2), y: Math.max(0, Math.min(c.p.h - hh, c.y - hh / 2)), w, h: hh, opacity: 1 };
  D.snap();
  addObj(c.i, o);
  setTool('select');
  select(o.id, c.i);
  S.dirty = true;
}

// ======================== 개체 설정 막대 ========================
const HINTS = {
  text: '문서의 원하는 위치를 누르면 글자 상자가 생깁니다',
  note: '메모를 붙일 위치를 눌러 주세요',
  highlight: '형광펜을 칠할 글자를 드래그해서 선택하세요',
  pen: '손가락이나 마우스로 문서 위에 직접 그리세요',
  whiteout: '가릴 영역을 드래그하세요 (지우개: 흰색으로 덮기)',
  hand: '화면을 끌어서 이동합니다',
};

function swatches(list, cur, set) {
  return h('div', { class: 'swatches' }, list.map(c => h('button', { class: 'sw' + (c.toLowerCase() === (cur || '').toLowerCase() ? ' on' : ''), style: { background: c }, 'aria-label': '색 ' + c, onclick: () => set(c) })),
    h('label', { class: 'sw custom', title: '다른 색' }, h('input', { type: 'color', value: cur && cur.length === 7 ? cur : '#000000', oninput: e => set(e.target.value) })));
}
const stepper = (label, val, min, max, step, set) => h('div', { class: 'stepper' },
  h('button', { class: 'icon-btn', 'aria-label': label + ' 줄이기', onclick: () => set(Math.max(min, val - step)), html: icon('minus') }),
  h('span', {}, String(Math.round(val))),
  h('button', { class: 'icon-btn', 'aria-label': label + ' 키우기', onclick: () => set(Math.min(max, val + step)), html: icon('plus') }));

function updateBar() {
  if (!barEl) return;
  const f = S.selected && findObj(S.selected.id);
  const o = f?.o, el = o && objEl(o.id);
  const parts = [];
  const live = (fn) => (v) => { D.snap(); fn(v); if (el) styleObj(el, o); updateBar(); };
  if (o) {
    if (o.type === 'text') {
      parts.push(stepper('글자 크기', o.size, 6, 96, 2, live(v => { o.size = v; S.style.size = v; })));
      parts.push(h('button', { class: 'tg' + (o.bold ? ' on' : ''), title: '굵게', onclick: live(() => { o.bold = !o.bold; S.style.bold = o.bold; }) }, h('b', {}, '가')));
      parts.push(swatches(PALETTE, o.color, live(c => { o.color = c; S.style.color = c; })));
      if (o.bg) parts.push(swatches(['#fff3a0', '#ffd6e0', '#d4f5dd', '#d6ebff'], o.bg, live(c => { o.bg = c; S.style.note = c; })));
    } else if (o.type === 'highlight') parts.push(swatches(HL_PALETTE, o.color, live(c => { o.color = c; S.style.hl = c; })));
    else if (o.type === 'whiteout') {
      parts.push(swatches(WO_PALETTE, o.color, live(c => { o.color = c; S.style.wo = c; })));
      parts.push(h('button', { class: 'btn small', onclick: () => applyAllPages(o) }, '모든 페이지에 적용'));
    } else if (o.type === 'ink') {
      parts.push(swatches(PALETTE, o.color, live(c => { o.color = c; S.style.ink = c; })));
      parts.push(stepper('굵기', o.sw, 1, 20, 1, live(v => { o.sw = v; S.style.inkW = v; })));
    } else if (o.type === 'image') {
      parts.push(h('label', { class: 'rng' }, '투명도', h('input', { type: 'range', min: 10, max: 100, value: (o.opacity ?? 1) * 100, oninput: e => { o.opacity = e.target.value / 100; styleObj(el, o); }, onchange: () => { S.dirty = true; } })));
      parts.push(h('button', { class: 'btn small', onclick: () => removeImgBg(o) }, '흰 배경 지우기'));
    }
    parts.push(h('button', { class: 'icon-btn', title: '복제', 'aria-label': '복제', onclick: () => duplicate(f), html: icon('copy') }));
    parts.push(h('button', { class: 'icon-btn danger', title: '삭제', 'aria-label': '삭제', onclick: removeSelected, html: icon('trash') }));
  } else if (HINTS[S.tool]) {
    parts.push(h('span', { class: 'hint' }, HINTS[S.tool]));
    if (S.tool === 'text' || S.tool === 'note') {
      parts.push(stepper('글자 크기', S.style.size, 6, 96, 2, v => { S.style.size = v; updateBar(); }));
      parts.push(swatches(PALETTE, S.style.color, c => { S.style.color = c; updateBar(); }));
    } else if (S.tool === 'highlight') parts.push(swatches(HL_PALETTE, S.style.hl, c => { S.style.hl = c; updateBar(); }));
    else if (S.tool === 'pen') {
      parts.push(swatches(PALETTE, S.style.ink, c => { S.style.ink = c; updateBar(); }));
      parts.push(stepper('굵기', S.style.inkW, 1, 20, 1, v => { S.style.inkW = v; updateBar(); }));
    } else if (S.tool === 'whiteout') parts.push(swatches(WO_PALETTE, S.style.wo, c => { S.style.wo = c; updateBar(); }));
  }
  barEl.replaceChildren(...parts);
  barEl.hidden = !parts.length;
}

function duplicate(f) {
  D.snap();
  const o = JSON.parse(JSON.stringify(f.o));
  o.id = uid(); o.x += 14; o.y += 14;
  if (o.pts) o.pts = o.pts.map(([x, y]) => [x + 14, y + 14]);
  addObj(f.pi, o);
  select(o.id, f.pi);
}

function applyAllPages(o) {
  D.snap();
  info.forEach((p, i) => {
    if (S.overlays[i]?.some(x => x.id === o.id)) return;
    addObj(i, { ...o, id: uid(), x: Math.min(o.x, Math.max(0, p.w - o.w)), y: Math.min(o.y, Math.max(0, p.h - o.h)) });
  });
  select(o.id, S.selected.page);
  toast(`모든 ${info.length}페이지에 같은 위치로 적용했습니다`, 'ok');
}

async function removeImgBg(o) {
  const img = new Image();
  img.src = S.imgs[o.img];
  await img.decode();
  const cv = h('canvas'); cv.width = img.naturalWidth; cv.height = img.naturalHeight;
  cv.getContext('2d').drawImage(img, 0, 0);
  whiteToAlpha(cv);
  D.snap();
  const id = 'img' + (S.uid++);
  S.imgs[id] = cv.toDataURL('image/png');
  o.img = id;
  const el = objEl(o.id); el.querySelector('img').src = S.imgs[id];
  toast('흰 배경을 지웠습니다', 'ok');
}
