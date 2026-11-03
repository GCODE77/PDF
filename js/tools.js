// 기능 대화상자 모음 (변환 · 압축 · 보안 · 워터마크 · OCR · 서명 …)
import { S, $, $$, h, icon, toast, busy, modal, fmtSize, download, pickFiles, readBytes, parseRange, baseName, sleep } from './state.js';
import * as core from './pdfcore.js';
import * as D from './doc.js';
import * as V from './viewer.js';
import { openOrganizer } from './side.js';
import * as X from './exporters.js';
import { TOOLS2 } from './tools2.js';
import { SIG_FONTS, ensureFont, cssFamily, fontFromFile, canListLocal, listLocalFonts } from './sigfonts.js';

export const needDoc = async () => S.pdf || await S.ensureDoc();
export const err = e => { console.error(e); toast(e.message || '처리 중 오류가 발생했습니다', 'err'); };
export const row = (label, ...c) => h('div', { class: 'row' }, h('label', { class: 'lab' }, label), h('div', { class: 'ctl' }, c));
export const opt = (v, t) => h('option', { value: v }, t);

// 페이지 범위 선택 위젯
export function pagesField(label = '대상 페이지') {
  const sel = h('select', { class: 'inp' }, opt('all', `전체 (${S.n}쪽)`), opt('cur', `현재 페이지 (${S.curPage}쪽)`), opt('custom', '직접 입력'));
  const inp = h('input', { class: 'inp', placeholder: '예: 1-3, 5, 8-', hidden: true });
  sel.onchange = () => { inp.hidden = sel.value !== 'custom'; if (!inp.hidden) inp.focus(); };
  return {
    el: row(label, sel, inp),
    get() {
      if (sel.value === 'all') return Array.from({ length: S.n }, (_, i) => i);
      if (sel.value === 'cur') return [S.curPage - 1];
      const r = parseRange(inp.value, S.n);
      if (!r) { toast(`페이지 범위를 확인해 주세요 (1~${S.n})`, 'err'); inp.focus(); return null; }
      return r;
    },
  };
}
export const seg = (name, items, val, onchange) => {
  const box = h('div', { class: 'seg', role: 'radiogroup' });
  items.forEach(([v, t, d]) => {
    const i = h('input', { type: 'radio', name, value: v, checked: v === val, onchange: () => onchange?.(v) });
    box.append(h('label', { class: 'segi' }, i, h('span', {}, h('b', {}, t), d ? h('small', {}, d) : null)));
  });
  return { el: box, get: () => box.querySelector('input:checked').value };
};

// ======================== OCR 엔진 ========================
let ocrW = null, ocrLang = '';
const abs = p => new URL(p, location.href).href.replace(/\/$/, '');
async function ocrWorker(lang, log) {
  if (ocrW && ocrLang === lang) return ocrW;
  if (ocrW) { await ocrW.terminate(); ocrW = null; }
  ocrW = await window.Tesseract.createWorker(lang, 1, {
    workerPath: abs('vendor/tess/worker.min.js'), corePath: abs('vendor/tess/core'), langPath: abs('vendor/tess/lang'),
    cacheMethod: 'none', logger: log,
  });
  ocrLang = lang;
  return ocrW;
}
async function ocrPage(w, index) {
  const pg = await S.pdf.getPage(index + 1);
  const v1 = pg.getViewport({ scale: 1 });
  const cv = await core.renderCanvas(S.pdf, index + 1, Math.min(4, 1800 / v1.width));
  const { data } = await w.recognize(cv, {}, { text: true, blocks: true });
  const words = [];
  for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) for (const wd of l.words || [])
    words.push({ text: wd.text, x0: wd.bbox.x0, y0: wd.bbox.y0, x1: wd.bbox.x1, y1: wd.bbox.y1 });
  if (!words.length && data.words) data.words.forEach(wd => words.push({ text: wd.text, x0: wd.bbox.x0, y0: wd.bbox.y0, x1: wd.bbox.x1, y1: wd.bbox.y1 }));
  const r = { index, cw: cv.width, words, text: (data.text || '').trim() };
  cv.width = 0;
  return r;
}

// ======================== 문자 인식(OCR) ========================
export async function ocrDialog() {
  if (!await needDoc()) return;
  const lang = h('select', { class: 'inp' }, opt('kor+eng', '한국어 + 영어'), opt('eng', '영어'), opt('kor', '한국어'));
  const pages = pagesField();
  const out = seg('ocrout', [['pdf', '검색 가능한 PDF로 만들기', '문서에 글자 정보를 넣어 검색·복사가 가능해집니다'], ['txt', '글자만 추출', '인식한 글자를 보고 복사·저장합니다']], 'pdf');
  modal({
    title: '문자 인식 (OCR)', wide: false,
    body: [h('p', { class: 'muted' }, '스캔한 문서·사진 속 글자를 인식합니다. 모든 처리는 이 기기 안에서 이루어지며 파일이 외부로 전송되지 않습니다.'), row('인식 언어', lang), pages.el, out.el],
    actions: [{ label: '취소' }, {
      label: '인식 시작', kind: 'primary', icon: 'ocr', run: async () => {
        const idx = pages.get(); if (!idx) return false;
        const b = busy('인식 엔진을 준비하는 중…');
        let cur = 0;
        try {
          await D.flush();
          const w = await ocrWorker(lang.value, m => { if (m.status === 'recognizing text') b.set(null, (cur + m.progress) / idx.length); });
          const results = [];
          for (const i of idx) {
            if (b.cancelled) throw new Error('취소되었습니다');
            b.set(`${cur + 1} / ${idx.length} 페이지 인식 중…`, cur / idx.length);
            results.push(await ocrPage(w, i)); cur++;
          }
          if (out.get() === 'pdf') {
            b.set('검색 가능한 PDF를 만드는 중…');
            await D.applyBytes(await core.addInvisibleText(S.bytes, results));
            const n = results.reduce((a, r) => a + r.words.length, 0);
            toast(n ? `글자 ${n}개를 인식했습니다. 이제 검색(Ctrl+F)·복사가 가능합니다` : '인식된 글자가 없습니다', n ? 'ok' : 'err');
          } else showText(results.map(r => `── ${r.index + 1}쪽 ──\n${r.text}`).join('\n\n'));
        } catch (e) { err(e); } finally { b.close(); }
      },
    }],
  });
}
function showText(text) {
  const ta = h('textarea', { class: 'inp txt', readonly: true }, text);
  modal({ title: '추출한 글자', wide: true, body: ta, actions: [
    { label: '닫기' },
    { label: '복사', icon: 'copy', keep: true, run: async () => { await navigator.clipboard.writeText(text); toast('복사했습니다', 'ok'); } },
    { label: 'TXT 저장', kind: 'primary', icon: 'save', run: () => download(new Blob(['﻿' + text], { type: 'text/plain;charset=utf-8' }), D.safeName('', '.txt')) },
  ] });
}

