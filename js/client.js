// Client portal: same data, only approved photos, no internal notes, names or issues.
import { t } from './i18n.js';
import { STAGES, farmProgress, completion, byFarmCode, byRegion } from './data.js';
import { state, me, farm, isMgr } from './store.js';
import { esc, stageName, topbar, progressBar, hydratePhotos, photoImg, videoEl, farmTitle } from './ui.js';
import { mgrNav } from './manage.js';

const TAG = {
  completed: ['ok', 'completed'], no_power: ['blue', 'done_no_power'], in_progress: ['amber', 'in_progress'],
  not_started: ['', 'not_started'], cancelled: ['', 'cancelled'],
};
const tagFor = st => `<span class="tag ${TAG[st][0]}">${st === 'completed' ? '✓ ' : st === 'no_power' ? '⚡ ' : ''}${esc(t(TAG[st][1]))}</span>`;
const count = (list, st) => list.filter(f => completion(f) === st).length;
const avgOf = list => list.length ? Math.round(list.reduce((n, f) => n + farmProgress(f), 0) / list.length) : 0;

export function clientView() {
  const all = [...state.farms].sort(byFarmCode);
  const live = all.filter(f => f.status !== 'cancelled');
  const regions = [...new Set(all.map(f => f.region || '—'))].sort(byRegion);
  const kpi = (v, label, cls = '') => `<div class="kpi center ${cls}" style="background:#fff"><span class="v">${v}</span><span>${esc(label)}</span></div>`;
  const chips = st => live.filter(f => completion(f) === st)
    .map(f => `<a class="farmchip ${st}" href="#/client/farm/${esc(f.id)}">${st === 'completed' ? '✓' : '⚡'} ${esc(farmTitle(f))}</a>`).join('');

  const regionRows = regions.map(r => {
    const fs = live.filter(f => (f.region || '—') === r);
    return `<tr><td><strong>${esc(r)}</strong></td><td class="num">${fs.length}</td>
      <td class="num"><strong>${count(fs, 'completed')}</strong></td><td class="num"><strong>${count(fs, 'no_power')}</strong></td>
      <td class="num">${count(fs, 'in_progress')}</td><td class="num">${count(fs, 'not_started')}</td><td class="num">${avgOf(fs)}%</td></tr>`;
  }).join('') + `<tr class="total"><td><strong>${esc(t('total'))}</strong></td><td class="num">${live.length}</td>
      <td class="num"><strong>${count(live, 'completed')}</strong></td><td class="num"><strong>${count(live, 'no_power')}</strong></td>
      <td class="num">${count(live, 'in_progress')}</td><td class="num">${count(live, 'not_started')}</td><td class="num">${avgOf(live)}%</td></tr>`;

  const card = f => {
    const st = completion(f), p = farmProgress(f);
    const approved = state.photos.filter(ph => ph.farmId === f.id && ph.approved).length;
    return `<a class="card flat stack farmcard ${st}" href="#/client/farm/${esc(f.id)}" style="text-decoration:none;color:inherit;gap:8px">
      <strong class="fname">${esc(farmTitle(f))}</strong>
      <div class="pline">${st === 'cancelled' ? '' : `${progressBar(p)}<span class="strong">${p}%</span>`}</div>
      <div class="row between">${tagFor(st)}${approved ? `<span class="small muted">${approved} ${esc(t('photos'))}</span>` : ''}</div></a>`;
  };
  const regionBlock = r => {
    const fs = all.filter(f => (f.region || '—') === r), lv = fs.filter(f => f.status !== 'cancelled');
    return `<section class="stack">
      <div class="row between"><h2 class="h2">${esc(r)} <span class="muted small">· ${lv.length} ${esc(t('farms').toLowerCase())}</span></h2>
        <span class="row small"><span class="tag ok">✓ ${count(lv, 'completed')} ${esc(t('completed'))}</span><span class="tag blue">⚡ ${count(lv, 'no_power')} ${esc(t('done_no_power'))}</span><span class="tag">${avgOf(lv)}%</span></span></div>
      <div class="farmgrid">${fs.map(card).join('')}</div></section>`;
  };

  return {
    html: `<div class="screen wide">${topbar()}<main class="content">
      ${isMgr(me()) ? mgrNav('client') : ''}
      <div class="eyebrow">${esc(t('client_portal'))} · ${esc(state.project.name.toUpperCase())} · ${esc(state.project.country.toUpperCase())}</div>
      <div class="grid c4">
        ${kpi(avgOf(live) + '%', t('project_progress'))}
        ${kpi(count(live, 'completed'), t('completed'), 'done')}
        ${kpi(count(live, 'no_power'), t('done_no_power'), 'nopower')}
        ${kpi(count(live, 'in_progress'), t('in_progress'))}
      </div>
      ${count(live, 'completed') + count(live, 'no_power') ? `<div class="card flat stack">
        ${count(live, 'completed') ? `<div class="eyebrow">✓ ${esc(t('completed'))}</div><div>${chips('completed')}</div>` : ''}
        ${count(live, 'no_power') ? `<div class="eyebrow">⚡ ${esc(t('done_no_power'))}</div><div>${chips('no_power')}</div>` : ''}</div>` : ''}
      <div class="card stack"><h2 class="h3">${esc(t('by_region'))}</h2><div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>${esc(t('region'))}</th><th class="num">${esc(t('farms'))}</th><th class="num">${esc(t('completed'))}</th><th class="num">${esc(t('done_no_power'))}</th>
          <th class="num">${esc(t('in_progress'))}</th><th class="num">${esc(t('not_started'))}</th><th class="num">${esc(t('progress'))}</th></tr></thead>
        <tbody>${regionRows}</tbody></table></div>
        <div class="small muted">${esc(t('no_power_hint'))}</div></div>
      ${regions.map(regionBlock).join('')}
      <div class="small muted">${esc(t('only_approved'))}</div>
    </main></div>`,
  };
}

