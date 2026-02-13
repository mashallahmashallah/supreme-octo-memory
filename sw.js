const BUILD_ID = new URL(self.location.href).searchParams.get('build') || 'dev';
const RUNTIME_CACHE = `tts-lab-runtime-${BUILD_ID}`;
const MODEL_CACHE = 'tts-lab-models-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(Promise.resolve());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => key.startsWith('tts-lab-runtime-') && key !== RUNTIME_CACHE)
        .map((key) => caches.delete(key))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const isNavigation = request.mode === 'navigate';
  const isAppCode = /\/(index\.html|src\/|sw\.js|manifest\.webmanifest|build\.json)/.test(url.pathname);
  const isModelAsset = url.pathname.includes('/public/models/');

  if (isNavigation || isAppCode) {
    event.respondWith(networkFirst(request, RUNTIME_CACHE));
    return;
  }

  if (isModelAsset) {
    event.respondWith(cacheFirst(request, MODEL_CACHE));
  }
});

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request, { cache: 'no-store' });
    cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw new Error('Network unavailable and no cached response.');
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  cache.put(request, response.clone());
  return response;
}
