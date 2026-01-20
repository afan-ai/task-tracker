const CACHE = 'task-tracker-cache';
const ASSETS = [
  '/', '/index.html', '/css/style.css',
  '/js/app.js', '/js/ui.js', '/js/storage.js',
  '/js/stencil.js', '/js/utils.js', '/js/privacy.js'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
});

self.addEventListener('fetch', e => {
  if (e.request.url.includes('/api/')) return;
  e.respondWith(
    fetch(e.request).then(res => {
      caches.open(CACHE).then(c => c.put(e.request, res.clone()));
      return res;
    }).catch(() => caches.match(e.request))
  );
});
