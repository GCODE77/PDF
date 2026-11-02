// 문서 상태(열기 · 이력 · 저장)
import { S, emit, toast, busy, modal, h, fmtSize, baseName } from './state.js';
import * as core from './pdfcore.js';

let pdfjs;
export async function getPdfjs() {
  if (!pdfjs) {
    pdfjs = await import('../vendor/pdfjs/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = 'vendor/pdfjs/pdf.worker.min.mjs';
  }
  return pdfjs;
}

export const killPdf = p => { try { (p.loadingTask?.destroy ? p.loadingTask.destroy() : p.destroy?.()); } catch { /* 이미 닫힘 */ } };

export async function openPdfjs(bytes, password) {
  const lib = await getPdfjs();
  return lib.getDocument({
    data: bytes.slice(), password,
    cMapUrl: 'vendor/pdfjs/cmaps/', cMapPacked: true,
    standardFontDataUrl: 'vendor/pdfjs/standard_fonts/', isEvalSupported: false,
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
        data: bytes.slice(), password: pw, cMapUrl: 'vendor/pdfjs/cmaps/', cMapPacked: true,
        standardFontDataUrl: 'vendor/pdfjs/standard_fonts/', isEvalSupported: false,
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

// 편집 내용을 문서에 반영한 바이트(현재 화면 상태는 유지)
export async function currentBytes() {
  if (!hasOverlays()) return S.bytes;
  return core.flatten(S.bytes, S.overlays, S.imgs);
}
// 구조 변경 전에 호출: 편집 내용을 문서에 확정
export async function flush() {
  if (!hasOverlays()) return S.bytes;
  const b = await core.flatten(S.bytes, S.overlays, S.imgs);
  await applyBytes(b);
  return b;
}

export function safeName(suffix = '_편집', ext = '.pdf') { return baseName(S.name) + suffix + ext; }
