// オフライン対応のサービスワーカー。
// 方針：ネットワーク優先（常に最新のアプリを使う）→ つながらないときはキャッシュで起動する。
// アプリのファイルを追加・削除したら SHELL を更新し、CACHE の番号を上げる。

const CACHE = 'my-money-v12';
const SHELL = [
  './',
  './index.html',
  './privacy.html',
  './terms.html',
  './manifest.json',
  './css/app.css',
  './js/app.js',
  './js/core.js',
  './js/ui.js',
  './js/guides.js',
  './js/guideContent.js',
  './js/views/home.js',
  './js/views/ledger.js',
  './js/views/charts.js',
  './js/views/budget.js',
  './js/views/sim.js',
  './js/views/settings.js',
  './js/calc.js',
  './js/dataService.js',
  './js/storage.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
];
const NETWORK_TIMEOUT_MS = 4000;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('my-money-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function fetchWithTimeout(request) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), NETWORK_TIMEOUT_MS);
    fetch(request).then(
      (res) => { clearTimeout(timer); resolve(res); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  // 外部への通信や GET 以外には関与しない（このアプリは外部送信をしない）
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await fetchWithTimeout(request);
      if (res.ok) cache.put(request, res.clone());
      return res;
    } catch {
      const cached = await cache.match(request, { ignoreSearch: true });
      if (cached) return cached;
      if (request.mode === 'navigate') return cache.match('./index.html');
      return Response.error();
    }
  })());
});
