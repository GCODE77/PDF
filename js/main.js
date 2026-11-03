// 앱 진입점: 화면 전환 · 툴바 · 홈 카드 · 저장 · 파일 열기
import { S, $, $$, h, icon, on, emit, toast, busy, modal, pickFiles, readBytes, download } from './state.js';
import * as D from './doc.js';
import * as V from './viewer.js';
import { initSide, togglePanel, showPanel, focusSearch } from './side.js';
import { TOOLS, PANEL, imagesDialog, mergeDialog } from './tools.js';
import * as R from './recent.js';
import { initHome } from './home.js';
import { initMenu } from './menubar.js';
import { initUpdate } from './update.js';

const phone = V.isPhone;
$$('[data-ic]').forEach(e => { e.innerHTML = icon(e.dataset.ic); });
$$('[data-ic-btn]').forEach(e => { e.insertAdjacentHTML('afterbegin', icon(e.dataset.icBtn)); });
$('#saveIc').innerHTML = icon('save'); $('#shareIc').innerHTML = icon('share');
$('#heroOpenIc').innerHTML = icon('open'); $('#heroImgIc').innerHTML = icon('image');
$('#btnOpen .ico').innerHTML = icon('open');
$('#vList').innerHTML = icon('list'); $('#vGrid').innerHTML = icon('grid'); $('#hsIc').innerHTML = icon('search');
let home = { refresh() {} };

