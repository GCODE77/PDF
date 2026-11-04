// 문자 인식(OCR) 백그라운드 작업: 병렬 처리 · 임시저장(이어서) · 중지/취소 · 작업 상자 (© 2026 GLORY KIM)
//  - 작업은 문서의 복사본(스냅숏)으로 돌아가므로 다른 문서를 열어 보거나 작업해도 됩니다.
//  - 쪽마다 결과를 브라우저 저장소(IndexedDB)에 임시저장해서, 취소·창 닫기·앱 종료 후에도 이어서 할 수 있습니다.
import { S, h, icon, toast, modal, emit, on, download } from './state.js';
import * as core from './pdfcore.js';
import * as D from './doc.js';
import { analyzeBlank } from './blank.js';

const abs = p => new URL(p, location.href).href.replace(/\/$/, '');
export const OCR_WIDTH = { fast: 1100, normal: 1400, best: 1800 };
export function workerCount() {
  const c = navigator.hardwareConcurrency || 4;
  if (matchMedia('(max-width: 820px)').matches) return 1;               // 폰은 메모리를 아끼려 1개
  return Math.max(1, Math.min(4, Math.floor(c / 2)));
}

// ---------- 임시저장 (IndexedDB) ----------
let dbp = null;
const db = () => (dbp ||= new Promise((res, rej) => {
  const r = indexedDB.open('pdfg-ocr', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('pages');
  r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
}));
const tx = async (mode, fn) => {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction('pages', mode);
    const req = fn(t.objectStore('pages'));
    t.oncomplete = () => res(req && 'result' in req ? req.result : undefined); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
  });
};
const cacheGet = k => tx('readonly', st => st.get(k)).catch(() => null);
const cachePut = (k, v) => tx('readwrite', st => st.put(v, k)).catch(() => null);
const cacheKeys = pre => tx('readonly', st => st.getAllKeys(IDBKeyRange.bound(pre, pre + '￿'))).catch(() => []);
const cacheDel = pre => tx('readwrite', st => st.delete(IDBKeyRange.bound(pre, pre + '￿'))).catch(() => null);

export async function docKey(bytes, n) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(d.slice(0, 12), b => b.toString(16).padStart(2, '0')).join('') + '-' + n;
}
export async function savedCount(bytes, n, lang) { return (await cacheKeys((await docKey(bytes, n)) + '|' + lang + '|')).length; }

// ---------- 쪽에 글자 정보(검색 가능한 글자)가 있는지 ----------
export async function pageHasText(pdf, i) {
  pdf.__txt ||= new Int8Array(pdf.numPages).fill(-1);
  if (pdf.__txt[i] >= 0) return !!pdf.__txt[i];
  let n = 0;
  try {
    const pg = await pdf.getPage(i + 1);
    const tc = await pg.getTextContent();
    for (const it of tc.items) { n += (it.str || '').trim().length; if (n >= 5) break; }
    pg.cleanup();
  } catch { /* 읽기 실패는 글자 없음으로 */ }
  pdf.__txt[i] = n >= 5 ? 1 : 0;
  return !!pdf.__txt[i];
}
export async function pageTextStatus(pdf, onProgress) {
  const arr = new Uint8Array(pdf.numPages);
  for (let i = 0; i < pdf.numPages; i++) {
    arr[i] = (await pageHasText(pdf, i)) ? 1 : 0;
    if (i % 8 === 7) { onProgress?.(i + 1, pdf.numPages); await new Promise(r => setTimeout(r, 0)); }
  }
  return arr;
}
export function toRanges(list, max = 160) {
  const out = [];
  for (let i = 0; i < list.length; i++) {
    let j = i; while (j + 1 < list.length && list[j + 1] === list[j] + 1) j++;
    out.push(j > i ? `${list[i] + 1}-${list[j] + 1}` : `${list[i] + 1}`); i = j;
  }
  const s = out.join(', ');
  return s.length > max ? s.slice(0, max).replace(/,[^,]*$/, '') + ' …' : s;
}

// ---------- 인식 엔진 묶음(병렬) ----------
export async function makePool(lang, n, onStatus) {
  const create = () => window.Tesseract.createWorker(lang, 1, {
    workerPath: abs('vendor/tess/worker.min.js'), corePath: abs('vendor/tess/core'), langPath: abs('vendor/tess/lang'),
    cacheMethod: 'none', logger: m => onStatus?.(m),
  });
  const workers = [await create()];                                        // 첫 번째로 언어 데이터를 받고
  if (n > 1) workers.push(...await Promise.all(Array.from({ length: n - 1 }, create)));
  return { workers, close: () => Promise.all(workers.map(w => w.terminate().catch(() => { /* 이미 종료 */ }))) };
}

