// 홈 화면: 최근 파일 · 별표 · 검색 · 사이드 메뉴
import { S, $, $$, h, icon, fmtSize, toast, modal } from './state.js';
import * as R from './recent.js';

let filter = 'recent', view = 'list', query = '';
let selecting = false, shown = [];            // 선택 모드 여부, 지금 화면에 보이는 항목
const selected = new Set();                   // 선택한 항목 id (보이는 항목 안에서만 유지)
try { view = localStorage.getItem('pdfg.view') || 'list'; } catch { /* 저장 불가 */ }

function when(t) {
  const d = new Date(t), now = new Date(), day = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 864e5);
  const time = d.toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' });
  return diff === 0 ? '오늘, ' + time : diff === 1 ? '어제, ' + time : `${d.getMonth() + 1}월${d.getDate()}일`;
}

function syncBar() {
  const n = selected.size, all = shown.length > 0 && shown.every(x => selected.has(x.id));
  $('#selBar').hidden = !selecting;
  $('#selCount').textContent = n ? `${n}개 선택됨` : '지울 파일을 선택하세요';
  $('#selAll').checked = all;
  $('#selDel').disabled = !n;
  $('#selDel').textContent = n ? `선택 삭제 (${n})` : '선택 삭제';
}

export async function renderRecent(openRecent) {
  const box = $('#recent');
  let items = await R.listRecent();
  const total = items.length;
  if (filter === 'star') items = items.filter(x => x.star);
  if (query) items = items.filter(x => x.name.toLowerCase().includes(query));
  if (!total) { selecting = false; selected.clear(); }
  shown = items;
  const ids = new Set(items.map(x => x.id));
  for (const id of [...selected]) if (!ids.has(id)) selected.delete(id);   // 필터·검색으로 안 보이게 된 항목은 선택에서 뺀다
  $('#recentTitle').textContent = filter === 'star' ? '별표 표시된 파일' : '최근';
  $('#recentSec').hidden = !total && !query;
  $('#selRecent').hidden = selecting || !items.length;
  $('#clearRecent').hidden = selecting || filter === 'star' || !items.length;
  $$('#hside [data-f]').forEach(b => b.classList.toggle('on', b.dataset.f === filter));
  $$('.views button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === view));
  box.className = 'recent ' + view + (selecting ? ' sel' : '');
  syncBar();
  if (!items.length) { box.replaceChildren(h('p', { class: 'empty' }, filter === 'star' ? '별표를 누른 파일이 여기에 모입니다.' : '조건에 맞는 파일이 없습니다.')); return; }
  const star = it => h('button', { class: 'icon-btn star' + (it.star ? ' on' : ''), 'aria-label': it.star ? '별표 해제' : '별표 표시', 'aria-pressed': !!it.star, title: '별표', onclick: async e => { e.stopPropagation(); await R.toggleStar(it.id); renderRecent(openRecent); }, html: icon('star') });
  const del = it => h('button', { class: 'icon-btn danger', 'aria-label': '목록에서 삭제', title: '목록에서 삭제', onclick: async e => { e.stopPropagation(); await R.removeRecent(it.id); renderRecent(openRecent); }, html: icon('x') });
  const th = it => it.thumb ? h('img', { src: it.thumb, alt: '' }) : h('span', { class: 'nothumb', html: icon('file') });
  // 선택 모드에서는 눌러도 파일이 열리지 않고 체크만 바뀐다
  const pick = (it, el, on) => {
    if (on === undefined) on = !selected.has(it.id);
    on ? selected.add(it.id) : selected.delete(it.id);
    el.classList.toggle('picked', on);
    const c = el.querySelector('.rchk'); if (c) c.checked = on;
    syncBar();
  };
  const chk = it => selecting ? h('input', { type: 'checkbox', class: 'rchk', 'aria-label': it.name + ' 선택', checked: selected.has(it.id), onclick: e => e.stopPropagation(), onchange: e => pick(it, e.target.closest('.rrow, .rcard'), e.target.checked) }) : null;
  const act = it => e => (selecting ? pick(it, e.currentTarget) : openRecent(it));
  const key = it => e => { if (e.key === 'Enter' || (selecting && e.key === ' ')) { e.preventDefault(); act(it)({ currentTarget: e.currentTarget }); } };
  const cls = it => (selecting && selected.has(it.id) ? ' picked' : '');
  if (view === 'grid') {
    box.replaceChildren(...items.map(it => h('div', { class: 'rcard' + cls(it), tabindex: 0, role: 'button', onclick: act(it), onkeydown: key(it) },
      chk(it), h('div', { class: 'rth' }, th(it)), h('div', { class: 'rn', title: it.name }, it.name),
      h('div', { class: 'rm' }, when(it.time) + ' · ' + fmtSize(it.size)), h('div', { class: 'racts' }, star(it), del(it)))));
  } else {
    box.replaceChildren(h('div', { class: 'rrow head' }, selecting ? h('span', {}) : null, h('span', {}), h('span', { class: 'c-n' }, '이름'), h('span', { class: 'c-t' }, '열린 시간'), h('span', { class: 'c-s' }, '크기'), h('span', {}), h('span', {})),
      ...items.map(it => h('div', { class: 'rrow' + cls(it), tabindex: 0, role: 'button', onclick: act(it), onkeydown: key(it) },
        chk(it), h('span', { class: 'rt' }, th(it)), h('span', { class: 'c-n' }, h('b', { title: it.name }, it.name), h('small', {}, 'PDF')),
        h('span', { class: 'c-t' }, when(it.time)), h('span', { class: 'c-s' }, fmtSize(it.size)), star(it), del(it))));
  }
}

export function initHome({ openRecent, onSideAct, onSearch }) {
  const refresh = () => renderRecent(openRecent);
  const setSelecting = on => { selecting = on; selected.clear(); refresh(); };
  $$('#hside [data-f]').forEach(b => b.addEventListener('click', () => { filter = b.dataset.f; $('#recentSec').scrollIntoView({ behavior: 'smooth' }); refresh(); }));
  $$('#hside [data-act]').forEach(b => b.addEventListener('click', () => onSideAct(b.dataset.act)));
  $$('.views button').forEach(b => b.addEventListener('click', () => { view = b.dataset.v; try { localStorage.setItem('pdfg.view', view); } catch { /* 무시 */ } refresh(); }));

  // 전체 지우기: 별표 파일은 기본으로 남기고, 원할 때만 함께 지운다
  $('#clearRecent').addEventListener('click', async () => {
    const all = await R.listRecent(), starred = all.filter(x => x.star).length;
    if (!all.length) return;
    const inc = h('input', { type: 'checkbox' });
    modal({
      title: '최근 파일 전체 지우기',
      body: [
        h('p', {}, `최근 파일 ${all.length}개를 목록에서 지웁니다.`),
        h('p', { class: 'muted small' }, '내 컴퓨터·폰에 있는 원래 PDF 파일은 지워지지 않습니다. 이 앱에 임시로 저장된 사본과 미리보기만 지워집니다.'),
        starred ? h('label', { class: 'chk' }, inc, `별표 표시한 파일 ${starred}개도 함께 지우기`) : null,
      ],
      actions: [{ label: '취소' }, { label: '모두 지우기', kind: 'danger', run: async () => { await R.clearRecent(inc.checked); toast('최근 파일을 지웠습니다', 'ok'); refresh(); } }],
    });
  });

  // 선택해서 지우기 (체크박스)
  $('#selRecent').addEventListener('click', () => setSelecting(true));
  $('#selCancel').addEventListener('click', () => setSelecting(false));
  $('#selAll').addEventListener('change', e => { shown.forEach(x => (e.target.checked ? selected.add(x.id) : selected.delete(x.id))); refresh(); });
  $('#selDel').addEventListener('click', () => {
    const ids = [...selected], starred = shown.filter(x => selected.has(x.id) && x.star).length;
    if (!ids.length) return;
    modal({
      title: '선택한 파일 지우기',
      body: [
        h('p', {}, `선택한 ${ids.length}개를 최근 목록에서 지웁니다.`),
        h('p', { class: 'muted small' }, '내 컴퓨터·폰에 있는 원래 PDF 파일은 지워지지 않습니다.'),
        starred ? h('p', { class: 'warn' }, `별표 표시한 파일 ${starred}개가 들어 있습니다.`) : null,
      ],
      actions: [{ label: '취소' }, { label: `${ids.length}개 지우기`, kind: 'danger', run: async () => { await R.removeMany(ids); selecting = false; selected.clear(); toast(`${ids.length}개를 지웠습니다`, 'ok'); refresh(); } }],
    });
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && selecting && $('#modal-root').hidden && $('#recentSec').offsetParent) { e.preventDefault(); setSelecting(false); }
  });

  $('#hsearch').addEventListener('input', e => {
    query = e.target.value.trim().toLowerCase();
    $$('#cards .card').forEach(c => { c.hidden = !!query && !c.textContent.toLowerCase().includes(query); });
    $('#gridWrap').hidden = !!query && ![...$$('#cards .card')].some(c => !c.hidden);
    refresh(); onSearch?.(query);
  });
  refresh();
  return { refresh };
}
