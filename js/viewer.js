// 뷰어(페이지 표시 · 확대/축소) + 편집 개체(텍스트·메모·서명·이미지·형광펜·펜·가리기)
import { S, $, $$, h, icon, emit, on, toast, uid, pickFiles } from './state.js';
import { FS, LH, BASE, whiteToAlpha } from './pdfcore.js';
import { editableLines, sampleRegion } from './layout.js';
import { allFonts, GROUP_ORDER, cssFamily, loadDisplay, isLoaded, hasBold, measure, baseOf, addUserFont } from './textfonts.js';
import * as D from './doc.js';

const GAP = 14, PAD = 16;
// 페이지 표시 방식: 한 페이지 / 스크롤 / 두 페이지 / 두 페이지 스크롤 / 네 페이지(2×2) / 네 열 스크롤
const LAYOUTS = { single: { cols: 1, per: 1, cont: false }, scroll: { cols: 1, cont: true }, two: { cols: 2, per: 2, cont: false }, twoscroll: { cols: 2, cont: true }, four: { cols: 2, per: 4, cont: false }, fourscroll: { cols: 4, cont: true } };
const LY = () => LAYOUTS[S.layout?.mode] || LAYOUTS.scroll;
const loadLayout = () => { try { const v = JSON.parse(localStorage.getItem('pdfg.layout') || 'null'); if (v && LAYOUTS[v.mode]) return { mode: v.mode, gap: v.gap !== false, cover: !!v.cover }; } catch { /* 기본값 */ } return { mode: 'scroll', gap: true, cover: false }; };
const saveLayout = () => { try { localStorage.setItem('pdfg.layout', JSON.stringify(S.layout)); } catch { /* 저장 불가 */ } };
const FIELD_LABEL = { text: '텍스트', check: '체크', radio: '선택', drop: '목록', sign: '서명' };
const HLT = new Set(['highlight', 'underline', 'strike']);
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
  S.layout = loadLayout();
  pdfjsLib = await D.getPdfjs();
  on('doc-loaded', build);
  on('overlays-changed', () => { renderOverlays(); info.forEach((_, i) => buildEditLayer(i)); });
  viewerEl.addEventListener('scroll', () => requestAnimationFrame(kick), { passive: true });
  new ResizeObserver(() => { if (S.fit && S.pdf) fit(S.fit, true); else kick(); }).observe(viewerEl);
  viewerEl.addEventListener('pointerdown', e => {
    pointerDown = true;
    if (!e.target.closest('.obj, #objbar, .hd')) deselect();
    if (S.tool === 'hand') startPan(e);
  });
  addEventListener('pointerup', () => { pointerDown = false; });
  initBlankDragSelect();
  viewerEl.addEventListener('wheel', e => {
    if (autoTimer && !e.ctrlKey) toggleAutoScroll(false);
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

// 글자 드래그 선택 보정: 글자 위가 아니라 빈 곳(여백·글자 사이)에서 시작해도 가장 가까운 글자부터 선택되게 한다.
// 기본 동작은 빈 곳에서 시작하면 선택이 아예 안 되거나 끊긴다.
function initBlankDragSelect() {
  const nearest = (tl, x, y) => {
    let best = null, bd = 1e12;
    for (const s of tl.children) {
      if (s.tagName !== 'SPAN' || !s.firstChild || s.firstChild.nodeType !== 3 || !s.textContent) continue;
      const r = s.getBoundingClientRect(); if (!r.width && !r.height) continue;
      const dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
      const dx = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
      const d = dy * dy * 4 + dx * dx;                 // 같은 줄(세로 겹침)을 우선
      if (d < bd) { bd = d; best = { s, r }; }
    }
    if (!best) return null;
    const { s, r } = best, n = s.firstChild, len = n.textContent.length;
    let off;
    if (x <= r.left) off = 0; else if (x >= r.right) off = len;
    else {
      const cp = document.caretPositionFromPoint?.(x, y);
      if (cp && s.contains(cp.offsetNode)) off = cp.offset;
      else { const cr = document.caretRangeFromPoint?.(x, y); off = cr && s.contains(cr.startContainer) ? cr.startOffset : Math.round((x - r.left) / r.width * len); }
    }
    return { node: n, off: Math.max(0, Math.min(len, off)) };
  };
  pagesEl.addEventListener('mousedown', e => {
    if (e.button !== 0 || !e.target.classList?.contains('textLayer')) return;     // 글자 위에서 시작하면 기본 동작
    const tl0 = e.target, a = nearest(tl0, e.clientX, e.clientY);
    if (!a) return;
    e.preventDefault();
    const sel = getSelection(); sel.removeAllRanges();
    let moved = false;
    const mv = ev => {
      if (!(ev.buttons & 1)) { up(); return; }
      const under = document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.('.textLayer') || tl0;
      const f = nearest(under, ev.clientX, ev.clientY) || nearest(tl0, ev.clientX, ev.clientY);
      if (!f) return;
      moved = true;
      sel.setBaseAndExtent(a.node, a.off, f.node, f.off);
    };
    const up = () => { removeEventListener('mousemove', mv); removeEventListener('mouseup', up); if (!moved) sel.removeAllRanges(); };
    addEventListener('mousemove', mv); addEventListener('mouseup', up);
  });
}

function onKey(e) {
  if (!S.pdf || e.target.closest('input, textarea, select') || e.target.isContentEditable) return;
  if ((e.key === 'Delete' || e.key === 'Backspace') && S.selected) { e.preventDefault(); removeSelected(); }
  else if (e.key === 'Escape') { deselect(); setTool('select'); }
}

// ======================== 페이지 구성 ========================
let building = false;
async function build({ keepPage, fresh }) {
  const keep = keepPage ? S.curPage : 1;
  // 다시 그린 뒤에도 같은 쪽의 같은 자리에 머물도록 쪽 안에서의 위치(pt)와 가로 위치를 기억
  const rel = keepPage && LY().cont && tops[keep - 1] >= 0 ? Math.max(0, (viewerEl.scrollTop - tops[keep - 1]) / scale()) : 0;
  const left = keepPage ? viewerEl.scrollLeft : 0;
  building = true;
  setTimeout(() => { building = false; }, 6000);      // 만일의 경우 잠금이 남지 않게
  gen++;
  info.forEach(p => p.task?.cancel?.());
  const old = keepPage ? info : [];      // 깜빡임 방지: 크기가 같은 쪽은 이전 그림을 그대로 두고 새 그림이 완성되면 바꿔치기
  const sizes = await Promise.all(Array.from({ length: S.n }, (_, i) => S.pdf.getPage(i + 1).then(p => { const v = p.getViewport({ scale: 1 }); return [v.width, v.height]; })));
  pagesEl.replaceChildren(); info = [];
  sizes.forEach(([w, hh], i) => {
    const p = { w, h: hh, rendered: false, rendering: false, gen: 0 };
    const o = old[i];
    p.canvas = (o && o.canvas.width > 0 && Math.abs(o.w / o.h - w / hh) < 0.004) ? o.canvas : h('canvas');
    p.textEl = h('div', { class: 'textLayer' });
    p.hlEl = h('div', { class: 'hlLayer' });
    p.ovEl = h('div', { class: 'ovl' });
    p.editEl = h('div', { class: 'editLayer' });
    p.el = h('div', { class: 'page', 'data-p': i }, p.canvas, p.textEl, p.hlEl, p.ovEl, p.editEl, h('span', { class: 'pno' }, String(i + 1)));
    bindPage(p, i);
    pagesEl.append(p.el);
    info.push(p);
  });
  tops = [];
  if (fresh) S.fit = 'auto';
  const target = Math.min(keep, S.n);
  S.curPage = target;
  if (S.fit) fit(S.fit, true); else layout();
  if (keepPage && LY().cont && info[target - 1]) {
    const p = info[target - 1];
    viewerEl.scrollTop = Math.max(0, tops[target - 1] - 8 + Math.min(rel * scale(), Math.max(0, p.h * scale() - 60)));
    viewerEl.scrollLeft = left;
    S.curPage = target; emit('page-changed');
  } else { S.curPage = target; scrollToPage(target); }
  building = false;
  renderOverlays();
  emit('pages-built');
}

function applyGrid() {
  const L = LY(), st = pagesEl.style, gapPx = S.layout.gap ? GAP : 0;
  st.gap = gapPx + 'px';
  if (L.cols > 1) { st.display = 'grid'; st.gridTemplateColumns = `repeat(${L.cols}, max-content)`; st.justifyContent = 'center'; st.alignItems = 'start'; }
  else { st.display = ''; st.gridTemplateColumns = ''; st.justifyContent = ''; st.alignItems = ''; }
  if (info[0]) info[0].el.style.gridColumnStart = (L.cols === 2 && S.layout.cover) ? '2' : '';
}
function groupOf(n) {
  const per = LY().per || 1;
  if (per === 1) return [n];
  if (per === 2 && S.layout.cover) { if (n === 1) return [1]; const s = 2 + Math.floor((n - 2) / 2) * 2; return [s, s + 1].filter(x => x <= S.n); }
  const s = Math.floor((n - 1) / per) * per + 1;
  return Array.from({ length: per }, (_, i) => s + i).filter(x => x <= S.n);
}
function applyVisibility() {
  const grp = LY().cont ? null : groupOf(S.curPage);
  info.forEach((p, i) => { p.el.style.display = (!grp || grp.includes(i + 1)) ? '' : 'none'; });
}
const measureTops = () => { tops = info.map(p => (p.el.style.display === 'none' ? -1 : p.el.offsetTop)); };
function layout() {
  const k = scale();
  applyGrid(); applyVisibility();
  info.forEach(p => { p.el.style.width = p.w * k + 'px'; p.el.style.height = p.h * k + 'px'; });
  measureTops();
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
  const L = LY(), gapPx = S.layout.gap ? GAP : 0;
  let z = (aw - (L.cols - 1) * gapPx) / (L.cols * p.w) / FS;
  if (mode === 'page') { const rows = L.cont ? 1 : Math.ceil((L.per || 1) / L.cols); z = Math.min(z, (ah - (rows - 1) * gapPx) / (rows * p.h) / FS); }
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

export function stepPage(dir) {
  if (LY().cont) { scrollToPage(S.curPage + dir, true); return; }
  const g = groupOf(S.curPage);
  scrollToPage(dir > 0 ? g[g.length - 1] + 1 : g[0] - 1);
}
export const layoutState = () => ({ ...S.layout, ...LY() });
function relayout() { if (!info.length) return; layout(); fit(LY().cont ? (S.fit || 'auto') : 'page'); scrollToPage(S.curPage); }
export function setLayout(mode) { if (!LAYOUTS[mode]) return; S.layout.mode = mode; saveLayout(); relayout(); }
export function setLayoutOpt(key, val) { S.layout[key] = val; saveLayout(); relayout(); }
let autoTimer = null;
export function toggleAutoScroll(on) {
  const want = on ?? !autoTimer;
  clearInterval(autoTimer); autoTimer = null;
  if (want) { autoTimer = setInterval(() => { viewerEl.scrollTop += 1; }, 24); toast('자동 스크롤을 시작했습니다. 멈추려면 다시 선택하거나 휠을 움직이세요'); }
  emit('autoscroll');
  return !!autoTimer;
}
export function scrollToPage(n, smooth = false) {
  n = Math.max(1, Math.min(S.n, n));
  if (!LY().cont) { S.curPage = n; applyVisibility(); measureTops(); viewerEl.scrollTo({ top: 0, left: 0 }); kick(); emit('page-changed'); return; }
  viewerEl.scrollTo({ top: Math.max(0, tops[n - 1] - 8), behavior: smooth ? 'smooth' : 'instant' });
  S.curPage = n; emit('page-changed');
}

// 보이는 페이지만 그리고 멀리 있는 페이지는 메모리에서 비움
function kick() {
  if (!tops.length || !S.pdf) return;
  const top = viewerEl.scrollTop, vh = viewerEl.clientHeight;
  if (LY().cont && !building) {
    let cur = 0;
    for (let i = 0; i < tops.length; i++) {
      if (tops[i] <= top + vh * 0.35) cur = i; else break;
    }
    if (S.curPage !== cur + 1) { S.curPage = cur + 1; emit('page-changed'); }
  }
  const lo = top - vh * 1.2, hi = top + vh * 2.2;
  info.forEach((p, i) => {
    if (tops[i] < 0) { if (p.rendered) release(p); return; }
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
    // 보이는 캔버스를 먼저 비우면 깜빡이므로 따로 그린 뒤 한 번에 바꿔치기
    const tmp = document.createElement('canvas');
    tmp.width = Math.floor(vp.width * ratio); tmp.height = Math.floor(vp.height * ratio);
    const ctx = tmp.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, tmp.width, tmp.height);
    const task = page.render({ canvasContext: ctx, viewport: page.getViewport({ scale: sc * ratio }) });
    p.task = task;
    await task.promise;
    if (g !== p.gen) { tmp.width = 0; return; }
    cv.width = tmp.width; cv.height = tmp.height;
    cv.getContext('2d').drawImage(tmp, 0, 0);
    tmp.width = 0;
    p.textEl.style.setProperty('--total-scale-factor', sc);
    p.textEl.style.setProperty('--scale-factor', sc);
    p.textEl.replaceChildren();
    const tl = new pdfjsLib.TextLayer({ textContentSource: page.streamTextContent(), container: p.textEl, viewport: vp });
    await tl.render();
    if (g !== p.gen) return;
    p.rendered = true;
    drawHighlights(i);
    if (S.tool === 'edittext') buildEditLayer(i);
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
  if (!LY().cont && info[i]?.el.style.display === 'none') scrollToPage(i + 1);
  const k = scale();
  viewerEl.scrollTo({ top: Math.max(0, tops[i] + rect[1] * k - viewerEl.clientHeight * 0.3), behavior: 'smooth' });
}

// ======================== 도구 ========================
export function setTool(t) {
  S.tool = t;
  viewerEl.className = 'tool-' + t;
  if (t !== 'select') deselect();
  info.forEach((_, i) => buildEditLayer(i));
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
  if (['image', 'whiteout', 'highlight', 'redact', 'field', 'shape'].includes(o.type))
    ['nw', 'ne', 'sw', 'se'].forEach(c => el.append(h('b', { class: 'hd ' + c, 'data-c': c })));
  if (o.type === 'image') el.append(h('b', { class: 'hd rot', title: '끌어서 회전 (Shift: 15° 단위)' }));
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
    st.fontFamily = cssFamily(o.font, o.bold); st.fontStyle = o.italic ? 'italic' : 'normal';
    st.textDecoration = [o.underline && 'underline', o.strike && 'line-through'].filter(Boolean).join(' ') || 'none';
    if (o.font && o.font !== 'noto' && !isLoaded(o.font, o.bold)) loadDisplay(o.font, o.bold).then(() => styleObj(el, o)).catch(() => {});
    st.padding = (o.bg ? 4 : 2) * k + 'px'; st.background = o.bg || 'transparent';
    if (o.bg) st.border = Math.max(1, 0.5 * k) + 'px solid #e0c200';
    st.minWidth = o.size * 0.6 * k + 'px';
    if (!el.isContentEditable) { o.w = el.offsetWidth / k; o.h = el.offsetHeight / k; }
  } else {
    st.width = o.w * k + 'px'; st.height = o.h * k + 'px';
    if (o.type === 'whiteout' || o.type === 'highlight' || o.type === 'redact') st.background = (o.type === 'highlight' && o.ls) ? 'transparent' : o.color;
    if (o.type === 'highlight' && o.ls === 'underline') st.boxShadow = `inset 0 -${Math.max(1, 1.4 * k)}px 0 ${o.color}`;
    if (o.type === 'highlight' && o.ls === 'strike') st.background = `linear-gradient(to bottom, transparent 47%, ${o.color} 47%, ${o.color} 53%, transparent 53%)`;
    if (o.type === 'field') { st.border = '1.5px dashed #5258e4'; st.background = 'rgba(82,88,228,.10)'; el.dataset.label = (FIELD_LABEL[o.kind] || '칸') + ' · ' + (o.name || ''); }
    if (o.type === 'shape') {
      const sw = o.sw || 2, w = Math.max(1, o.w), hh = Math.max(1, o.h);
      let inner = '';
      const stroke = `fill="none" stroke="${o.color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"`;
      if (o.shape === 'rect') inner = `<rect x="${sw / 2}" y="${sw / 2}" width="${Math.max(0, w - sw)}" height="${Math.max(0, hh - sw)}" ${stroke}/>`;
      else if (o.shape === 'ellipse') inner = `<ellipse cx="${w / 2}" cy="${hh / 2}" rx="${Math.max(0, w / 2 - sw / 2)}" ry="${Math.max(0, hh / 2 - sw / 2)}" ${stroke}/>`;
      else {
        const [x1, y1, x2, y2] = [o.fx ? w : 0, o.fy ? hh : 0, o.fx ? 0 : w, o.fy ? 0 : hh];
        inner = `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" ${stroke}/>`;
        if (o.shape === 'arrow') { const a = Math.atan2(y2 - y1, x2 - x1), L = Math.max(8, sw * 4); inner += `<path d="M${x2 - L * Math.cos(a - 0.45)} ${y2 - L * Math.sin(a - 0.45)} L${x2} ${y2} L${x2 - L * Math.cos(a + 0.45)} ${y2 - L * Math.sin(a + 0.45)}" ${stroke}/>`; }
      }
      el.innerHTML = `<svg viewBox="0 0 ${w} ${hh}" preserveAspectRatio="none" width="100%" height="100%" style="overflow:visible">${inner}</svg>`;
    }
    if (o.type === 'image') { el.firstChild.style.opacity = o.opacity ?? 1; st.transform = o.rot ? `rotate(${o.rot}deg)` : ''; }
    if (o.type === 'ink') {
      const d = o.pts.map(([x, y], i) => (i ? 'L' : 'M') + (x - o.x).toFixed(2) + ' ' + (y - o.y).toFixed(2)).join(' ') + (o.pts.length === 1 ? ' l0.01 0' : '');
      el.innerHTML = `<svg viewBox="0 0 ${o.w} ${o.h}" preserveAspectRatio="none" width="100%" height="100%"><path d="${d}" fill="none" stroke="${o.color}" stroke-width="${o.sw}" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    }
  }
}

function bindObj(el, o, pi) {
  el.addEventListener('pointerdown', e => {
    if (el.isContentEditable) return;
    if (e.target.classList.contains('rot')) { startRotate(e, el, o); return; }
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

// 마우스(손가락)로 각도 조절: 개체 중심 기준으로 포인터 방향을 따라 회전
function startRotate(e, el, o) {
  e.stopPropagation(); e.preventDefault();
  const r = el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  let began = false;
  el.setPointerCapture(e.pointerId);
  document.body.classList.add('rotating');
  const mv = ev => {
    if (!began) { began = true; D.snap(); }
    let a =Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180 / Math.PI + 90;
    if (ev.shiftKey) a = Math.round(a / 15) * 15;
    a = ((a + 180) % 360 + 360) % 360 - 180;
    if (Math.abs(a) < 1.5) a = 0;               // 0° 바로 근처만 살짝 달라붙게
    o.rot = Math.round(a * 10) / 10;
    styleObj(el, o);
    if (!o._rb && o.rot) { o._rb = 1; updateBar(); }    // 처음 돌릴 때 「똑바로」 버튼 표시
  };
  const up = () => { document.body.classList.remove('rotating'); el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); if (began) updateBar(); };
  el.addEventListener('pointercancel', up);
  el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up);
}

function startResize(e, el, o, c) {
  e.stopPropagation(); e.preventDefault();
  const k = scale(), sx = e.clientX, sy = e.clientY, { x, y, w, hh = o.h } = { x: o.x, y: o.y, w: o.w, hh: o.h };
  const ratio = o.h / o.w, keep = o.type === 'image';
  const th = (o.rot || 0) * Math.PI / 180, cs = Math.cos(th), sn = Math.sin(th);
  let began = false;
  el.setPointerCapture(e.pointerId);
  const mv = ev => {
    if (!began) { began = true; D.snap(); }
    const sdx = (ev.clientX - sx) / k, sdy = (ev.clientY - sy) / k;
    const dx = sdx * cs + sdy * sn, dy = -sdx * sn + sdy * cs;      // 회전된 개체의 자기 축 기준 이동량
    let nw = c.includes('e') ? w + dx : w - dx;
    nw = Math.max(10, nw);
    let nh = keep ? nw * ratio : Math.max(10, c.includes('s') ? hh + dy : hh - dy);
    const lx = (c.includes('e') ? 1 : -1) * (nw - w) / 2, ly = (c.includes('s') ? 1 : -1) * (nh - hh) / 2;   // 반대쪽 모서리 고정
    const ncx = x + w / 2 + lx * cs - ly * sn, ncy = y + hh / 2 + lx * sn + ly * cs;
    o.w = nw; o.h = nh; o.x = ncx - nw / 2; o.y = ncy - nh / 2;
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
      const o = { id: uid(), type: 'text', x: Math.max(0, pt[0] - 4), y: Math.max(0, pt[1] - S.style.size * 0.7), size: S.style.size, color: S.style.color, bold: S.style.bold, font: S.style.font, text: '', bg: note ? S.style.note : null, w: 20, h: 20, _fresh: true };
      const el = addObj(i, o);
      setTool('select');
      setTimeout(() => editText(el, o), 0);
    } else if (S.tool === 'pen') drawInk(e, i, ov);
    else if (['whiteout', 'redact', 'field', 'shape'].includes(S.tool)) drawRect(e, i, ov);
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
  const tool0 = S.tool;
  const box = h('div', { class: 'obj owhiteout draft', style: { left: sx + 'px', top: sy + 'px', background: tool0 === 'redact' ? '#000000aa' : tool0 === 'whiteout' ? S.style.wo : 'transparent', pointerEvents: 'none' } });
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
    const isLine = tool0 === 'shape' && (S.style.shape === 'line' || S.style.shape === 'arrow');
    if (isLine ? (w < 4 && hh < 4) : (w < 4 || hh < 4)) return;
    D.snap();
    const base = { id: uid(), x: Math.min(sx, x) / k, y: Math.min(sy, y) / k, w: Math.max(w, isLine ? 1 : w), h: Math.max(hh, isLine ? 1 : hh) };
    let o;
    if (tool0 === 'redact') o = { ...base, type: 'redact', color: '#000000' };
    else if (tool0 === 'field') {
      const kind = S.style.fieldKind || 'text';
      const n = Object.values(S.overlays).flat().filter(q => q.type === 'field' && q.kind === kind).length + 1;
      o = { ...base, type: 'field', kind, name: kind === 'radio' ? '선택그룹' : (FIELD_LABEL[kind] + n), options: '', multiline: false };
    } else if (tool0 === 'shape') o = { ...base, type: 'shape', shape: S.style.shape || 'rect', color: S.style.ink, sw: S.style.inkW, fx: x < sx, fy: y < sy };
    else o = { ...base, type: 'whiteout', color: S.style.wo };
    addObj(i, o);
    select(o.id, i);
    if (tool0 === 'whiteout' || tool0 === 'shape') setTool('select');
  };
  ov.addEventListener('pointermove', mv); ov.addEventListener('pointerup', up);
}

// ---------- 본문 수정: 원래 PDF의 글자를 그 자리에서 고치기 ----------
async function buildEditLayer(i) {
  const p = info[i]; if (!p) return;
  p.editEl.replaceChildren();
  if (S.tool !== 'edittext' || !p.rendered) return;
  const g = p.gen;
  try {
    const page = await S.pdf.getPage(i + 1);
    const lines = p.lines || (p.lines = await editableLines(page, pdfjsLib));
    if (g !== p.gen || S.tool !== 'edittext') return;
    const k = scale();
    const done = (S.overlays[i] || []).filter(o => o.type === 'whiteout' && o.edit).map(o => o.src);
    p.editEl.replaceChildren();
    for (const ln of lines) {
      const key = Math.round(ln.x) + ',' + Math.round(ln.by);
      if (done.includes(key)) continue;
      const el = h('div', { class: 'eline', title: '눌러서 수정' });
      Object.assign(el.style, { left: (ln.x - 1) * k + 'px', top: ln.top * k + 'px', width: (ln.w + 2) * k + 'px', height: ln.h * k + 'px' });
      el.addEventListener('pointerdown', e => { e.stopPropagation(); if (el.classList.contains('editing')) return; e.preventDefault(); startLineEdit(i, ln, key, el, e); });
      p.editEl.append(el);
    }
  } catch (e) { console.warn('편집 영역 만들기 실패', e); }
}
function startLineEdit(i, ln, key, el, ev0) {
  const p = info[i], k = scale();
  const cvk = p.canvas.width / p.w;
  const sm = p.canvas.width ? sampleRegion(p.canvas, (ln.x - 1) * cvk, ln.top * cvk, (ln.w + 2) * cvk, ln.h * cvk) : { bg: '#ffffff', ink: '#000000' };
  el.classList.add('editing');
  el.contentEditable = 'plaintext-only';
  if (el.contentEditable !== 'plaintext-only') el.contentEditable = 'true';
  el.textContent = ln.text;
  Object.assign(el.style, { fontSize: ln.size * k + 'px', lineHeight: ln.h * k + 'px', color: sm.ink, background: sm.bg, fontWeight: ln.bold ? 700 : 400, fontStyle: ln.italic ? 'italic' : 'normal', minWidth: (ln.w + 2) * k + 'px', width: 'auto' });
  el.focus();
  // 누른 자리에 커서(깜빡이는 세로선)를 놓는다. (예전에는 전체 선택이라 커서가 보이지 않았음) 전체 선택은 Ctrl+A
  const sel = getSelection(); sel.removeAllRanges();
  const r = document.createRange();
  let placed = false;
  if (ev0) {
    const cp = document.caretPositionFromPoint?.(ev0.clientX, ev0.clientY);
    if (cp && el.contains(cp.offsetNode)) { r.setStart(cp.offsetNode, cp.offset); placed = true; }
    else { const cr = document.caretRangeFromPoint?.(ev0.clientX, ev0.clientY); if (cr && el.contains(cr.startContainer)) { r.setStart(cr.startContainer, cr.startOffset); placed = true; } }
  }
  if (!placed) { r.selectNodeContents(el); r.collapse(false); }
  r.collapse(true);
  sel.addRange(r);
  let cancelled = false, confirmed = false;
  const finish = async () => {
    el.removeEventListener('blur', finish);
    const txt = el.innerText.replace(/\s*[\r\n]+\s*/g, ' ').trim();
    if (cancelled || (txt === ln.text.trim() && !confirmed)) { buildEditLayer(i); return; }
    const fid = ln.font?.serif ? 'myeongjo' : 'noto';
    try { await measure(fid, ln.bold); } catch { /* 기본 기준선 */ }
    D.snap();
    addObj(i, { id: uid(), type: 'whiteout', edit: true, src: key, x: ln.x - 1, y: ln.top, w: ln.w + 2, h: ln.h, by: ln.by, size: ln.size, color: sm.bg });
    let made = null;
    if (txt) { made = { id: uid(), type: 'text', x: ln.x - 2, y: ln.by - 2 - baseOf(fid, ln.bold && hasBold(fid)) * ln.size, size: Math.round(ln.size * 10) / 10, color: sm.ink, bold: ln.bold, italic: ln.italic, font: fid === 'noto' ? undefined : fid, text: txt, bg: null, w: 20, h: 20 }; addObj(i, made); }
    buildEditLayer(i);
    if (made) select(made.id, i);
    toast(txt ? '글자를 고쳤습니다. 저장하면 PDF에 반영됩니다' : '글자를 지웠습니다', 'ok');
  };
  el.addEventListener('blur', finish);
  el.addEventListener('keydown', ev => {
    if (ev.key === 'Enter') { ev.preventDefault(); confirmed = true; el.blur(); }
    else if (ev.key === 'Escape') { cancelled = true; el.blur(); }
    ev.stopPropagation();
  });
}

// ---------- 형광펜: 글자를 드래그해서 선택 ----------
function initHighlightSelection() {
  let timer;
  document.addEventListener('selectionchange', () => {
    if (!HLT.has(S.tool)) return;
    clearTimeout(timer);
    timer = setTimeout(() => { if (!pointerDown) applyHighlight(); }, 450);
  });
  addEventListener('pointerup', () => { if (HLT.has(S.tool)) setTimeout(applyHighlight, 60); });
}
function applyHighlight() {
  const sel = getSelection();
  if (!HLT.has(S.tool) || !sel.rangeCount || sel.isCollapsed) return;
  const rects = [...sel.getRangeAt(0).getClientRects()].filter(r => r.width > 2 && r.height > 2);
  if (!rects.length) return;
  const k = scale();
  const made = [];
  info.forEach((p, i) => {
    const pr = p.el.getBoundingClientRect();
    rects.filter(r => r.bottom > pr.top && r.top < pr.bottom && r.right > pr.left && r.left < pr.right).forEach(r => {
      made.push([i, { id: uid(), type: 'highlight', x: (r.left - pr.left) / k, y: (r.top - pr.top) / k, w: r.width / k, h: r.height / k, color: S.tool === 'highlight' ? S.style.hl : (S.style.ul || '#e1251b'), ls: S.tool === 'highlight' ? undefined : S.tool }]);
    });
  });
  // 같은 줄은 중복 제거
  const uniq = made.filter(([i, a], idx) => !made.some(([j, b], jdx) => jdx < idx && i === j && Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1 && Math.abs(a.w - b.w) < 1));
  if (!uniq.length) return;
  D.snap();
  uniq.forEach(([i, o]) => addObj(i, o));
  sel.removeAllRanges();
  toast(S.tool === 'highlight' ? '형광펜을 칠했습니다' : S.tool === 'underline' ? '밑줄을 그었습니다' : '취소선을 그었습니다');
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
  underline: '밑줄 칠 글자를 드래그해서 선택하세요',
  strike: '취소선을 그을 글자를 드래그해서 선택하세요',
  shape: '문서 위에서 드래그해 그립니다 (사각형·원·선·화살표)',
  redact: '지울 영역(개인정보 등)을 드래그해 검은 상자로 표시하세요. 표시 후 「교정 적용」을 눌러야 영구 삭제됩니다',
  field: '입력칸이 들어갈 자리를 드래그하세요. 칸 종류는 「양식 만들기」에서 바꿀 수 있습니다',
  edittext: '고칠 글자를 누르세요. Enter로 확정하면 글꼴·크기·색·밑줄을 바꾸는 막대가 나타납니다 (Esc 취소 · 모두 지우면 삭제)',
};

// 글꼴 고르기 (내장 글꼴 + 글꼴 파일 불러오기)
function fontPicker(cur, set) {
  const fonts = allFonts();
  const groups = GROUP_ORDER.map(g => [g, fonts.filter(f => (f.group || '불러온 글꼴') === g)]).filter(([, l]) => l.length);
  const sel = h('select', { class: 'inp small', 'aria-label': '글꼴', title: '글꼴 (영문 전용 글꼴은 한글이 기본 글꼴로 표시됩니다)' },
    ...groups.map(([g, l]) => h('optgroup', { label: g }, ...l.map(f => h('option', { value: f.id, selected: f.id === cur }, f.label)))),
    h('option', { value: '__file' }, '+ 글꼴 파일 불러오기…'));
  sel.onchange = async () => {
    if (sel.value !== '__file') { set(sel.value); return; }
    sel.value = cur;
    const [f] = await pickFiles('.ttf,.otf,.woff,.woff2');
    if (!f) return;
    try { const d = await addUserFont(f); set(d.id); } catch { toast('글꼴 파일을 읽을 수 없습니다', 'err'); }
  };
  return sel;
}
const shapeKinds = (cur, set) => h('div', { class: 'seg inline' }, [['rect', '사각형'], ['ellipse', '원'], ['line', '선'], ['arrow', '화살표']].map(([k, t]) => h('button', { class: 'btn small' + (k === cur ? ' primary' : ''), onclick: () => set(k) }, t)));
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
      parts.push(fontPicker(o.font || 'noto', async id => { try { await loadDisplay(id, o.bold); } catch { toast('글꼴을 불러오지 못했습니다', 'err'); return; } live(v => { o.font = v === 'noto' ? undefined : v; S.style.font = o.font; })(id); }));
      parts.push(stepper('글자 크기', o.size, 6, 200, 1, live(v => { o.size = v; S.style.size = v; })));
      parts.push(h('button', { class: 'tg' + (o.bold ? ' on' : ''), title: '굵게', onclick: live(() => { o.bold = !o.bold; S.style.bold = o.bold; }) }, h('b', {}, '가')));
      parts.push(h('button', { class: 'tg' + (o.italic ? ' on' : ''), title: '기울임', onclick: live(() => { o.italic = !o.italic; }) }, h('i', {}, '가')));
      parts.push(h('button', { class: 'tg' + (o.underline ? ' on' : ''), title: '밑줄', onclick: live(() => { o.underline = !o.underline; }) }, h('u', {}, '가')));
      parts.push(h('button', { class: 'tg' + (o.strike ? ' on' : ''), title: '취소선', onclick: live(() => { o.strike = !o.strike; }) }, h('s', {}, '가')));
      parts.push(swatches(PALETTE, o.color, live(c => { o.color = c; S.style.color = c; })));
      if (o.bg) parts.push(swatches(['#fff3a0', '#ffd6e0', '#d4f5dd', '#d6ebff'], o.bg, live(c => { o.bg = c; S.style.note = c; })));
    } else if (o.type === 'highlight') parts.push(swatches(HL_PALETTE, o.color, live(c => { o.color = c; S.style.hl = c; })));
    else if (o.type === 'whiteout') {
      parts.push(swatches(WO_PALETTE, o.color, live(c => { o.color = c; S.style.wo = c; })));
      parts.push(h('button', { class: 'btn small', onclick: () => applyAllPages(o) }, '모든 페이지에 적용'));
    } else if (o.type === 'redact') {
      parts.push(h('button', { class: 'btn small primary', onclick: () => import('./tools2.js').then(m => m.redactApplyDialog()) }, '교정 적용 (영구 삭제)'));
    } else if (o.type === 'field') {
      parts.push(h('select', { class: 'inp small', 'aria-label': '칸 종류', onchange: e => live(v => { o.kind = v; S.style.fieldKind = v; })(e.target.value) }, ...Object.entries(FIELD_LABEL).map(([k, t]) => h('option', { value: k, selected: k === o.kind }, t))));
      parts.push(h('input', { class: 'inp small', value: o.name || '', placeholder: '칸 이름', 'aria-label': '칸 이름', onchange: e => live(v => { o.name = v; })(e.target.value) }));
      if (o.kind === 'drop') parts.push(h('input', { class: 'inp small', value: o.options || '', placeholder: '항목: 예, 아니오', 'aria-label': '목록 항목', onchange: e => live(v => { o.options = v; })(e.target.value) }));
    } else if (o.type === 'shape') {
      parts.push(shapeKinds(o.shape, live(v => { o.shape = v; S.style.shape = v; })));
      parts.push(swatches(PALETTE, o.color, live(c => { o.color = c; S.style.ink = c; })));
      parts.push(stepper('굵기', o.sw, 1, 12, 1, live(v => { o.sw = v; S.style.inkW = v; })));
    } else if (o.type === 'ink') {
      parts.push(swatches(PALETTE, o.color, live(c => { o.color = c; S.style.ink = c; })));
      parts.push(stepper('굵기', o.sw, 1, 20, 1, live(v => { o.sw = v; S.style.inkW = v; })));
    } else if (o.type === 'image') {
      parts.push(h('label', { class: 'rng' }, '투명도', h('input', { type: 'range', min: 10, max: 100, value: (o.opacity ?? 1) * 100, oninput: e => { o.opacity = e.target.value / 100; styleObj(el, o); }, onchange: () => { S.dirty = true; } })));
      if (o.rot) parts.push(h('button', { class: 'btn small', title: '회전을 풀어 똑바로', onclick: live(() => { o.rot = 0; }) }, '똑바로'));
      parts.push(h('button', { class: 'btn small', onclick: () => removeImgBg(o) }, '흰 배경 지우기'));
      const grow = k => live(() => { const cx = o.x + o.w / 2, cy = o.y + o.h / 2; o.w *= k; o.h *= k; o.x = cx - o.w / 2; o.y = cy - o.h / 2; });
      parts.push(h('button', { class: 'btn small', title: '작게', onclick: grow(0.9) }, '작게'), h('button', { class: 'btn small', title: '크게', onclick: grow(1.1) }, '크게'));
    }
    parts.push(h('button', { class: 'icon-btn', title: '복제', 'aria-label': '복제', onclick: () => duplicate(f), html: icon('copy') }));
    parts.push(h('button', { class: 'icon-btn danger', title: '삭제', 'aria-label': '삭제', onclick: removeSelected, html: icon('trash') }));
  } else if (HINTS[S.tool]) {
    parts.push(h('span', { class: 'hint' }, HINTS[S.tool]));
    if (S.tool === 'text' || S.tool === 'note') {
      parts.push(fontPicker(S.style.font || 'noto', id => { S.style.font = id === 'noto' ? undefined : id; updateBar(); }));
      parts.push(stepper('글자 크기', S.style.size, 6, 200, 1, v => { S.style.size = v; updateBar(); }));
      parts.push(swatches(PALETTE, S.style.color, c => { S.style.color = c; updateBar(); }));
    } else if (S.tool === 'highlight') parts.push(swatches(HL_PALETTE, S.style.hl, c => { S.style.hl = c; updateBar(); }));
    else if (S.tool === 'underline' || S.tool === 'strike') parts.push(swatches(PALETTE, S.style.ul || '#e1251b', c => { S.style.ul = c; updateBar(); }));
    else if (S.tool === 'shape') {
      parts.push(shapeKinds(S.style.shape || 'rect', v => { S.style.shape = v; updateBar(); }));
      parts.push(swatches(PALETTE, S.style.ink, c => { S.style.ink = c; updateBar(); }));
      parts.push(stepper('굵기', S.style.inkW, 1, 12, 1, v => { S.style.inkW = v; updateBar(); }));
    } else if (S.tool === 'redact') parts.push(h('button', { class: 'btn small primary', onclick: () => import('./tools2.js').then(m => m.redactApplyDialog()) }, '교정 적용 (영구 삭제)'), h('button', { class: 'btn small', onclick: () => import('./tools2.js').then(m => m.redactSearchDialog()) }, '검색해서 표시'));
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
