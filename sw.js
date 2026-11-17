// 오프라인에서도 화면이 열리도록 정적 파일만 캐시 (API 는 절대 캐시하지 않음)
const CACHE = 'mylife-v5';
const SHELL = ['./', 'index.html', 'fonts/pretendard/pretendard.css', 'css/style.css', 'js/records.js', 'js/saju.js', 'js/app.js', 'js/stats.js', 'js/charts.js', 'js/views.js', 'js/sync.js', 'js/integrations.js', 'manifest.webmanifest', 'icons/icon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// 네트워크 우선 → 실패하면 캐시 (항상 최신 화면, 오프라인일 때만 캐시)
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('index.html')))
  );
});
