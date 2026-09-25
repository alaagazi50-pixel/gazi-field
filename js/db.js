// Thin IndexedDB wrapper. Schema is shared with sw.js (keep DB_NAME / version in sync).
export const DB_NAME = 'gazi-field';
const DB_VERSION = 2;

// If IndexedDB can't be opened (blocked by an older version open in another tab, private mode,
// sandboxed frame), the app keeps working with an in-memory store for this session instead of hanging.
export let storageLimited = false;
const OPEN_TIMEOUT_MS = 3000;

let dbp;
export function openDB() {
  if (!dbp) {
    dbp = new Promise(resolve => {
      const fallback = () => { storageLimited = true; resolve(null); };
      const timer = setTimeout(fallback, OPEN_TIMEOUT_MS);
      let req;
      try { req = indexedDB.open(DB_NAME, DB_VERSION); } catch { clearTimeout(timer); return fallback(); }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('conn')) db.createObjectStore('conn', { keyPath: 't' });
      };
      req.onsuccess = () => {
        clearTimeout(timer);
        const db = req.result;
        // A newer version opened in another tab: step aside so it isn't blocked.
        db.onversionchange = () => { db.close(); location.reload(); };
        if (storageLimited) { db.close(); return; }   // timed out already; stay on memory for this session
        resolve(db);
      };
      req.onerror = () => { clearTimeout(timer); fallback(); };
    });
  }
  return dbp;
}

// In-memory stand-in with the same operations, used when IndexedDB is unavailable.
const mem = { kv: new Map(), photos: new Map(), conn: new Map() };
const keyOf = (store, val, key) => (store === 'kv' ? key : store === 'photos' ? val.id : val.t);
function memTx(store, fn) {
  const m = mem[store];
  const api = {
    get: k => ({ result: m.get(k) }),
    put: (v, k) => { m.set(keyOf(store, v, k), v); },
    delete: k => {
      if (k && typeof k === 'object' && 'upper' in k) { for (const x of [...m.keys()]) if (x <= k.upper) m.delete(x); }
      else m.delete(k);
    },
    getAll: range => ({ result: [...m.values()].filter(v => !range || keyOf(store, v) >= range.lower) }),
    clear: () => m.clear(),
  };
  const out = fn(api);
  return Promise.resolve(out && 'result' in out ? out.result : out);
}

function tx(store, mode, fn) {
  return openDB().then(db => db === null ? memTx(store, fn) : new Promise((resolve, reject) => {
    const tr = db.transaction(store, mode);
    const st = tr.objectStore(store);
    const out = fn(st);
    tr.oncomplete = () => resolve(out && 'result' in out ? out.result : out);
    tr.onerror = () => reject(tr.error);
  }));
}

const above = v => (typeof IDBKeyRange !== 'undefined' ? IDBKeyRange.lowerBound(v) : { lower: v });
const upTo = v => (typeof IDBKeyRange !== 'undefined' ? IDBKeyRange.upperBound(v) : { upper: v });

export const kvGet = key => tx('kv', 'readonly', s => s.get(key));
export const kvSet = (key, val) => tx('kv', 'readwrite', s => { s.put(val, key); });
export const putPhoto = rec => tx('photos', 'readwrite', s => { s.put(rec); });
export const getPhoto = id => tx('photos', 'readonly', s => s.get(id));
export const kvDel = key => tx('kv', 'readwrite', s => { s.delete(key); });
export const addConnSample = rec => tx('conn', 'readwrite', s => { s.put(rec); });
export const getConnSince = since => tx('conn', 'readonly', s => s.getAll(above(since)));
export const pruneConn = before => tx('conn', 'readwrite', s => { s.delete(upTo(before)); });

export function clearAll() {
  return openDB().then(db => db === null ? Object.values(mem).forEach(m => m.clear()) : new Promise((resolve, reject) => {
    const tr = db.transaction(['kv', 'photos', 'conn'], 'readwrite');
    ['kv', 'photos', 'conn'].forEach(n => tr.objectStore(n).clear());
    tr.oncomplete = resolve;
    tr.onerror = () => reject(tr.error);
  }));
}
