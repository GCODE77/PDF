// 왼쪽 패널(페이지 · 목차 · 검색) + 페이지 정리 화면
import { S, $, $$, h, icon, on, emit, toast, busy, modal, parseRange, download, pickFiles, readBytes } from './state.js';
import * as core from './pdfcore.js';
import * as D from './doc.js';
import * as V from './viewer.js';

let panelEl, thumbObs;
const tcache = new Map();         // 페이지 번호 -> 썸네일 canvas (문서 바뀌면 초기화)

export function initSide() {
  panelEl = $('#panel');
  on('doc-loaded', () => { tcache.clear(); S.search = null; textCache.clear(); renderPanel(); });
  on('page-changed', markActive);
  $$('#rail button').forEach(b => b.addEventListener('click', () => showPanel(b.dataset.panel)));
  $('#panelClose').addEventListener('click', () => togglePanel(false));
}

export function togglePanel(open) {
  const el = $('#editor');
  const v = open ?? !el.classList.contains('panel-open');
  el.classList.toggle('panel-open', v);
  $('#btnPanel')?.setAttribute('aria-pressed', v);
  if (v && !S.panelTab) showPanel('pages');
}

export function showPanel(name) {
  S.panelTab = name;
  $$('#rail button').forEach(b => b.setAttribute('aria-pressed', b.dataset.panel === name));
  $('#editor').classList.add('panel-open');
  $('#panelTitle').textContent = { pages: '페이지', outline: '목차', search: '검색' }[name];
  renderPanel();
}

function renderPanel() {
  if (!S.pdf || !panelEl) return;
  thumbObs?.disconnect();
  const t = S.panelTab || 'pages';
  if (t === 'pages') renderThumbs();
  else if (t === 'outline') renderOutline();
  else renderSearch();
}

// ======================== 페이지(썸네일) ========================
function renderThumbs() {
  const list = h('div', { class: 'thumbs' });
  panelEl.replaceChildren(h('div', { class: 'p-actions' },
    h('button', { class: 'btn small', onclick: () => openOrganizer(), html: icon('grid') + '<span>페이지 정리</span>' })), list);
  thumbObs = new IntersectionObserver(es => es.forEach(e => {
    if (e.isIntersecting) { thumbObs.unobserve(e.target); drawThumb(e.target); }
  }), { root: panelEl, rootMargin: '300px' });
  for (let i = 1; i <= S.n; i++) {
    const cell = h('div', { class: 'thumb', 'data-p': i, tabindex: 0, role: 'button', 'aria-label': i + '페이지로 이동', onclick: () => V.scrollToPage(i, true), onkeydown: e => { if (e.key === 'Enter') V.scrollToPage(i, true); } },
      h('div', { class: 'tcv' }), h('span', { class: 'tn' }, String(i)),
      h('div', { class: 'tq' },
        h('button', { class: 'icon-btn', title: '왼쪽으로 회전', 'aria-label': '왼쪽으로 회전', onclick: e => { e.stopPropagation(); quickOp(i - 1, 'rotL'); }, html: icon('rotl') }),
        h('button', { class: 'icon-btn', title: '오른쪽으로 회전', 'aria-label': '오른쪽으로 회전', onclick: e => { e.stopPropagation(); quickOp(i - 1, 'rotR'); }, html: icon('rotr') }),
        h('button', { class: 'icon-btn danger', title: '이 페이지 삭제', 'aria-label': '이 페이지 삭제', onclick: e => { e.stopPropagation(); quickOp(i - 1, 'del'); }, html: icon('trash') })));
    list.append(cell);
    thumbObs.observe(cell);
  }
  markActive();
}

async function drawThumb(cell) {
  const n = +cell.dataset.p;
  let cv = tcache.get(n);
  if (!cv) {
    const page = await S.pdf.getPage(n);
    const v1 = page.getViewport({ scale: 1 });
    cv = await core.renderCanvas(S.pdf, n, 150 / v1.width);
    tcache.set(n, cv);
  }
  const c = cv.cloneNode ? h('canvas') : cv;
  c.width = cv.width; c.height = cv.height; c.getContext('2d').drawImage(cv, 0, 0);
  cell.querySelector('.tcv').replaceChildren(c);
}

function markActive() {
  const cells = $$('.thumb', panelEl);
  cells.forEach(c => c.classList.toggle('on', +c.dataset.p === S.curPage));
  if (S.panelTab === 'pages') cells[S.curPage - 1]?.scrollIntoView({ block: 'nearest' });
}

