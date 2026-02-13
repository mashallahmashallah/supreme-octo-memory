const CACHE = 'tts-lab-v1';
const APP_ASSETS = [
  './',
  './index.html',
  './src/app.js',
  './src/capabilities.js',
  './src/storage/db.js',
  './public/models/manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(APP_ASSETS)));
});

self.addEventListener('fetch', (event) => {
  event.respondWith(caches.match(event.request).then((hit) => hit || fetch(event.request)));
});
