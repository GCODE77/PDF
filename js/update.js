// 새 버전 확인 · 알림 · 업데이트 (© 2026 GLORY KIM)
import { S, $, h, toast, busy, icon, modal } from './state.js';

export const VERSION = '1.3.7';
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

function updateFailed(v, raw) {
  let msg = String(raw?.message || raw || '').replace(/^Error invoking remote method [^:]+: Error: /, '');
  let file = '', log = '', manual = false;
  if (msg.startsWith('MANUAL|')) { const p = msg.split('|'); manual = true; msg = p[1]; file = p[2]; }
  else if (msg.includes('|LOG|')) { const p = msg.split('|LOG|'); msg = p[0]; log = p[1]; }
  const body = [
    h('p', {}, manual ? '설치 파일은 내려받았지만 자동으로 실행하지 못했습니다. 열린 폴더에서 「PDF-Gongjakso-Setup.exe」를 더블클릭해 설치해 주세요.' : '자동 설치를 끝내지 못했습니다.'),
    h('p', { class: 'muted small' }, '이유: ' + msg),
    file ? h('p', { class: 'muted small' }, '설치 파일 위치: ' + file) : null,
    log ? h('p', { class: 'muted small' }, '기록 파일: ' + log) : null,
    h('p', { class: 'muted small' }, 'Windows 보호 화면이 뜨면 「추가 정보 → 실행」을 누르세요. 회사 보안 프로그램이 막는 경우에는 아래 「설치 파일 받는 페이지」에서 직접 내려받아 실행해 주세요.'),
  ];
  modal({
    title: '자동 업데이트를 완료하지 못했습니다', body,
    actions: [{ label: '닫기' }, { label: '다시 시도', run: () => { setTimeout(() => applyUpdate(v), 50); } }, { label: '설치 파일 받는 페이지', kind: 'primary', run: () => { window.open(v.setup || RELEASES, '_blank'); } }],
  });
}

let progressBound = false;
async function applyUpdate(v) {
  if (isDesktopApp) {
    const b = busy('새 버전을 내려받는 중… 완료되면 자동으로 설치됩니다');
    if (!progressBound) { progressBound = true; window.electronAPI.onUpdateProgress?.(p => window.__updProgress?.(p)); }
    window.__updProgress = p => b.set(null, p);
    try { await window.electronAPI.installUpdate(v.setup); }
    catch (e) { b.close(); updateFailed(v, e); }
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
