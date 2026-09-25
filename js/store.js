// Data layer: Supabase (auth, database, photo storage) + an offline copy on the phone.
//
// Views read the in-memory `state` synchronously. It is filled from the local cache at start,
// then refreshed from the server. Field reports are queued in an outbox and uploaded when the
// phone has internet; management actions go straight to the server.
import { SUPABASE_URL, SUPABASE_ANON_KEY, USERNAME_DOMAIN, ADMIN_FUNCTION } from './config.js';
import { kvGet, kvSet, kvDel, putPhoto, getPhoto } from './db.js';
import { photoLabel } from './data.js';

export const configured = !!(SUPABASE_URL && SUPABASE_ANON_KEY && window.supabase);
export const sb = configured
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } })
  : null;

const empty = () => ({
  me: null, project: { name: 'GAZI FIELD', country: '' }, teams: [], users: [], farms: [], reports: [], issues: [], photos: [], followUps: {},
  drafts: {}, farmPick: {}, outbox: [], pendingPhotos: [], lastSync: null, syncError: null,
});
export let state = empty();

const rerender = () => window.dispatchEvent(new Event('rerender'));
export const newId = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => (Math.random() * 16 | 0).toString(16)));

// ---------- row mappers (database → shapes the views use) ----------
const ms = v => (v ? new Date(v).getTime() : null);
const mapProfile = p => ({ id: p.id, name: p.full_name, username: p.username, role: p.role === 'worker' ? 'field' : p.role, teamId: p.team_id, lang: p.lang, active: p.active });
const mapFarm = f => ({ id: f.id, region: f.region, gps: { lat: f.lat ?? 0, lng: f.lng ?? 0 }, teamId: f.team_id, stages: f.stages || {}, boq: f.boq || [], drawingPhotoId: f.drawing_photo_id });
const mapReport = r => ({ id: r.id, farmId: r.farm_id, teamId: r.team_id, userId: r.user_id, date: r.date, submittedAt: ms(r.submitted_at), issueId: r.issue_id, items: r.items, location: r.location, connectivity: r.connectivity });
const mapIssue = i => ({ id: i.id, farmId: i.farm_id, stage: i.stage, category: i.category, note: i.note, lang: i.lang, photoId: i.photo_id, reportedBy: i.reported_by, teamId: i.team_id, at: ms(i.at), status: i.status, resolvedAt: ms(i.resolved_at) });
const mapPhoto = p => ({ id: p.id, label: p.label, takenAt: ms(p.taken_at), farmId: p.farm_id, stage: p.stage, progress: p.progress, kind: p.kind, userId: p.user_id, teamId: p.team_id, loc: p.loc, approved: p.approved, path: p.path });
const mapTeam = t => ({ id: t.id, name: t.name, todayFarm: t.today_farm_id });

// ---------- persistence of the local copy ----------
const localKey = () => `local:${state.me?.id}`;
const cacheKey = () => `cache:${state.me?.id}`;
export function save() {
  if (!state.me) return Promise.resolve();
  const { drafts, farmPick, outbox, pendingPhotos } = state;
  return kvSet(localKey(), { drafts, farmPick, outbox, pendingPhotos });
}
function saveCache(server) { return kvSet(cacheKey(), server); }

// Server data + the phone's not-yet-uploaded reports layered on top.
function applyServer(server) {
  Object.assign(state, {
    project: server.project || state.project,
    teams: server.teams.map(mapTeam), users: server.profiles.map(mapProfile), farms: server.farms.map(mapFarm),
    reports: server.reports.map(mapReport), issues: server.issues.map(mapIssue), photos: server.photos.map(mapPhoto),
    followUps: Object.fromEntries(server.followUps.map(f => [`${f.team_id}|${f.date}`, ms(f.at)])),
    lastSync: server.at,
  });
  const me = state.users.find(u => u.id === state.me.id);
  if (me) state.me = me;
  overlayLocal();
}
function overlayLocal() {
  for (const p of state.pendingPhotos) if (!state.photos.some(x => x.id === p.id)) state.photos.push({ ...p, pending: true });
  for (const o of state.outbox) {
    if (state.reports.some(r => r.id === o.id)) continue;
    state.reports.push({ ...o.report, pending: true, error: o.error || null });
    const f = farm(o.report.farmId);
    if (f) o.report.items.forEach(i => { if (i.action === 'updated') f.stages[i.stage] = Math.max(f.stages[i.stage] || 0, i.next); });
  }
}