// ======================== 변환 ========================
export async function convertDialog(preset = 'png') {
  if (!await needDoc()) return;
  const KINDS = [
    ['png', '사진 PNG', '선명한 이미지'], ['jpg', '사진 JPG', '용량이 작음'],
    ['docx', 'Word (DOCX)', '글·표·그림'], ['pptx', 'PowerPoint (PPTX)', '쪽마다 슬라이드'], ['xlsx', '엑셀 (XLSX)', '표·글을 칸으로'],
    ['txt', '텍스트 (TXT)', '글만 추출'], ['html', '웹 페이지 (HTML)', '글·표·그림'], ['md', '마크다운 (MD)', '제목·표 구조'], ['csv', '표만 (CSV)', '표를 엑셀용으로'],
  ];
  const fmt = seg('fmt', KINDS, preset, v => sync(v));
  fmt.el.classList.add('seg-grid');
  const pages = pagesField('변환할 페이지');
  const dpi = h('select', { class: 'inp' }, opt(110, '보통 (110dpi · 빠름)'), opt(150, '고화질 (150dpi)'), opt(220, '최고화질 (220dpi)'));
  dpi.value = 150;
  const ocr = h('input', { type: 'checkbox', checked: true });
  const pics = h('input', { type: 'checkbox', checked: true });
  const imgRow = row('화질', dpi);
  const txtRow = row('옵션', h('label', { class: 'chk' }, ocr, '글자가 없는 페이지는 OCR로 인식 (한국어+영어)'), h('label', { class: 'chk' }, pics, '그림 포함'));
  const note = h('p', { class: 'muted small' });
  const NOTES = {
    docx: '글꼴·크기·색·정렬을 최대한 살리고, 선이 있는 표는 Word 표로, 그림은 그대로 옮깁니다.',
    pptx: '쪽마다 슬라이드 한 장으로 만들고, 글상자·표·그림을 원래 위치에 배치합니다.',
    xlsx: '쪽마다 시트 한 장. 표는 칸으로, 숫자는 숫자 칸으로 옮기고 합친 칸도 유지합니다.',
    txt: '줄·문단을 복원한 글만 저장합니다. 표는 탭으로 구분됩니다.',
    html: '글·표·그림을 담은 웹 페이지 한 파일로 저장합니다.',
    md: '글 크기로 제목을 구분하고 표는 마크다운 표로 만듭니다.',
    csv: '문서의 모든 표를 쉼표로 구분해 저장합니다 (엑셀에서 바로 열림).',
  };
  function sync(v) {
    const img = v === 'png' || v === 'jpg';
    imgRow.hidden = !img; txtRow.hidden = img;
    pics.parentElement.hidden = !(v === 'docx' || v === 'pptx' || v === 'html');
    note.textContent = img ? '여러 페이지는 ZIP 한 개로 묶어 저장합니다.' : NOTES[v] + ' 스캔·복잡한 편집 문서는 원본과 조금 다를 수 있습니다.';
  }
  sync(preset);
  modal({
    title: 'PDF 파일 변환', wide: true,
    body: [h('p', { class: 'muted' }, '변환할 형식을 고르세요.'), fmt.el, pages.el, imgRow, txtRow, note],
    actions: [{ label: '취소' }, {
      label: '변환하여 저장', kind: 'primary', icon: 'save', run: async () => {
        const idx = pages.get(); if (!idx) return false;
        const f = fmt.get(), b = busy('변환하는 중…');
        try {
          await D.flush();
          const base = baseName(S.name);
          if (f === 'png' || f === 'jpg') {
            const mime = f === 'png' ? 'image/png' : 'image/jpeg';
            const files = [];
            for (let n = 0; n < idx.length; n++) {
              if (b.cancelled) throw new Error('취소되었습니다');
              b.set(`${n + 1} / ${idx.length} 페이지`, n / idx.length);
              const cv = await core.renderCanvas(S.pdf, idx[n] + 1, +dpi.value / 72);
              const blob = await new Promise(r => cv.toBlob(r, mime, 0.92));
              cv.width = 0;
              files.push([`${base}_${String(idx[n] + 1).padStart(3, '0')}.${f}`, blob]);
              await sleep(0);
            }
            if (files.length === 1) download(files[0][1], files[0][0]);
            else {
              b.set('ZIP으로 묶는 중…');
              const z = new window.JSZip(); files.forEach(([n, bl]) => z.file(n, bl));
              download(await z.generateAsync({ type: 'blob', compression: 'STORE' }), base + '_이미지.zip');
            }
          } else {
            let w = null;
            const lib = await D.getPdfjs();
            const r = await X.exportPages(f, S.pdf, lib, idx, {
              title: base, images: pics.checked, cancelled: () => b.cancelled, onProgress: (t, p) => b.set(t, p),
              ocr: ocr.checked ? async i => { w ||= await ocrWorker('kor+eng'); return (await ocrPage(w, i)).text; } : null,
            });
            download(r.blob, base + '.' + r.ext);
          }
          toast('변환한 파일을 저장했습니다', 'ok');
        } catch (e) { err(e); return false; } finally { b.close(); }
      },
    }],
  });
}

