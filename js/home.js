// 홈 화면: 최근 파일 · 별표 · 검색 · 사이드 메뉴
import { S, $, $$, h, icon, fmtSize, toast } from './state.js';
import * as R from './recent.js';

let filter = 'recent', view = 'list', query = '';
try { view = localStorage.getItem('pdfg.view') || 'list'; } catch { /* 저장 불가 */ }

function when(t) {
  const d = new Date(t), now = new Date(), day = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 864e5);
  const time = d.toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' });
  return diff === 0 ? '오늘, ' + time : diff === 1 ? '어제, ' + time : `${d.getMonth() + 1}월${d.getDate()}일`;
}

export async function renderRecent(openRecent) {
  const box = $('#recent');
  let items = await R.listRecent();
  const total = items.length;
  if (filter === 'star') items = items.filter(x => x.star);
  if (query) items = items.filter(x => x.name.toLowerCase().includes(query));
  $('#recentTitle').textContent = filter === 'star' ? '별표 표시된 파일' : '최근';
  $('#recentSec').hidden = !total && !query;
  $('#clearRecent').hidden = filter === 'star' || !items.length;
  $$('#hside [data-f]').forEach(b => b.classList.toggle('on', b.dataset.f === filter));
  $$('.views button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === view));
  box.className = 'recent ' + view;
  if (!items.length) { box.replaceChildren(h('p', { class: 'empty' }, filter === 'star' ? '별표를 누른 파일이 여기에 모입니다.' : '조건에 맞는 파일이 없습니다.')); return; }
  const star = it => h('button', { class: 'icon-btn star' + (it.star ? ' on' : ''), 'aria-label': it.star ? '별표 해제' : '별표 표시', 'aria-pressed': !!it.star, title: '별표', onclick: async e => { e.stopPropagation(); await R.toggleStar(it.id); renderRecent(openRecent); }, html: icon('star') });
  const del = it => h('button', { class: 'icon-btn danger', 'aria-label': '목록에서 삭제', title: '목록에서 삭제', onclick: async e => { e.stopPropagation(); await R.removeRecent(it.id); renderRecent(openRecent); }, html: icon('x') });
  const th = it => it.thumb ? h('img', { src: it.thumb, alt: '' }) : h('span', { class: 'nothumb', html: icon('file') });
  const open = it => () => openRecent(it);
  if (view === 'grid') {
    box.replaceChildren(...items.map(it => h('div', { class: 'rcard', tabindex: 0, role: 'button', onclick: open(it), onkeydown: e => { if (e.key === 'Enter') open(it)(); } },
      h('div', { class: 'rth' }, th(it)), h('div', { class: 'rn', title: it.name }, it.name),
      h('div', { class: 'rm' }, when(it.time) + ' · ' + fmtSize(it.size)), h('div', { class: 'racts' }, star(it), del(it)))));
  } else {
    box.replaceChildren(h('div', { class: 'rrow head' }, h('span', {}), h('span', { class: 'c-n' }, '이름'), h('span', { class: 'c-t' }, '열린 시간'), h('span', { class: 'c-s' }, '크기'), h('span', {}), h('span', {})),
      ...items.map(it => h('div', { class: 'rrow', tabindex: 0, role: 'button', onclick: open(it), onkeydown: e => { if (e.key === 'Enter') open(it)(); } },
        h('span', { class: 'rt' }, th(it)), h('span', { class: 'c-n' }, h('b', { title: it.name }, it.name), h('small', {}, 'PDF')),
        h('span', { class: 'c-t' }, when(it.time)), h('span', { class: 'c-s' }, fmtSize(it.size)), star(it), del(it))));
  }
}

export function initHome({ openRecent, onSideAct, onSearch }) {
  const refresh = () => renderRecent(openRecent);
  $$('#hside [data-f]').forEach(b => b.addEventListener('click', () => { filter = b.dataset.f; $('#recentSec').scrollIntoView({ behavior: 'smooth' }); refresh(); }));
  $$('#hside [data-act]').forEach(b => b.addEventListener('click', () => onSideAct(b.dataset.act)));
  $$('.views button').forEach(b => b.addEventListener('click', () => { view = b.dataset.v; try { localStorage.setItem('pdfg.view', view); } catch { /* 무시 */ } refresh(); }));
  $('#clearRecent').addEventListener('click', async () => { if (confirm('최근 파일 목록을 지울까요? (별표 표시한 파일은 남습니다)')) { await R.clearRecent(); refresh(); } });
  $('#hsearch').addEventListener('input', e => {
    query = e.target.value.trim().toLowerCase();
    $$('#cards .card').forEach(c => { c.hidden = !!query && !c.textContent.toLowerCase().includes(query); });
    $('#gridWrap').hidden = !!query && ![...$$('#cards .card')].some(c => !c.hidden);
    refresh(); onSearch?.(query);
  });
  refresh();
  return { refresh };
}