// ---------- auth ----------
export async function restoreSession() {
  if (!configured) return null;
  const { data } = await sb.auth.getSession();
  if (!data.session) return null;
  const cachedMe = await kvGet('me');
  if (cachedMe && cachedMe.id === data.session.user.id) state.me = cachedMe;
  else {
    const p = await fetchProfile(data.session.user.id);
    if (!p) { await sb.auth.signOut(); return null; }
    state.me = p;
  }
  await loadLocal();
  return state.me;
}

async function fetchProfile(uid) {
  const { data, error } = await sb.from('profiles').select('*').eq('id', uid).maybeSingle();
  if (error) throw error;
  return data && data.active ? mapProfile(data) : null;
}

export async function signIn(identifier, password) {
  const id = identifier.trim().toLowerCase();
  const email = id.includes('@') ? id : `${id}@${USERNAME_DOMAIN}`;
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error('wrong_login');
  const p = await fetchProfile(data.user.id);
  if (!p) { await sb.auth.signOut(); throw new Error('no_access'); }
  state = empty();
  state.me = p;
  await kvSet('me', p);
  await loadLocal();
  await refresh();
  return p;
}

export async function signOut() {
  await sb.auth.signOut().catch(() => {});
  await kvDel('me');
  state = empty();
}

async function loadLocal() {
  const [local, cache] = await Promise.all([kvGet(localKey()), kvGet(cacheKey())]);
  if (local) Object.assign(state, local);
  if (cache) applyServer(cache);
  else overlayLocal();
}

// ---------- refresh from server ----------
let refreshing = null;
export function refresh() {
  if (!configured || !state.me) return Promise.resolve();
  if (!refreshing) refreshing = doRefresh().finally(() => { refreshing = null; });
  return refreshing;
}
async function doRefresh() {
  const role = state.me.role;
  const since = new Date(Date.now() - 120 * 864e5).toISOString().slice(0, 10);
  const q = (p) => p.then(({ data, error }) => { if (error) throw error; return data; });
  const none = Promise.resolve([]);
  try {
    const [project, teams, profiles, farms, photos, reports, issues, followUps] = await Promise.all([
      q(sb.from('project').select('*').maybeSingle()),
      role === 'client' ? none : q(sb.from('teams').select('*').order('id')),
      q(sb.from('profiles').select('*').order('full_name')),
      q(sb.from('farms').select('*').order('id')),
      q(sb.from('photos').select('*').order('taken_at')),
      role === 'client' ? none : q(sb.from('reports').select('*').gte('date', since).order('submitted_at')),
      role === 'client' ? none : q(sb.from('issues').select('*').order('at')),
      role === 'manager' ? q(sb.from('follow_ups').select('*').gte('date', since)) : none,
    ]);
    const me = profiles.find(p => p.id === state.me.id);
    if (me && !me.active) { await signOut(); location.hash = '#/login'; return; }
    const server = { project, teams, profiles, farms, photos, reports, issues, followUps, at: Date.now() };
    applyServer(server);
    state.syncError = null;
    await saveCache(server);
    if (me) await kvSet('me', state.me);
  } catch (e) {
    state.syncError = e.message;
    console.warn('refresh failed', e);
  }
  rerender();
}

