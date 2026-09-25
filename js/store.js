// App state: one JSON document in IndexedDB ("kv/state") + photo blobs in their own store.
import { kvGet, kvSet, putPhoto, getPhoto, clearAll } from './db.js';
import { buildSeed, uid, photoLabel } from './data.js';

export let state;

export async function loadState() {
  state = await kvGet('state');
  if (!state) { state = buildSeed(); await save(); }
  return state;
}
export const save = () => kvSet('state', state);

export async function resetAll() {
  await clearAll();
  urlCache.clear();
  state = buildSeed();
  await save();
}

// ---------- lookups ----------
export const user = id => state.users.find(u => u.id === id);
export const me = () => state.session && user(state.session.userId);
export const farm = id => state.farms.find(f => f.id === id);
export const team = id => state.teams.find(t => t.id === id);
export const teamFarm = teamId => farm(state.farmOverride[teamId] || team(teamId).todayFarm);
export const reportFor = (farmId, date) => state.reports.find(r => r.farmId === farmId && r.date === date);
export const issue = id => state.issues.find(i => i.id === id);
export const photoMeta = id => state.photos.find(p => p.id === id);

// ---------- photos ----------
const urlCache = new Map();
export async function photoURL(id) {
  if (urlCache.has(id)) return urlCache.get(id);
  const rec = await getPhoto(id);
  if (!rec) return null;
  const url = URL.createObjectURL(rec.blob);
  urlCache.set(id, url);
  return url;
}

// Resize to ≤1600px, burn the record label into the image and store it with its metadata.
export async function savePhoto(file, meta) {
  const bmp = await loadImage(file);
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.drawImage(bmp, 0, 0, w, h);

  const takenAt = Date.now();
  const label = meta.stage === 'drawing' ? `${meta.farmId} · DRAWING` : photoLabel(meta.farmId, meta.stage, meta.progress, takenAt);
  if (meta.stamp !== false) {
    const fs = Math.max(14, Math.round(w / 45));
    const who = meta.userName ? ` · ${meta.userName}` : '';
    const text = `${label} · ${new Date(takenAt).toTimeString().slice(0, 5)}${who}`;
    g.fillStyle = 'rgba(9,59,53,.82)';
    g.fillRect(0, h - fs * 2, w, fs * 2);
    g.fillStyle = '#fff';
    g.font = `600 ${fs}px "IBM Plex Sans", sans-serif`;
    g.textBaseline = 'middle';
    g.fillText(text, fs * .7, h - fs);
  }
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', .82));
  const id = uid();
  await putPhoto({ id, blob });
  const rec = {
    id, label, takenAt, farmId: meta.farmId, stage: meta.stage ?? null, progress: meta.progress ?? null,
    kind: meta.kind, userId: meta.userId ?? null, teamId: meta.teamId ?? null, loc: meta.loc ?? null, approved: false,
  };
  state.photos.push(rec);
  await save();
  return rec;
}

function loadImage(file) {
  if ('createImageBitmap' in window) return createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => viaImg(file));
  return viaImg(file);
}
function viaImg(file) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = URL.createObjectURL(file);
  });
}