// ---------- 파일 열기 ----------
// ---------- 문서 탭 (여러 문서를 열고, 끌어서 순서 변경, 닫기) ----------
const docs = [];
let activeId = null, tabSeq = 0;
const MAX_TABS = 12;
const isDirty = d => (d.id === activeId ? S.dirty : d.dirty);
function stashActive() {
  const r = docs.find(d => d.id === activeId);
  if (!r || !S.pdf) return;
  Object.assign(r, { name: S.name, bytes: S.bytes, overlays: S.overlays, imgs: S.imgs, hist: S.hist, fut: S.fut, dirty: S.dirty, page: S.curPage });
}
function renderTabs() {
  const box = $('#docTabs');
  const inEditor = !$('#editor').hidden;
  box.replaceChildren(...docs.map(d => {
    const el = h('div', {
      class: 'tab doc' + (d.id === activeId && inEditor ? ' on' : ''), role: 'tab', tabindex: '0', draggable: 'true', 'data-id': d.id, title: d.name,
      onclick: () => switchTo(d.id),
      onauxclick: e => { if (e.button === 1) { e.preventDefault(); closeTab(d.id); } },
      onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); switchTo(d.id); } },
    }, h('span', { class: 'tabname' }, isDirty(d) ? h('span', { class: 'dot', title: '저장하지 않은 변경 사항' }, '●') : null, d.name),
    h('button', { class: 'tclose', 'aria-label': d.name + ' 닫기', title: '탭 닫기 (Ctrl+W)', html: icon('x'), onclick: e => { e.stopPropagation(); closeTab(d.id); } }));
    el.addEventListener('dragstart', e => { e.dataTransfer.setData('text/x-pdfg-tab', String(d.id)); e.dataTransfer.effectAllowed = 'move'; el.classList.add('dragging'); });
    el.addEventListener('dragend', () => { el.classList.remove('dragging'); $$('.tab.doc', box).forEach(t => t.classList.remove('dropbefore', 'dropafter')); });
    el.addEventListener('dragover', e => {
      if (!e.dataTransfer.types.includes('text/x-pdfg-tab')) return;
      e.preventDefault();
      const r = el.getBoundingClientRect(), before = e.clientX < r.left + r.width / 2;
      $$('.tab.doc', box).forEach(t => t.classList.remove('dropbefore', 'dropafter'));
      el.classList.add(before ? 'dropbefore' : 'dropafter');
    });
    el.addEventListener('drop', e => {
      const from = +e.dataTransfer.getData('text/x-pdfg-tab');
      if (!from) return;
      e.preventDefault();
      const r = el.getBoundingClientRect(), before = e.clientX < r.left + r.width / 2;
      moveTab(from, d.id, before);
    });
    return el;
  }));
  box.querySelector('.tab.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
function moveTab(fromId, toId, before) {
  const a = docs.findIndex(d => d.id === fromId);
  if (a < 0 || fromId === toId) { renderTabs(); return; }
  const [rec] = docs.splice(a, 1);
  let b = docs.findIndex(d => d.id === toId);
  if (!before) b++;
  docs.splice(b, 0, rec);
  renderTabs();
}
async function switchTo(id) {
  if (id === activeId) { if ($('#editor').hidden) showEditor(); return; }
  const rec = docs.find(d => d.id === id);
  if (!rec) return;
  stashActive();
  const b = busy('문서를 여는 중…');
  try {
    await D.openFromBytes(rec.bytes, rec.name);
    S.overlays = rec.overlays; S.imgs = rec.imgs; S.hist = rec.hist; S.fut = rec.fut; S.dirty = rec.dirty;
    activeId = id;
    showEditor();
    for (let i = 0; i < 100 && $$('#pages .page').length !== S.n; i++) await new Promise(r => setTimeout(r, 30));
    emit('overlays-changed'); emit('history');
    V.scrollToPage(rec.page || 1);
  } catch (e) { toast(e.message || '문서를 열 수 없습니다', 'err'); }
  finally { b.close(); }
}
async function closeTab(id) {
  const i = docs.findIndex(d => d.id === id);
  if (i < 0) return;
  if (id === activeId) stashActive();
  const rec = docs[i];
  if (isDirty(rec) && !confirm(`「${rec.name}」에 저장하지 않은 변경 사항이 있습니다. 닫을까요?`)) return;
  docs.splice(i, 1);
  if (id !== activeId) { renderTabs(); return; }
  activeId = null;
  if (docs.length) { await switchTo(docs[Math.min(i, docs.length - 1)].id); return; }
  if (S.pdf) D.killPdf(S.pdf);
  Object.assign(S, { pdf: null, bytes: null, n: 0, overlays: {}, hist: [], fut: [], dirty: false, selected: null });
  $('#pages').replaceChildren(); document.title = 'PDF 공작소';
  showHome(false);
}

S.openBytes = async (bytes, name) => {
  if (docs.length >= MAX_TABS) { toast(`탭은 최대 ${MAX_TABS}개까지 열 수 있습니다. 쓰지 않는 탭을 닫아 주세요`, 'err'); return false; }
  stashActive();
  const b = busy('문서를 여는 중…');
  try {
    const ok = await D.openFromBytes(bytes, name);
    if (ok) {
      const rec = { id: ++tabSeq, name: S.name, bytes: S.bytes, overlays: S.overlays, imgs: S.imgs, hist: S.hist, fut: S.fut, dirty: S.dirty, page: 1 };
      docs.push(rec); activeId = rec.id;
      showEditor();
      R.addRecent(S.name, S.bytes, S.pdf).then(() => home.refresh());
    }
    return ok;
  } catch (e) { toast(e.message || 'PDF를 열 수 없습니다', 'err'); return false; }
  finally { b.close(); }
};
async function openPicker() {
  const [f] = await pickFiles('application/pdf,.pdf');
  if (f) await S.openBytes(await readBytes(f), f.name);
}
S.ensureDoc = async () => { await openPicker(); return !!S.pdf; };

// ---------- 저장 · 공유 ----------
S.save = async () => {
  if (!S.pdf) return;
  const b = busy('저장할 파일을 만드는 중…');
  try {
    const bytes = await D.currentBytes();
    download(bytes, D.safeName(), 'application/pdf');
    S.dirty = false;
    R.addRecent(D.safeName(), bytes, S.pdf).then(() => home.refresh());
    toast('저장했습니다. 다운로드 폴더를 확인하세요', 'ok');
  } catch (e) { toast(e.message || '저장하지 못했습니다', 'err'); }
  finally { b.close(); }
};
async function share() {
  const bytes = await D.currentBytes();
  const file = new File([bytes], D.safeName(), { type: 'application/pdf' });
  try {
    if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: S.name });
    else S.save();
  } catch (e) { if (e.name !== 'AbortError') S.save(); }
}
if (!navigator.share) $('#btnShare').dataset.noshare = '1';

