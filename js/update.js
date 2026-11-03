// 새 버전 확인 · 알림 · 업데이트 (© 2026 GLORY KIM)
import { S, $, h, toast, busy, icon } from './state.js';

export const VERSION = '1.1.2';
const REMOTE = 'https://gcode77.github.io/PDF/version.json';
const RELEASES = 'https://github.com/GCODE77/PDF/releases/latest';
const isDesktopApp = !!window.electronAPI;
const onPages = location.hostname === 'gcode77.github.io';

const newer = (a, b) => {
  const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
};
const SKIP = 'pdfg.update.later';
const snoozed = v => { try { const s = JSON.parse(localStorage.getItem(SKIP) || '{}'); return s.v === v && Date.now() - s.t < 864e5; } catch { return false; } };
const snooze = v => { try { localStorage.setItem(SKIP, JSON.stringify({ v, t: Date.now() })); } catch { /* 무시 */ } };

async function refreshWebApp() {
  for (const r of (await navigator.serviceWorker?.getRegistrations?.()) || []) await r.unregister();
  for (const k of await caches.keys()) await caches.delete(k);
  location.reload();
}

async function applyUpdate(v) {
  if (isDesktopApp) {
    const b = busy('새 버전을 내려받는 중… 완료되면 자동으로 설치됩니다');
    window.electronAPI.onUpdateProgress?.(p => b.set(null, p));
    try { await window.electronAPI.installUpdate(v.setup); }
    catch (e) { b.close(); toast('자동 설치에 실패했습니다 (' + String(e.message || e).replace(/^Error invoking remote method [^:]+: Error: /, '').slice(0, 80) + '). 열리는 페이지에서 설치 파일을 받아 실행해 주세요', 'err'); window.open(v.setup || RELEASES, '_blank'); }
  } else if (onPages) { toast('새 버전을 불러옵니다…'); setTimeout(refreshWebApp, 400); }
  else window.open(RELEASES, '_blank');     // 압축파일(ZIP)로 쓰는 경우: 새 파일 받기
}

function showBar(v) {
  $('#updbar')?.remove();
  const label = isDesktopApp ? '지금 업데이트 (자동 설치)' : onPages ? '지금 업데이트' : '새 버전 받기';
  const bar = h('div', { id: 'updbar', role: 'status' },
    h('span', { class: 'ui', html: icon('save') }),
    h('span', { class: 'ut' }, h('b', {}, `새 버전 ${v.version}이 나왔어요`), v.notes ? ' · ' + v.notes : ''),
    h('button', { class: 'btn primary small', onclick: () => applyUpdate(v) }, label),
    h('button', { class: 'btn ghost small', onclick: () => { snooze(v.version); bar.remove(); } }, '나중에'));
  $('#app').insertBefore(bar, $('#home'));
}

export async function checkUpdate({ manual = false } = {}) {
  try {
    const r = await fetch(REMOTE + '?t=' + Date.now(), { cache: 'no-store' });
    const v = await r.json();
    if (newer(v.version, VERSION)) {
      if (manual || !snoozed(v.version)) {
        showBar(v);
        if (isDesktopApp && !manual && 'Notification' in window) {      // Windows 알림창
          try { new Notification('PDF 공작소 새 버전 ' + v.version, { body: (v.notes || '업데이트가 있습니다') + ' — 앱 위쪽의 「지금 업데이트」를 누르세요' }); } catch { /* 알림 불가 */ }
        }
      }
      return v;
    }
    if (manual) toast(`최신 버전입니다 (v${VERSION})`, 'ok');
  } catch {
    if (manual) toast('업데이트를 확인하지 못했습니다. 인터넷 연결을 확인해 주세요', 'err');
  }
}

export function initUpdate() {
  let last = 0;
  const run = () => { last = Date.now(); checkUpdate(); };
  setTimeout(run, 3000);
  setInterval(run, 6 * 36e5);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && Date.now() - last > 36e5) run(); });
}