// ======================== 사진 → PDF ========================
export async function imagesDialog(initial = []) {
  const items = [];
  const list = h('div', { class: 'flist imgs' });
  const size = seg('psize', [['fit', '사진 크기 그대로', '여백 없음'], ['a4', 'A4에 맞춤', '여백 포함']], 'fit');
  const q = h('select', { class: 'inp' }, opt(0.9, '표준 화질'), opt(0.95, '높은 화질'), opt(0.75, '작은 용량'));
  const append = S.pdf ? h('input', { type: 'checkbox' }) : null;
  const count = h('b', {}, '0');
  let dragI = null;
  const moveTo = (from, to) => { to = Math.max(0, Math.min(items.length - 1, to)); if (from === to) return; items.splice(to, 0, items.splice(from, 1)[0]); draw(); };
  const sortBy = fn => { items.sort(fn); draw(); };
  const draw = () => {
    count.textContent = items.length;
    list.replaceChildren(...(items.length ? items.map((it, i) => h('div', {
      class: 'fitem', draggable: 'true',
      ondragstart: e => { dragI = i; e.dataTransfer.effectAllowed = 'move'; e.currentTarget.classList.add('drag'); },
      ondragend: e => { dragI = null; e.currentTarget.classList.remove('drag'); },
      ondragover: e => { if (dragI != null) { e.preventDefault(); e.currentTarget.classList.add('over'); } },
      ondragleave: e => e.currentTarget.classList.remove('over'),
      ondrop: e => { if (dragI == null) return; e.preventDefault(); e.stopPropagation(); moveTo(dragI, i); },
    },
      h('input', { class: 'ord', type: 'number', min: 1, max: items.length, value: i + 1, 'aria-label': `${it.file.name} 순서`, title: '번호를 바꾸면 그 위치로 이동합니다',
        onchange: e => { const n = parseInt(e.target.value, 10); if (n >= 1) moveTo(i, n - 1); else draw(); }, onfocus: e => e.target.select() }),
      h('img', { src: it.url, alt: '', style: { transform: `rotate(${it.rot}deg)` } }),
      h('span', { class: 'fn' }, it.file.name),
      h('button', { class: 'icon-btn', 'aria-label': '회전', title: '회전', onclick: () => { it.rot = (it.rot + 90) % 360; draw(); }, html: icon('rotr') }),
      h('button', { class: 'icon-btn', 'aria-label': '위로', disabled: i === 0, onclick: () => moveTo(i, i - 1), html: icon('up') }),
      h('button', { class: 'icon-btn', 'aria-label': '아래로', disabled: i === items.length - 1, onclick: () => moveTo(i, i + 1), html: icon('down') }),
      h('button', { class: 'icon-btn danger', 'aria-label': '제거', onclick: () => { URL.revokeObjectURL(it.url); items.splice(i, 1); draw(); }, html: icon('x') }))) : [h('p', { class: 'empty' }, '사진을 추가하거나 이 창에 끌어다 놓으세요 (여러 장 가능)')]));
    m.buttons['PDF 만들기'].disabled = !items.length;
    sortRow.hidden = items.length < 2;
  };
  const add = files => {
    files.filter(f => f.type.startsWith('image/') || /\.(jpe?g|png|webp|bmp|gif)$/i.test(f.name))
      .sort((a, b) => a.name.localeCompare(b.name, 'ko', { numeric: true }))
      .forEach(file => items.push({ file, rot: 0, url: URL.createObjectURL(file) }));
    draw();
  };
  const nat = (a, b) => a.file.name.localeCompare(b.file.name, 'ko', { numeric: true });
  const sortRow = h('div', { class: 'btnrow' }, h('span', { class: 'muted small' }, '순서 정렬:'),
    h('button', { class: 'btn small', onclick: () => sortBy(nat) }, '이름순'),
    h('button', { class: 'btn small', onclick: () => sortBy((a, b) => a.file.lastModified - b.file.lastModified) }, '날짜순'),
    h('button', { class: 'btn small', onclick: () => { items.reverse(); draw(); } }, '거꾸로'));
  const m = modal({
    title: '사진을 PDF로 만들기', wide: true,
    body: [
      h('div', { class: 'btnrow' },
        h('button', { class: 'btn primary', onclick: async () => add(await pickFiles('image/*', true)), html: icon('image') + '<span>사진 추가</span>' }),
        h('button', { class: 'btn phone-only', onclick: async () => add(await pickFiles('image/*', false, true)), html: icon('camera') + '<span>카메라 촬영</span>' }),
        h('span', { class: 'muted small' }, '총 ', count, '장 · 번호를 바꾸거나 끌어서 순서를 정하세요')),
      sortRow, list, size.el, row('화질', q),
      append ? h('label', { class: 'chk' }, append, '지금 열려 있는 문서 뒤에 이어 붙이기') : null],
    actions: [{ label: '취소' }, {
      label: 'PDF 만들기', kind: 'primary', icon: 'file', id: 'PDF 만들기', run: async () => {
        const b = busy('PDF를 만드는 중…');
        try {
          const bytes = await core.imagesToPdf(items, { size: size.get(), margin: 28, quality: +q.value }, (p, t) => b.set(t, p));
          const name = (items.length === 1 ? baseName(items[0].file.name) : '사진모음') + '.pdf';
          items.forEach(i => URL.revokeObjectURL(i.url));
          if (append?.checked) { const cur = await D.flush(); await D.applyBytes(await core.mergePdfs([cur, bytes])); }
          else await S.openBytes(bytes, name);
          toast('PDF가 만들어졌습니다. 오른쪽 위 「저장」으로 내려받으세요', 'ok');
        } catch (e) { err(e); return false; } finally { b.close(); }
      },
    }],
  });
  const box = m.body.closest('.m-box');
  box.addEventListener('dragover', e => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); });
  box.addEventListener('drop', e => { if (e.dataTransfer?.files?.length) { e.preventDefault(); e.stopPropagation(); add([...e.dataTransfer.files]); } });
  add(initial);
}

// ======================== 파일 결합 ========================
export async function mergeDialog(initial = []) {
  const items = [];
  if (S.pdf) items.push({ name: S.name + ' (현재 문서)', bytes: null, cur: true, pages: S.n });
  const list = h('div', { class: 'flist' });
  const draw = () => {
    list.replaceChildren(...items.map((it, i) => h('div', { class: 'fitem' },
      h('span', { class: 'fico', html: icon('file') }), h('span', { class: 'fn' }, `${i + 1}. ${it.name}`, h('small', {}, ` · ${it.pages}쪽`)),
      h('button', { class: 'icon-btn', 'aria-label': '위로', disabled: i === 0, onclick: () => { [items[i - 1], items[i]] = [items[i], items[i - 1]]; draw(); }, html: icon('up') }),
      h('button', { class: 'icon-btn', 'aria-label': '아래로', disabled: i === items.length - 1, onclick: () => { [items[i + 1], items[i]] = [items[i], items[i + 1]]; draw(); }, html: icon('down') }),
      h('button', { class: 'icon-btn danger', 'aria-label': '제거', onclick: () => { items.splice(i, 1); draw(); }, html: icon('x') }))));
    if (!items.length) list.append(h('p', { class: 'empty' }, 'PDF 파일을 추가해 주세요'));
    m.buttons['결합하기'].disabled = items.length < 2;
  };
  const add = async files => {
    for (const f of files) {
      try {
        const bytes = await readBytes(f);
        const d = await window.PDFLib.PDFDocument.load(bytes);
        items.push({ name: f.name, bytes, pages: d.getPageCount() });
      } catch (e) { toast(`'${f.name}' 파일을 열 수 없습니다 (암호 문서이거나 손상됨)`, 'err'); }
    }
    draw();
  };
  const m = modal({
    title: '파일 결합', wide: true,
    body: [h('p', { class: 'muted' }, '여러 PDF를 하나로 합칩니다. 위·아래 버튼으로 순서를 바꾸세요.'),
      h('div', { class: 'btnrow' }, h('button', { class: 'btn', onclick: async () => add(await pickFiles('application/pdf,.pdf', true)), html: icon('plus') + '<span>PDF 추가</span>' })), list],
    actions: [{ label: '취소' }, {
      label: '결합하기', kind: 'primary', icon: 'merge', run: async () => {
        const b = busy('PDF를 합치는 중…');
        try {
          const cur = S.pdf ? await D.currentBytes() : null;
          const bytes = await core.mergePdfs(items.map(i => i.cur ? cur : i.bytes));
          if (S.pdf) { await D.flush(); await D.applyBytes(bytes); } else await S.openBytes(bytes, '결합본.pdf');
          toast(`${items.length}개 파일을 합쳤습니다`, 'ok');
        } catch (e) { err(e); return false; } finally { b.close(); }
      },
    }],
  });
  if (initial.length) await add(initial); else draw();
}

