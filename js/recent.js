// 최근 파일 · 별표 (이 기기의 IndexedDB에만 저장됩니다)
import * as core from './pdfcore.js';

const DB = 'pdfgongjakso', META = 'recent', FILES = 'files';
const MAX_ITEMS = 30, MAX_BYTES = 80 * 1048576;

const open = () => new Promise((res, rej) => {
  const r = indexedDB.open(DB, 1);
  r.onupgradeneeded = () => { r.result.createObjectStore(META, { keyPath: 'id' }); r.result.createObjectStore(FILES, { keyPath: 'id' }); };
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});
async function run(stores, mode, fn) {
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction(stores, mode);
    const out = fn(...[].concat(stores).map(s => t.objectStore(s)));
    t.oncomplete = () => { db.close(); res(out?.result); };
    t.onerror = t.onabort = () => { db.close(); rej(t.error); };
  });
}
const safe = async (fn, fallback) => { try { return await fn(); } catch (e) { console.warn('최근 파일 저장소 오류', e); return fallback; } };

export const listRecent = () => safe(async () => (await run(META, 'readonly', s => s.getAll())).sort((a, b) => b.time - a.time), []);
export const getFile = id => safe(() => run(FILES, 'readonly', s => s.get(id)), null);

async function thumb(pdf) {
  try {
    const pg = await pdf.getPage(1);
    const cv = await core.renderCanvas(pdf, 1, 160 / pg.getViewport({ scale: 1 }).width);
    const u = cv.toDataURL('image/jpeg', 0.7);
    cv.width = 0;
    return u;
  } catch { return null; }
}

export async function addRecent(name, bytes, pdf) {
  return safe(async () => {
    const id = name + '|' + bytes.length;
    const prev = (await run(META, 'readonly', s => s.get(id)));
    const meta = { id, name, size: bytes.length, time: Date.now(), star: !!prev?.star, thumb: await thumb(pdf), hasFile: bytes.length <= MAX_BYTES };
    await run([META, FILES], 'readwrite', (m, f) => {
      m.put(meta);
      if (meta.hasFile) f.put({ id, bytes: bytes.slice().buffer });
      return m;
    });
    // 오래된 항목 정리 (별표는 유지)
    const all = await listRecent();
    const drop = all.filter(x => !x.star).slice(MAX_ITEMS);
    if (drop.length) await run([META, FILES], 'readwrite', (m, f) => { drop.forEach(x => { m.delete(x.id); f.delete(x.id); }); return m; });
    navigator.storage?.persist?.();
  });
}

export const toggleStar = id => safe(async () => {
  const m = await run(META, 'readonly', s => s.get(id));
  if (!m) return;
  m.star = !m.star;
  await run(META, 'readwrite', s => s.put(m));
});
export const removeRecent = id => safe(() => run([META, FILES], 'readwrite', (m, f) => { m.delete(id); f.delete(id); return m; }));
export const clearRecent = () => safe(async () => {
  const drop = (await listRecent()).filter(x => !x.star);
  await run([META, FILES], 'readwrite', (m, f) => { drop.forEach(x => { m.delete(x.id); f.delete(x.id); }); return m; });
});