// ---------- lookups ----------
export const me = () => state.me;
export const user = id => state.users.find(u => u.id === id) || (state.me?.id === id ? state.me : null);
export const farm = id => state.farms.find(f => f.id === id);
export const team = id => state.teams.find(t => t.id === id) || { id, name: id ? `Team ${id}` : '—' };
export function teamFarms(teamId) { return state.farms.filter(f => f.teamId === teamId); }
export function teamFarm(teamId) {
  const list = teamFarms(teamId);
  const pick = state.farmPick[teamId];
  return list.find(f => f.id === pick) || list.find(f => f.id === team(teamId).todayFarm) || list[0] || null;
}
export const reportFor = (farmId, date) => state.reports.find(r => r.farmId === farmId && r.date === date && !r.error);
export const issue = id => state.issues.find(i => i.id === id);
export const photoMeta = id => state.photos.find(p => p.id === id);
export const pendingCount = () => state.outbox.length;

// ---------- photos ----------
const urlCache = new Map();
export async function photoURL(id) {
  if (urlCache.has(id)) return urlCache.get(id);
  let rec = await getPhoto(id);
  if (!rec) {
    const meta = photoMeta(id);
    if (!meta?.path || !configured) return null;
    const { data, error } = await sb.storage.from('photos').download(meta.path);
    if (error) return null;
    rec = { id, blob: data };
    await putPhoto(rec).catch(() => {});
  }
  const url = URL.createObjectURL(rec.blob);
  urlCache.set(id, url);
  return url;
}

// Resize to ≤1600px, burn the record label into the image, keep it on the phone until uploaded.
export async function savePhoto(file, meta) {
  const bmp = await loadImage(file);
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.drawImage(bmp, 0, 0, w, h);

  const takenAt = Date.now();
  const label = meta.kind === 'drawing' ? `${meta.farmId} · DRAWING` : photoLabel(meta.farmId, meta.stage, meta.progress, takenAt);
  if (meta.kind !== 'drawing') {
    const fs = Math.max(14, Math.round(w / 45));
    g.fillStyle = 'rgba(9,59,53,.82)';
    g.fillRect(0, h - fs * 2, w, fs * 2);
    g.fillStyle = '#fff';
    g.font = `600 ${fs}px "IBM Plex Sans", sans-serif`;
    g.textBaseline = 'middle';
    g.fillText(`${label} · ${new Date(takenAt).toTimeString().slice(0, 5)}`, fs * .7, h - fs);
  }
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', .82));
  const id = newId();
  await putPhoto({ id, blob });
  const rec = {
    id, label, takenAt, farmId: meta.farmId, stage: meta.stage ?? null, progress: meta.progress ?? null, kind: meta.kind,
    userId: state.me.id, teamId: state.me.teamId ?? null, loc: meta.loc ?? null, approved: false, path: `${meta.farmId}/${id}.jpg`,
  };
  state.pendingPhotos.push(rec);
  state.photos.push({ ...rec, pending: true });
  await save();
  return rec;
}