export async function quickOp(idx, op) {
  if (op === 'del' && S.n === 1) return toast('마지막 한 페이지는 삭제할 수 없습니다', 'err');
  const b = await D.flush();
  const plan = Array.from({ length: S.n }, (_, i) => ({ src: i, rot: 0 }));
  if (op === 'rotL') plan[idx].rot = -90;
  else if (op === 'rotR') plan[idx].rot = 90;
  else plan.splice(idx, 1);
  await D.applyBytes(await core.applyPlan(b, plan));
  toast(op === 'del' ? `${idx + 1}페이지를 삭제했습니다 (되돌리기: Ctrl+Z)` : '회전했습니다');
}

// ======================== 목차 ========================
async function renderOutline() {
  panelEl.replaceChildren(h('p', { class: 'muted pad' }, '불러오는 중…'));
  const out = await S.pdf.getOutline();
  if (!out?.length) { panelEl.replaceChildren(h('p', { class: 'muted pad' }, '이 문서에는 목차(북마크)가 없습니다.')); return; }
  const go = async dest => {
    try {
      const d = typeof dest === 'string' ? await S.pdf.getDestination(dest) : dest;
      const idx = await S.pdf.getPageIndex(d[0]);
      V.scrollToPage(idx + 1, true);
    } catch { /* 이동 불가 항목 */ }
  };
  const mk = items => h('ul', { class: 'tree' }, items.map(it => h('li', {}, h('button', { onclick: () => go(it.dest) }, it.title), it.items?.length ? mk(it.items) : null)));
  panelEl.replaceChildren(mk(out));
}

// ======================== 검색 ========================
const textCache = new Map();
let searchToken = 0;

async function getText(i) {
  if (textCache.has(i)) return textCache.get(i);
  const page = await S.pdf.getPage(i + 1);
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  let str = ''; const segs = [];
  for (const it of tc.items) {
    if (!it.str && !it.hasEOL) continue;
    segs.push({ s: str.length, e: str.length + it.str.length, it });
    str += it.str + (it.hasEOL ? ' ' : '');
    if (!it.hasEOL && it.str) { /* 아이템 사이 공백은 추가하지 않음 (한글 단어가 쪼개지지 않도록) */ }
  }
  const r = { str, low: str.toLowerCase(), segs, vp };
  textCache.set(i, r);
  return r;
}

function rectsFor(t, a, b) {
  const out = [];
  for (const sg of t.segs) {
    if (sg.e <= a || sg.s >= b || sg.e === sg.s) continue;
    const it = sg.it, len = sg.e - sg.s;
    const fa = Math.max(0, (a - sg.s) / len), fb = Math.min(1, (b - sg.s) / len);
    const fh = Math.hypot(it.transform[2], it.transform[3]) || it.height;
    const x = it.transform[4] + it.width * fa, w = it.width * (fb - fa), y = it.transform[5];
    const [x1, y1] = t.vp.convertToViewportPoint(x, y - fh * 0.22), [x2, y2] = t.vp.convertToViewportPoint(x + w, y + fh * 0.92);
    out.push([Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1)]);
  }
  return out;
}

export function focusSearch() { showPanel('search'); setTimeout(() => $('#q')?.focus(), 50); }

function renderSearch() {
  const inp = h('input', { id: 'q', class: 'inp', type: 'search', placeholder: '문서에서 찾기…', value: S.search?.q || '', 'aria-label': '검색어' });
  const info = h('div', { class: 'muted s-info' }, S.search ? `${S.search.results.length}건` : '검색어를 입력하고 Enter');
  const list = h('div', { class: 's-list' });
  const nav = h('div', { class: 's-nav' },
    h('button', { class: 'icon-btn', 'aria-label': '이전 결과', onclick: () => step(-1), html: icon('up') }),
    h('button', { class: 'icon-btn', 'aria-label': '다음 결과', onclick: () => step(1), html: icon('down') }));
  panelEl.replaceChildren(h('div', { class: 's-box' }, inp, nav), info, list);
  const fill = () => {
    list.replaceChildren(...(S.search?.results || []).slice(0, 500).map((r, idx) => h('button', { class: 's-item' + (idx === S.search.cur ? ' on' : ''), onclick: () => jump(idx) }, h('span', { class: 'sp' }, r.page + 1 + 'p'), h('span', {}, r.snip))));
  };
  fill();
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') { if (S.search && S.search.q === inp.value.trim() && S.search.results.length) step(e.shiftKey ? -1 : 1); else run(inp.value.trim(), info, fill); } });
  inp.addEventListener('input', () => { if (!inp.value.trim()) { S.search = null; V.redrawAllHighlights(); info.textContent = '검색어를 입력하고 Enter'; list.replaceChildren(); } });
  function jump(idx) {
    S.search.cur = idx;
    const r = S.search.results[idx];
    V.redrawAllHighlights();
    if (r.rects?.[0]) V.scrollToRect(r.page, r.rects[0]); else V.scrollToPage(r.page + 1, true);
    $$('.s-item', list).forEach((e, i) => e.classList.toggle('on', i === idx));
    $$('.s-item', list)[idx]?.scrollIntoView({ block: 'nearest' });
    info.textContent = `${idx + 1} / ${S.search.results.length}건`;
  }
  function step(d) { if (!S.search?.results.length) return; jump((S.search.cur + d + S.search.results.length) % S.search.results.length); }
  S._searchJump = jump;
}

