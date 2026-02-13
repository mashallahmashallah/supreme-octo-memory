const BUILD_ID = '__BUILD_ID__';
const CACHE = `tts-lab-${BUILD_ID}`;
const APP_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  `./src/app.js?v=${BUILD_ID}`,
  './src/capabilities.js',
  './src/storage/db.js',
  './public/models/manifest.json',
  './version.json'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(APP_ASSETS)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }

  if (url.pathname.endsWith('.js') || url.pathname.endsWith('.json') || url.pathname.endsWith('.webmanifest')) {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(cacheFirst(request));
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request, { cache: 'no-store' });
    cache.put(request, response.clone());
    return response;
  } catch {
    return (await cache.match(request)) || fetch(request);
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  cache.put(request, response.clone());
  return response;
}
