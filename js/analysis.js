// Supervisor: compare teams and workers over a period.
import { t } from './i18n.js';
import { STAGES, dateKey, farmProgress } from './data.js';
import { state, team } from './store.js';
import { esc, topbar, progressBar, farmTitle, timeLabel } from './ui.js';
import { mgrNav } from './manage.js';

let days = 30;
const WEIGHT = Object.fromEntries(STAGES.map(s => [s.id, s.weight]));
const TOTAL_WEIGHT = STAGES.reduce((n, s) => n + s.weight, 0);

// Farm-level % points a report added (stage gains weighted like the farm progress figure).
const gain = r => r.items.reduce((n, i) => n + (i.action === 'updated' ? (i.next - i.prev) * WEIGHT[i.stage] : 0), 0) / TOTAL_WEIGHT;
const minutesOfDay = ms => { const d = new Date(ms); return d.getHours() * 60 + d.getMinutes(); };
const hm = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(Math.round(m % 60)).padStart(2, '0')}`;
const avg = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const pctTxt = x => (x == null ? '—' : `${Math.round(x * 100)}%`);

function workingDays(n) {           // Monday–Saturday, today included
  let count = 0;
  for (let i = 0; i < n; i++) { const d = new Date(Date.now() - i * 864e5); if (d.getDay() !== 0) count++; }
  return count;
}

function stats(reports, issues) {
  const resolved = issues.filter(i => i.status === 'resolved' && i.resolvedAt);
  return {
    reports: reports.length,
    days: new Set(reports.map(r => r.date)).size,
    farms: new Set(reports.map(r => r.farmId)).size,
    gain: reports.reduce((n, r) => n + gain(r), 0),
    photos: reports.reduce((n, r) => n + r.items.filter(i => i.photoId).length, 0),
    problems: issues.length,
    open: issues.filter(i => i.status === 'open').length,
    fixHours: avg(resolved.map(i => (i.resolvedAt - i.at) / 3600e3)),
    time: avg(reports.map(r => minutesOfDay(r.submittedAt))),
    gps: reports.length ? reports.filter(r => r.location?.verified).length / reports.length : null,
    last: reports.reduce((m, r) => Math.max(m, r.submittedAt), 0) || null,
  };
}

export function analysisView() {
  const from = dateKey(new Date(Date.now() - (days - 1) * 864e5));
  const reps = state.reports.filter(r => r.date >= from && !r.pending);
  const issues = state.issues.filter(i => !i.pending && i.at >= Date.now() - days * 864e5);
  const wd = workingDays(days);
  const all = stats(reps, issues);

  const teams = state.teams.map(tm => {
    const s = stats(reps.filter(r => r.teamId === tm.id), issues.filter(i => i.teamId === tm.id));
    return { tm, s, workers: state.users.filter(u => u.role === 'field' && u.active && u.teamId === tm.id).length, rate: s.days / wd };
  }).sort((a, b) => b.rate - a.rate || b.s.gain - a.s.gain);
  const workers = state.users.filter(u => u.role === 'field' && u.active).map(u => ({
    u, s: stats(reps.filter(r => r.userId === u.id), issues.filter(i => i.reportedBy === u.id)),
  })).sort((a, b) => b.s.reports - a.s.reports || b.s.gain - a.s.gain);
  const cats = {};
  issues.forEach(i => { cats[i.category] = (cats[i.category] || 0) + 1; });
  const catMax = Math.max(1, ...Object.values(cats));
  const moved = new Set(reps.filter(r => gain(r) > 0).map(r => r.farmId));
  const stalled = state.farms.filter(f => { const p = farmProgress(f); return f.status !== 'cancelled' && p > 0 && p < 100 && !moved.has(f.id); })
    .sort((a, b) => farmProgress(a) - farmProgress(b));
  const bestGain = Math.max(1, ...teams.map(x => x.s.gain));

  const seg = [7, 30, 90].map(n => `<a href="javascript:void 0" data-days="${n}" class="${n === days ? 'on' : ''}">${n} ${esc(t('days_short'))}</a>`).join('');
  const kpi = (v, label, hot) => `<div class="kpi ${hot ? 'hot' : ''}"><span class="v">${v}</span><span>${esc(label)}</span></div>`;

  return {
    html: `<div class="screen wide">${topbar()}<main class="content">
      ${mgrNav('analysis')}
      <div class="row between"><h1 class="h1">${esc(t('analysis'))}</h1><nav class="segmented">${seg}</nav></div>
      <div class="small muted">${esc(t('analysis_note', { d: wd }))}</div>
      <div class="grid c4">
        ${kpi(all.reports, t('reports_sent'))}
        ${kpi(`+${all.gain.toFixed(1)}`, t('progress_points'))}
        ${kpi(all.problems, t('problems_reported'), all.open > 0)}
        ${kpi(pctTxt(all.gps), t('location_ok_share'))}
      </div>

      <div class="card stack"><div class="eyebrow">${esc(t('compare_teams'))}</div>
        <div class="tbl-wrap"><table class="tbl"><thead><tr>
          <th>${esc(t('team'))}</th><th>${esc(t('days_reported'))}</th><th>${esc(t('progress_added'))}</th><th>${esc(t('photos'))}</th>
          <th>${esc(t('problems'))}</th><th>${esc(t('usual_time'))}</th><th>${esc(t('location_ok_share'))}</th></tr></thead>
        <tbody>${teams.map(({ tm, s, workers: w, rate }) => `<tr>
          <td><strong>${esc(tm.name)}</strong><div class="small muted">${w} ${esc(t('workers_n'))}</div></td>
          <td style="min-width:150px"><div class="small">${s.days} / ${wd} · ${pctTxt(rate)}</div>${progressBar(Math.round(rate * 100))}</td>
          <td style="min-width:120px"><div class="small">+${s.gain.toFixed(1)}</div>${progressBar(Math.round((s.gain / bestGain) * 100))}</td>
          <td class="num">${s.photos}</td>
          <td>${s.problems}${s.open ? ` <span class="tag warn">${s.open} ${esc(t('open'))}</span>` : ''}${s.fixHours != null ? `<div class="small muted">${esc(t('fixed_in', { h: Math.round(s.fixHours) }))}</div>` : ''}</td>
          <td class="num">${s.time != null ? hm(s.time) : '—'}</td>
          <td class="num">${pctTxt(s.gps)}</td></tr>`).join('')}</tbody></table></div></div>

      <div class="card stack"><div class="eyebrow">${esc(t('compare_workers'))}</div>
        <div class="tbl-wrap"><table class="tbl"><thead><tr>
          <th>${esc(t('worker'))}</th><th>${esc(t('reports_sent'))}</th><th>${esc(t('farms'))}</th><th>${esc(t('progress_added'))}</th>
          <th>${esc(t('problems'))}</th><th>${esc(t('usual_time'))}</th><th>${esc(t('location_ok_share'))}</th><th>${esc(t('last_report'))}</th></tr></thead>
        <tbody>${workers.map(({ u, s }) => `<tr>
          <td><strong>${esc(u.name)}</strong><div class="small muted">${u.teamId ? esc(team(u.teamId).name) : ''}</div></td>
          <td class="num">${s.reports}</td><td class="num">${s.farms}</td><td class="num">+${s.gain.toFixed(1)}</td>
          <td class="num">${s.problems}</td><td class="num">${s.time != null ? hm(s.time) : '—'}</td>
          <td class="num">${pctTxt(s.gps)}</td><td class="small">${s.last ? esc(timeLabel(s.last)) : `<span class="tag warn">${esc(t('none_in_period'))}</span>`}</td></tr>`).join('')}</tbody></table></div></div>

      <div class="grid c2 stack">
        <div class="card stack"><div class="eyebrow">${esc(t('problems_by_type'))}</div>
          ${Object.keys(cats).length ? Object.entries(cats).sort((a, b) => b[1] - a[1]).map(([c, n]) => `<div class="stack" style="gap:4px">
            <div class="row between small"><span>${esc(t('cat_' + c))}</span><strong>${n}</strong></div>${progressBar(Math.round((n / catMax) * 100))}</div>`).join('')
            : `<div class="empty">${esc(t('no_issues'))}</div>`}</div>
        <div class="card stack"><div class="eyebrow">${esc(t('stalled_farms'))} · ${stalled.length}</div>
          <div class="small muted">${esc(t('stalled_note'))}</div>
          ${stalled.length ? `<ul class="list">${stalled.slice(0, 12).map(f => `<li><a class="rowlink" href="#/farm/${esc(f.id)}"><span>${esc(farmTitle(f))}</span>
            <span class="r small">${farmProgress(f)}% · ${esc(f.teamId ? team(f.teamId).name : '')}</span></a></li>`).join('')}</ul>` : `<div class="empty">—</div>`}</div>
      </div>
    </main></div>`,
    mount(root) {
      root.querySelectorAll('[data-days]').forEach(a => a.onclick = () => { days = +a.dataset.days; window.dispatchEvent(new Event('rerender')); });
    },
  };
}