async function run(q, info, fill) {
  if (!q) return;
  const tok = ++searchToken;
  S.search = { q, results: [], cur: -1 };
  const ql = q.toLowerCase();
  info.textContent = '검색 중…';
  for (let i = 0; i < S.n; i++) {
    if (tok !== searchToken) return;
    const t = await getText(i);
    let p = 0;
    while ((p = t.low.indexOf(ql, p)) !== -1) {
      const a = Math.max(0, p - 12), b = Math.min(t.str.length, p + q.length + 22);
      S.search.results.push({ page: i, snip: (a ? '…' : '') + t.str.slice(a, b).replace(/\s+/g, ' ') + (b < t.str.length ? '…' : ''), rects: rectsFor(t, p, p + q.length) });
      p += q.length;
    }
    if (i % 5 === 4 || i === S.n - 1) { info.textContent = `검색 중… ${S.search.results.length}건 (${i + 1}/${S.n}쪽)`; }
  }
  fill();
  V.redrawAllHighlights();
  if (!S.search.results.length) { info.textContent = '검색 결과가 없습니다. 스캔 문서라면 「문자 인식(OCR)」을 먼저 실행하세요.'; return; }
  S._searchJump(0);
}

// ======================== 페이지 정리 화면 ========================
export async function openOrganizer({ mode } = {}) {
  await D.flush();
  const root = $('#organizer');
  let items = Array.from({ length: S.n }, (_, i) => ({ k: i, src: i, rot: 0 }));
  let key = S.n;
  const sel = new Set();
  let dragK = null;
  const orig = JSON.stringify(items.map(x => x.k));
  const view = S.bytes;

  const grid = h('div', { class: 'og' });
  const count = h('span', { class: 'o-count' });
  const btn = (ic, label, fn, cls = '') => h('button', { class: 'o-btn ' + cls, onclick: fn, title: label }, h('span', { html: icon(ic) }), h('span', { class: 'lb' }, label));
  const bApply = h('button', { class: 'btn primary', onclick: apply }, '변경 적용');
  const bar = h('div', { class: 'o-bar' },
    h('button', { class: 'btn ghost', onclick: () => close(), html: icon('left') + '<span>돌아가기</span>' }),
    h('strong', { class: 'o-title' }, '페이지 정리'),
    count, h('span', { class: 'sp1' }), bApply);
  const tools = h('div', { class: 'o-tools' },
    btn('check', '전체 선택', () => { items.forEach(x => sel.add(x.k)); draw(); }),
    btn('rotl', '왼쪽 회전', () => rot(-90)), btn('rotr', '오른쪽 회전', () => rot(90)),
    btn('left', '앞으로', () => move(-1)), btn('right', '뒤로', () => move(1)),
    btn('copy', '복제', dup), btn('plus', '빈 페이지', blank),
    btn('extract', '선택 추출', extract), btn('trash', '삭제', del, 'danger'));
  root.replaceChildren(bar, tools, h('div', { class: 'o-hint' }, '페이지를 눌러 선택하세요. 끌어서 순서를 바꾸거나, 위 버튼으로 회전·삭제·복제·추출할 수 있습니다.'), grid);
  root.hidden = false;
  document.body.classList.add('no-scroll');

  const obs = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { obs.unobserve(e.target); paintThumb(e.target); } }), { root: grid, rootMargin: '400px' });
  async function paintThumb(cell) {
    const src = +cell.dataset.src;
    if (src < 0) return;
    let cv = tcache.get(src + 1);
    if (!cv) {
      const pg = await S.pdf.getPage(src + 1);
      cv = await core.renderCanvas(S.pdf, src + 1, 150 / pg.getViewport({ scale: 1 }).width);
      tcache.set(src + 1, cv);
    }
    const c = h('canvas'); c.width = cv.width; c.height = cv.height; c.getContext('2d').drawImage(cv, 0, 0);
    cell.querySelector('.ocv').replaceChildren(c);
  }
  function draw() {
    grid.replaceChildren();
    items.forEach((it, n) => {
      const on_ = sel.has(it.k);
      const cell = h('div', { class: 'ocell' + (on_ ? ' on' : ''), draggable: 'true', 'data-src': it.blank ? -1 : it.src, 'data-k': it.k, role: 'checkbox', 'aria-checked': on_, tabindex: 0,
        onclick: () => { on_ ? sel.delete(it.k) : sel.add(it.k); draw(); },
        onkeydown: e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); on_ ? sel.delete(it.k) : sel.add(it.k); draw(); } },
        ondragstart: e => { dragK = it.k; e.dataTransfer.effectAllowed = 'move'; cell.classList.add('drag'); },
        ondragend: () => { dragK = null; cell.classList.remove('drag'); },
        ondragover: e => { e.preventDefault(); cell.classList.add('over'); },
        ondragleave: () => cell.classList.remove('over'),
        ondrop: e => {
          e.preventDefault();
          if (dragK == null || dragK === it.k) return;
          const group = sel.has(dragK) ? items.filter(x => sel.has(x.k)) : [items.find(x => x.k === dragK)];
          const rest = items.filter(x => !group.includes(x));
          const at = rest.indexOf(it);
          rest.splice(at, 0, ...group); items = rest; draw();
        } },
        h('div', { class: 'ocv', style: { transform: `rotate(${it.rot}deg)` } }, it.blank ? h('div', { class: 'blank' }, '빈 페이지') : null),
        h('span', { class: 'on_' }, h('span', { html: icon('check') })), h('span', { class: 'ono' }, String(n + 1)));
      if (!it.blank) obs.observe(cell);
      grid.append(cell);
    });
    count.textContent = `${items.length}쪽${sel.size ? ' · ' + sel.size + '쪽 선택' : ''}`;
    $$('.o-tools .o-btn', root).forEach((b, i) => { b.disabled = !(i === 0 || i === 6 || sel.size); });
    const changed = JSON.stringify(items.map(x => x.k)) !== orig || items.some(x => x.rot);
    bApply.disabled = !changed;
  }
  const chosen = () => items.filter(x => sel.has(x.k));
  function rot(d) { chosen().forEach(x => x.rot = ((x.rot + d) % 360 + 360) % 360); draw(); }
  function del() {
    if (items.length === chosen().length) return toast('모든 페이지를 삭제할 수는 없습니다', 'err');
    items = items.filter(x => !sel.has(x.k)); sel.clear(); draw();
  }
  function dup() {
    const out = [];
    items.forEach(x => { out.push(x); if (sel.has(x.k)) out.push({ ...x, k: key++ }); });
    items = out; draw();
  }
  function blank() {
    const at = items.findLastIndex(x => sel.has(x.k));
    const ref = items[at >= 0 ? at : items.length - 1];
    const dim = info_(ref);
    items.splice((at >= 0 ? at : items.length - 1) + 1, 0, { k: key++, blank: true, w: dim[0], h: dim[1], rot: 0 });
    draw();
  }
  function info_(ref) { return ref.blank ? [ref.w, ref.h] : (S.__sizes?.[ref.src] || [595.28, 841.89]); }
  function move(d) {
    const idx = items.map((x, i) => sel.has(x.k) ? i : -1).filter(i => i >= 0);
    if (d < 0) { if (idx[0] === 0) return; idx.forEach(i => [items[i - 1], items[i]] = [items[i], items[i - 1]]); }
    else { if (idx.at(-1) === items.length - 1) return; [...idx].reverse().forEach(i => [items[i + 1], items[i]] = [items[i], items[i + 1]]); }
    draw();
  }
  async function extract() {
    const list = chosen().filter(x => !x.blank);
    if (!list.length) return;
    const bb = busy('선택한 페이지를 추출하는 중…');
    try {
      const bytes = await core.applyPlan(view, list.map(x => ({ src: x.src, rot: x.rot })));
      download(bytes, D.safeName('_추출'), 'application/pdf');
      toast(`${list.length}쪽을 PDF로 저장했습니다`, 'ok');
    } finally { bb.close(); }
  }
  async function apply() {
    const bb = busy('페이지를 정리하는 중…');
    try {
      const plan = items.map(x => x.blank ? { blank: true, w: x.w, h: x.h } : { src: x.src, rot: x.rot });
      await D.applyBytes(await core.applyPlan(view, plan));
      toast('페이지 정리를 적용했습니다. 되돌리려면 Ctrl+Z', 'ok');
      close(true);
    } finally { bb.close(); }
  }
  function close(force) {
    if (force !== true && !bApply.disabled && !confirm('적용하지 않은 변경이 있습니다. 그래도 닫을까요?')) return;
    obs.disconnect(); root.hidden = true; root.replaceChildren(); document.body.classList.remove('no-scroll');
  }
  // 페이지 크기 조회(빈 페이지 크기 기준)
  S.__sizes = await Promise.all(Array.from({ length: S.n }, (_, i) => S.pdf.getPage(i + 1).then(p => { const v = p.getViewport({ scale: 1 }); return [v.width, v.height]; })));
  draw();
  if (mode === 'extract') toast('추출할 페이지를 선택한 뒤 「선택 추출」을 누르세요');
}
