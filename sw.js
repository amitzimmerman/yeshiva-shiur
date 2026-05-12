const CACHE       = 'dror-v2';
const AUDIO_CACHE = 'dror-audio-v1';
const SHELL = ['/', '/index.html', '/styles.css', '/app.js', '/data.json', '/dror-logo.png'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE && k !== AUDIO_CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = e.request.url;

  // Apps Script API — always network
  if (url.includes('script.google.com')) return;

  // Google Drive audio — cache after first play for offline use
  if (url.includes('drive.google.com/uc')) {
    e.respondWith(
      caches.open(AUDIO_CACHE).then(async cache => {
        const cached = await cache.match(e.request);
        if (cached) return cached;
        try {
          const res = await fetch(e.request);
          if (res.ok || res.type === 'opaque') cache.put(e.request, res.clone());
          return res;
        } catch {
          return cached || new Response('offline', { status: 503 });
        }
      })
    );
    return;
  }

  // App shell — cache first, network fallback
  e.respondWith(
    caches.match(e.request).then(cached => {
      const net = fetch(e.request).then(res => {
        if (res.ok) caches.open(CACHE).then(c => c.put(e.request, res.clone()));
        return res;
      }).catch(() => cached);
      return cached || net;
    })
  );
});