// ---------- 화면 전환 ----------
function chrome(inDoc) {
  $('#btnSave').hidden = !inDoc; $('#btnOpen').hidden = !inDoc;
  $('#btnShare').hidden = !inDoc || !navigator.share;
}
function showHome(scrollToGrid) {
  $('#home').hidden = false; $('#editor').hidden = true;
  $('#tabHome').classList.toggle('on', !scrollToGrid); $('#tabTools').classList.toggle('on', !!scrollToGrid);
  chrome(!!S.pdf);
  renderTabs();
  document.body.classList.remove('in-editor');
  home.refresh();
  if (scrollToGrid) $('#gridWrap').scrollIntoView({ behavior: 'smooth' }); else $('#home').scrollTo({ top: 0 });
}
function showEditor() {
  $('#home').hidden = true; $('#editor').hidden = false;
  $('#tabHome').classList.remove('on'); $('#tabTools').classList.remove('on');
  chrome(true);
  renderTabs();
  document.body.classList.add('in-editor');
  requestAnimationFrame(() => V.fit(S.fit || 'auto', true));
}
function closeDoc() { if (activeId != null) closeTab(activeId); }
async function openRecent(it) {
  const f = await R.getFile(it.id);
  if (!f) { toast('용량이 커서 목록에만 남아 있습니다. 「PDF 열기」로 다시 선택해 주세요', 'err'); return; }
  await S.openBytes(new Uint8Array(f.bytes), it.name);
}
$('#brand').onclick = () => showHome(false);
$('#tabHome').onclick = () => showHome(false);
$('#tabTools').onclick = () => showHome(true);
$('#heroOpen').onclick = openPicker;
$('#btnOpen').onclick = openPicker;
$('#heroImg').onclick = async () => { const f = await pickFiles('image/*', true); if (f.length) imagesDialog(f); else imagesDialog(); };
$('#btnSave').onclick = S.save;
$('#btnShare').onclick = share;

// ---------- 홈 카드 ----------
async function runTool(t) {
  if (t.doc && !S.pdf && !(await S.ensureDoc())) return;
  if (S.pdf && $('#editor').hidden) showEditor();
  if (phone()) closeSheets();
  await t.run();
}
const homeOrder = ['sign', 'edittext', 'convert', 'create', 'note', 'merge', 'organize', 'compress', 'redact', 'forms', 'signreq', 'reviewreq', 'security', 'watermark', 'clean', 'ocr', 'stamp', 'extract', 'header', 'split'];
$('#cards').append(...homeOrder.map(id => TOOLS.find(t => t.id === id)).map(t => h('article', { class: 'card' },
  h('div', { class: 'ch' }, h('span', { class: 'ci', style: { color: t.color, background: t.color + '18' }, html: icon(t.icon) }), h('h3', {}, t.home || t.label)),
  h('p', {}, t.desc),
  h('button', { class: 'btn', onclick: () => runTool(t), 'aria-label': (t.home || t.label) + ' ' + (t.cta || '열기') }, t.cta || '열기'))));

// ---------- 편집 툴바 ----------
const SHORT = { edittext: '본문수정', text: '텍스트', sign: '서명', note: '메모', highlight: '형광펜', pen: '펜', image: '이미지', stamp: '스탬프', whiteout: '지우개' };
const MODE = new Set(['edittext', 'text', 'note', 'highlight', 'pen', 'whiteout']);
$('#editTools').append(...Object.keys(SHORT).map(id => {
  const t = TOOLS.find(x => x.id === id);
  return h('button', { class: 'tb', 'data-tool': id, 'aria-label': t.label, title: t.label, onclick: () => { if (MODE.has(id)) V.setTool(S.tool === id ? 'select' : id); else runTool(t); } },
    h('span', { html: icon(t.icon), style: { color: t.color } }), h('em', {}, SHORT[id]));
}));
on('tool', () => {
  $$('[data-tool]').forEach(b => b.setAttribute('aria-pressed', b.dataset.tool === S.tool));
  $('#zSelect').setAttribute('aria-pressed', S.tool !== 'hand'); $('#zHand').setAttribute('aria-pressed', S.tool === 'hand');
});

