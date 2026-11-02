// 상단 메뉴 막대(파일·편집·보기·창·도움말) + 도움말·정보 대화상자
import { S, $, $$, h, icon, modal, toast } from './state.js';
import * as D from './doc.js';
import * as V from './viewer.js';
import * as R from './recent.js';
import { TOOLS, convertDialog, mergeDialog, imagesDialog, insertDialog, compressDialog, securityDialog, watermarkDialog, ocrDialog, cleanDialog, signDialog, stampDialog, insertImage } from './tools.js';
import { VERSION, checkUpdate } from './update.js';
import { togglePanel, showPanel, focusSearch, openOrganizer, quickOp } from './side.js';

export const APP = { name: 'PDF 공작소', version: VERSION, owner: 'GLORY KIM', year: 2026 };

function aboutDialog() {
  modal({
    title: APP.name + ' 정보',
    body: h('div', { class: 'about' },
      h('img', { src: 'icons/icon-192.png', width: 84, height: 84, alt: '' }),
      h('h3', {}, APP.name), h('p', { class: 'muted' }, `버전 ${APP.version}`),
      h('p', {}, 'PDF 편집 · 변환 · 서명 · 압축 · OCR을 폰과 PC에서.', h('br'), '모든 처리는 이 기기 안에서만 이루어지며 파일은 외부로 전송되지 않습니다.'),
      h('p', { class: 'copy' }, `© ${APP.year} ${APP.owner}. All rights reserved.`),
      h('details', {}, h('summary', {}, '오픈소스 라이선스'),
        h('ul', { class: 'oss' },
          ['pdf-lib · MIT', 'pdf-lib-plus-encrypt · MIT', 'PDF.js (Mozilla) · Apache-2.0', 'Tesseract.js · Apache-2.0', 'JSZip · MIT', 'fontkit · MIT', 'Noto Sans KR (Google) · SIL OFL 1.1'].map(t => h('li', {}, t))))),
    actions: [{ label: '닫기', kind: 'primary' }],
  });
}

function usageDialog() {
  const li = (b, t) => h('li', {}, h('b', {}, b + ' '), t);
  modal({
    title: '사용 방법', wide: true,
    body: [h('ol', { class: 'steps' },
      li('열기', '홈의 「PDF 열기」, 파일 끌어다 놓기, 또는 최근 파일을 누릅니다.'),
      li('고치기', '위쪽 도구 막대에서 텍스트·서명·메모·형광펜·펜·이미지·지우개를 고르고 문서를 누릅니다.'),
      li('페이지 정리', '「페이지 정리」에서 끌어서 순서를 바꾸고 회전·삭제·복제·추출합니다.'),
      li('변환·압축·보안', '오른쪽 「도구」 목록 또는 메뉴의 파일에서 고릅니다.'),
      li('저장', '오른쪽 위 파란 「저장」 버튼을 누르면 편집 내용이 PDF에 합쳐져 내려받아집니다.')),
    h('p', { class: 'muted small' }, '실수하면 Ctrl+Z로 되돌릴 수 있습니다. 폰에서는 두 손가락으로 확대/축소합니다.')],
    actions: [{ label: '닫기', kind: 'primary' }],
  });
}

function keysDialog() {
  const rows = [['Ctrl + O', 'PDF 열기'], ['Ctrl + S', '저장'], ['Ctrl + Z / Ctrl + Y', '실행 취소 / 다시 실행'], ['Ctrl + F', '문서에서 찾기'], ['Ctrl + 휠, Ctrl + + / -', '확대 / 축소'], ['PageUp / PageDown', '이전 / 다음 페이지'], ['Delete', '선택한 개체 삭제'], ['Esc', '도구 해제 · 선택 해제']];
  modal({ title: '단축키', body: h('table', { class: 'keys' }, rows.map(([k, t]) => h('tr', {}, h('td', {}, h('kbd', {}, k)), h('td', {}, t)))), actions: [{ label: '닫기', kind: 'primary' }] });
}

async function refreshApp() {
  for (const r of await navigator.serviceWorker?.getRegistrations?.() || []) await r.unregister();
  for (const k of await caches.keys()) await caches.delete(k);
  toast('최신 버전을 불러옵니다…');
  setTimeout(() => location.reload(), 600);
}

