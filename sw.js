const CACHE       = 'dror-v8';
const AUDIO_CACHE = 'dror-audio-v1';   // שמור לנצח — לא נמחק בעדכון
const SHELL = ['/', '/index.html', '/styles.css', '/app.js', '/dror-logo.png'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      // מחק גרסאות ישנות — אבל שמור את cache האודיו
      Promise.all(keys
        .filter(k => k !== CACHE && k !== AUDIO_CACHE)
        .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = e.request.url;

  // External services — always network (Apps Script, Google Drive audio/PDF)
  if (url.includes('script.google.com') || url.includes('drive.google.com') || url.includes('docs.google.com')) return;

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