// 오른쪽 도구 목록 (Adobe 구성: 검색 + 펼치는 목록)
{
  const list = $('#toolList');
  const byId = id => TOOLS.find(t => t.id === id);
  const run = t => runTool(t);
  const row = (t, sub) => h('button', { class: 'trow' + (sub ? ' sub' : ''), onclick: () => run(t), title: t.desc },
    h('span', { class: 'ti', style: { color: t.color, background: t.color + '18' }, html: icon(t.icon) }),
    h('span', { class: 'tt' }, h('b', {}, t.label), sub ? null : h('small', {}, t.desc)));
  const search = h('input', { class: 'inp tsearch', type: 'search', placeholder: "'PDF 결합' 검색", 'aria-label': '도구 검색', autocomplete: 'off' });
  const acc = h('div', { class: 'tacc' });
  const found = h('div', { class: 'tfound', hidden: true });
  list.replaceChildren(h('div', { class: 'tsearch-wrap' }, search), acc, found);
  const openState = new Set();
  const build = () => {
    acc.replaceChildren(...PANEL.map(g => {
      const kids = (g.kids || []).map(byId).filter(Boolean);
      const lead = g.id ? byId(g.id) : null;
      const meta = lead || { label: g.label, icon: g.icon, color: g.color };
      const label = g.label || lead.label;
      if (!kids.length) return h('button', { class: 'trow top', onclick: () => run(lead) }, h('span', { class: 'ti', style: { color: lead.color, background: lead.color + '18' }, html: icon(lead.icon) }), h('span', { class: 'tt' }, h('b', {}, label)));
      const key = label, open = openState.has(key);
      const head = h('div', { class: 'trow top grp' + (open ? ' open' : '') },
        h('button', { class: 'tgmain', onclick: () => { if (lead) run(lead); else toggle(); } }, h('span', { class: 'ti', style: { color: meta.color || '#555', background: (meta.color || '#555') + '18' }, html: icon(meta.icon || 'tools') }), h('span', { class: 'tt' }, h('b', {}, label))),
        h('button', { class: 'tchev', 'aria-label': label + ' 펼치기', 'aria-expanded': String(open), onclick: toggle, html: icon('chev') }));
      function toggle() { openState.has(key) ? openState.delete(key) : openState.add(key); build(); }
      return h('div', { class: 'tgroup-wrap' }, head, open ? h('div', { class: 'tkids' }, kids.map(k => row(k, true))) : null);
    }));
  };
  build();
  search.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    acc.hidden = !!q; found.hidden = !q;
    if (!q) return;
    const hits = TOOLS.filter(t => (t.label + ' ' + (t.desc || '') + ' ' + (t.home || '')).toLowerCase().includes(q));
    found.replaceChildren(...(hits.length ? hits.map(t => row(t)) : [h('p', { class: 'muted small', style: { padding: '12px' } }, '일치하는 도구가 없습니다')]));
  });
  search.addEventListener('keydown', e => { if (e.key === 'Enter') found.querySelector('.trow')?.click(); });
}

// ---------- 패널 / 시트 ----------
const ed = $('#editor');
function closeSheets() { ed.classList.remove('tools-open'); if (phone()) ed.classList.remove('panel-open'); $('#scrim').hidden = true; }
const sheetUpdate = () => { $('#scrim').hidden = !phone() || !(ed.classList.contains('tools-open') || ed.classList.contains('panel-open')); };
$('#btnPanel').onclick = () => { if (phone()) ed.classList.remove('tools-open'); togglePanel(); sheetUpdate(); };
$('#btnToolsPanel').onclick = () => { if (phone()) ed.classList.remove('panel-open'); ed.classList.toggle('tools-open'); sheetUpdate(); };
$('#toolsClose').onclick = () => { ed.classList.remove('tools-open'); sheetUpdate(); };
$('#panelClose').addEventListener('click', sheetUpdate);
$('#scrim').onclick = closeSheets;
$('#btnSearch').onclick = () => { if (phone()) ed.classList.remove('tools-open'); focusSearch(); sheetUpdate(); };
$$('#bottomnav button').forEach(b => b.onclick = () => {
  const g = b.dataset.go;
  if (g === 'pages') { ed.classList.remove('tools-open'); showPanel('pages'); }
  else if (g === 'search') { ed.classList.remove('tools-open'); focusSearch(); }
  else if (g === 'tools') { ed.classList.remove('panel-open'); ed.classList.toggle('tools-open'); }
  else showHome(false);
  sheetUpdate();
});
$$('#rail button').forEach(b => b.addEventListener('click', sheetUpdate));