export function initMenu(ctx) {
  const bar = $('#menubar');
  const doc = f => () => { if (!S.pdf) { toast('먼저 PDF를 열어 주세요'); return; } return f(); };
  const tool = id => doc(() => TOOLS.find(t => t.id === id).run());
  const mode = m => doc(() => V.setTool(m));
  const cur = () => S.curPage - 1;

  const MENUS = [
    { t: '파일', k: 'F', items: () => [
      { t: '열기…', s: 'Ctrl+O', f: ctx.openPicker },
      { t: '사진으로 PDF 만들기…', f: () => imagesDialog() },
      { t: '파일 결합…', f: () => mergeDialog() },
      { t: '페이지 삽입…', d: 1, f: doc(insertDialog) },
      '-',
      { t: '저장', s: 'Ctrl+S', d: 1, f: doc(ctx.save) },
      { t: 'Word로 변환…', d: 1, f: doc(() => convertDialog('docx')) },
      { t: '텍스트로 저장…', d: 1, f: doc(() => convertDialog('txt')) },
      { t: '사진(이미지)으로 변환…', d: 1, f: doc(() => convertDialog('png')) },
      '-',
      { t: '파일 압축…', d: 1, f: doc(compressDialog) },
      { t: '암호 보호…', d: 1, f: doc(securityDialog) },
      { t: '워터마크…', d: 1, f: doc(watermarkDialog) },
      '-',
      ...ctx.recent.slice(0, 5).map((r, i) => ({ t: `${i + 1}  ${r.name}`, f: () => ctx.openRecent(r) })),
      ctx.recent.length ? '-' : null,
      { t: '파일 닫기', d: 1, f: doc(ctx.closeDoc) },
    ] },
    { t: '편집', k: 'E', items: () => [
      { t: '실행 취소', s: 'Ctrl+Z', d: !S.hist.length, f: () => D.undo() },
      { t: '다시 실행', s: 'Ctrl+Y', d: !S.fut.length, f: () => D.redo() },
      '-',
      { t: '텍스트 추가', d: 1, f: mode('text') },
      { t: '이미지 추가…', d: 1, f: doc(insertImage) },
      { t: '서명 넣기…', d: 1, f: doc(signDialog) },
      { t: '스탬프…', d: 1, f: doc(stampDialog) },
      '-',
      { t: '현재 페이지 삭제', d: 1, f: doc(() => quickOp(cur(), 'del')) },
      { t: '현재 페이지 오른쪽 회전', d: 1, f: doc(() => quickOp(cur(), 'rotR')) },
      { t: '현재 페이지 왼쪽 회전', d: 1, f: doc(() => quickOp(cur(), 'rotL')) },
      { t: '페이지 정리…', d: 1, f: doc(() => openOrganizer()) },
      '-',
      { t: '찾기', s: 'Ctrl+F', d: 1, f: doc(focusSearch) },
      '-',
      { t: '문자 인식(OCR)…', d: 1, f: doc(ocrDialog) },
      { t: '배경 정리…', d: 1, f: doc(cleanDialog) },
    ] },
    { t: '보기', k: 'V', items: () => [
      { t: '확대', s: 'Ctrl++', d: 1, f: doc(() => V.zoomBy(1.2)) },
      { t: '축소', s: 'Ctrl+-', d: 1, f: doc(() => V.zoomBy(1 / 1.2)) },
      { t: '실제 크기 (100%)', d: 1, f: doc(() => V.setZoom(1)) },
      { t: '페이지 맞춤', d: 1, f: doc(() => V.fit('page')) },
      { t: '너비 맞춤', d: 1, f: doc(() => V.fit('width')) },
      '-',
      { t: '페이지 패널', d: 1, f: doc(() => togglePanel()) },
      { t: '목차(북마크)', d: 1, f: doc(() => showPanel('outline')) },
      { t: '도구 패널', d: 1, f: doc(() => $('#editor').classList.toggle('tools-open')) },
      '-',
      { t: '선택 도구', d: 1, f: mode('select') },
      { t: '손 도구 (끌어서 이동)', d: 1, f: mode('hand') },
      '-',
      { t: '전체 화면', f: () => { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.(); } },
    ] },
    { t: '창', k: 'W', items: () => [
      { t: '새 창', f: () => window.open(location.href, '_blank') },
      '-',
      { t: '홈', f: () => ctx.showHome() },
      { t: S.pdf ? S.name : '열린 문서 없음', d: !S.pdf, f: () => ctx.showEditor() },
    ] },
    { t: '도움말', k: 'H', items: () => [
      { t: '사용 방법', f: usageDialog },
      { t: '단축키', f: keysDialog },
      '-',
      { t: '앱 설치 · 다운로드…', f: ctx.install },
      { t: '업데이트 확인', f: () => checkUpdate({ manual: true }) },
      '-',
      { t: `${APP.name} 정보…`, f: aboutDialog },
    ] },
  ];

  let openIdx = -1, drop = null;
  const closeMenu = () => { drop?.remove(); drop = null; openIdx = -1; $$('.mb', bar).forEach(b => b.setAttribute('aria-expanded', 'false')); };
  async function openMenu(i) {
    closeMenu();
    ctx.recent = await R.listRecent();
    openIdx = i;
    const btn = $$('.mb', bar)[i];
    btn.setAttribute('aria-expanded', 'true');
    drop = h('div', { class: 'mdrop', role: 'menu' }, MENUS[i].items().filter(Boolean).map(it => it === '-' ? h('hr') : h('button', {
      role: 'menuitem', class: 'mi', disabled: it.d === 1 ? !S.pdf : !!it.d,
      onclick: () => { closeMenu(); it.f(); },
    }, h('span', { class: 'mt' }, it.t), it.s ? h('span', { class: 'ms' }, it.s) : null)));
    drop.style.left = btn.offsetLeft + 'px';
    bar.append(drop);
  }
  bar.replaceChildren(...MENUS.map((m, i) => h('button', {
    class: 'mb', 'aria-haspopup': 'true', 'aria-expanded': 'false',
    onclick: e => { e.stopPropagation(); openIdx === i ? closeMenu() : openMenu(i); },
    onmouseenter: () => { if (openIdx >= 0 && openIdx !== i) openMenu(i); },
  }, `${m.t}(${m.k})`)));
  addEventListener('click', e => { if (!e.target.closest('#menubar')) closeMenu(); });
  addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });
  return { about: aboutDialog, usage: usageDialog };
}
