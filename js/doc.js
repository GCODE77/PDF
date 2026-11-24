// 문서 상태(열기 · 이력 · 저장)
import { S, emit, toast, busy, modal, h, fmtSize, baseName } from './state.js';
import * as core from './pdfcore.js';
import { addFormFields, rasterizePages } from './core2.js';

let pdfjs;
export async function getPdfjs() {
  if (!pdfjs) {
    pdfjs = await import('../vendor/pdfjs/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = 'vendor/pdfjs/pdf.worker.min.mjs';
  }
  return pdfjs;
}

// pdf.js 작업 스레드가 읽는 데이터 폴더(글꼴·CMap·스캔 그림 해독기 wasm). 상대 경로는 작업 스레드 기준으로 풀려 못 찾으므로 절대 주소로 만든다
const PJS = new URL('vendor/pdfjs/', document.baseURI).href;

export const killPdf = p => { try { (p.loadingTask?.destroy ? p.loadingTask.destroy() : p.destroy?.()); } catch { /* 이미 닫힘 */ } };

export async function openPdfjs(bytes, password) {
  const lib = await getPdfjs();
  return lib.getDocument({
    data: bytes.slice(), password, fontExtraProperties: true,
    cMapUrl: PJS + 'cmaps/', cMapPacked: true,
    standardFontDataUrl: PJS + 'standard_fonts/', wasmUrl: PJS + 'wasm/', isEvalSupported: false,
  }).promise;
}

function askPassword(wrong) {
  return new Promise(res => {
    const inp = h('input', { type: 'password', class: 'inp', autocomplete: 'off', placeholder: '비밀번호', autofocus: true });
    let done = false;
    const m = modal({
      title: '비밀번호가 필요한 문서입니다',
      body: [h('p', { class: 'muted' }, wrong ? '비밀번호가 맞지 않습니다. 다시 입력해 주세요.' : '이 PDF는 암호로 보호되어 있습니다.'), inp],
      actions: [
        { label: '취소', kind: 'ghost', run: () => { done = true; res(null); } },
        { label: '열기', kind: 'primary', run: () => { done = true; res(inp.value); } },
      ],
      onClose: () => { if (!done) res(null); },
    });
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') m.buttons['열기'].click(); });
  });
}

export async function loadBytes(bytes, name, { keepPage = false } = {}) {
  const pdf = await openPdfjs(bytes);
  if (S.pdf) killPdf(S.pdf);
  S.bytes = bytes; S.pdf = pdf; S.n = pdf.numPages;
  if (name) S.name = name;
  emit('doc-loaded', { keepPage });
}

// 파일 열기: 암호 문서는 해제한 사본으로 연다
export async function openFromBytes(bytes, name) {
  const lib = await getPdfjs();
  let pw, pdf;
  for (;;) {
    try {
      pdf = await lib.getDocument({
        data: bytes.slice(), password: pw, fontExtraProperties: true, cMapUrl: PJS + 'cmaps/', cMapPacked: true,
        standardFontDataUrl: PJS + 'standard_fonts/', wasmUrl: PJS + 'wasm/', isEvalSupported: false,
      }).promise;
      break;
    } catch (e) {
      if (e.name === 'PasswordException') { pw = await askPassword(e.code === 2); if (pw == null) return false; continue; }
      throw new Error('PDF를 열 수 없습니다. 손상되었거나 PDF 파일이 아닐 수 있습니다.');
    }
  }
  const tail = new TextDecoder('latin1').decode(bytes.subarray(Math.max(0, bytes.length - 65536)));
  if (pw !== undefined || /\/Encrypt\s/.test(tail)) {
    const b = busy('암호를 해제한 사본을 만드는 중…');
    try {
      bytes = await core.rasterRebuild(bytes, pdf, { scale: 2, quality: 0.9 }, (p, t) => { b.set(t, p); return !b.cancelled; });
    } finally { b.close(); }
    killPdf(pdf);
    S.hist = []; S.fut = []; S.overlays = {}; S.dirty = true;
    await loadBytes(bytes, name);
    toast('암호를 해제한 사본으로 열었습니다. 글자 선택이 필요하면 「문자 인식(OCR)」을 사용하세요.', 'ok');
    return true;
  }
  if (S.pdf) killPdf(S.pdf);
  S.hist = []; S.fut = []; S.overlays = {}; S.imgs = {}; S.dirty = false;
  S.bytes = bytes; S.pdf = pdf; S.n = pdf.numPages; S.name = name;
  emit('doc-loaded', { keepPage: false, fresh: true });
  return true;
}

// ---------- 이력 ----------
const snapshot = () => ({ bytes: S.bytes, ov: JSON.stringify(S.overlays) });
export function snap() {
  S.hist.push(snapshot());
  if (S.hist.length > 30) S.hist.shift();
  S.fut = []; S.dirty = true;
  emit('history');
}
async function restore(s) {
  const same = s.bytes === S.bytes;
  S.overlays = JSON.parse(s.ov);
  S.selected = null;
  if (!same) await loadBytes(s.bytes, null, { keepPage: true });
  else emit('overlays-changed');
  S.dirty = true;
  emit('history');
}
export async function undo() { if (!S.hist.length) return; S.fut.push(snapshot()); await restore(S.hist.pop()); }
export async function redo() { if (!S.fut.length) return; S.hist.push(snapshot()); await restore(S.fut.pop()); }

export const hasOverlays = () => Object.values(S.overlays).some(l => l.length);

export async function applyBytes(bytes) {
  snap();
  S.overlays = {};
  await loadBytes(bytes, null, { keepPage: true });
}

// 편집 개체를 PDF에 굽는다. 교정 상자(검은 상자·모자이크)가 있는 쪽은 그림으로 다시 만든다(원본 복구 불가):
// 모자이크 영역은 픽셀화, 검은 상자는 검게 칠한 채로 그림이 된다.
// raster: 그 밖에 그림으로 바꿀 쪽. boxText: 사용자가 「글자만 제거」를 고른 경우에만 true (검은 상자 쪽을 그림으로 바꾸지 않음)
const isMosaic = o => o.type === 'redact' && o.mosaic;
export const redactPages = ov => Object.entries(ov || {}).filter(([, l]) => l.some(o => o.type === 'redact')).map(([i]) => +i);
export async function flattenAll(bytes, overlays, imgs, raster = [], onProg, { boxText = false } = {}) {
  const mos = {};
  for (const [pi, l] of Object.entries(overlays)) { const m = l.filter(isMosaic); if (m.length) mos[pi] = m; }
  const ov = Object.keys(mos).length ? Object.fromEntries(Object.entries(overlays).map(([pi, l]) => [pi, l.filter(o => !isMosaic(o))])) : overlays;
  let b = Object.values(ov).some(l => l.length) ? await core.flatten(bytes, ov, imgs) : bytes;
  if (Object.values(ov).some(l => l.some(o => o.type === 'field'))) b = await addFormFields(b, ov);
  const pages = [...new Set([...Object.keys(mos).map(Number), ...raster, ...(boxText ? [] : redactPages(overlays))])].sort((a, c) => a - c);
  if (pages.length) {
    const pdf = await openPdfjs(b);
    try { b = await rasterizePages(b, pdf, pages, 2.2, onProg, mos); } finally { killPdf(pdf); }
  }
  return b;
}
export const hasRedact = ov => Object.values(ov || {}).some(l => l.some(o => o.type === 'redact'));
// 「교정 적용」을 거치지 않고 굽는 경로(저장·공유·변환·구조 변경)에서 교정 상자가 있으면 그림 방식으로 굽고 한 줄 알린다
async function flat(msg) {
  const red = hasRedact(S.overlays);
  const b = await flattenAll(S.bytes, S.overlays, S.imgs);
  if (red && msg) toast(msg);
  return b;
}
// 교정을 문서에 굽기 전: 이 문서의 진행 중 글자 인식(OCR)을 취소한다 (원본을 읽은 글자가 가린 자리에 다시 들어가지 않게)
async function stopOcrForRedact() {
  if (!hasRedact(S.overlays)) return;
  const J = await import('./ocrjob.js');
  J.cancelForRedact(S.docId?.());          // 알림은 작업이 실제로 끝나는 쪽(ocrjob)에서 상태와 함께 낸다
}
// 문서별 잠금: 교정 굽기와 백그라운드 결과(OCR) 넣기가 겹치지 않게 차례로 실행한다
const locks = new Map();
export function withDocLock(id, fn) {
  const prev = locks.get(id) || Promise.resolve();
  const run = prev.catch(() => {}).then(fn);
  const tail = run.catch(() => {});
  locks.set(id, tail);
  tail.then(() => { if (locks.get(id) === tail) locks.delete(id); });
  return run;
}
// 교정 적용: 편집 개체를 굽고 지정한 쪽을 그림으로 바꾼다. 실행 취소 한 번으로 표시 상태로 돌아간다
export async function bake(raster, onProg, opts) {
  await stopOcrForRedact();                 // 잠금을 기다리기 전에 OCR 취소 표시부터 (넣는 중인 결과를 버리게)
  return withDocLock(S.docId?.(), async () => {
    const b = await flattenAll(S.bytes, S.overlays, S.imgs, raster, onProg, opts);
    await applyBytes(b);
    return b;
  });
}
export async function currentBytes() {
  if (!hasOverlays()) return S.bytes;
  return flat('가림 영역이 있어 해당 쪽을 그림으로 바꿔 저장했습니다');
}
// 구조 변경 전에 호출: 편집 내용을 문서에 확정
export async function flush() {
  if (!hasOverlays()) return S.bytes;
  await stopOcrForRedact();
  const b = await flat('가림 영역이 있어 해당 쪽을 그림으로 바꿨습니다');
  await applyBytes(b);
  return b;
}

export function safeName(suffix = '_편집', ext = '.pdf') { return baseName(S.name) + suffix + ext; }
