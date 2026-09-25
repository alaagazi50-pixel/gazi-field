// Domain constants, demo seed data and pure helpers.

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

const REGIONS = [
  { prefix: 'HM', name: 'Huambo', count: 24, lat: -12.776, lng: 15.739 },
  { prefix: 'BI', name: 'Bié', count: 18, lat: -12.383, lng: 16.933 },
  { prefix: 'ML', name: 'Malanje', count: 18, lat: -9.545, lng: 16.341 },
];

const TEAMS = [
  { id: 'A', name: 'Team A', todayFarm: 'HM16' },
  { id: 'B', name: 'Team B', todayFarm: 'BI07' },
  { id: 'C', name: 'Team C', todayFarm: 'BI12' },
  { id: 'D', name: 'Team D', todayFarm: 'ML04' },
  { id: 'E', name: 'Team E', todayFarm: 'HM19' },
];

const USERS = [
  { id: 'jamal', name: 'Jamal', role: 'field', teamId: 'A', lang: 'en' },
  { id: 'marcos', name: 'Marcos', role: 'field', teamId: 'A', lang: 'pt' },
  { id: 'paulo', name: 'Paulo', role: 'field', teamId: 'B', lang: 'pt' },
  { id: 'ana', name: 'Ana', role: 'field', teamId: 'C', lang: 'pt' },
  { id: 'karim', name: 'Karim', role: 'field', teamId: 'D', lang: 'ar' },
  { id: 'joao', name: 'João', role: 'field', teamId: 'E', lang: 'pt' },
  { id: 'manager', name: 'GAZI Management', role: 'manager', lang: 'en' },
  { id: 'client', name: 'Client · Angola', role: 'client', lang: 'en' },
];

const BOQ_TEMPLATE = [
  ['Pump room (civil works)', 'm²', 24],
  ['Main line HDPE Ø110', 'm', 1850],
  ['Sub-main HDPE Ø63', 'm', 2400],
  ['Drip line 16 mm', 'm', 38000],
  ['Sprinklers', 'pcs', 120],
  ['Filtration station', 'set', 1],
  ['Pump 15 kW', 'pcs', 1],
  ['Generator 30 kVA', 'pcs', 1],
  ['Electrical panel', 'pcs', 1],
  ['Cable 4×16 mm²', 'm', 160],
];

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

// Deterministic RNG so the demo looks the same on every device.
function rng(seed) { return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296); }
const r5 = x => Math.max(0, Math.min(100, Math.round(x / 5) * 5));

// ---------- seed ----------
export function buildSeed() {
  const rand = rng(60);
  const farms = [];
  for (const reg of REGIONS) {
    for (let i = 1; i <= reg.count; i++) {
      const id = reg.prefix + pad(i);
      farms.push({
        id, region: reg.name,
        gps: { lat: +(reg.lat + (rand() - .5) * .6).toFixed(5), lng: +(reg.lng + (rand() - .5) * .6).toFixed(5) },
        teamId: TEAMS[farms.length % TEAMS.length].id,
        stages: Object.fromEntries(STAGES.map(s => [s.id, 0])),
        boq: BOQ_TEMPLATE.map(([item, unit, qty]) => ({ item, unit, qty })),
        drawingPhotoId: null,
      });
    }
  }
  const byId = Object.fromEntries(farms.map(f => [f.id, f]));
  TEAMS.forEach(t => { byId[t.todayFarm].teamId = t.id; });

  // 18 completed · 23 in progress (incl. every team's farm of the day) · 19 not started
  const todayFarms = new Set(TEAMS.map(t => t.todayFarm));
  const rest = farms.filter(f => !todayFarms.has(f.id)).sort(() => rand() - .5);
  const completed = rest.slice(0, 18), inProgress = rest.slice(18, 36);
  completed.forEach(f => STAGES.forEach(s => { f.stages[s.id] = 100; }));
  [...inProgress, ...TEAMS.map(t => byId[t.todayFarm])].forEach(f => {
    const p = .25 + rand() * .7;
    STAGES.forEach((s, k) => { f.stages[s.id] = r5(100 * (p * 1.7 - k * .17 + (rand() - .5) * .2)); });
  });
  Object.assign(byId.HM16.stages, { room: 70, main_lines: 100, drip: 40, sprinklers: 0, electrical: 35, generator: 20, testing: 0 });

  const now = Date.now(), today = dateKey();
  const ago = min => now - min * 60e3;
  // Demo connectivity timelines: [hoursAgoStart, hoursAgoEnd, 'on'|'off'].
  const conn = (end, spans) => {
    const segments = spans.map(([a, b, s]) => [end - a * 3600e3, end - b * 3600e3, s]);
    const sum = s => segments.filter(x => x[2] === s).reduce((n, x) => n + x[1] - x[0], 0);
    const lastOn = segments.filter(x => x[2] === 'on').pop();
    return { hours: 12, from: end - 12 * 3600e3, to: end, onlineMs: sum('on'), offlineMs: sum('off'),
      unknownMs: 12 * 3600e3 - sum('on') - sum('off'), lastOnline: lastOn ? lastOn[1] : null, samples: 0, segments };
  };
  const reports = [], issues = [];

  const bi07Issue = {
    id: uid(), farmId: 'BI07', stage: 'main_lines', category: 'access', lang: 'pt',
    note: 'Estrada de acesso bloqueada pela chuva. O camião não consegue chegar.',
    photoId: null, reportedBy: 'paulo', teamId: 'B', at: ago(50), status: 'open',
  };
  issues.push(bi07Issue);
  const mkReport = (farmId, teamId, userId, ms, changes, issueId = null, date = today, connectivity = null) => {
    const farm = byId[farmId];
    return {
      id: uid(), farmId, teamId, userId, date, submittedAt: ms, issueId, seeded: true,
      items: STAGES.map(s => {
        const next = changes[s.id];
        const prev = next != null ? Math.max(0, next - 10) : farm.stages[s.id];
        return { stage: s.id, prev, next: next ?? prev, action: next != null ? 'updated' : 'no_change', photoId: null };
      }),
      location: { verified: true, distKm: 0.2 },
      connectivity,
    };
  };
  // Team B: phone had no internet most of the day, only got signal before sending.
  reports.push(mkReport('BI07', 'B', 'paulo', ago(50), {}, bi07Issue.id, today,
    conn(ago(50), [[11, 10.2, 'on'], [9.5, 1.1, 'off'], [0.3, 0, 'on']])));
  reports.push(mkReport('BI12', 'C', 'ana', ago(35), { drip: byId.BI12.stages.drip }, null, today,
    conn(ago(35), [[10, 7, 'on'], [5, 3.5, 'on'], [3.5, 3, 'off'], [1.5, 0, 'on']])));
  reports.push(mkReport('ML04', 'D', 'karim', ago(15), { electrical: byId.ML04.stages.electrical }, null, today,
    conn(ago(15), [[8, 6, 'off'], [2, 0, 'on']])));

  // A little history for HM16
  for (const [daysAgo, ch] of [[3, { room: 60 }], [2, { electrical: 35 }], [1, { room: 70 }]]) {
    const d = new Date(now - daysAgo * 864e5); d.setHours(17, 20 + daysAgo, 0, 0);
    reports.push(mkReport('HM16', 'A', 'jamal', d.getTime(), ch, null, dateKey(d)));
  }

  return {
    version: 1, seededOn: today,
    project: { id: '60farms', name: '60 Farms Project', country: 'Angola' },
    teams: TEAMS, users: USERS, farms, reports, issues, photos: [],
    drafts: {}, followUps: {}, farmOverride: {}, session: null,
  };
}