// ---------- 쪽 이동 · 확대 ----------
const pgNum = $('#pgNum');
const syncPage = () => { pgNum.value = S.curPage; $('#pgTot').textContent = S.n; };
on('page-changed', syncPage); on('pages-built', syncPage);
pgNum.addEventListener('keydown', e => { if (e.key === 'Enter') { V.scrollToPage(+pgNum.value || 1); pgNum.blur(); } });
pgNum.addEventListener('focus', () => pgNum.select());
$('#pgPrev').onclick = () => V.stepPage(-1);
$('#pgNext').onclick = () => V.stepPage(1);
on('zoom', () => { $('#zVal').firstChild.textContent = Math.round(S.zoom * 100) + '% '; });
$('#zOut').onclick = () => V.zoomBy(1 / 1.2);
$('#zIn').onclick = () => V.zoomBy(1.2);
$('#zFitPage').onclick = () => V.fit('page');
$('#zFitW').onclick = () => V.fit('width');
$('#zSelect').onclick = () => V.setTool('select');
$('#zHand').onclick = () => V.setTool('hand');
$('#zFull').onclick = () => { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.(); };
$('#zVal').onclick = e => {
  e.stopPropagation();
  const m = $('#zmenu');
  if (!m.hidden) { m.hidden = true; return; }
  m.replaceChildren(...[['페이지 맞춤', () => V.fit('page')], ['너비 맞춤', () => V.fit('width')], ...[0.5, 0.75, 1, 1.25, 1.5, 2, 3].map(z => [Math.round(z * 100) + '%', () => V.setZoom(z)])]
    .map(([t, f]) => h('button', { onclick: () => { m.hidden = true; f(); } }, t)));
  m.hidden = false;
};
addEventListener('click', () => { $('#zmenu').hidden = true; });

// ---------- 실행 취소 ----------
$('#btnUndo').onclick = () => D.undo();
$('#btnRedo').onclick = () => D.redo();
on('history', () => { renderTabs(); $('#btnUndo').disabled = !S.hist.length; $('#btnRedo').disabled = !S.fut.length; });
on('doc-loaded', () => { $('#btnUndo').disabled = !S.hist.length; $('#btnRedo').disabled = !S.fut.length; });
on('doc-loaded', () => {
  document.title = S.name + ' - PDF 공작소'; renderTabs();
  V.setTool('select');
  if (!phone()) { ed.classList.toggle('tools-open', innerWidth >= 1180 && !ed.dataset.seen); ed.dataset.seen = '1'; }
});

// ---------- 단축키 ----------
addEventListener('keydown', e => {
  const mod = e.ctrlKey || e.metaKey;
  const typing = e.target.closest?.('input, textarea, select') || e.target.isContentEditable;
  if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); S.save(); return; }
  if (mod && e.key.toLowerCase() === 'o') { e.preventDefault(); openPicker(); return; }
  if (mod && e.key.toLowerCase() === 'w' && S.pdf) { e.preventDefault(); closeDoc(); return; }
  if (!S.pdf || $('#editor').hidden) return;
  if (mod && e.key.toLowerCase() === 'f') { e.preventDefault(); focusSearch(); return; }
  if (typing) return;
  if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? D.redo() : D.undo(); }
  else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); D.redo(); }
  else if (mod && (e.key === '=' || e.key === '+')) { e.preventDefault(); V.zoomBy(1.2); }
  else if (mod && e.key === '-') { e.preventDefault(); V.zoomBy(1 / 1.2); }
  else if (e.key === 'PageDown') V.stepPage(1);
  else if (e.key === 'PageUp') V.stepPage(-1);
});