async function uploadPhoto(rec) {
  const stored = await getPhoto(rec.id);
  if (!stored) throw new Error('Photo file missing on this phone');
  const up = await sb.storage.from('photos').upload(rec.path, stored.blob, { contentType: 'image/jpeg', upsert: false });
  if (up.error && !/exists|duplicate/i.test(up.error.message)) throw up.error;
  const { error } = await sb.from('photos').insert({
    id: rec.id, farm_id: rec.farmId, stage: rec.stage === 'drawing' ? null : rec.stage, progress: rec.progress, kind: rec.kind,
    label: rec.label, path: rec.path, taken_at: new Date(rec.takenAt).toISOString(), user_id: rec.userId, team_id: rec.teamId, loc: rec.loc,
  });
  if (error && error.code !== '23505') throw error;
  state.pendingPhotos = state.pendingPhotos.filter(p => p.id !== rec.id);
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

// ---------- field: daily report outbox ----------
export async function queueReport(report, issueDraft) {
  const photoIds = [...report.items.map(i => i.photoId), issueDraft?.photoId].filter(Boolean);
  state.outbox.push({ id: report.id, report, issue: issueDraft, photoIds, queuedAt: Date.now() });
  overlayLocal();
  await save();
  sync();
}

let syncing = false;
export async function sync() {
  if (!configured || !state.me || syncing || !navigator.onLine) return;
  if (!state.outbox.some(o => !o.error) && !state.pendingPhotos.length) return;
  syncing = true;
  try {
    for (const o of [...state.outbox]) {
      if (o.error) continue;
      for (const pid of o.photoIds) {
        const p = state.pendingPhotos.find(x => x.id === pid);
        if (p) { await uploadPhoto(p); await save(); }
      }
      const r = o.report;
      const { error } = await sb.rpc('submit_report', {
        p_id: r.id, p_farm: r.farmId, p_date: r.date, p_items: r.items,
        p_issue: o.issue,
        p_location: r.location, p_connectivity: r.connectivity, p_submitted_at: new Date(r.submittedAt).toISOString(),
      });
      if (error) {
        if (/ALREADY_SUBMITTED|not assigned|Only field workers|Unknown farm/.test(error.message)) {
          o.error = error.message.replace('ALREADY_SUBMITTED: ', '');
          await save();
          continue;
        }
        throw error;
      }
      state.outbox = state.outbox.filter(x => x.id !== o.id);
      await save();
    }
    state.syncError = null;
  } catch (e) {
    state.syncError = e.message;
    console.warn('sync failed', e);
  } finally {
    syncing = false;
  }
  await refresh();
}

export async function dismissFailed(reportId) {
  state.outbox = state.outbox.filter(o => o.id !== reportId);
  state.reports = state.reports.filter(r => r.id !== reportId);
  await save();
  rerender();
}

// ---------- management actions (need a connection) ----------
async function run(p) {
  if (!navigator.onLine) throw new Error('needs_connection');
  const { error } = await p;
  if (error) throw error;
}
export const setPhotoApproved = (id, approved) => run(sb.from('photos').update({ approved }).eq('id', id)).then(() => { photoMeta(id).approved = approved; });
export const resolveIssue = id => run(sb.from('issues').update({ status: 'resolved', resolved_at: new Date().toISOString() }).eq('id', id)).then(refresh);
export const markFollowUp = (teamId, date) => run(sb.from('follow_ups').upsert({ team_id: teamId, date, by: state.me.id })).then(refresh);
export const saveBoq = (farmId, boq) => run(sb.from('farms').update({ boq, updated_at: new Date().toISOString() }).eq('id', farmId)).then(refresh);
export const saveStages = (farmId, stages) => run(sb.from('farms').update({ stages, updated_at: new Date().toISOString() }).eq('id', farmId)).then(refresh);
export const setFarmTeam = (farmId, teamId) => run(sb.from('farms').update({ team_id: teamId || null }).eq('id', farmId)).then(refresh);
export const setTodayFarm = (teamId, farmId) => run(sb.from('teams').update({ today_farm_id: farmId || null }).eq('id', teamId)).then(refresh);
export const addTeam = (id, name) => run(sb.from('teams').insert({ id, name })).then(refresh);
export const updateProfile = (id, patch) => run(sb.from('profiles').update(patch).eq('id', id)).then(refresh);
export async function setDrawing(farmId, file) {
  if (!navigator.onLine) throw new Error('needs_connection');
  const rec = await savePhoto(file, { farmId, kind: 'drawing' });
  await uploadPhoto(rec);
  await save();
  await run(sb.from('farms').update({ drawing_photo_id: rec.id }).eq('id', farmId));
  await refresh();
}
export async function adminUsers(body) {
  if (!navigator.onLine) throw new Error('needs_connection');
  const { data, error } = await sb.functions.invoke(ADMIN_FUNCTION || 'admin-users', { body });
  if (error) {
    let msg = error.message;
    try { msg = (await error.context.json()).error || msg; } catch { /* keep generic message */ }
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  await refresh();
  return data;
}
