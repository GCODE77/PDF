// 상단 메뉴 막대(파일·편집·보기·서명·창·도움말) — Adobe Acrobat 구성, 하위 메뉴 지원 + 도움말·정보 대화상자 (© 2026 GLORY KIM)
import { S, $, $$, h, icon, modal, toast, busy } from './state.js';
import * as D from './doc.js';
import * as V from './viewer.js';
import * as R from './recent.js';
import * as core from './pdfcore.js';
import { TOOLS, PANEL, convertDialog, mergeDialog, imagesDialog, insertDialog, compressDialog, securityDialog, watermarkDialog, ocrDialog, cleanDialog, signDialog, stampDialog, insertImage, extractDialog } from './tools.js';
import * as T2 from './tools2.js';
import { VERSION, checkUpdate } from './update.js';
import { togglePanel, showPanel, focusSearch, openOrganizer } from './side.js';

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
          ['pdf-lib · MIT', 'pdf-lib-plus-encrypt · MIT', 'PDF.js (Mozilla) · Apache-2.0', 'Tesseract.js · Apache-2.0', 'JSZip · MIT', 'fontkit · MIT', 'Noto Sans KR (Google) · SIL OFL 1.1', '무료 글꼴 38종(나눔·Gothic A1·IBM Plex·Roboto·Lato 등) · SIL OFL 1.1'].map(t => h('li', {}, t))))),
    actions: [{ label: '닫기', kind: 'primary' }],
  });
}

function usageDialog() {
  const li = (b, t) => h('li', {}, h('b', {}, b + ' '), t);
  modal({
    title: '사용 방법', wide: true,
    body: [h('ol', { class: 'steps' },
      li('열기', '홈의 「PDF 열기」, 파일 끌어다 놓기, 또는 최근 파일을 누릅니다. 여러 문서는 위쪽 탭으로 전환하고, 끌어서 순서를 바꾸고, ×로 닫습니다.'),
      li('고치기', '「본문수정」으로 원래 글자를 그 자리에서 고치거나, 텍스트·서명·메모·형광펜·펜·이미지·지우개를 고르고 문서를 누릅니다.'),
      li('보기', '보기 메뉴에서 한 페이지·스크롤·두 페이지·네 페이지 보기와 확대/축소를 바꿉니다.'),
      li('페이지 정리', '「페이지 정리」에서 끌어서 순서를 바꾸고 회전·삭제·복제·추출합니다.'),
      li('변환·압축·보안', '오른쪽 「도구」 목록 또는 파일 메뉴에서 고릅니다. Word·PPT·엑셀·텍스트 등으로 바꿀 수 있습니다.'),
      li('저장', '오른쪽 위 파란 「저장」 버튼을 누르면 편집 내용이 PDF에 합쳐져 내려받아집니다.')),
    h('p', { class: 'muted small' }, '실수하면 Ctrl+Z로 되돌릴 수 있습니다. 폰에서는 두 손가락으로 확대/축소합니다.')],
    actions: [{ label: '닫기', kind: 'primary' }],
  });
}

function keysDialog() {
  const rows = [['Ctrl + O', 'PDF 열기'], ['Ctrl + S', '저장'], ['Ctrl + W', '현재 탭 닫기'], ['Ctrl + P', '인쇄'], ['Ctrl + Z / Ctrl + Y', '실행 취소 / 다시 실행'], ['Ctrl + F', '문서에서 찾기'], ['Ctrl + 휠, Ctrl + + / -', '확대 / 축소'], ['PageUp / PageDown', '이전 / 다음 페이지(화면)'], ['Ctrl + H', '읽기 모드'], ['Ctrl + L', '전체 화면 모드'], ['Shift + Ctrl + H', '자동 스크롤'], ['F9', '메뉴 막대 보이기/숨기기'], ['Delete', '선택한 개체 삭제'], ['Esc', '도구 해제 · 선택 해제']];
  modal({ title: '단축키', body: h('table', { class: 'keys' }, rows.map(([k, t]) => h('tr', {}, h('td', {}, h('kbd', {}, k)), h('td', {}, t)))), actions: [{ label: '닫기', kind: 'primary' }] });
}