// ---------- 끌어다 놓기 ----------
let dragDepth = 0;
addEventListener('dragenter', e => { if (e.dataTransfer?.types?.includes('Files')) { dragDepth++; document.body.classList.add('dragging'); } });
addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragging'); } });
addEventListener('dragover', e => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); });
addEventListener('drop', async e => {
  document.body.classList.remove('dragging'); dragDepth = 0;
  const files = [...(e.dataTransfer?.files || [])];
  if (!files.length) return;
  e.preventDefault();
  const pdfs = files.filter(f => /pdf$/i.test(f.type) || /\.pdf$/i.test(f.name)), imgs = files.filter(f => f.type.startsWith('image/'));
  if (pdfs.length > 1) mergeDialog(pdfs);
  else if (pdfs.length === 1) await S.openBytes(await readBytes(pdfs[0]), pdfs[0].name);
  else if (imgs.length) imagesDialog(imgs);
  else toast('PDF 또는 사진 파일을 놓아 주세요', 'err');
});

addEventListener('beforeunload', e => { if (docs.some(isDirty)) { e.preventDefault(); e.returnValue = ''; } });

// ---------- 앱 설치 · 다운로드 ----------
const ZIP_URL = 'https://github.com/GCODE77/PDF/releases/latest/download/PDF-gongjakso-offline.zip';
const SETUP_URL = 'https://github.com/GCODE77/PDF/releases/latest/download/PDF-Gongjakso-Setup.exe';
const isDesktopApp = /Electron/.test(navigator.userAgent);
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone || isDesktopApp;
let deferredInstall = null;
$('#instIc').innerHTML = icon('save'); $('#heroInstIc').innerHTML = icon('save');
const showInstall = () => { const on = !standalone; $('#heroInstall').hidden = !on; $('#btnInstall').hidden = !on; };
showInstall();
addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; });
addEventListener('appinstalled', () => { deferredInstall = null; toast('설치되었습니다. 홈 화면·시작 메뉴에서 실행하세요', 'ok'); $('#heroInstall').hidden = true; $('#btnInstall').hidden = true; });
async function installApp() {
  if (deferredInstall) { deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; return; }
  const li = (b, t) => h('li', {}, h('b', {}, b + ' '), t);
  modal({
    title: '앱으로 설치 · 다운로드',
    body: [
      h('p', { class: 'muted' }, '설치하면 홈 화면·바탕화면에서 앱처럼 바로 열리고, 인터넷이 없어도 쓸 수 있습니다.'),
      h('ul', { class: 'steps' },
        li('아이폰/아이패드(사파리):', '아래 공유 버튼 → 「홈 화면에 추가」'),
        li('안드로이드(크롬):', '오른쪽 위 ⋮ 메뉴 → 「앱 설치」 또는 「홈 화면에 추가」'),
        li('PC(크롬·엣지):', '주소창 오른쪽의 설치 아이콘(⊕) → 「설치」')),
      h('hr'),
      h('p', {}, h('b', {}, 'Windows PC: 설치 파일 하나로 설치'), h('br'), h('span', { class: 'muted small' }, '내려받아 더블클릭하면 설치되고, 바탕화면·시작 메뉴에 아이콘이 생깁니다. PDF 파일을 더블클릭해 바로 열 수도 있습니다. (처음 실행 시 Windows 보호 창이 뜨면 「추가 정보 → 실행」)')),
      h('div', { class: 'btnrow' },
        h('a', { class: 'btn primary', href: SETUP_URL, target: '_blank', rel: 'noopener' }, 'Windows 설치 파일 받기 (.exe)'),
        h('a', { class: 'btn', href: ZIP_URL, target: '_blank', rel: 'noopener' }, '설치 없이 쓰기 (ZIP)'))],
    actions: [{ label: '닫기' }],
  });
}
$('#heroInstall').onclick = installApp; $('#btnInstall').onclick = installApp;

