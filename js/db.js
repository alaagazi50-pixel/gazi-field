// Thin IndexedDB wrapper. Schema is shared with sw.js (keep DB_NAME / version in sync).
export const DB_NAME = 'gazi-field';
const DB_VERSION = 1;

let dbp;
export function openDB() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
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
  return dbp;
}

function tx(store, mode, fn) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tr = db.transaction(store, mode);
    const st = tr.objectStore(store);
    const out = fn(st);
    tr.oncomplete = () => resolve(out && 'result' in out ? out.result : out);
    tr.onerror = () => reject(tr.error);
  }));
}

export const kvGet = key => tx('kv', 'readonly', s => s.get(key));
export const kvSet = (key, val) => tx('kv', 'readwrite', s => { s.put(val, key); });
export const putPhoto = rec => tx('photos', 'readwrite', s => { s.put(rec); });
export const getPhoto = id => tx('photos', 'readonly', s => s.get(id));
export const addConnSample = rec => tx('conn', 'readwrite', s => { s.put(rec); });
export const getConnSince = since => tx('conn', 'readonly', s => s.getAll(IDBKeyRange.lowerBound(since)));
export const pruneConn = before => tx('conn', 'readwrite', s => { s.delete(IDBKeyRange.upperBound(before)); });

export function clearAll() {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tr = db.transaction(['kv', 'photos', 'conn'], 'readwrite');
    ['kv', 'photos', 'conn'].forEach(n => tr.objectStore(n).clear());
    tr.oncomplete = resolve;
    tr.onerror = () => reject(tr.error);
  }));
}