// 한 쪽 인식. 빈 쪽은 인식하지 않고 건너뜀
export async function ocrOnePage(pdf, i, width, worker) {
  const pg = await pdf.getPage(i + 1);
  const vw = pg.getViewport({ scale: 1 }).width;
  const cv = await core.renderCanvas(pdf, i + 1, Math.min(4, width / vw));
  try {
    if (analyzeBlank(cv, 'normal').blank) return { index: i, cw: cv.width, words: [], text: '', blank: true };
    const { data } = await worker.recognize(cv, {}, { text: true, blocks: true });
    const words = [];
    const push = wd => words.push({ text: wd.text, x0: wd.bbox.x0, y0: wd.bbox.y0, x1: wd.bbox.x1, y1: wd.bbox.y1 });
    for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) for (const wd of l.words || []) push(wd);
    if (!words.length && data.words) data.words.forEach(push);
    return { index: i, cw: cv.width, words, text: (data.text || '').trim() };
  } finally { cv.width = 0; pg.cleanup(); }
}

// ---------- 작업 관리 ----------
const jobs = [];
let seq = 0;
export const listJobs = () => jobs;
export const anyActive = () => jobs.some(j => j.active);
export const jobOf = docId => jobs.find(j => j.docId === docId && j.active) || null;
const notify = () => emit('jobs-changed');
export const jobPct = j => (j.total ? Math.min(1, j.done / j.total) : 0);
export function jobEta(j) {
  if (!j.active || j.processed < 1) return null;
  const el = (Date.now() - j.workStart) / 1000;
  const left = j.total - j.done - (j.skipPending || 0);
  return left <= 0 ? 0 : el / j.processed * left;
}

export async function startOcrJob(o) {
  if (o.docId != null && jobOf(o.docId)) { toast('이 문서는 이미 문자 인식을 하고 있습니다. 작업 상자에서 확인하세요'); return null; }
  const job = { id: ++seq, docId: o.docId, name: o.name, total: o.indices.length, done: 0, skipped: 0, cached: 0, processed: 0, workers: 0, status: 'running', active: true, phase: '준비 중…', stopReq: false, cancelReq: false, startedAt: Date.now(), workStart: Date.now(), out: o.out };
  jobs.push(job); notify();
  run(job, o).catch(e => { console.error(e); finish(job, 'error', e.message || String(e)); });
  return job;
}
export const stopJob = j => { if (j.active) { j.stopReq = true; j.phase = '중지하는 중… 진행 중인 쪽까지 마무리합니다'; notify(); } };
export const cancelJob = j => { if (j.active) { j.cancelReq = true; j.phase = '취소하는 중…'; notify(); } };

function finish(job, status, msg) {
  job.active = false; job.status = status; job.msg = msg; job.endedAt = Date.now();
  notify();
}

async function run(job, o) {
  let pdf = null, pool = null;
  const results = new Map();
  try {
    pdf = await D.openPdfjs(o.bytes);
    const key = (await docKey(o.bytes, pdf.numPages)) + '|' + o.lang + '|';
    job.phase = '이전 임시저장 확인 중…'; notify();
    const queue = [];
    for (const i of o.indices) {
      const c = await cacheGet(key + i);
      if (c) { results.set(i, c); job.cached++; job.done++; } else queue.push(i);
    }
    notify();
    if (queue.length) {
      job.phase = '인식 엔진 준비 중… (처음 한 번은 시간이 걸립니다)'; notify();
      pool = await makePool(o.lang, Math.min(o.nWorkers || 1, queue.length));
      job.workers = pool.workers.length; job.phase = '글자 인식 중'; job.workStart = Date.now(); notify();
      let next = 0;
      await Promise.all(pool.workers.map(async w => {
        while (!job.stopReq && !job.cancelReq) {
          const k = next++; if (k >= queue.length) return;
          const i = queue[k];
          if (o.skipText && await pageHasText(pdf, i)) { job.skipped++; job.done++; notify(); continue; }
          const r = await ocrOnePage(pdf, i, o.width, w);
          results.set(i, r); job.done++; job.processed++;
          cachePut(key + i, r);                                    // 쪽마다 임시저장
          notify();
        }
      }));
      await pool.close(); pool = null;
    }
    if (job.cancelReq) { finish(job, 'cancelled', `취소했습니다. 인식한 ${results.size}쪽은 임시저장되어 다음에 이어서 합니다`); toast(job.msg); return; }
    const list = [...results.values()].sort((a, b) => a.index - b.index);
    const nWords = list.reduce((a, r) => a + r.words.length, 0);
    if (o.out === 'txt') {
      finish(job, 'done', `${list.length}쪽 인식 완료`);
      showText(list.map(r => `── ${r.index + 1}쪽 ──\n${r.text}`).join('\n\n'), o.name);
      return;
    }
    if (!nWords) { finish(job, 'done', '인식된 글자가 없습니다'); toast('인식된 글자가 없습니다', 'err'); cacheDel(key); return; }
    job.phase = '결과를 문서에 넣는 중…'; notify();
    await S.applyToDoc(job.docId, bytes => core.addInvisibleText(bytes, list), { pages: pdf.numPages });
    cacheDel(key);
    const doneMsg = job.stopReq ? `중지했습니다. ${list.length}쪽까지 문서에 적용했습니다 (나머지는 다시 시작하면 이어서 합니다)` : `완료: 글자 ${nWords}개를 인식했습니다. 이제 검색·복사가 가능합니다`;
    finish(job, 'done', doneMsg); toast(doneMsg, 'ok');
  } catch (e) {
    console.error(e);
    const m = String(e.message || e);
    finish(job, 'error', m + (results.size ? ` (인식한 ${results.size}쪽은 임시저장됨)` : ''));
    toast('문자 인식 중 문제가 생겼습니다: ' + m, 'err');
  } finally {
    try { await pool?.close(); } catch { /* 무시 */ }
    try { pdf?.destroy?.(); } catch { /* 무시 */ }
  }
}