// ---------- 홈 · 메뉴 막대 ----------
const tabs = { list: () => docs.map(d => ({ id: d.id, name: d.name, active: d.id === activeId })), switchTo };
// ---------- 기본 PDF 앱으로 설정 ----------
function defaultAppDialog() {
  const api = window.electronAPI;
  const li = (b, t) => h('li', {}, h('b', {}, b + ' '), t);
  const body = [
    h('p', { class: 'muted' }, 'Windows는 보안상 프로그램이 기본 앱을 마음대로 바꿀 수 없어, 처음 한 번만 직접 골라 주셔야 합니다. 한 번 정해 두면 PDF 파일을 더블클릭할 때마다 PDF 공작소가 열립니다.'),
    h('ol', { class: 'steps' },
      li('방법 1 (가장 쉬움):', 'PDF 파일을 마우스 오른쪽 버튼으로 눌러 「연결 프로그램」 → 「다른 앱 선택」 → 「PDF 공작소」를 고르고 「항상 이 앱을 사용하여 .pdf 파일 열기」에 체크한 뒤 「확인」.'),
      li('방법 2:', 'Windows 「설정 → 앱 → 기본 앱」에서 위쪽 「파일 형식 또는 링크 형식 입력」 칸에 .pdf 를 입력하고 「PDF 공작소」를 선택. (아래 「Windows 기본 앱 설정 열기」를 누르면 등록을 새로 고친 뒤 설정 창이 열립니다)')),
  ];
  if (!api) body.push(h('p', { class: 'muted small' }, '이 기능은 Windows 설치 버전(.exe)에서 쓸 수 있습니다. 웹으로 쓰는 중이라면 「앱 설치 · 다운로드」에서 설치 파일을 받아 주세요. (크롬·엣지에서 웹앱으로 설치해도 「연결 프로그램」에 나타납니다.)'));
  modal({
    title: 'PDF를 항상 PDF 공작소로 열기', wide: false, body,
    actions: [{ label: '닫기' }, api?.openDefaultApps ? { label: 'Windows 기본 앱 설정 열기', kind: 'primary', run: () => { api.openDefaultApps(); return false; } } : { label: '앱 설치 · 다운로드', kind: 'primary', run: () => installApp() }],
  });
}
const menu = initMenu({ openPicker, save: S.save, closeDoc, openRecent, showHome, showEditor, install: installApp, defaultApp: defaultAppDialog, tabs, recent: [] });
home = initHome({
  openRecent,
  onSideAct: act => ({ open: openPicker, photo: () => imagesDialog(), merge: () => mergeDialog(), tools: () => showHome(true), install: installApp, help: menu.usage, about: menu.about })[act]?.(),
});

// ---------- 데스크톱 앱(설치 버전): PDF 더블클릭으로 열기 ----------
if (window.electronAPI) {
  const openExternal = async f => { if (f) await S.openBytes(new Uint8Array(f.data), f.name); };
  window.electronAPI.onOpenFile(openExternal);
  window.electronAPI.getInitialFile().then(openExternal);
  // 처음 실행 때 한 번만 기본 앱 설정을 안내
  try {
    if (!localStorage.getItem('pdfg.defprompt')) {
      localStorage.setItem('pdfg.defprompt', '1');
      setTimeout(() => modal({ title: 'PDF 파일을 이 앱으로 바로 열까요?', body: h('p', {}, 'PDF 파일을 더블클릭하면 PDF 공작소가 열리도록 설정할 수 있습니다. 설정 방법을 안내해 드릴까요? (도움말 메뉴에서 언제든 다시 볼 수 있습니다)'), actions: [{ label: '나중에' }, { label: '설정 방법 보기', kind: 'primary', run: () => setTimeout(defaultAppDialog, 50) }] }), 6000);
    }
  } catch { /* 저장소 사용 불가 */ }
}
// 웹앱(PWA)으로 설치했을 때 PDF 파일 연결로 열린 경우
if ('launchQueue' in window) {
  window.launchQueue.setConsumer(async p => { for (const fh of p.files || []) { const f = await fh.getFile(); await S.openBytes(await readBytes(f), f.name); } });
}

// ---------- 시작 ----------
initUpdate();
await V.initViewer();
initSide();
V.setTool('select');
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
window.__S = S;   // 디버깅용