// ======================== 압축 ========================
export async function compressDialog() {
  if (!await needDoc()) return;
  await D.flush();
  const before = S.bytes.length;
  const lv = seg('lv', [
    ['light', '가벼운 최적화', '글자·화질 그대로, 구조만 정리 (감소폭 작음)'],
    ['mid', '균형 (권장)', '화질 유지하며 크게 줄임 · 글자 선택 불가'],
    ['max', '최대 압축', '용량 최우선 · 글자가 다소 흐려짐'],
  ], 'mid');
  modal({
    title: 'PDF 압축',
    body: [h('div', { class: 'kv' }, h('span', {}, '현재 용량'), h('b', {}, fmtSize(before))), lv.el,
      h('p', { class: 'muted small' }, '「균형·최대」는 페이지를 이미지로 다시 만들기 때문에 글자 선택·검색이 사라집니다. 필요하면 압축 후 「문자 인식(OCR)」을 실행하세요.')],
    actions: [{ label: '취소' }, {
      label: '압축하기', kind: 'primary', icon: 'compress', run: async () => {
        const b = busy('압축하는 중…');
        let res;
        try {
          const v = lv.get();
          res = v === 'light' ? await core.optimize(S.bytes) : await core.rasterRebuild(S.bytes, S.pdf, v === 'mid' ? { scale: 1.35, quality: 0.62 } : { scale: 1.0, quality: 0.45 }, (p, t) => { b.set(t, p); return !b.cancelled; });
        } catch (e) { err(e); return false; } finally { b.close(); }
        if (res.length >= before) { toast('이미 충분히 최적화되어 더 줄일 수 없습니다. 다른 단계를 선택해 보세요.', 'err'); return false; }
        await D.applyBytes(res);
        const pct = Math.round((1 - res.length / before) * 100);
        modal({ title: '압축 완료', body: h('div', { class: 'done' }, h('div', { class: 'big' }, `${pct}% 감소`), h('p', {}, `${fmtSize(before)} → `, h('b', {}, fmtSize(res.length))), h('p', { class: 'muted small' }, '문서에 반영되었습니다. 마음에 들지 않으면 Ctrl+Z로 되돌릴 수 있습니다.')),
          actions: [{ label: '닫기' }, { label: '지금 저장', kind: 'primary', icon: 'save', run: () => S.save() }] });
      },
    }],
  });
}

// ======================== 비밀번호 ========================
export async function securityDialog() {
  if (!await needDoc()) return;
  const mk = ph => h('input', { class: 'inp', type: 'password', placeholder: ph, autocomplete: 'new-password' });
  const u = mk('문서를 열 때 필요한 비밀번호'), u2 = mk('비밀번호 한 번 더'), o = mk('(선택) 인쇄·편집 제한을 풀 수 있는 암호');
  const cb = (t, c = true) => { const i = h('input', { type: 'checkbox', checked: c }); return [i, h('label', { class: 'chk' }, i, t)]; };
  const [pi, pl] = cb('인쇄 허용'), [ci, cl] = cb('내용 복사 허용'), [ei, el] = cb('편집·주석 허용');
  const show = h('label', { class: 'chk' }, h('input', { type: 'checkbox', onchange: e => [u, u2, o].forEach(x => x.type = e.target.checked ? 'text' : 'password') }), '비밀번호 보이기');
  modal({
    title: '비밀번호로 보호',
    body: [h('p', { class: 'muted' }, '비밀번호를 설정한 사본을 저장합니다. 비밀번호를 잊으면 복구할 수 없으니 꼭 기억해 두세요.'),
      row('열기 비밀번호', u), row('확인', u2), row('권한 암호', o), show,
      h('div', { class: 'perm' }, h('b', {}, '허용할 작업'), pl, cl, el),
      h('hr'), h('div', { class: 'btnrow' }, h('span', { class: 'muted small' }, '암호가 걸린 PDF를 열 때는 비밀번호를 입력하면 암호가 해제된 사본으로 열립니다.'),
        h('button', { class: 'btn small', onclick: async () => { const [f] = await pickFiles('application/pdf,.pdf'); if (f) { document.querySelector('.m-wrap')?.remove(); await S.openBytes(await readBytes(f), f.name); } } }, '암호 PDF 열기'))],
    actions: [{ label: '취소' }, {
      label: '보호하여 저장', kind: 'primary', icon: 'lock', run: async () => {
        if (!u.value && !o.value) { toast('열기 비밀번호를 입력해 주세요', 'err'); u.focus(); return false; }
        if (u.value && u.value !== u2.value) { toast('비밀번호 확인이 일치하지 않습니다', 'err'); u2.focus(); return false; }
        const b = busy('암호를 적용하는 중…');
        try {
          const bytes = await core.encryptPdf(await D.currentBytes(), { user: u.value, owner: o.value, print: pi.checked, copy: ci.checked, edit: ei.checked });
          download(bytes, D.safeName('_보호'), 'application/pdf');
          toast('비밀번호가 설정된 파일을 저장했습니다', 'ok');
        } catch (e) { err(e); return false; } finally { b.close(); }
      },
    }],
  });
}

// ======================== 워터마크 ========================
export async function watermarkDialog() {
  if (!await needDoc()) return;
  let kind = 'text', imgData = null;
  const text = h('input', { class: 'inp', value: '대외비', maxlength: 60 });
  const size = h('input', { type: 'range', min: 20, max: 160, value: 80 });
  const color = h('input', { type: 'color', value: '#e1251b' });
  const op = h('input', { type: 'range', min: 5, max: 80, value: 25 });
  const ang = h('select', { class: 'inp' }, opt(45, '대각선 ↗'), opt(0, '가로'), opt(-45, '대각선 ↘'), opt(90, '세로'));
  const lay = seg('wml', [['center', '가운데 한 개'], ['tile', '바둑판 반복']], 'center');
  const pages = pagesField();
  const imgIn = h('button', { class: 'btn', onclick: async () => { const [f] = await pickFiles('image/*'); if (!f) return; const cv = await core.toCanvas(f, 0, 1600); imgData = cv.toDataURL('image/png'); imgBtn.textContent = f.name; } }, '이미지 선택');
  const imgBtn = imgIn;
  const kindSeg = seg('wmk', [['text', '글자'], ['image', '이미지(로고)']], 'text', v => { kind = v; tRows.forEach(r => r.hidden = v !== 'text'); iRows.forEach(r => r.hidden = v !== 'image'); });
  const tRows = [row('문구', text), row('크기', size), row('색상', color)], iRows = [row('이미지', imgIn)];
  iRows.forEach(r => r.hidden = true);
  const addPane = h('div', {}, kindSeg.el, ...tRows, ...iRows, row('투명도', op), row('방향', ang), lay.el, pages.el);
  const remPane = h('div', { hidden: true },
    h('p', {}, '이 앱으로 넣은 워터마크와 PDF 표준 워터마크는 자동으로 제거할 수 있습니다.'),
    h('div', { class: 'btnrow' }, h('button', { class: 'btn primary', onclick: async () => {
      const b = busy('워터마크를 찾는 중…');
      try {
        const r = await core.removeWatermark(await D.currentBytes());
        if (!r.removed) { toast('제거할 수 있는 워터마크를 찾지 못했습니다. 아래 방법을 사용해 보세요.', 'err'); return; }
        await D.applyBytes(r.bytes); toast(`워터마크 ${r.removed}개를 제거했습니다`, 'ok');
        document.querySelector('.m-wrap')?.remove();
      } catch (e) { err(e); } finally { b.close(); }
    } }, '워터마크 자동 제거')),
    h('p', { class: 'muted small' }, '다른 프로그램에서 문서 내용에 합쳐 넣은 워터마크는 자동 제거가 어렵습니다. 이 경우 「지우개」로 워터마크 위를 가린 뒤 「모든 페이지에 적용」을 누르세요.'),
    h('div', { class: 'btnrow' }, h('button', { class: 'btn', onclick: () => { document.querySelector('.m-wrap')?.remove(); V.setTool('whiteout'); } }, '지우개 도구로 가리기')));
  const tabs = seg('wmtab', [['add', '워터마크 넣기'], ['rem', '워터마크 지우기']], 'add', v => { addPane.hidden = v !== 'add'; remPane.hidden = v !== 'rem'; m.buttons['넣기'].hidden = v !== 'add'; });
  const m = modal({
    title: '워터마크', body: [tabs.el, addPane, remPane],
    actions: [{ label: '닫기' }, {
      id: '넣기', label: '워터마크 넣기', kind: 'primary', icon: 'drop', run: async () => {
        const idx = pages.get(); if (!idx) return false;
        if (kind === 'text' && !text.value.trim()) { toast('문구를 입력해 주세요', 'err'); return false; }
        if (kind === 'image' && !imgData) { toast('이미지를 선택해 주세요', 'err'); return false; }
        const b = busy('워터마크를 넣는 중…');
        try {
          await D.flush();
          const bytes = await core.addWatermark(S.bytes, { kind, text: text.value, size: +size.value, color: color.value, opacity: op.value / 100, angle: +ang.value, layout: lay.get(), pages: idx, img: imgData, scale: 0.5 });
          await D.applyBytes(bytes);
          toast('워터마크를 넣었습니다', 'ok');
        } catch (e) { err(e); return false; } finally { b.close(); }
      },
    }],
  });
}