function showText(text, name) {
  const ta = h('textarea', { class: 'inp txt', readonly: true }, text);
  modal({ title: `추출한 글자 · ${name}`, wide: true, body: ta, actions: [
    { label: '닫기' },
    { label: '복사', icon: 'copy', keep: true, run: async () => { await navigator.clipboard.writeText(text); toast('복사했습니다', 'ok'); } },
    { label: 'TXT 저장', kind: 'primary', icon: 'save', run: () => download(new Blob(['﻿' + text], { type: 'text/plain;charset=utf-8' }), String(name).replace(/\.pdf$/i, '') + '.txt') },
  ] });
}

// ---------- 작업 상자 (화면 왼쪽 아래) ----------
const fmtDur = s => (s == null ? '계산 중' : s < 60 ? `${Math.max(1, Math.round(s))}초` : s < 3600 ? `${Math.round(s / 60)}분` : `${Math.floor(s / 3600)}시간 ${Math.round((s % 3600) / 60)}분`);
export function initJobsUI() {
  const root = h('div', { id: 'jobs', hidden: true });
  document.body.append(root);
  let open = false;
  const card = j => {
    const pct = Math.round(jobPct(j) * 100);
    const el = (Date.now() - j.startedAt) / 1000;
    const sub = j.active
      ? `${j.done} / ${j.total}장 · ${pct}% · 남은 시간 약 ${fmtDur(jobEta(j))} · 경과 ${fmtDur(el)}`
      : (j.msg || '');
    const extra = [j.workers > 1 ? `동시 ${j.workers}개 처리` : '', j.cached ? `임시저장에서 ${j.cached}쪽` : '', j.skipped ? `글자 있는 ${j.skipped}쪽 건너뜀` : ''].filter(Boolean).join(' · ');
    return h('div', { class: 'jcard ' + j.status },
      h('div', { class: 'jt' }, h('b', {}, 'OCR'), h('span', { class: 'jn' }, j.name)),
      h('div', { class: 'jbar' }, h('i', { style: { width: (j.active ? pct : 100) + '%' } })),
      h('div', { class: 'jsub' }, j.active ? j.phase : (j.status === 'done' ? '✔ ' : j.status === 'error' ? '⚠ ' : '') + sub),
      j.active ? h('div', { class: 'jsub' }, sub) : null,
      extra ? h('div', { class: 'jsub muted' }, extra) : null,
      j.active ? h('div', { class: 'jbtn' },
        h('button', { class: 'btn small primary', onclick: () => stopJob(j), title: '지금까지 인식한 쪽을 문서에 넣고 멈춥니다' }, '중지하고 지금까지 적용'),
        h('button', { class: 'btn small', onclick: () => cancelJob(j), title: '문서에는 넣지 않습니다. 인식한 쪽은 임시저장되어 나중에 이어서 할 수 있습니다' }, '취소 (임시저장 유지)')) : null);
  };
  const render = () => {
    const shown = jobs.filter(j => j.active || Date.now() - (j.endedAt || 0) < 12000);
    root.hidden = !shown.length;
    if (!shown.length) { root.replaceChildren(); open = false; return; }
    const lead = shown.find(j => j.active) || shown[0];
    const chip = h('button', { class: 'jchip', 'aria-expanded': String(open), onclick: () => { open = !open; render(); } },
      lead.active ? h('span', { class: 'jspin' }) : null,
      h('span', {}, lead.active ? `OCR ${lead.done}/${lead.total}장 · ${Math.round(jobPct(lead) * 100)}% · 남은 약 ${fmtDur(jobEta(lead))}` : 'OCR ' + (lead.status === 'done' ? '완료' : lead.status === 'cancelled' ? '취소됨' : '문제 발생')),
      shown.filter(j => j.active).length > 1 ? h('em', {}, `외 ${shown.filter(j => j.active).length - 1}건`) : null);
    root.replaceChildren(...(open ? [h('div', { class: 'jpanel' }, ...shown.map(card))] : []), chip);
  };
  on('jobs-changed', render);
  setInterval(() => { if (jobs.some(j => j.active) || !root.hidden) render(); }, 1000);
  render();
}