// ---------- 보기 설정 ----------
export function setTheme(mode) {
  try { localStorage.setItem('pdfg.theme', mode); } catch { /* 저장 불가 */ }
  const dark = mode === 'dark' || (mode === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
}
const getTheme = () => { try { return localStorage.getItem('pdfg.theme') || 'light'; } catch { return 'light'; } };
setTheme(getTheme());

async function rotateAll(deg) {
  const b = busy('회전하는 중…');
  try { await D.flush(); await D.applyBytes(await core.applyPlan(S.bytes, Array.from({ length: S.n }, (_, i) => ({ src: i, rot: deg })))); } catch (e) { toast(e.message, 'err'); } finally { b.close(); }
}
function toolInfo(t) {
  modal({ title: t.label, body: [h('p', {}, t.desc || ''), h('p', { class: 'muted small' }, t.doc ? '문서를 연 상태에서 사용합니다.' : '문서를 열지 않아도 사용할 수 있습니다.')], actions: [{ label: '닫기' }, { label: '열기', kind: 'primary', run: () => { t.run(); } }] });
}
function goPage() {
  const v = prompt(`이동할 쪽 번호 (1~${S.n})`, String(S.curPage));
  const n = parseInt(v, 10);
  if (n >= 1 && n <= S.n) V.scrollToPage(n);
}

export function initMenu(ctx) {
  const bar = $('#menubar');
  const doc = f => () => { if (!S.pdf) { toast('먼저 PDF를 열어 주세요'); return; } return f(); };
  const byId = id => TOOLS.find(t => t.id === id);
  const tool = id => ({ t: byId(id).label, d: byId(id).doc ? 1 : 0, f: () => { const t = byId(id); if (t.doc && !S.pdf) { toast('먼저 PDF를 열어 주세요'); return; } t.run(); } });
  const mode = m => doc(() => V.setTool(m));
  const cur = () => S.curPage - 1;
  const toolsSub = () => PANEL.map(g => {
    const kids = g.kids ? g.kids.map(byId).filter(Boolean) : [byId(g.id)].filter(Boolean);
    return { t: g.label || byId(g.id).label, d: kids.every(k => k.doc) ? 1 : 0, sub: () => [
      ...(g.kids ? kids.map(k => ({ t: k.label, d: k.doc ? 1 : 0, f: () => k.run() })) : [{ t: '열기(O)', d: kids[0].doc ? 1 : 0, f: () => kids[0].run() }, { t: '추가 정보(L)', f: () => toolInfo(kids[0]) }]),
    ] };
  });
  const layoutItem = (m, t, s) => ({ t, s, d: 1, check: () => V.layoutState().mode === m, f: () => V.setLayout(m) });
  const zoomTo = z => doc(() => V.setZoom(z));

  const MENUS = [
    { t: '파일', k: 'F', items: () => [
      { t: '열기…', s: 'Ctrl+O', f: ctx.openPicker },
      { t: '최근 파일', sub: () => (ctx.recent.length ? ctx.recent.slice(0, 10).map((r, i) => ({ t: `${i + 1}  ${r.name}`, f: () => ctx.openRecent(r) })) : [{ t: '(최근 파일 없음)', d: true, f: () => {} }]) },
      { t: '만들기', sub: () => [
        { t: '사진에서 PDF 만들기…', f: () => imagesDialog() }, { t: '빈 문서…', f: T2.createBlankDialog }, { t: '글에서 PDF 만들기…', f: T2.createTextDialog },
        { t: '클립보드 이미지에서…', f: T2.pasteImageDialog }, '-', { t: '파일 결합…', f: () => mergeDialog() }] },
      '-',
      { t: '닫기', s: 'Ctrl+W', d: 1, f: doc(ctx.closeDoc) },
      { t: '저장', s: 'Ctrl+S', d: 1, f: doc(ctx.save) },
      { t: '다른 이름으로 저장…', s: 'Shift+Ctrl+S', d: 1, f: doc(ctx.save) },
      { t: '내보내기 (다른 형식으로 변환)', d: 1, sub: () => [
        ['docx', 'Word (DOCX)'], ['xlsx', '엑셀 (XLSX)'], ['pptx', 'PowerPoint (PPTX)'], ['png', '이미지 (PNG·JPG)'], ['txt', '텍스트 (TXT)'], ['html', '웹 페이지 (HTML)'], ['md', '마크다운 (MD)'], ['csv', '표만 (CSV)'],
      ].map(([k, t]) => ({ t, f: () => convertDialog(k) })).concat(['-', { t: 'PDF 안의 이미지 꺼내기…', f: T2.extractImagesDialog }]) },
      { t: '공유…', d: 1, f: doc(() => $('#btnShare').click()) },
      '-',
      { t: '문서 속성…', s: 'Ctrl+D', d: 1, f: doc(T2.propsDialog) },
      { t: '비밀번호 보호…', d: 1, f: doc(securityDialog) },
      { t: 'PDF 압축…', d: 1, f: doc(compressDialog) },
      { t: '인쇄…', s: 'Ctrl+P', d: 1, f: doc(T2.printDoc) },
    ] },
    { t: '편집', k: 'E', items: () => [
      { t: '실행 취소', s: 'Ctrl+Z', d: !S.hist.length, f: () => D.undo() },
      { t: '다시 실행', s: 'Ctrl+Y', d: !S.fut.length, f: () => D.redo() },
      '-',
      { t: '복사', s: 'Ctrl+C', d: 1, f: doc(() => document.execCommand('copy')) },
      { t: '선택한 개체 삭제', s: 'Delete', d: 1, f: doc(() => V.removeSelected()) },
      '-',
      { t: '찾기…', s: 'Ctrl+F', d: 1, f: doc(focusSearch) },
      '-',
      { t: 'PDF 편집 (본문 글자 수정)', d: 1, f: mode('edittext') },
      { t: '텍스트 추가', d: 1, f: mode('text') },
      { t: '이미지 추가…', d: 1, f: doc(insertImage) },
      { t: '지우개 (가리기)', d: 1, f: mode('whiteout') },
      '-',
      { t: '페이지', d: 1, sub: () => [
        { t: '정리…', f: () => openOrganizer() }, { t: '빈 페이지 찾아 삭제…', f: T2.blankPagesDialog }, { t: '회전…', f: T2.rotateDialog }, { t: '삭제…', f: T2.deleteDialog }, { t: '삽입…', f: insertDialog },
        { t: '추출…', f: extractDialog }, { t: '나누기…', f: T2.splitDialog }, { t: '자르기…', f: T2.cropDialog }, { t: '머리글·바닥글·쪽 번호…', f: T2.headerFooterDialog }] },
      '-',
      { t: '문자 인식(OCR)…', d: 1, f: doc(ocrDialog) },
      { t: '배경 정리…', d: 1, f: doc(cleanDialog) },
      { t: '워터마크…', d: 1, f: doc(watermarkDialog) },
    ] },
    { t: '보기', k: 'V', items: () => [
      { t: '보기 회전', d: 1, sub: () => [{ t: '시계 방향', s: 'Shift+Ctrl++', f: () => rotateAll(90) }, { t: '반시계 방향', s: 'Shift+Ctrl+-', f: () => rotateAll(-90) }] },
      { t: '페이지 탐색', d: 1, sub: () => [
        { t: '첫 페이지', s: 'Home', f: () => V.scrollToPage(1) }, { t: '이전 페이지', s: 'PageUp', f: () => V.stepPage(-1) }, { t: '다음 페이지', s: 'PageDown', f: () => V.stepPage(1) },
        { t: '마지막 페이지', s: 'End', f: () => V.scrollToPage(S.n) }, '-', { t: '페이지 이동…', s: 'Shift+Ctrl+N', f: goPage }] },
      { t: '페이지 표시', d: 1, sub: () => [
        layoutItem('single', '한 페이지 보기'), layoutItem('scroll', '스크롤 사용'), layoutItem('two', '두 페이지 보기'), layoutItem('twoscroll', '두 페이지 스크롤'),
        layoutItem('four', '네 페이지 보기 (2×2)'), layoutItem('fourscroll', '네 페이지 스크롤 (4열)'), '-',
        { t: '페이지 사이에 간격 표시', d: 1, check: () => V.layoutState().gap, f: () => V.setLayoutOpt('gap', !V.layoutState().gap) },
        { t: '두 페이지 보기에 표지 페이지 표시', d: 1, check: () => V.layoutState().cover, f: () => V.setLayoutOpt('cover', !V.layoutState().cover) },
        '-', { t: '자동 스크롤', s: 'Shift+Ctrl+H', d: 1, f: () => V.toggleAutoScroll() }] },
      { t: '확대/축소', d: 1, sub: () => [
        { t: '확대', s: 'Ctrl++', f: () => V.zoomBy(1.2) }, { t: '축소', s: 'Ctrl+-', f: () => V.zoomBy(1 / 1.2) }, { t: '실제 크기 (100%)', s: 'Ctrl+1', f: () => V.setZoom(1) },
        { t: '페이지 맞춤', s: 'Ctrl+0', f: () => V.fit('page') }, { t: '너비 맞춤', s: 'Ctrl+2', f: () => V.fit('width') }, '-',
        ...[0.5, 0.75, 1.25, 1.5, 2, 3].map(z => ({ t: Math.round(z * 100) + '%', f: () => V.setZoom(z) }))] },
      { t: '도구', sub: toolsSub },
      '-',
      { t: '표시/숨기기', sub: () => [
        { t: '페이지 패널', d: 1, f: doc(() => togglePanel()) }, { t: '목차(북마크) 패널', d: 1, f: doc(() => showPanel('outline')) }, { t: '검색 패널', s: 'Ctrl+F', d: 1, f: doc(focusSearch) },
        { t: '도구 패널', d: 1, f: doc(() => $('#editor').classList.toggle('tools-open')) }, '-',
        { t: '메뉴 막대', s: 'F9', check: () => !document.body.classList.contains('nomenubar'), f: () => document.body.classList.toggle('nomenubar') }] },
      { t: '표시 테마', sub: () => [
        { t: '밝게', check: () => getTheme() === 'light', f: () => setTheme('light') }, { t: '어둡게', check: () => getTheme() === 'dark', f: () => setTheme('dark') }, { t: '시스템 설정 따르기', check: () => getTheme() === 'auto', f: () => setTheme('auto') }] },
      '-',
      { t: '읽기 모드', s: 'Ctrl+H', d: 1, check: () => document.body.classList.contains('reading'), f: doc(() => document.body.classList.toggle('reading')) },
      { t: '전체 화면 모드', s: 'Ctrl+L', f: () => { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.(); } },
      '-',
      { t: '선택 도구', d: 1, f: mode('select') },
      { t: '손 도구 (끌어서 이동)', d: 1, f: mode('hand') },
      '-',
      { t: '소리내어 읽기', d: 1, sub: () => [{ t: '이 페이지부터 읽기', f: () => T2.readAloud() }, { t: '읽기 멈춤', f: () => T2.stopReading() }] },
    ] },
    { t: '서명', k: 'S', items: () => [
      { t: '채우기 및 서명', d: 1, sub: () => [{ t: '서명 넣기…', f: signDialog }, { t: '텍스트 넣기', f: () => V.setTool('text') }, { t: '스탬프 · 날짜…', f: stampDialog }, { t: '양식 채우기…', f: T2.fillFormDialog }] },
      { t: '서명 넣기 (그리기 · 이름 입력 · 사진)…', d: 1, f: doc(signDialog) },
      { t: '날짜 · 확인 스탬프…', d: 1, f: doc(stampDialog) },
      '-',
      { t: '서명란 만들기…', d: 1, f: doc(() => { S.style.fieldKind = 'sign'; V.setTool('field'); }) },
      { t: '양식 만들기…', d: 1, f: doc(T2.formsDialog) },
      '-',
      { t: '전자 서명 요청…', d: 1, f: doc(T2.signRequestDialog) },
      { t: '주석 요청하기…', d: 1, f: doc(T2.reviewRequestDialog) },
    ] },
    { t: '창', k: 'W', items: () => [
      { t: '새 창', f: () => window.open(location.href, '_blank') },
      '-',
      { t: '홈', f: () => ctx.showHome() },
      ...(ctx.tabs.list().length ? ctx.tabs.list().map(d => ({ t: d.name, check: () => d.active, f: () => ctx.tabs.switchTo(d.id) })) : [{ t: '열린 문서 없음', d: true, f: () => {} }]),
      ctx.tabs.list().length ? '-' : null,
      { t: '현재 탭 닫기', s: 'Ctrl+W', d: 1, f: doc(ctx.closeDoc) },
    ] },
    { t: '도움말', k: 'H', items: () => [
      { t: '사용 방법', f: usageDialog },
      { t: '단축키', f: keysDialog },
      '-',
      { t: '기본 PDF 앱으로 설정…', f: ctx.defaultApp },
      { t: '앱 설치 · 다운로드…', f: ctx.install },
      { t: '업데이트 확인', f: () => checkUpdate({ manual: true }) },
      '-',
      { t: `${APP.name} 정보…`, f: aboutDialog },
    ] },
  ];

  let openIdx = -1, drop = null;
  const closeMenu = () => { drop?.remove(); drop = null; openIdx = -1; $$('.mb', bar).forEach(b => b.setAttribute('aria-expanded', 'false')); };
  const disabled = it => (it.d === 1 ? !S.pdf : !!it.d);
  function buildList(items, cls) {
    return h('div', { class: cls, role: 'menu' }, items.filter(Boolean).map(it => {
      if (it === '-') return h('hr');
      const btn = h('button', {
        role: 'menuitem', class: 'mi' + (it.sub ? ' has-sub' : ''), disabled: disabled(it),
        'aria-haspopup': it.sub ? 'true' : null,
      }, h('span', { class: 'mc' }, it.check ? (it.check() ? '✓' : '') : ''), h('span', { class: 'mt' }, it.t), it.sub ? h('span', { class: 'ms' }, '▸') : (it.s ? h('span', { class: 'ms' }, it.s) : null));
      if (!it.sub) { btn.onclick = () => { closeMenu(); it.f(); }; return btn; }
      const wrap = h('div', { class: 'mwrap' }, btn);
      let sub = null;
      const show = () => {
        if (!sub) { sub = buildList(it.sub(), 'mdrop msub'); wrap.append(sub); }
        wrap.parentElement.querySelectorAll(':scope > .mwrap.open').forEach(w => { if (w !== wrap) w.classList.remove('open'); });
        wrap.classList.add('open');
        sub.classList.remove('flip');
        const r = sub.getBoundingClientRect();
        if (r.right > innerWidth - 4) sub.classList.add('flip');
        if (r.bottom > innerHeight - 4) sub.style.top = Math.max(-r.top + 4, innerHeight - r.bottom - 8 - 7) + 'px';
      };
      wrap.addEventListener('mouseenter', () => { if (!btn.disabled) show(); });
      btn.addEventListener('click', e => { e.stopPropagation(); if (!btn.disabled) { wrap.classList.contains('open') && sub ? wrap.classList.remove('open') : show(); } });
      return wrap;
    }));
  }
  async function openMenu(i) {
    closeMenu();
    try { ctx.recent = await R.listRecent(); } catch { ctx.recent = []; }
    openIdx = i;
    const btn = $$('.mb', bar)[i];
    btn.setAttribute('aria-expanded', 'true');
    drop = buildList(MENUS[i].items(), 'mdrop');
    drop.style.left = btn.offsetLeft + 'px';
    bar.append(drop);
  }
  bar.replaceChildren(...MENUS.map((m, i) => h('button', {
    class: 'mb', 'aria-haspopup': 'true', 'aria-expanded': 'false',
    onclick: e => { e.stopPropagation(); openIdx === i ? closeMenu() : openMenu(i); },
    onmouseenter: () => { if (openIdx >= 0 && openIdx !== i) openMenu(i); },
  }, `${m.t}(${m.k})`)));
  addEventListener('click', e => { if (!e.target.closest('#menubar')) closeMenu(); });
  addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeMenu(); document.body.classList.remove('reading'); }
    const mod = e.ctrlKey || e.metaKey;
    const typing = e.target.closest?.('input, textarea, select') || e.target.isContentEditable;
    if (e.key === 'F9') { e.preventDefault(); document.body.classList.toggle('nomenubar'); return; }
    if (mod && !typing && S.pdf) {
      const k = e.key.toLowerCase();
      if (k === 'p') { e.preventDefault(); T2.printDoc(); }
      else if (k === 'd') { e.preventDefault(); T2.propsDialog(); }
      else if (k === 'h' && e.shiftKey) { e.preventDefault(); V.toggleAutoScroll(); }
      else if (k === 'h') { e.preventDefault(); document.body.classList.toggle('reading'); }
      else if (k === 'l') { e.preventDefault(); document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.(); }
      else if (k === '0') { e.preventDefault(); V.fit('page'); }
      else if (k === '1') { e.preventDefault(); V.setZoom(1); }
      else if (k === '2') { e.preventDefault(); V.fit('width'); }
    } else if (!mod && !typing && S.pdf && !$('#editor').hidden) {
      if (e.key === 'Home') { e.preventDefault(); V.scrollToPage(1); }
      else if (e.key === 'End') { e.preventDefault(); V.scrollToPage(S.n); }
    }
  });
  return { about: aboutDialog, usage: usageDialog };
}
