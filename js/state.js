// 공용 상태 · 유틸리티
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export const S = {
  bytes: null,          // 현재 문서(Uint8Array)
  name: 'document.pdf',
  pdf: null,            // pdf.js 문서
  n: 0,
  overlays: {},         // pageIndex -> [obj]
  imgs: {},             // imgId -> dataURL
  hist: [], fut: [],
  tool: 'select',
  zoom: 1,              // 1 = 100% (96dpi)
  fit: 'width',
  dirty: false,
  uid: 1,
  selected: null,
  curPage: 1,
  style: { color: '#111111', size: 16, bold: false, ink: '#e1251b', inkW: 3, hl: '#ffe14d', wo: '#ffffff', note: '#fff3a0' },
};

const bus = new EventTarget();
export const emit = (t, d) => bus.dispatchEvent(new CustomEvent(t, { detail: d }));
export const on = (t, f) => bus.addEventListener(t, e => f(e.detail));

export const icon = (name, cls = '') => `<svg class="ic ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;

export function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(c));
  return e;
}

export function toast(msg, kind = '') {
  const t = h('div', { class: 'toast ' + kind, role: 'status' }, msg);
  $('#toasts').append(t);
  setTimeout(() => t.classList.add('out'), 3200);
  setTimeout(() => t.remove(), 3700);
}

// 처리 중 오버레이 (진행률 + 취소)
export function busy(msg = '처리 중…') {
  const root = $('#busy');
  const bar = h('div', { class: 'bar' }, h('i'));
  const txt = h('div', { class: 'bt' }, msg);
  const cancel = h('button', { class: 'btn ghost', onclick: () => { api.cancelled = true; cancel.disabled = true; txt.textContent = '취소하는 중…'; } }, '취소');
  const box = h('div', { class: 'busybox' }, h('div', { class: 'spin' }), txt, bar, cancel);
  root.replaceChildren(box);
  root.hidden = false;
  const api = {
    cancelled: false,
    set(m, pct) {
      if (m) txt.textContent = m;
      if (pct != null) bar.firstChild.style.width = Math.round(pct * 100) + '%';
    },
    close() { root.hidden = true; root.replaceChildren(); },
  };
  return api;
}

export const fmtSize = b => b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(0) + ' KB' : (b / 1048576).toFixed(2) + ' MB';

export function download(data, name, mime = 'application/octet-stream') {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}

export const baseName = n => n.replace(/\.[^.]+$/, '');

// "1-3, 5, 8-" -> [0,1,2,4,7,...]  (0부터 시작, 중복 제거, 입력 순서 유지)
export function parseRange(str, max) {
  const out = [], seen = new Set();
  const s = String(str || '').trim();
  if (!s) return null;
  for (const part of s.split(/[,\s]+/).filter(Boolean)) {
    const m = part.match(/^(\d*)\s*[-~]\s*(\d*)$/);
    let a, b;
    if (m) { a = m[1] ? +m[1] : 1; b = m[2] ? +m[2] : max; }
    else if (/^\d+$/.test(part)) { a = b = +part; }
    else return null;
    if (a > b) [a, b] = [b, a];
    if (a < 1 || b > max) return null;
    for (let i = a; i <= b; i++) if (!seen.has(i)) { seen.add(i); out.push(i - 1); }
  }
  return out.length ? out : null;
}

export function pickFiles(accept, multiple = false, capture = false) {
  return new Promise(res => {
    const i = h('input', { type: 'file', accept, multiple, style: { display: 'none' } });
    if (capture) i.setAttribute('capture', 'environment');
    i.addEventListener('change', () => { res([...i.files]); i.remove(); });
    i.addEventListener('cancel', () => { res([]); i.remove(); });
    document.body.append(i);
    i.click();
  });
}

export const readBytes = async f => new Uint8Array(await f.arrayBuffer());
export const uid = () => 'o' + (S.uid++);
export const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- 모달 ----------
let modalCount = 0;
const modalStack = [];
export function modal({ title, body, actions = [], wide = false, onClose }) {
  const root = $('#modal-root');
  let closed = false;
  const onKey = e => {
    if (e.key === 'Escape' && modalStack[modalStack.length - 1] === api && !e.defaultPrevented) { e.preventDefault(); e.stopPropagation(); close(); }
  };
  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey, true);
    const i = modalStack.indexOf(api); if (i >= 0) modalStack.splice(i, 1);
    wrap.remove(); modalCount--; if (!modalCount) root.hidden = true; onClose && onClose();
  };
  const foot = h('div', { class: 'm-foot' });
  const api = { close, body: null, foot, buttons: {} };
  for (const a of actions) {
    const b = h('button', {
      class: 'btn ' + (a.kind || 'ghost'),
      onclick: async () => {
        if (a.run) {
          b.disabled = true;
          try { const r = await a.run(api); if (r === false) { b.disabled = false; return; } }
          catch (e) { console.error(e); toast(e.message || '오류가 발생했습니다', 'err'); b.disabled = false; return; }
        }
        if (!a.keep) close();
        else b.disabled = false;
      },
    }, a.icon ? [h('span', { html: icon(a.icon) }), a.label] : a.label);
    api.buttons[a.id || a.label] = b;
    foot.append(b);
  }
  const b = h('div', { class: 'm-body' }, body);
  api.body = b;
  const wrap = h('div', { class: 'm-wrap', onmousedown: e => { if (e.target === wrap && !actions.some(a => a.kind === 'primary' && a.noDismiss)) close(); } },
    h('div', { class: 'm-box' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('div', { class: 'm-head' }, h('h2', {}, title), h('button', { class: 'icon-btn', 'aria-label': '닫기', onclick: close, html: icon('x') })),
      b, foot));
  root.append(wrap);
  root.hidden = false;
  modalCount++;
  modalStack.push(api);
  document.addEventListener('keydown', onKey, true);
  setTimeout(() => (wrap.querySelector('[autofocus], input, select, textarea') || wrap.querySelector('.btn.primary'))?.focus(), 30);
  return api;
}
