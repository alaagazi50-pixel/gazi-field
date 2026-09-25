// Domain constants and pure helpers. Farms, teams and people live in the database (see supabase/).

export const STAGES = [
  { id: 'room', code: 'ROOM', weight: 15 },
  { id: 'main_lines', code: 'MAIN LINES', weight: 20 },
  { id: 'drip', code: 'DRIP', weight: 20 },
  { id: 'sprinklers', code: 'SPRINKLERS', weight: 10 },
  { id: 'electrical', code: 'ELECTRICAL', weight: 15 },
  { id: 'generator', code: 'GENERATOR', weight: 10 },
  { id: 'testing', code: 'TESTING', weight: 10 },
];
export const CATEGORIES = ['access', 'material', 'equipment', 'technical', 'client', 'other'];
export const STEP = 5;               // progress picker step, in %
export const LOCATION_RADIUS_KM = 3; // "location verified" when within this distance of the farm GPS point

// ---------- helpers ----------
export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const pad = n => String(n).padStart(2, '0');
export function dateKey(d = new Date()) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
export function hhmm(ms) { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }
export function shortDate(ms) {
  const d = new Date(ms);
  return `${pad(d.getDate())}${d.toLocaleString('en', { month: 'short' }).toUpperCase()}${String(d.getFullYear()).slice(2)}`;
}
export function niceDate(ms, lang) {
  return new Date(ms).toLocaleDateString(lang === 'ar' ? 'ar' : lang === 'pt' ? 'pt-PT' : 'en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}
export function photoLabel(farmId, stageId, progress, ms) {
  const code = stageId ? STAGES.find(s => s.id === stageId).code : 'ISSUE';
  const p = progress == null ? '' : ` · ${String(progress).padStart(3, '0')}`;
  return `${farmId} · ${code}${p} · ${shortDate(ms)}`;
}
export function farmProgress(farm) {
  let sum = 0, w = 0;
  for (const s of STAGES) { sum += (farm.stages[s.id] || 0) * s.weight; w += s.weight; }
  return Math.round(sum / w);
}
export function farmStatus(farm) {
  const p = farmProgress(farm);
  return p >= 100 ? 'completed' : p > 0 ? 'in_progress' : 'not_started';
}
export function distanceKm(a, b) {
  const R = 6371, rad = x => x * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
