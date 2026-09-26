// Domain constants and pure helpers. Farms, teams and people live in the database (see supabase/).

// The project's 9 stages, as in the PDAC progress tracking table (same list as gazi_stages() in the database).
// Equal weights: each stage is 1/9 of a farm's progress.
export const STAGES = [
  { id: 'concrete_floor', code: 'FLOOR', weight: 1 },
  { id: 'room_structure', code: 'ROOM', weight: 1 },
  { id: 'excavation', code: 'EXCAVATION', weight: 1 },
  { id: 'room_irrigation', code: 'ROOM IRRIG', weight: 1 },
  { id: 'drip_sprinklers', code: 'DRIP-SPRINK', weight: 1 },
  { id: 'main_line', code: 'MAIN LINE', weight: 1 },
  { id: 'secondary_lines', code: 'SECONDARY', weight: 1 },
  { id: 'electricity', code: 'ELECTRICITY', weight: 1 },
  { id: 'commissioning', code: 'HANDOVER', weight: 1 },
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
  const code = STAGES.find(s => s.id === stageId)?.code || 'ISSUE';
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
