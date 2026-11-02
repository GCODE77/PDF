// 앱 진입점: 화면 전환 · 툴바 · 홈 카드 · 저장 · 파일 열기
import { S, $, $$, h, icon, on, toast, busy, pickFiles, readBytes, download } from './state.js';
import * as D from './doc.js';
import * as V from './viewer.js';
import { initSide, togglePanel, showPanel, focusSearch } from './side.js';
import { TOOLS, GROUPS, imagesDialog, mergeDialog } from './tools.js';
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
S.openBytes = async (bytes, name) => {
  if (S.pdf && S.dirty && !confirm('저장하지 않은 변경 사항이 있습니다. 새 문서를 열까요?')) return false;
  const b = busy('문서를 여는 중…');
  try {
    const ok = await D.openFromBytes(bytes, name);
    if (ok) { showEditor(); R.addRecent(S.name, S.bytes, S.pdf).then(() => home.refresh()); }
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
  $('#btnSave').hidden = !inDoc; $('#tabDoc').hidden = !inDoc; $('#btnOpen').hidden = !inDoc;
  $('#btnShare').hidden = !inDoc || !navigator.share;
}
function showHome(scrollToGrid) {
  $('#home').hidden = false; $('#editor').hidden = true;
  $('#tabHome').classList.toggle('on', !scrollToGrid); $('#tabTools').classList.toggle('on', !!scrollToGrid); $('#tabDoc').classList.remove('on');
  chrome(!!S.pdf);
  document.body.classList.remove('in-editor');
  home.refresh();
  if (scrollToGrid) $('#gridWrap').scrollIntoView({ behavior: 'smooth' }); else $('#home').scrollTo({ top: 0 });
}
function showEditor() {
  $('#home').hidden = true; $('#editor').hidden = false;
  $$('.tab').forEach(t => t.classList.remove('on')); $('#tabDoc').classList.add('on');
  chrome(true);
  document.body.classList.add('in-editor');
  requestAnimationFrame(() => V.fit(S.fit || 'auto', true));
}
function closeDoc() {
  if (S.dirty && !confirm('저장하지 않은 변경 사항이 있습니다. 닫을까요?')) return;
  if (S.pdf) D.killPdf(S.pdf);
  Object.assign(S, { pdf: null, bytes: null, n: 0, overlays: {}, hist: [], fut: [], dirty: false, selected: null });
  $('#pages').replaceChildren(); document.title = 'PDF 공작소';
  showHome(false);
}
async function openRecent(it) {
  const f = await R.getFile(it.id);
  if (!f) { toast('용량이 커서 목록에만 남아 있습니다. 「PDF 열기」로 다시 선택해 주세요', 'err'); return; }
  await S.openBytes(new Uint8Array(f.bytes), it.name);
}
$('#brand').onclick = () => showHome(false);
$('#tabHome').onclick = () => showHome(false);
$('#tabTools').onclick = () => showHome(true);
$('#tabDoc').onclick = () => { if (S.pdf) showEditor(); };
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
const homeOrder = ['sign', 'text', 'note', 'convert', 'create', 'merge', 'organize', 'compress', 'security', 'watermark', 'clean', 'ocr', 'stamp', 'extract', 'image', 'whiteout'];
$('#cards').append(...homeOrder.map(id => TOOLS.find(t => t.id === id)).map(t => h('article', { class: 'card' },
  h('div', { class: 'ch' }, h('span', { class: 'ci', style: { color: t.color, background: t.color + '18' }, html: icon(t.icon) }), h('h3', {}, t.home || t.label)),
  h('p', {}, t.desc),
  h('button', { class: 'btn', onclick: () => runTool(t), 'aria-label': (t.home || t.label) + ' ' + (t.cta || '열기') }, t.cta || '열기'))));

// ---------- 편집 툴바 ----------
const SHORT = { text: '텍스트', sign: '서명', note: '메모', highlight: '형광펜', pen: '펜', image: '이미지', stamp: '스탬프', whiteout: '지우개' };
const MODE = new Set(['text', 'note', 'highlight', 'pen', 'whiteout']);
$('#editTools').append(...Object.keys(SHORT).map(id => {
  const t = TOOLS.find(x => x.id === id);
  return h('button', { class: 'tb', 'data-tool': id, 'aria-label': t.label, title: t.label, onclick: () => { if (MODE.has(id)) V.setTool(S.tool === id ? 'select' : id); else runTool(t); } },
    h('span', { html: icon(t.icon), style: { color: t.color } }), h('em', {}, SHORT[id]));
}));
on('tool', () => {
  $$('[data-tool]').forEach(b => b.setAttribute('aria-pressed', b.dataset.tool === S.tool));
  $('#zSelect').setAttribute('aria-pressed', S.tool !== 'hand'); $('#zHand').setAttribute('aria-pressed', S.tool === 'hand');
});

// 오른쪽 도구 목록
{
  const list = $('#toolList');
  for (const [g, title] of Object.entries(GROUPS)) {
    list.append(h('div', { class: 'tg-h' }, title));
    TOOLS.filter(t => t.group === g).forEach(t => list.append(h('button', { class: 'trow', onclick: () => runTool(t) },
      h('span', { class: 'ti', style: { color: t.color, background: t.color + '18' }, html: icon(t.icon) }),
      h('span', { class: 'tt' }, h('b', {}, t.label), h('small', {}, t.desc)))));
  }
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
$('#pgPrev').onclick = () => V.scrollToPage(S.curPage - 1, true);
$('#pgNext').onclick = () => V.scrollToPage(S.curPage + 1, true);
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
on('history', () => { $('#btnUndo').disabled = !S.hist.length; $('#btnRedo').disabled = !S.fut.length; });
on('doc-loaded', () => { $('#btnUndo').disabled = !S.hist.length; $('#btnRedo').disabled = !S.fut.length; });
on('doc-loaded', () => {
  $('#docName').textContent = S.name; document.title = S.name + ' - PDF 공작소';
  V.setTool('select');
  if (!phone()) { ed.classList.toggle('tools-open', innerWidth >= 1180 && !ed.dataset.seen); ed.dataset.seen = '1'; }
});

// ---------- 단축키 ----------
addEventListener('keydown', e => {
  const mod = e.ctrlKey || e.metaKey;
  const typing = e.target.closest?.('input, textarea, select') || e.target.isContentEditable;
  if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); S.save(); return; }
  if (mod && e.key.toLowerCase() === 'o') { e.preventDefault(); openPicker(); return; }
  if (!S.pdf || $('#editor').hidden) return;
  if (mod && e.key.toLowerCase() === 'f') { e.preventDefault(); focusSearch(); return; }
  if (typing) return;
  if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? D.redo() : D.undo(); }
  else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); D.redo(); }
  else if (mod && (e.key === '=' || e.key === '+')) { e.preventDefault(); V.zoomBy(1.2); }
  else if (mod && e.key === '-') { e.preventDefault(); V.zoomBy(1 / 1.2); }
  else if (e.key === 'PageDown') V.scrollToPage(S.curPage + 1);
  else if (e.key === 'PageUp') V.scrollToPage(S.curPage - 1);
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

addEventListener('beforeunload', e => { if (S.pdf && S.dirty) { e.preventDefault(); e.returnValue = ''; } });

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
const menu = initMenu({ openPicker, save: S.save, closeDoc, openRecent, showHome, showEditor, install: installApp, recent: [] });
home = initHome({
  openRecent,
  onSideAct: act => ({ open: openPicker, photo: () => imagesDialog(), merge: () => mergeDialog(), tools: () => showHome(true), install: installApp, help: menu.usage, about: menu.about })[act]?.(),
});

// ---------- 데스크톱 앱(설치 버전): PDF 더블클릭으로 열기 ----------
if (window.electronAPI) {
  const openExternal = async f => { if (f) await S.openBytes(new Uint8Array(f.data), f.name); };
  window.electronAPI.onOpenFile(openExternal);
  window.electronAPI.getInitialFile().then(openExternal);
}

// ---------- 시작 ----------
initUpdate();
await V.initViewer();
initSide();
V.setTool('select');
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
window.__S = S;   // 디버깅용