// ======================== 배경 정리 ========================
export async function cleanDialog() {
  if (!await needDoc()) return;
  await D.flush();
  const mode = seg('cmode', [['color', '컬러 유지', '배경만 하얗게'], ['gray', '흑백(회색조)', '글자 또렷하게'], ['bw', '순수 흑백', '복사본처럼']], 'color', () => preview());
  const str = h('input', { type: 'range', min: 0, max: 100, value: 45, oninput: () => preview() });
  const pages = pagesField();
  const a = h('canvas', { class: 'pv' }), bcv = h('canvas', { class: 'pv' });
  let base = null, timer;
  (async () => {
    const pg = await S.pdf.getPage(S.curPage), v1 = pg.getViewport({ scale: 1 });
    base = await core.renderCanvas(S.pdf, S.curPage, 420 / v1.width);
    [a, bcv].forEach(c => { c.width = base.width; c.height = base.height; });
    a.getContext('2d').drawImage(base, 0, 0);
    preview();
  })();
  function preview() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!base) return;
      const c = bcv.getContext('2d'); c.drawImage(base, 0, 0);
      core.cleanCanvas(bcv, { mode: mode.get(), strength: +str.value });
    }, 60);
  }
  modal({
    title: '배경 정리 (스캔 문서 보정)', wide: true,
    body: [h('p', { class: 'muted' }, '스캔·촬영한 문서의 얼룩, 그림자, 누런 배경을 지우고 글자를 선명하게 만듭니다.'),
      h('div', { class: 'ba' }, h('figure', {}, a, h('figcaption', {}, '원본 (현재 페이지)')), h('figure', {}, bcv, h('figcaption', {}, '정리 후 미리보기'))),
      mode.el, row('강도', str), pages.el],
    actions: [{ label: '취소' }, {
      label: '적용하기', kind: 'primary', icon: 'clean', run: async () => {
        const idx = pages.get(); if (!idx) return false;
        const b = busy('배경을 정리하는 중…');
        try {
          const m = mode.get(), s = +str.value;
          const bytes = await core.rasterRebuild(S.bytes, S.pdf, { indices: idx, scale: 2, quality: 0.85, filter: cv => core.cleanCanvas(cv, { mode: m, strength: s }) }, (p, t) => { b.set(t, p); return !b.cancelled; });
          await D.applyBytes(bytes);
          toast('배경을 정리했습니다', 'ok');
        } catch (e) { err(e); return false; } finally { b.close(); }
      },
    }],
  });
}

// ======================== 페이지 추출 · 삽입 ========================
export async function extractDialog() {
  if (!await needDoc()) return;
  const range = h('input', { class: 'inp', placeholder: `예: 1-3, 5, 8-  (전체 ${S.n}쪽)`, autofocus: true });
  const split = h('input', { type: 'checkbox' });
  modal({
    title: '페이지 추출',
    body: [h('p', { class: 'muted' }, '필요한 페이지만 골라 새 PDF로 저장합니다. 원본 문서는 그대로입니다.'),
      row('페이지', range), h('label', { class: 'chk' }, split, '페이지마다 파일 한 개씩 (ZIP)'),
      h('div', { class: 'btnrow' }, h('button', { class: 'btn small', onclick: () => { document.querySelector('.m-wrap')?.remove(); openOrganizer({ mode: 'extract' }); } }, '썸네일 보고 고르기'))],
    actions: [{ label: '취소' }, {
      label: '추출하여 저장', kind: 'primary', icon: 'extract', run: async () => {
        const idx = parseRange(range.value, S.n);
        if (!idx) { toast(`페이지 범위를 확인해 주세요 (1~${S.n})`, 'err'); range.focus(); return false; }
        const b = busy('추출하는 중…');
        try {
          const src = await D.currentBytes();
          if (split.checked && idx.length > 1) {
            const z = new window.JSZip();
            for (const [n, i] of idx.entries()) { b.set(`${n + 1} / ${idx.length}`, n / idx.length); z.file(`${baseName(S.name)}_${i + 1}쪽.pdf`, await core.extractPages(src, [i])); }
            download(await z.generateAsync({ type: 'blob', compression: 'STORE' }), baseName(S.name) + '_분할.zip');
          } else download(await core.extractPages(src, idx), D.safeName('_추출'), 'application/pdf');
          toast(`${idx.length}쪽을 저장했습니다`, 'ok');
        } catch (e) { err(e); return false; } finally { b.close(); }
      },
    }],
  });
}

export async function insertDialog() {
  if (!await needDoc()) return;
  let file = null;
  const fb = h('button', { class: 'btn', onclick: async () => { const [f] = await pickFiles('application/pdf,.pdf'); if (f) { file = f; fb.textContent = f.name; } } }, 'PDF 선택');
  const at = h('select', { class: 'inp' }, opt('end', '맨 뒤'), opt('start', '맨 앞'), opt('cur', `현재 페이지(${S.curPage}쪽) 뒤`));
  modal({
    title: 'PDF 삽입', body: [row('삽입할 파일', fb), row('위치', at)],
    actions: [{ label: '취소' }, {
      label: '삽입', kind: 'primary', icon: 'plus', run: async () => {
        if (!file) { toast('삽입할 PDF를 선택해 주세요', 'err'); return false; }
        const b = busy('삽입하는 중…');
        try {
          const cur = await D.flush();
          const pos = at.value === 'end' ? S.n : at.value === 'start' ? 0 : S.curPage;
          await D.applyBytes(await core.insertPdf(cur, pos, await readBytes(file)));
          toast('PDF를 삽입했습니다', 'ok');
        } catch (e) { err(e); return false; } finally { b.close(); }
      },
    }],
  });
}

