// Service worker: offline app shell + background connectivity probes.
const CACHE = 'gazi-field-v0.1.0';
const SHELL = [
  './', './index.html', './manifest.webmanifest', './css/app.css',
  './js/app.js', './js/i18n.js', './js/db.js', './js/data.js', './js/store.js', './js/ui.js',
  './js/connectivity.js', './js/field.js', './js/farm.js', './js/manage.js', './js/client.js',
  './assets/logo.jpg', './assets/icon-192.png', './assets/icon-512.png', './assets/icon-maskable.png', './assets/apple-touch-icon.png',
];
const PROBE_URL = 'https://www.gstatic.com/generate_204';

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('gazi-field-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // Never answer the connectivity probe from cache.
  if (url.href.startsWith(PROBE_URL) || url.searchParams.has('probe')) return;

  if (url.origin === location.origin) {
    // Network first so updates land quickly; cache when offline.
    e.respondWith(fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('./index.html'))));
  } else if (url.host === 'fonts.googleapis.com' || url.host === 'fonts.gstatic.com') {
    e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return res;
    })));
  }
});

// ----- connectivity samples while the app is closed (where Periodic Background Sync is available) -----
function saveSample(rec) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('gazi-field', 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      ['kv'].forEach(n => db.objectStoreNames.contains(n) || db.createObjectStore(n));
      if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('conn')) db.createObjectStore('conn', { keyPath: 't' });
    };
    req.onsuccess = () => {
      const tr = req.result.transaction('conn', 'readwrite');
      tr.objectStore('conn').put(rec);
      tr.oncomplete = resolve;
      tr.onerror = () => reject(tr.error);
    };
    req.onerror = () => reject(req.error);
  });
}
async function probeAndSave(src) {
  let online = false;
  const local = ['localhost', '127.0.0.1'].includes(location.hostname);
  const url = local ? PROBE_URL : new URL('assets/probe.txt', self.registration.scope).href;
  try { await fetch(`${url}?probe=${Date.now()}`, { mode: local ? 'no-cors' : 'same-origin', cache: 'no-store' }); online = true; } catch { /* offline */ }
  await saveSample({ t: Date.now(), online, src });
}
self.addEventListener('periodicsync', e => { if (e.tag === 'conn-check') e.waitUntil(probeAndSave('sw-periodic')); });
self.addEventListener('sync', e => { e.waitUntil(probeAndSave('sw-sync')); });