export function clientFarmView({ farmId }) {
  const f = farm(farmId);
  const p = farmProgress(f);
  const photos = state.photos.filter(ph => ph.farmId === f.id && ph.approved).sort((a, b) => b.takenAt - a.takenAt);
  const dates = f.details?.stage_dates || {};
  const stageRows = STAGES.map(st => {
    const v = f.stages[st.id] || 0, dt = dates[st.id];
    const when = dt ? (dt.status === 'ready' ? t('done_on', { d: dt.date }) : t('since', { d: dt.date })) : '';
    return `<div class="stage-row"><span>${esc(stageName(st.id))}${when ? `<br><span class="small muted">${esc(when)}</span>` : ''}</span>
      <span>${progressBar(v)}</span>
      <span class="tag ${v >= 100 ? 'ok' : v > 0 ? 'amber' : ''}">${v >= 100 ? esc(t('ready')) : v > 0 ? `${v}%` : esc(t('not_started'))}</span></div>`;
  }).join('');
  return {
    html: `<div class="screen wide">${topbar({ back: '#/client' })}<main class="content">
      <div class="eyebrow">${esc(t('client_portal'))}</div>
      <h1 class="h1">${esc(farmTitle(f))}</h1>
      <div class="stack" style="gap:6px"><div class="row"><span class="strong">${p}% ${esc(t('in_progress'))}</span>${tagFor(completion(f))}</div>${progressBar(p)}</div>
      <div class="card flat stack"><div class="eyebrow">${esc(t('stage_status'))}</div><div>${stageRows}</div></div>
      ${photos.length ? `<div class="photos" style="grid-template-columns:repeat(auto-fill,minmax(220px,1fr))">${photos.map(ph => `<div class="ph">
        ${ph.kind === 'video' ? videoEl(ph.id) : `<button class="imgbtn" data-zoom="${ph.id}">${photoImg(ph.id)}</button>`}
        <div>${esc(stageName(ph.stage))}${ph.progress != null ? ` · ${ph.progress}%` : ''} · ${esc(t('approved'))}</div></div>`).join('')}</div>`
        : `<div class="empty">${esc(t('no_photos'))}</div>`}
    </main></div>`,
    async mount(root) { await hydratePhotos(root); },
  };
}