// ======================== 서명 ========================
const SIG_KEY = 'pdfstudio.sigs.v1';
const loadSigs = () => { try { return JSON.parse(localStorage.getItem(SIG_KEY) || '[]'); } catch { return []; } };
const saveSigs = l => { try { localStorage.setItem(SIG_KEY, JSON.stringify(l.slice(0, 6))); } catch { /* 저장 불가 */ } };

function trim(cv, pad = 6) {
  const c = cv.getContext('2d'), { width: w, height: hh } = cv, d = c.getImageData(0, 0, w, hh).data;
  let x0 = w, y0 = hh, x1 = 0, y1 = 0;
  for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 <= x0) return null;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(w, x1 + pad); y1 = Math.min(hh, y1 + pad);
  const o = h('canvas'); o.width = x1 - x0; o.height = y1 - y0;
  o.getContext('2d').drawImage(cv, x0, y0, o.width, o.height, 0, 0, o.width, o.height);
  return o;
}

export async function signDialog() {
  if (!await needDoc()) return;
  let tab = 'draw', penColor = '#111111', penW = 3, imgCv = null;
  const place = (url, w, hh) => { V.addImage(url, w, hh, { width: 150 }); toast('서명을 넣었습니다. 끌어서 위치·크기를 조절하세요', 'ok'); };
  const saved = loadSigs();
  const savedBox = h('div', { class: 'saved' });
  const drawSaved = () => {
    savedBox.replaceChildren(...(saved.length ? [h('b', { class: 'small' }, '저장된 서명 (누르면 바로 넣기)'), h('div', { class: 'sgrid' }, saved.map((s, i) => h('div', { class: 'sg' },
      h('button', { class: 'sgb', onclick: () => { m.close(); place(s.url, s.w, s.h); }, html: `<img src="${s.url}" alt="저장된 서명 ${i + 1}">` }),
      h('button', { class: 'icon-btn danger', 'aria-label': '삭제', onclick: () => { saved.splice(i, 1); saveSigs(saved); drawSaved(); }, html: icon('x') }))))] : []));
  };
  drawSaved();

  const pad = h('canvas', { class: 'sigpad', 'aria-label': '서명을 그리는 영역' });
  const ctxP = () => pad.getContext('2d');
  let ink = false;
  const fitPad = () => { const r = pad.getBoundingClientRect(), dpr = 2; pad.width = r.width * dpr; pad.height = r.height * dpr; ctxP().scale(dpr, dpr); ctxP().lineCap = ctxP().lineJoin = 'round'; };
  pad.addEventListener('pointerdown', e => {
    pad.setPointerCapture(e.pointerId); ink = true;
    const r = pad.getBoundingClientRect(), c = ctxP();
    c.strokeStyle = penColor; c.lineWidth = penW; c.beginPath(); c.moveTo(e.clientX - r.left, e.clientY - r.top);
    c.lineTo(e.clientX - r.left + 0.1, e.clientY - r.top);
    c.stroke(); hint.hidden = true;
    const mv = ev => { c.lineTo(ev.clientX - r.left, ev.clientY - r.top); c.stroke(); c.beginPath(); c.moveTo(ev.clientX - r.left, ev.clientY - r.top); };
    const up = () => { pad.removeEventListener('pointermove', mv); pad.removeEventListener('pointerup', up); };
    pad.addEventListener('pointermove', mv); pad.addEventListener('pointerup', up);
  });
  const hint = h('div', { class: 'padhint' }, '여기에 서명하세요');
  const colors = h('div', { class: 'swatches' }, ['#111111', '#1473e6', '#e1251b'].map(c => h('button', { class: 'sw' + (c === penColor ? ' on' : ''), style: { background: c }, 'aria-label': '색 ' + c, onclick: e => { penColor = c; $$('.sw', colors).forEach(x => x.classList.remove('on')); e.currentTarget.classList.add('on'); } })));
  const drawPane = h('div', {}, h('div', { class: 'padwrap' }, pad, hint), h('div', { class: 'btnrow' }, colors, h('label', { class: 'chk' }, '색 ', h('input', { type: 'color', value: penColor, oninput: e => { penColor = e.target.value; } })), h('label', { class: 'chk' }, '굵기 ', h('input', { type: 'range', min: 1, max: 9, value: penW, oninput: e => { penW = +e.target.value; } })), h('button', { class: 'btn small', onclick: () => { ctxP().clearRect(0, 0, pad.width, pad.height); hint.hidden = false; } }, '지우기')));

  const name = h('input', { class: 'inp', placeholder: '이름을 입력하세요 (예: 홍길동, Gildong Hong)', maxlength: 30, 'aria-label': '서명에 쓸 이름' });
  const userFonts = [];
  let curFont = SIG_FONTS[0];
  const fontSel = h('select', { class: 'inp', 'aria-label': '글꼴' });
  const fillFonts = () => {
    const groups = {};
    [...SIG_FONTS, ...userFonts].forEach(f => (groups[f.group] ||= []).push(f));
    fontSel.replaceChildren(...Object.entries(groups).map(([g, list]) => { const og = h('optgroup', { label: g }); list.forEach(f => og.append(h('option', { value: f.id }, f.label))); return og; }));
    fontSel.value = curFont.id;
  };
  const allFonts = () => [...SIG_FONTS, ...userFonts];
  fillFonts();
  const bold = h('input', { type: 'checkbox', onchange: () => paintName() });
  const ital = h('input', { type: 'checkbox', onchange: () => paintName() });
  const tColor = h('input', { type: 'color', value: penColor, 'aria-label': '글자 색', oninput: e => { penColor = e.target.value; paintName(); } });
  const fstat = h('span', { class: 'muted small' });
  const prev = h('canvas', { class: 'tprev', width: 900, height: 240 });
  let paintSeq = 0;
  const paintName = async () => {
    const my = ++paintSeq;
    fstat.textContent = '';
    try { fstat.textContent = curFont.system ? '' : '글꼴을 불러오는 중…'; await ensureFont(curFont); fstat.textContent = ''; }
    catch { fstat.textContent = '글꼴을 불러오지 못했습니다'; return; }
    if (my !== paintSeq) return;
    const c = prev.getContext('2d');
    c.clearRect(0, 0, prev.width, prev.height);
    c.fillStyle = penColor; c.textBaseline = 'alphabetic';
    const font = `${ital.checked ? 'italic ' : ''}${bold.checked ? '700 ' : ''}120px ${cssFamily(curFont)}`;
    c.font = font;
    try { await document.fonts.load(font, name.value || '가A'); } catch { /* 시스템 글꼴 */ }
    const txt = name.value || '';
    if (txt) c.fillText(txt, 24, 150, prev.width - 48);
    else { c.fillStyle = '#c4c9d0'; c.font = '36px sans-serif'; c.fillText('이름을 입력하면 여기에 서명이 나타납니다', 24, 130); }
  };
  name.oninput = paintName;
  fontSel.onchange = () => { curFont = allFonts().find(f => f.id === fontSel.value) || curFont; paintName(); };
  const loadFile = h('button', { class: 'btn small', onclick: async () => {
    const [f] = await pickFiles('.ttf,.otf,.woff,.woff2,font/*');
    if (!f) return;
    try { const nf = await fontFromFile(f); userFonts.push(nf); curFont = nf; fillFonts(); paintName(); toast('글꼴을 불러왔습니다', 'ok'); } catch { toast('글꼴 파일을 읽을 수 없습니다', 'err'); }
  } }, '글꼴 파일 불러오기');
  const loadLocal = canListLocal() ? h('button', { class: 'btn small', onclick: async () => {
    try { const list = await listLocalFonts(); userFonts.push(...list.filter(x => !userFonts.some(u => u.id === x.id))); fillFonts(); toast(`내 컴퓨터 글꼴 ${list.length}개를 불러왔습니다. 목록의 「내 컴퓨터 글꼴」에서 고르세요`, 'ok'); }
    catch { toast('글꼴 목록을 볼 수 있는 권한이 없습니다. 「글꼴 파일 불러오기」를 사용해 주세요', 'err'); }
  } }, '내 컴퓨터 글꼴 보기') : null;
  const typePane = h('div', { hidden: true },
    name, row('글꼴', fontSel), h('div', { class: 'btnrow' }, loadFile, loadLocal, fstat),
    h('div', { class: 'btnrow' }, h('label', { class: 'chk' }, bold, '굵게'), h('label', { class: 'chk' }, ital, '기울임'), h('label', { class: 'chk' }, '색 ', tColor)),
    prev, h('p', { class: 'muted small' }, '문서에 넣은 뒤에는 모서리 점을 끌어 크기를, 서명을 끌어 위치를 조절할 수 있습니다.'));
  ital.checked = false;

  const bgOff = h('input', { type: 'checkbox', checked: true, onchange: () => paintImg() });
  const imgPrev = h('canvas', { class: 'tprev' });
  const paintImg = () => {
    if (!imgCv) return;
    imgPrev.width = imgCv.width; imgPrev.height = imgCv.height;
    imgPrev.getContext('2d').drawImage(imgCv, 0, 0);
    if (bgOff.checked) core.whiteToAlpha(imgPrev);
  };
  const imgPane = h('div', { hidden: true }, h('div', { class: 'btnrow' }, h('button', { class: 'btn', onclick: async () => { const [f] = await pickFiles('image/*'); if (f) { imgCv = await core.toCanvas(f, 0, 1200); paintImg(); } }, html: icon('image') + '<span>서명 사진 선택</span>' }), h('label', { class: 'chk' }, bgOff, '흰 배경 지우기')), imgPrev,
    h('p', { class: 'muted small' }, '흰 종이에 서명한 사진을 올리면 배경이 투명하게 처리됩니다.'));
  const keep = h('input', { type: 'checkbox', checked: true });
  const tabs = seg('sigtab', [['draw', '직접 그리기', '마우스·손가락으로 서명'], ['type', '이름 입력', '글꼴 골라 텍스트 서명'], ['img', '사진 올리기', '종이에 쓴 서명 사진']], 'draw', v => { tab = v; drawPane.hidden = v !== 'draw'; typePane.hidden = v !== 'type'; imgPane.hidden = v !== 'img'; if (v === 'type') paintName(); });
  const m = modal({
    title: '서명 넣기', wide: true,
    body: [savedBox, tabs.el, drawPane, typePane, imgPane, h('label', { class: 'chk' }, keep, '이 기기에 저장해 다음에도 사용')],
    actions: [{ label: '취소' }, {
      label: '문서에 넣기', kind: 'primary', icon: 'sign', run: async () => {
        let src = tab === 'draw' ? pad : tab === 'type' ? prev : imgPrev;
        if (tab === 'type' && !name.value.trim()) { toast('이름을 입력해 주세요', 'err'); return false; }
        if (tab === 'img' && !imgCv) { toast('사진을 선택해 주세요', 'err'); return false; }
        const cp = h('canvas'); cp.width = src.width; cp.height = src.height; cp.getContext('2d').drawImage(src, 0, 0);
        const t = trim(cp);
        if (!t) { toast('서명이 비어 있습니다', 'err'); return false; }
        const url = t.toDataURL('image/png');
        if (keep.checked) { saved.unshift({ url, w: t.width, h: t.height }); saveSigs(saved); }
        place(url, t.width, t.height);
      },
    }],
  });
  requestAnimationFrame(fitPad);
}

