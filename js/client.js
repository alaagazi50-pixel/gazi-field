// Client portal: same data, only approved photos, no internal notes, names or issues.
import { t } from './i18n.js';
import { STAGES, farmProgress, farmStatus } from './data.js';
import { state, me, farm, isMgr } from './store.js';
import { esc, stageName, topbar, progressBar, hydratePhotos, photoImg, farmTitle } from './ui.js';
import { mgrNav } from './manage.js';

export function clientView() {
  const farms = state.farms.filter(f => f.status !== 'cancelled');
  const avg = Math.round(farms.reduce((s, f) => s + farmProgress(f), 0) / farms.length);
  const done = farms.filter(f => farmStatus(f) === 'completed').length;
  const inProg = farms.filter(f => farmStatus(f) === 'in_progress').sort((a, b) => farmProgress(b) - farmProgress(a));
  const card = f => {
    const p = farmProgress(f);
    const approved = state.photos.filter(ph => ph.farmId === f.id && ph.approved).length;
    return `<a class="card flat stack" href="#/client/farm/${f.id}" style="text-decoration:none;color:inherit">
      <div class="row between"><strong>${esc(farmTitle(f))}</strong><span class="small muted">${esc(f.region)}</span><span>${p}%</span></div>${progressBar(p)}
      ${approved ? `<span class="small muted">${approved} ${esc(t('photos_n'))}</span>` : ''}</a>`;
  };
  return {
    html: `<div class="screen wide">${topbar()}<main class="content">
      ${isMgr(me()) ? mgrNav('client') : ''}
      <div class="eyebrow">${esc(t('client_portal'))} · ${esc(state.project.name.toUpperCase())} · ${esc(state.project.country.toUpperCase())}</div>
      <div class="grid c3">
        <div class="kpi" style="background:#fff"><span class="v">${avg}%</span><span>${esc(t('project_progress'))}</span></div>
        <div class="kpi" style="background:#fff"><span class="v">${done}</span><span>${esc(t('completed'))}</span></div>
        <div class="kpi" style="background:#fff"><span class="v">${inProg.length}</span><span>${esc(t('in_progress'))}</span></div>
      </div>
      <div class="eyebrow">${esc(t('in_progress'))}</div>
      <div class="grid c3">${inProg.map(card).join('')}</div>
      <div class="small muted">${esc(t('only_approved'))}</div>
    </main></div>`,
  };
}

export function clientFarmView({ farmId }) {
  const f = farm(farmId);
  const p = farmProgress(f);
  const photos = state.photos.filter(ph => ph.farmId === f.id && ph.approved).sort((a, b) => b.takenAt - a.takenAt);
  const started = STAGES.filter(s => f.stages[s.id] > 0).map(s => `${stageName(s.id)} ${f.stages[s.id]}%`).join(' · ');
  return {
    html: `<div class="screen wide">${topbar({ back: '#/client' })}<main class="content">
      <div class="eyebrow">${esc(t('client_portal'))}</div>
      <h1 class="h1">${esc(farmTitle(f))}</h1><div class="strong">${p}% ${esc(t('in_progress'))}</div>
      <div>${esc(started)}</div>
      ${progressBar(p)}
      ${photos.length ? `<div class="photos" style="grid-template-columns:repeat(auto-fill,minmax(220px,1fr))">${photos.map(ph => `<div class="ph">
        <button class="imgbtn" data-zoom="${ph.id}">${photoImg(ph.id)}</button>
        <div>${esc(stageName(ph.stage))}${ph.progress != null ? ` · ${ph.progress}%` : ''} · ${esc(t('approved'))}</div></div>`).join('')}</div>`
        : `<div class="empty">${esc(t('no_photos'))}</div>`}
    </main></div>`,
    async mount(root) { await hydratePhotos(root); },
  };
}
