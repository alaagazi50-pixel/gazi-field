// Farm hub ("Everything about HM16 lives in HM16"), its sub-pages, and the daily report view.
import { t, getLang, LANGS } from './i18n.js';
import { STAGES, farmProgress } from './data.js';
import { state, me, farm, user, team, issue, reportIssues, isMgr as isMgrUser, photoMeta, setPhotoApproved, resolveIssue, saveBoq, saveStages, setDrawing, setFarmTeam, saveFarmInfo } from './store.js';
import { esc, stageName, ICONS, topbar, toast, fail, photoImg, hydratePhotos, pct, timeLabel, connBlock, progressBar, pickPhoto, parseGps, farmTitle } from './ui.js';

const isMgr = () => isMgrUser(me());
const homeHref = () => (isMgr() ? '#/manage' : '#/');

export function farmHubView({ farmId }) {
  const f = farm(farmId);
  const openIssues = state.issues.filter(i => i.farmId === f.id && i.status === 'open').length;
  const item = (sub, icon, label, badge) => `<a class="tile" href="#/farm/${f.id}/${sub}">${ICONS[icon]}<span>${esc(label)}${badge ? ` <span class="badge">${badge}</span>` : ''}</span></a>`;
  return {
    html: `<div class="screen">${topbar({ back: isMgr() ? '#/manage/farms' : `#/work/${f.id}` })}<main class="content">
      <div class="h2">${esc(f.id)}${f.name ? `<br><span style="font-size:20px">${esc(f.name)}</span>` : ''}</div>
      <div class="small upper muted">${esc(f.region)}</div>
      <div class="strong upper">${farmProgress(f)}% ${esc(t('in_progress'))} · ${esc(team(f.teamId).name)}</div>
      ${progressBar(farmProgress(f))}
      <div class="eyebrow" style="margin-top:8px">${esc(t('project_information'))}</div>
      <nav class="tiles two">
        ${item('location', 'map', t('location'))}
        ${item('drawing', 'drawing', t('project_drawing'))}
        ${item('boq', 'boq', t('bill_of_quantities'))}
        ${item('photos', 'photos', t('photos'))}
        ${item('history', 'history', t('history'))}
        ${item('issues', 'issues', t('issues'), openIssues)}
      </nav>
      ${isMgr() ? stageEditor(f) : `<ul class="list">${STAGES.map(s => `<li>${esc(stageName(s.id))}<span class="r strong">${pct(f.stages[s.id] || 0)}</span></li>`).join('')}</ul>`}
    </main></div>`,
    mount(root) {
      const form = root.querySelector('[data-stages]');
      if (!form) return;
      form.onsubmit = async e => {
        e.preventDefault();
        const stages = Object.fromEntries(STAGES.map(s => [s.id, +form.elements[s.id].value]));
        try { await saveStages(f.id, stages); toast(t('saved')); } catch (err) { fail(err); }
      };
      root.querySelector('[data-info]').onsubmit = async e => {
        e.preventDefault();
        const v = Object.fromEntries(new FormData(e.target));
        try { const g = parseGps(v.gps); await saveFarmInfo(f.id, { name: v.name.trim(), region: v.region.trim(), lat: g?.lat, lng: g?.lng }); toast(t('saved')); } catch (err) { fail(err); }
      };
      root.querySelector('[data-team]').onchange = async ev => {
        try { await setFarmTeam(f.id, ev.target.value); toast(t('saved')); } catch (err) { fail(err); }
      };
    },
  };
}

// Management can correct progress directly (e.g. when loading an existing project) and move a farm between teams.
function stageEditor(f) {
  const opts = v => Array.from({ length: 21 }, (_, i) => i * 5).map(p => `<option value="${p}" ${p === (v || 0) ? 'selected' : ''}>${p}%</option>`).join('');
  const gps = f.gps.lat || f.gps.lng ? `${f.gps.lat}, ${f.gps.lng}` : '';
  return `<div class="card flat stack">
    <form data-info class="form"><span class="eyebrow">${esc(t('farm_details'))}</span>
      <label>${esc(t('farm_name'))}<input class="input" name="name" id="fi-name" value="${esc(f.name)}" placeholder="${esc(t('farm_name_hint'))}"></label>
      <label>${esc(t('region'))}<input class="input" name="region" id="fi-region" value="${esc(f.region)}" required></label>
      <label>${esc(t('gps_optional'))}<input class="input" name="gps" id="fi-gps" value="${esc(gps)}" placeholder="-12.7765, 15.7391" inputmode="decimal"></label>
      <button class="btn sm" type="submit" style="align-self:flex-start">${esc(t('save'))}</button></form>
    <label class="form"><span class="eyebrow">${esc(t('team'))}</span>
      <select class="input" data-team><option value="">${esc(t('no_team'))}</option>
        ${state.teams.map(tm => `<option value="${esc(tm.id)}" ${tm.id === f.teamId ? 'selected' : ''}>${esc(tm.name)}</option>`).join('')}</select></label>
    <form data-stages class="stack"><div class="eyebrow">${esc(t('edit_progress'))}</div>
      <div class="stage-edit">${STAGES.map(s => `<label for="st-${s.id}">${esc(stageName(s.id))}</label>
        <select class="input" id="st-${s.id}" name="${s.id}">${opts(f.stages[s.id])}</select>`).join('')}</div>
      <button class="btn sm" type="submit" style="align-self:flex-start">${esc(t('save'))}</button></form>
  </div>`;
}

function page(f, title, inner, mount) {
  return { html: `<div class="screen">${topbar({ back: `#/farm/${f.id}` })}<main class="content">
    <div class="eyebrow teal">${esc(farmTitle(f))} · ${esc(f.region)}</div><h1 class="h1">${esc(title)}</h1>${inner}</main></div>`, mount };
}

export function farmSubView({ farmId, sub }) {
  const f = farm(farmId);
  switch (sub) {
    case 'location': return locationPage(f);
    case 'drawing': return drawingPage(f);
    case 'boq': return boqPage(f);
    case 'photos': return photosPage(f);
    case 'history': return historyPage(f);
    case 'issues': return issuesPage(f);
  }
  return farmHubView({ farmId });
}

function locationPage(f) {
  const { lat, lng } = f.gps;
  if (!lat && !lng) return page(f, t('location'), `<div class="empty">—</div>`);
  const last = [...state.reports].filter(r => r.farmId === f.id && r.location?.lat != null).sort((a, b) => b.submittedAt - a.submittedAt)[0];
  return page(f, t('location'), `
    <div class="card flat stack">
      <div class="eyebrow">${esc(t('gps_location'))}</div>
      <svg class="map-svg" viewBox="0 0 300 170" aria-hidden="true">
        <path d="M40 0 L140 170" stroke="#cdd8d2" stroke-width="16"/><path d="M200 0 L250 170" stroke="#cdd8d2" stroke-width="16"/>
        <path d="M0 125 L300 35" stroke="#cdd8d2" stroke-width="16"/>
        <path d="M95 35 L200 25 L210 120 L110 130 Z" fill="none" stroke="#093b35" stroke-width="2.5"/>
        <circle cx="152" cy="77" r="11" fill="#093b35"/><circle cx="152" cy="77" r="4" fill="#fff"/>
      </svg>
      <div>${esc(f.id)} · ${esc(f.region)}</div>
      <div class="small muted" dir="ltr">${lat.toFixed(5)}, ${lng.toFixed(5)}</div>
      <a class="btn sm" href="https://www.google.com/maps/search/?api=1&query=${lat},${lng}" target="_blank" rel="noopener">${esc(t('open_maps'))}</a>
    </div>
    ${last ? `<div class="small muted">${esc(t('last_report'))}: ${esc(timeLabel(last.submittedAt))} · ${last.location.distKm.toFixed(1)} km</div>` : ''}`);
}

function drawingPage(f) {
  const schematic = `<svg class="draw-svg" viewBox="0 0 300 130" aria-hidden="true" style="background:#fff;border:1px solid var(--line)">
    <rect x="20" y="50" width="34" height="30" fill="#f2f3ee" stroke="#093b35" stroke-width="2.5"/>
    <path d="M54 65 H280" stroke="#093b35" stroke-width="2.5"/>
    ${[110, 150, 190, 230].map(x => `<path d="M${x} 20 V110 M${x - 6} 20 H${x + 6} M${x - 6} 110 H${x + 6}" stroke="#093b35" stroke-width="2.5"/>`).join('')}
  </svg>`;
  return page(f, t('project_drawing'), `
    <div class="card flat stack"><div class="eyebrow">${esc(t('approved_layout'))}</div>
      ${f.drawingPhotoId ? `<button data-zoom="${f.drawingPhotoId}" style="border:0;padding:0;background:none;cursor:zoom-in">${photoImg(f.drawingPhotoId)}</button>`
        : `${schematic}<div class="small muted">${esc(t('no_drawing'))}</div>`}
    </div>
    ${isMgr() ? `<button class="btn sm" data-act="upload">${esc(f.drawingPhotoId ? t('replace_drawing') : t('upload_drawing'))}</button>` : ''}`,
  async root => {
    const b = root.querySelector('[data-act=upload]');
    if (b) b.onclick = async () => {
      const file = await pickPhoto(false);
      if (!file) return;
      try { await setDrawing(f.id, file); toast(t('saved')); } catch (err) { fail(err); }
    };
    await hydratePhotos(root);
  });
}

function boqPage(f) {
  const edit = isMgr();
  const rows = f.boq.map((r, i) => edit
    ? `<tr><td><input class="input" data-i="${i}" data-k="item" value="${esc(r.item)}"></td><td style="width:80px"><input class="input" data-i="${i}" data-k="unit" value="${esc(r.unit)}"></td><td style="width:110px"><input class="input" data-i="${i}" data-k="qty" value="${esc(r.qty)}" inputmode="decimal"></td></tr>`
    : `<tr><td>${esc(r.item)}</td><td>${esc(r.unit || '—')}</td><td class="num">${esc(r.qty === '' || r.qty == null ? '—' : Number(r.qty).toLocaleString())}</td></tr>`).join('');
  return page(f, t('bill_of_quantities'), `
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>${esc(t('item'))}</th><th>${esc(t('unit'))}</th><th>${esc(t('qty'))}</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="small muted">${esc(t('boq_note'))}</div>
    ${edit ? `<div class="row"><button class="btn ghost sm" data-act="add">${esc(t('add_row'))}</button><button class="btn sm" data-act="save">${esc(t('save'))}</button></div>` : ''}`,
  root => {
    root.querySelectorAll('input[data-i]').forEach(inp => inp.oninput = () => { f.boq[+inp.dataset.i][inp.dataset.k] = inp.value; });
    const add = root.querySelector('[data-act=add]');
    if (add) add.onclick = () => { f.boq.push({ item: '', unit: '', qty: '' }); window.dispatchEvent(new Event('rerender')); };
    const sv = root.querySelector('[data-act=save]');
    if (sv) sv.onclick = async () => {
      try { await saveBoq(f.id, f.boq.filter(r => String(r.item).trim())); toast(t('saved')); } catch (err) { fail(err); }
    };
  });
}

export function photoGrid(photos, { approve = false } = {}) {
  if (!photos.length) return `<div class="empty">${esc(t('no_photos'))}</div>`;
  return `<div class="photos">${photos.map(p => `<div class="ph">
    <button class="imgbtn" data-zoom="${p.id}">${photoImg(p.id, p.label)}</button>
    <div class="strong">${p.progress != null ? p.progress + '%' : esc(p.kind === 'issue' ? t('issues') : '')} <span class="muted" style="font-weight:400">${esc(stageName(p.stage))}</span></div>
    <div class="muted" style="font-size:11px">${esc(p.label)}</div>
    ${approve ? `<label class="row small" style="gap:6px"><input type="checkbox" data-approve="${p.id}" ${p.approved ? 'checked' : ''}> ${esc(t('approve_client'))}</label>`
      : p.approved ? `<span class="tag ok">${esc(t('approved'))}</span>` : ''}
  </div>`).join('')}</div>`;
}
export function bindApprove(root) {
  root.querySelectorAll('[data-approve]').forEach(cb => cb.onchange = async () => {
    try { await setPhotoApproved(cb.dataset.approve, cb.checked); toast(t('saved')); }
    catch (err) { cb.checked = !cb.checked; fail(err); }
  });
}

function photosPage(f) {
  const sel = new URLSearchParams(location.hash.split('?')[1] || '').get('stage');
  let photos = state.photos.filter(p => p.farmId === f.id && p.kind !== 'drawing');
  if (sel) photos = photos.filter(p => p.stage === sel);
  photos.sort((a, b) => (a.stage || '').localeCompare(b.stage || '') || (a.progress ?? 0) - (b.progress ?? 0) || a.takenAt - b.takenAt);
  const seg = `<div class="chips"><a class="pill ${sel ? '' : 'outline'}" href="#/farm/${f.id}/photos" style="text-decoration:none;color:inherit">${esc(t('all_stages'))}</a>
    ${STAGES.map(s => `<a class="pill ${sel === s.id ? 'outline' : ''}" href="#/farm/${f.id}/photos?stage=${s.id}" style="text-decoration:none;color:inherit">${esc(stageName(s.id))}</a>`).join('')}</div>`;
  return page(f, t('photo_history'), `${seg}${photoGrid(photos, { approve: isMgr() })}`, async root => { bindApprove(root); await hydratePhotos(root); });
}

function historyPage(f) {
  const reps = state.reports.filter(r => r.farmId === f.id).sort((a, b) => b.submittedAt - a.submittedAt);
  return page(f, t('history'), reps.length ? `<ul class="list">${reps.map(r => {
    const changes = r.items.filter(i => i.action === 'updated').map(i => `${stageName(i.stage)} ${i.prev} → ${i.next}%`).join(' · ');
    return `<li><a class="rowlink" href="#/report/${r.id}"><div><div class="strong">${esc(timeLabel(r.submittedAt))}</div>
      <div class="small muted">${esc(user(r.userId)?.name)} · ${esc(changes || t('no_changes'))}</div></div>
      <span class="r">${reportIssues(r).length ? `<span class="tag warn">${esc(t('issues'))} · ${reportIssues(r).length}</span>` : ''}</span></a></li>`;
  }).join('')}</ul>` : `<div class="empty">${esc(t('no_history'))}</div>`);
}

export function issueCard(i, { manage = false } = {}) {
  const viewer = getLang();
  // Workers may type in any language whatever their screen language, so let Google detect it.
  const tr = i.note
    ? `<a class="small" target="_blank" rel="noopener" href="https://translate.google.com/?sl=auto&tl=${viewer}&op=translate&text=${encodeURIComponent(i.note)}">${esc(t('translate'))}</a>` : '';
  return `<div class="card flat stack">
    <div class="row between"><span class="eyebrow">${esc(i.farmId)} · ${esc(stageName(i.stage))} / ${esc(t('cat_' + i.category))}</span>
      <span class="tag ${i.status === 'open' ? 'warn' : 'ok'}">${esc(t(i.status))}</span></div>
    ${i.note ? `<p class="note-quote" dir="auto">“${esc(i.note)}”</p>` : ''}
    <div class="row small muted"><span>${esc(t('original', { l: LANGS[i.lang] || i.lang }))}</span>${tr}</div>
    ${i.photoId ? `<button class="imgbtn" data-zoom="${i.photoId}" style="border:0;padding:0;background:none;max-width:220px">${photoImg(i.photoId).replace('<img', '<img class="photo-preview"')}</button>` : ''}
    <div class="small muted">${esc(t('reported_by', { n: user(i.reportedBy)?.name || '—', t: timeLabel(i.at) }))}</div>
    ${manage && i.status === 'open' ? `<button class="btn sm" data-resolve="${i.id}">${esc(t('resolve'))}</button>` : ''}
  </div>`;
}
export function bindResolve(root) {
  root.querySelectorAll('[data-resolve]').forEach(b => b.onclick = async () => {
    try { await resolveIssue(b.dataset.resolve); } catch (err) { fail(err); }
  });
}

function issuesPage(f) {
  const list = state.issues.filter(i => i.farmId === f.id).sort((a, b) => (a.status === 'open' ? -1 : 1) - (b.status === 'open' ? -1 : 1) || b.at - a.at);
  return page(f, t('issues'), list.length ? list.map(i => issueCard(i, { manage: isMgr() })).join('') : `<div class="empty">${esc(t('no_issues'))}</div>`,
    async root => { bindResolve(root); await hydratePhotos(root); });
}

// ---------- Daily report ----------
export function reportView({ reportId }) {
  const r = state.reports.find(x => x.id === reportId);
  if (!r) return { html: `<div class="screen">${topbar({ back: homeHref() })}<main class="content"><div class="empty">—</div></main></div>` };
  const f = farm(r.farmId), u = user(r.userId), mgr = isMgr();
  const issues = reportIssues(r);
  const blocked = new Set(issues.map(i => i.stage).filter(Boolean));
  const rows = r.items.map(i => {
    const val = i.action === 'updated' ? `${i.prev} → ${i.next}%` : i.prev === 0 ? `<span style="font-weight:400">${esc(t('not_started'))}</span>` : `${i.prev}%`;
    let note = i.action === 'updated' ? t('photo_ok') : i.prev >= 100 ? '✓' : i.prev === 0 ? '' : t('no_change');
    if (blocked.has(i.stage) && i.action !== 'updated') note = t('waiting');
    return `<tr><td>${esc(stageName(i.stage))}</td><td class="num">${val}</td><td>${esc(note)}</td></tr>`;
  }).join('');
  const photoIds = [...r.items.map(i => i.photoId), ...issues.map(i => i.photoId)].filter(Boolean);
  const photos = photoIds.map(photoMeta).filter(Boolean);
  const loc = r.location;
  const locLine = !loc ? t('location_unavailable') : loc.verified ? t('location_verified') : loc.distKm != null ? t('location_far', { km: loc.distKm.toFixed(1) }) : t('location_unavailable');

  return {
    html: `<div class="screen ${mgr ? 'wide' : ''}">${topbar({ back: mgr ? '#/manage' : `#/work/${f.id}` })}<main class="content">
      <div class="eyebrow teal">${esc(t('report_detail'))}</div>
      <h1 class="h1">${esc(farmTitle(f))}</h1>
      <div class="muted">${esc(f.region)} · ${r.teamId ? esc(team(r.teamId).name) + ' / ' : ''}${esc(u?.name)} · ${esc(t('submitted_at', { t: timeLabel(r.submittedAt) }))}</div>
      <div class="grid ${mgr ? 'c2' : ''} stack">
        <div class="card flat"><div class="tbl-wrap"><table class="tbl"><tbody>${rows}</tbody></table></div>
          <div style="margin-top:12px"><div class="strong">${r.items.length} / ${r.items.length} ${esc(t('reviewed'))} · ${photos.length} ${esc(photos.length === 1 ? t('photo_1') : t('photos_n'))}</div>
          <div style="${loc && !loc.verified ? 'color:var(--red)' : ''}">${esc(locLine)}</div></div></div>
        <div class="stack">
          ${issues.map(i => issueCard(i, { manage: mgr && !i.pending })).join('')}
          <div class="card flat stack"><div class="eyebrow">${esc(t('connectivity'))} · ${esc(u?.name)}</div>${connBlock(r.connectivity)}</div>
        </div>
      </div>
      <div class="eyebrow">${esc(t('photos'))}</div>
      ${photoGrid(photos, { approve: mgr })}
    </main></div>`,
    async mount(root) { bindApprove(root); bindResolve(root); await hydratePhotos(root); },
  };
}