// ======================== 이미지 · 스탬프 ========================
export async function insertImage() {
  if (!await needDoc()) return;
  const [f] = await pickFiles('image/*');
  if (!f) return;
  try {
    const cv = await core.toCanvas(f, 0, 1600);
    const isPng = /png/i.test(f.type);
    V.addImage(cv.toDataURL(isPng ? 'image/png' : 'image/jpeg', 0.92), cv.width, cv.height, { width: 220 });
    toast('이미지를 넣었습니다. 끌어서 위치·크기를 조절하세요', 'ok');
  } catch (e) { err(e); }
}

export async function stampDialog() {
  if (!await needDoc()) return;
  const presets = [['승인됨', '#1f9d55'], ['반려', '#e1251b'], ['초안', '#1473e6'], ['기밀', '#e1251b'], ['검토 필요', '#f59e0b'], ['완료', '#1f9d55'], ['확인함', '#7c3aed'], ['사본', '#555555']];
  const make = (txt, col) => {
    const cv = h('canvas'), c = cv.getContext('2d');
    c.font = '700 64px "Malgun Gothic","Apple SD Gothic Neo","Noto Sans KR",sans-serif';
    const w = Math.ceil(c.measureText(txt).width) + 56; cv.width = w; cv.height = 112;
    c.font = '700 64px "Malgun Gothic","Apple SD Gothic Neo","Noto Sans KR",sans-serif';
    c.strokeStyle = col; c.fillStyle = col; c.lineWidth = 8; c.beginPath(); c.roundRect(6, 6, w - 12, 100, 14); c.stroke();
    c.textBaseline = 'middle'; c.textAlign = 'center'; c.fillText(txt, w / 2, 60);
    return cv;
  };
  const date = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\s/g, '');
  const all = [...presets, [date, '#333333']];
  const m = modal({
    title: '스탬프', body: [h('p', { class: 'muted' }, '누르면 문서에 바로 찍힙니다. 끌어서 위치·크기를 조절하세요.'),
      h('div', { class: 'stamps' }, all.map(([t, c]) => { const cv = make(t, c); const b = h('button', { class: 'stamp', onclick: () => { m.close(); V.addImage(cv.toDataURL('image/png'), cv.width, cv.height, { width: 130 }); } }); b.append(cv); return b; }))],
    actions: [{ label: '닫기' }],
  });
}

