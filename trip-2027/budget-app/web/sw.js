// 지하철처럼 신호가 약할 때도 앱 화면은 뜨도록, 앱 파일만 저장해 둔다.
// 항상 새 파일을 먼저 받고, 못 받을 때만 저장본을 쓴다. 데이터(Supabase) 요청은 건드리지 않는다.
const CACHE = 'trip-budget-v1';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return res; })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('./index.html'))),
  );
});
