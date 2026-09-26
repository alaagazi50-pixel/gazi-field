// Service worker: offline app shell, push reminders, automatic upload of reports queued offline,
// and background connectivity probes.
const CACHE = 'gazi-field-v0.4.0';
const SHELL = [
  './', './index.html', './manifest.webmanifest', './css/app.css',
  './js/app.js', './js/i18n.js', './js/db.js', './js/data.js', './js/store.js', './js/ui.js',
  './js/connectivity.js', './js/field.js', './js/farm.js', './js/manage.js', './js/client.js', './js/analysis.js',
  './js/config.js', './js/people.js', './js/vendor/supabase.js',
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

// ----- push reminders -----
self.addEventListener('push', e => {
  let msg = { title: 'GAZI FIELD', body: '', url: './', tag: 'gazi' };
  try { msg = { ...msg, ...e.data.json() }; } catch { if (e.data) msg.body = e.data.text(); }
  e.waitUntil(self.registration.showNotification(msg.title, {
    body: msg.body, tag: msg.tag, renotify: true, icon: 'assets/icon-192.png', badge: 'assets/icon-192.png', data: { url: msg.url },
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const open = list.find(c => c.url.startsWith(self.registration.scope));
    return open ? open.focus() : self.clients.openWindow(new URL(e.notification.data?.url || './', self.registration.scope).href);
  }));
});

// ----- local database (same schema as js/db.js) -----
function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('gazi-field', 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('conn')) db.createObjectStore('conn', { keyPath: 't' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function dbOp(store, mode, fn) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tr = db.transaction(store, mode);
    const r = fn(tr.objectStore(store));
    tr.oncomplete = () => { db.close(); resolve(r && 'result' in r ? r.result : undefined); };
    tr.onerror = () => { db.close(); reject(tr.error); };
  });
}
const kvGet = k => dbOp('kv', 'readonly', s => s.get(k));
const kvSet = (k, v) => dbOp('kv', 'readwrite', s => { s.put(v, k); });
const photoGet = id => dbOp('photos', 'readonly', s => s.get(id));

// ----- upload reports queued offline, even when the app is closed -----
// The open app does this itself; the worker only acts when no window of the app is open.
async function uploadQueued() {
  const windows = await self.clients.matchAll({ type: 'window' });
  if (windows.length) { windows.forEach(c => c.postMessage('gazi-sync')); return; }

  const [cfg, me] = await Promise.all([kvGet('cfg'), kvGet('me')]);
  if (!cfg || !me) return;
  const localKey = `local:${me.id}`;
  const local = await kvGet(localKey);
  if (!local?.outbox?.some(o => !o.error)) return;

  const ref = new URL(cfg.url).hostname.split('.')[0];
  const authKey = `auth:sb-${ref}-auth-token`;
  let session = JSON.parse((await kvGet(authKey)) || 'null');
  if (!session?.refresh_token) return;
  if (!session.expires_at || session.expires_at * 1000 < Date.now() + 60e3) {
    const res = await fetch(`${cfg.url}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST', headers: { apikey: cfg.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: session.refresh_token }),
    });
    if (!res.ok) throw new Error(`login refresh failed: ${res.status}`);
    session = await res.json();
    if (!session.expires_at && session.expires_in) session.expires_at = Math.floor(Date.now() / 1000) + session.expires_in;
    await kvSet(authKey, JSON.stringify(session));
  }
  const H = { apikey: cfg.key, Authorization: `Bearer ${session.access_token}` };
  const sent = [];

  for (const o of local.outbox) {
    if (o.error) continue;
    for (const pid of o.photoIds || []) {
      const p = (local.pendingPhotos || []).find(x => x.id === pid);
      if (!p) continue;
      const stored = await photoGet(p.id);
      if (!stored) throw new Error('photo missing on phone');
      const up = await fetch(`${cfg.url}/storage/v1/object/photos/${p.path}`, { method: 'POST', headers: { ...H, 'Content-Type': 'image/jpeg' }, body: stored.blob });
      if (!up.ok && !/exist|duplicate/i.test(await up.text())) throw new Error(`photo upload ${up.status}`);
      const row = await fetch(`${cfg.url}/rest/v1/photos`, {
        method: 'POST', headers: { ...H, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ id: p.id, farm_id: p.farmId, stage: p.stage, progress: p.progress, kind: p.kind, label: p.label, path: p.path,
          taken_at: new Date(p.takenAt).toISOString(), user_id: p.userId, team_id: p.teamId, loc: p.loc }),
      });
      if (!row.ok && row.status !== 409) throw new Error(`photo record ${row.status}`);
      local.pendingPhotos = local.pendingPhotos.filter(x => x.id !== p.id);
      await kvSet(localKey, local);
    }
    const r = o.report;
    const issues = o.issues || (o.issue ? [o.issue] : []);
    const res = await fetch(`${cfg.url}/rest/v1/rpc/submit_report`, {
      method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_id: r.id, p_farm: r.farmId, p_date: r.date, p_items: r.items, p_issues: issues.length ? issues : null,
        p_location: r.location, p_connectivity: r.connectivity, p_submitted_at: new Date(r.submittedAt).toISOString() }),
    });
    if (!res.ok) {
      const text = await res.text();
      if (/ALREADY_SUBMITTED|Only field workers|Unknown farm/.test(text)) {
        o.error = (JSON.parse(text).message || text).replace('ALREADY_SUBMITTED: ', '');
        await kvSet(localKey, local);
        continue;
      }
      throw new Error(`report ${res.status}`);
    }
    local.outbox = local.outbox.filter(x => x.id !== o.id);
    await kvSet(localKey, local);
    sent.push(r.farmId);
  }
  if (sent.length && self.Notification?.permission === 'granted') {
    await self.registration.showNotification('GAZI FIELD', { body: `✓ ${sent.join(', ')}`, tag: 'gazi-uploaded', icon: 'assets/icon-192.png' });
  }
}

// ----- connectivity samples while the app is closed (where Periodic Background Sync is available) -----
async function probeAndSave(src) {
  let online = false;
  const local = ['localhost', '127.0.0.1'].includes(location.hostname);
  const url = local ? PROBE_URL : new URL('assets/probe.txt', self.registration.scope).href;
  try { await fetch(`${url}?probe=${Date.now()}`, { mode: local ? 'no-cors' : 'same-origin', cache: 'no-store' }); online = true; } catch { /* offline */ }
  await dbOp('conn', 'readwrite', s => { s.put({ t: Date.now(), online, src }); });
}
self.addEventListener('periodicsync', e => { if (e.tag === 'conn-check') e.waitUntil(probeAndSave('sw-periodic')); });
self.addEventListener('sync', e => {
  if (e.tag === 'gazi-upload') e.waitUntil(probeAndSave('sw-sync').then(uploadQueued));   // a failure makes the browser retry later
  else e.waitUntil(probeAndSave('sw-sync'));
});