// ======================== 도구 목록 (홈 카드 · 오른쪽 패널 공용) ========================
export const TOOLS = [
  { id: 'edittext', group: 'edit', label: 'PDF 편집 (본문 글자 수정)', icon: 'text', color: '#1473e6', desc: '원래 PDF에 있는 글자를 눌러 그 자리에서 고치고 지웁니다.', cta: '열기', doc: true, home: 'PDF 편집', run: () => V.setTool('edittext') },
  { id: 'text', group: 'edit', label: '텍스트 추가', icon: 'text', color: '#1473e6', desc: '문서 위에 글자를 직접 입력합니다.', cta: '열기', doc: true, home: 'PDF 편집', run: () => V.setTool('text') },
  { id: 'note', group: 'edit', label: '메모', icon: 'note', color: '#f0a500', desc: '스티커 메모를 붙이고 강조 표시를 합니다.', cta: '열기', doc: true, home: '주석', run: () => V.setTool('note') },
  { id: 'highlight', group: 'edit', label: '형광펜', icon: 'highlight', color: '#e8b900', desc: '글자를 드래그해 형광색으로 칠합니다.', doc: true, run: () => V.setTool('highlight') },
  { id: 'pen', group: 'edit', label: '펜', icon: 'pen', color: '#e1251b', desc: '손글씨로 직접 그립니다.', doc: true, run: () => V.setTool('pen') },
  { id: 'sign', group: 'edit', label: '채우기 및 서명', icon: 'sign', color: '#5258e4', desc: '서명을 그리거나 사진으로 올려 넣습니다.', cta: '열기', doc: true, run: signDialog },
  { id: 'image', group: 'edit', label: '이미지 삽입', icon: 'image', color: '#0f9d8a', desc: '사진·로고를 문서에 넣습니다.', doc: true, run: insertImage },
  { id: 'stamp', group: 'edit', label: '스탬프', icon: 'stamp', color: '#8e44ad', desc: "'승인됨', '초안' 같은 스탬프를 찍습니다.", cta: '열기', doc: true, run: stampDialog },
  { id: 'whiteout', group: 'edit', label: '지우개 (가리기)', icon: 'eraser', color: '#6b7280', desc: '영역을 드래그해 흰색으로 덮어 지웁니다.', doc: true, run: () => V.setTool('whiteout') },

  { id: 'organize', group: 'page', label: '페이지 정리', icon: 'grid', color: '#2f9e44', desc: '페이지 순서 변경·삭제·회전·복제·추출.', cta: '열기', doc: true, run: () => openOrganizer() },
  { id: 'extract', group: 'page', label: '페이지 추출', icon: 'extract', color: '#16a34a', desc: '필요한 페이지만 새 PDF로 저장합니다.', cta: '열기', doc: true, run: extractDialog },
  { id: 'insert', group: 'page', label: 'PDF 삽입', icon: 'plus', color: '#0e7490', desc: '다른 PDF를 원하는 위치에 끼워 넣습니다.', doc: true, run: insertDialog },
  { id: 'merge', group: 'page', label: '파일 결합', icon: 'merge', color: '#6d4aff', desc: '여러 파일을 하나의 PDF로 합칩니다.', cta: '추가', doc: false, run: () => mergeDialog() },

  { id: 'convert', group: 'convert', label: 'PDF 파일변환', icon: 'convert', color: '#0b7a9b', desc: 'PDF를 사진(PNG·JPG), 텍스트, Word로 바꿉니다.', cta: '열기', doc: true, run: () => convertDialog('png') },
  { id: 'create', group: 'convert', label: '사진에서 PDF 만들기', home: 'PDF 만들기', icon: 'file', color: '#e1251b', desc: '사진·스캔 이미지를 PDF로 빠르게 만듭니다.', cta: '추가', doc: false, run: () => imagesDialog() },

  { id: 'compress', group: 'opt', label: 'PDF 압축', icon: 'compress', color: '#0891b2', desc: '용량을 줄여 메일·메신저로 보내기 쉽게 합니다.', cta: '열기', doc: true, run: compressDialog },
  { id: 'security', group: 'opt', label: '비밀번호 보호', icon: 'lock', color: '#b45309', desc: '비밀번호를 걸고 인쇄·복사를 제한합니다.', cta: '열기', doc: true, run: securityDialog },
  { id: 'watermark', group: 'opt', label: '워터마크', icon: 'drop', color: '#0369a1', desc: '글자·로고 워터마크를 넣거나 지웁니다.', cta: '열기', doc: true, run: watermarkDialog },
  { id: 'clean', group: 'opt', label: '배경 정리', icon: 'clean', color: '#d946a8', desc: '스캔 문서의 그림자·얼룩·누런 배경을 지웁니다.', cta: '열기', doc: true, run: cleanDialog },
  { id: 'ocr', group: 'opt', label: '문자 인식 (OCR)', icon: 'ocr', color: '#7c3aed', desc: '스캔본에서 글자를 추출하고 검색 가능하게 만듭니다.', cta: '열기', doc: true, run: ocrDialog },
];
export const GROUPS = { edit: '편집 · 주석 · 서명', page: '페이지', convert: '변환', opt: '최적화 · 보호 · 인식' };

// ---------- 확장 도구 · Adobe 구성의 도구 패널 ----------
TOOLS.push(...TOOLS2);
[['docx', 'Word로 변환', '글꼴·표·그림을 살려 Word 문서(DOCX)로 바꿉니다.'], ['xlsx', '엑셀로 변환', '표와 글을 칸으로 옮긴 엑셀(XLSX)로 바꿉니다.'], ['pptx', 'PowerPoint로 변환', '쪽마다 슬라이드가 되는 PPTX로 바꿉니다.'],
  ['png', '이미지로 변환 (PNG·JPG)', '쪽마다 사진 파일로 저장합니다.'], ['txt', '텍스트로 변환', '글만 추출해 TXT로 저장합니다.'], ['html', '웹 페이지로 변환', 'HTML 파일 하나로 저장합니다.'],
  ['md', '마크다운으로 변환', '제목·표 구조를 살린 MD로 저장합니다.'], ['csv', '표만 CSV로 변환', '문서의 표를 CSV로 저장합니다.']].forEach(([k, label, desc]) =>
  TOOLS.push({ id: 'to-' + k, group: 'convert', label, icon: 'convert', color: '#0b7a9b', desc, doc: true, run: () => convertDialog(k), hidden: true }));
export const PANEL = [
  { label: 'PDF 파일변환', icon: 'convert', color: '#0b7a9b', kids: ['to-docx', 'to-xlsx', 'to-pptx', 'to-png', 'to-txt', 'to-html', 'to-md', 'to-csv', 'getimages'] },
  { id: 'edittext', label: 'PDF 편집', kids: ['edittext', 'text', 'image', 'whiteout'] },
  { label: 'PDF 만들기', icon: 'file', color: '#e1251b', kids: ['create', 'create-blank', 'create-text', 'create-paste'] },
  { label: '주석', icon: 'note', color: '#d4a017', kids: ['note', 'highlight', 'underline', 'strike', 'pen', 'shape', 'stamp'] },
  { id: 'merge' },
  { label: '페이지 구성', icon: 'grid', color: '#2f9e44', kids: ['organize', 'rotate', 'delpages', 'extract', 'insert', 'split', 'crop'] },
  { id: 'compress' },
  { label: '교정', icon: 'redact', color: '#b91c1c', kids: ['redact', 'redact-find', 'redact-apply'] },
  { id: 'forms' },
  { id: 'signreq' },
  { label: '채우기 및 서명', icon: 'sign', color: '#5258e4', kids: ['sign', 'fillform', 'stamp'] },
  { id: 'reviewreq' },
  { label: '추가 도구', icon: 'tools', color: '#6b7280', kids: ['header', 'watermark', 'security', 'clean', 'ocr', 'props', 'flatform', 'print'] },
];
