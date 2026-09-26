// Phone connectivity log.
//
// We don't trust navigator.onLine alone (it is "true" on Wi-Fi/mobile data with no real internet),
// so each sample makes a real network request to PROBE_URL. Samples are stored in IndexedDB
// (store "conn") by the page while it's open and, where the browser allows it, by the service
// worker through Periodic Background Sync. Time the phone wasn't observed is reported as unknown,
// never as offline.

import { addConnSample, getConnSince, pruneConn } from './db.js';

// When hosted (https), reaching our own server proves the phone has internet. On localhost that
// proves nothing, so probe Google's no-content endpoint instead.
const LOCAL = ['localhost', '127.0.0.1', ''].includes(location.hostname);
export const PROBE_URL = LOCAL ? 'https://www.gstatic.com/generate_204' : new URL('assets/probe.txt', location.href).href;
export const WINDOW_HOURS = 12;       // window attached to each daily report
const SAMPLE_EVERY_MS = 3 * 60e3;     // while the app is open
const HOLD_MS = 6 * 60e3;             // how long one sample is assumed to stay valid
const KEEP_MS = 72 * 3600e3;

export async function probe() {
  if (!navigator.onLine) return false;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 6000);
  try {
    await fetch(`${PROBE_URL}?probe=${Date.now()}`, { mode: LOCAL ? 'no-cors' : 'same-origin', cache: 'no-store', signal: ctl.signal });
    return true;
  } catch { return false; }
  finally { clearTimeout(timer); }
}

let listeners = [];
let sampleListeners = [];
let lastState = null;
export const onConnChange = fn => listeners.push(fn);
export const onSample = fn => sampleListeners.push(fn);   // after every check is saved
export const currentConn = () => lastState;

export async function sample(src = 'app') {
  const online = await probe();
  await addConnSample({ t: Date.now(), online, src });
  sampleListeners.forEach(fn => fn(online));
  if (online !== lastState) { lastState = online; listeners.forEach(fn => fn(online)); }
  return online;
}

export function startConnectivityMonitor() {
  sample('start');
  setInterval(() => { if (document.visibilityState === 'visible') sample('app'); }, SAMPLE_EVERY_MS);
  window.addEventListener('online', () => sample('event'));
  window.addEventListener('offline', () => sample('event'));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') sample('resume'); });
  pruneConn(Date.now() - KEEP_MS).catch(() => {});
  registerPeriodicCheck();
}

// Best effort: lets the service worker probe while the app is closed (installed PWA on Android/Chrome).
async function registerPeriodicCheck() {
  try {
    const reg = await navigator.serviceWorker?.ready;
    if (!reg || !('periodicSync' in reg)) return;
    const perm = await navigator.permissions.query({ name: 'periodic-background-sync' });
    if (perm.state === 'granted') await reg.periodicSync.register('conn-check', { minInterval: 60 * 60e3 });
  } catch { /* unsupported */ }
}

// Turn raw samples into a compact summary that travels with the daily report.
export async function connectivitySummary(hours = WINDOW_HOURS, now = Date.now()) {
  const samples = await getConnSince(now - hours * 3600e3 - HOLD_MS);
  return summarize(samples, hours, now);
}

// samples: [{ t: epoch ms, online: bool }]. Time between checks further apart than HOLD_MS is "not observed".
export function summarize(samples, hours = WINDOW_HOURS, now = Date.now()) {
  const from = now - hours * 3600e3;
  samples = [...samples].sort((a, b) => a.t - b.t);
  const segs = [];
  const push = (a, b, state) => {
    a = Math.max(a, from); b = Math.min(b, now);
    if (b <= a) return;
    const last = segs[segs.length - 1];
    if (last && last.state === state && last.to >= a) last.to = b;
    else segs.push({ from: a, to: b, state });
  };
  samples.forEach((s, i) => {
    const next = samples[i + 1];
    const end = Math.min(next ? next.t : now, s.t + HOLD_MS);
    push(s.t, end, s.online ? 'on' : 'off');
  });
  let onlineMs = 0, offlineMs = 0;
  segs.forEach(s => { if (s.state === 'on') onlineMs += s.to - s.from; else offlineMs += s.to - s.from; });
  const lastOnline = [...samples].reverse().find(s => s.online)?.t ?? null;
  return {
    hours, from, to: now, onlineMs, offlineMs,
    unknownMs: now - from - onlineMs - offlineMs,
    lastOnline: lastOnline && lastOnline >= from ? lastOnline : null,
    samples: samples.filter(s => s.t >= from).length,
    segments: segs.map(s => [s.from, s.to, s.state]),
  };
}
