// 오프라인 사용을 위한 서비스 워커: 앱 파일은 캐시 우선, 용량이 큰 OCR·글꼴은 처음 쓸 때 캐시
const V = 'pdfgongjakso-v19';
const CORE = ['./', 'index.html', 'css/style.css', 'js/main.js', 'js/state.js', 'js/doc.js', 'js/viewer.js', 'js/side.js', 'js/tools.js', 'js/pdfcore.js', 'js/home.js', 'js/menubar.js', 'js/recent.js', 'js/update.js', 'js/layout.js', 'js/exporters.js', 'js/tools2.js', 'js/core2.js', 'js/sigfonts.js', 'js/textfonts.js', 'js/blank.js', 'js/orient.js', 'js/dup.js', 'js/ocrjob.js', 'icons/icon-512.png',
  'vendor/pdf-lib.min.js', 'vendor/fontkit.umd.min.js', 'vendor/jszip.min.js', 'vendor/pdfjs/pdf.min.mjs', 'vendor/pdfjs/pdf.worker.min.mjs',
  'vendor/tess/tesseract.min.js', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(CORE)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin) return;
  const heavy = u.pathname.includes('/vendor/');
  const fromNet = () => fetch(r).then(res => { if (res.ok) { const c = res.clone(); caches.open(V).then(ca => ca.put(r, c)); } return res; });
  e.respondWith(heavy
    ? caches.match(r).then(hit => hit || fromNet())                 // 라이브러리: 캐시 우선
    : fromNet().catch(() => caches.match(r, { ignoreSearch: true })) // 앱 코드: 네트워크 우선(항상 최신), 오프라인이면 캐시
  );
});
