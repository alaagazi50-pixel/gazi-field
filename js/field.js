// Field worker screens: choose a farm, the farm screen, and the daily update flow.
import { t, getLang } from './i18n.js';
import { STAGES, CATEGORIES, STEP, LOCATION_RADIUS_KM, dateKey, hhmm, farmProgress, distanceKm } from './data.js';
import { state, save, me, farm, team, reportFor, reportIssues, savePhoto, photoMeta, queueReport, newId, dismissFailed,
  rememberFarm, pushState, enablePush, testPush } from './store.js';
import { esc, stageName, ICONS, topbar, photoImg, hydratePhotos, pct, connBlock, getPosition, pickPhoto, progressBar, farmTitle, toast, fail } from './ui.js';
import { connectivitySummary, currentConn } from './connectivity.js';

const go = h => { location.hash = h; };
let nearPos = null;        // set by "Near me": farms are then sorted by distance (GPS works without signal)
let searchText = '';

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? t('good_morning') : h < 18 ? t('good_afternoon') : t('good_evening');
};

// Reports the server refused (e.g. someone already sent this farm's report today).
function failedCards() {
  return state.outbox.filter(o => o.error).map(o => `<div class="card alert flat stack">
    <strong>${esc(o.report.farmId)} · ${esc(o.report.date)}</strong><div class="small">${esc(t('report_failed', { e: o.error }))}</div>
    <button class="btn ghost xs" data-dismiss="${esc(o.id)}" style="align-self:flex-start">${esc(t('dismiss'))}</button></div>`).join('');
}

async function remindersCard() {
  const s = await pushState();
  if (s === 'on' || s === 'unsupported') return '';
  if (s === 'denied') return `<div class="card flat small muted">${esc(t('push_blocked'))}</div>`;
  return `<div class="card flat row between"><div class="stack" style="gap:2px;flex:1;min-width:180px"><strong>${esc(t('push_title'))}</strong>
    <span class="small muted">${esc(t('push_why'))}</span></div><button class="btn sm" data-act="push">${esc(t('push_enable'))}</button></div>`;
}

// ---------------- Home: which farm are you at today? ----------------
export async function homeView() {
  const u = me();
  const today = dateKey();
  const mine = state.reports.filter(r => r.date === today && r.userId === u.id && !r.error);
  const planned = u.teamId ? team(u.teamId).todayFarm : null;
  const status = f => {
    const rep = reportFor(f.id, today);
    if (rep) return `<span class="tag ok">✓ ${hhmm(rep.submittedAt)}</span>`;
    if (state.drafts[`${f.id}|${today}`]) return `<span class="tag amber">${esc(t('in_progress_short'))}</span>`;
    return '';
  };
  const row = (f, extra = '') => `<li data-row="${esc((f.id + ' ' + f.name + ' ' + f.region).toLowerCase())}">
    <a class="rowlink" href="#/work/${esc(f.id)}"><div style="flex:1;min-width:0"><div class="strong">${esc(farmTitle(f))}</div>
      <div class="small muted">${esc(f.region)} · ${farmProgress(f)}%${extra}</div></div><span class="r">${status(f)}</span></a></li>`;
  const dist = f => (nearPos && (f.gps.lat || f.gps.lng) ? distanceKm(nearPos, f.gps) : null);
  const all = [...state.farms].sort((a, b) => nearPos ? (dist(a) ?? 1e9) - (dist(b) ?? 1e9) : a.id.localeCompare(b.id));
  const recent = (state.recentFarms || []).map(farm).filter(Boolean);
  const plannedFarm = planned && farm(planned);

  return {
    html: `<div class="screen">${topbar()}
    <main class="content">
      <div><p class="greet">${esc(greeting())}<br>${esc(u.name)}.</p>${u.teamId ? `<div class="small upper" style="margin-top:8px">${esc(team(u.teamId).name)}</div>` : ''}</div>
      ${failedCards()}
      ${mine.length ? `<div class="card dark flat stack"><div class="eyebrow" style="color:#9fd3a6">${esc(t('sent_today'))}</div>
        ${mine.map(r => `<a href="#/report/${r.id}" style="color:#fff;text-decoration:none" class="row between"><span>✓ ${esc(farmTitle(farm(r.farmId) || { id: r.farmId }))}</span>
          <span class="small">${hhmm(r.submittedAt)}${r.pending ? ' · ' + esc(t('pending_upload')) : ''}</span></a>`).join('')}</div>` : ''}
      ${await remindersCard()}
      <h1 class="h1" style="font-size:26px">${esc(t('which_farm'))}</h1>
      <div class="row" style="flex-wrap:nowrap">
        <input class="input" id="farm-search" data-search placeholder="${esc(t('search'))}" value="${esc(searchText)}" autocomplete="off" style="flex:1">
        <button class="btn ghost sm" data-act="near" style="white-space:nowrap">${esc(nearPos ? t('near_on') : t('near_me'))}</button>
      </div>
      ${plannedFarm && !nearPos ? `<div class="stack" style="gap:6px"><div class="eyebrow muted">${esc(t('planned_for_team'))}</div><ul class="list">${row(plannedFarm)}</ul></div>` : ''}
      ${recent.length && !nearPos ? `<div class="stack" style="gap:6px"><div class="eyebrow muted">${esc(t('recent_farms'))}</div><ul class="list">${recent.map(f => row(f)).join('')}</ul></div>` : ''}
      <div class="stack" style="gap:6px"><div class="eyebrow muted">${esc(nearPos ? t('nearest_first') : t('all_farms'))} · ${all.length}</div>
        <ul class="list" data-all>${all.map(f => row(f, dist(f) != null ? ` · ${dist(f).toFixed(1)} km` : '')).join('')}</ul></div>
    </main></div>`,
    mount(root) {
      root.querySelectorAll('[data-dismiss]').forEach(b => b.onclick = () => dismissFailed(b.dataset.dismiss));
      const input = root.querySelector('[data-search]');
      const filter = () => {
        searchText = input.value;
        const q = searchText.trim().toLowerCase();
        root.querySelectorAll('[data-row]').forEach(li => { li.hidden = !!q && !li.dataset.row.includes(q); });
      };
      input.oninput = filter;
      filter();
      root.querySelector('[data-act=near]').onclick = async () => {
        if (nearPos) { nearPos = null; window.dispatchEvent(new Event('rerender')); return; }
        toast(t('checking_location'));
        const p = await getPosition(15000);
        if (!p) { toast(t('location_unavailable')); return; }
        nearPos = p;
        window.dispatchEvent(new Event('rerender'));
      };
      const push = root.querySelector('[data-act=push]');
      if (push) push.onclick = async () => {
        try { await enablePush(); toast(t('push_on')); testPush().catch(() => {}); window.dispatchEvent(new Event('rerender')); }
        catch (err) { fail(err); }
      };
    },
  };
}

// Older links / bookmarks to the farm picker land on the chooser.
export function pickFarmView() { go('#/'); return { html: '' }; }

// ---------------- One farm: start the update, or open the farm's information ----------------
export async function workView({ farmId }) {
  const f = farm(farmId);
  if (!f) { go('#/'); return { html: '' }; }
  if ((state.recentFarms || [])[0] !== f.id) rememberFarm(f.id);
  const today = dateKey();
  const rep = reportFor(f.id, today);
  const draft = state.drafts[`${f.id}|${today}`];
  const conn = await connectivitySummary();
  const openIssues = state.issues.filter(i => i.farmId === f.id && i.status === 'open').length;
  const byMe = rep && rep.userId === me().id;

  let cta;
  if (rep) cta = `<div class="card dark flat"><div class="check" style="color:#fff;font-size:44px">✓</div>
      <div class="h3 upper" style="margin-top:6px">${esc(t('day_submitted'))} · ${hhmm(rep.submittedAt)}</div>
      ${!byMe ? `<div class="small" style="margin-top:6px;color:#9fd3a6">${esc(t('sent_by', { n: state.users.find(x => x.id === rep.userId)?.name || '—' }))}</div>` : ''}
      ${rep.pending ? `<div class="small" style="margin-top:6px;color:#9fd3a6">${esc(t('pending_upload'))}</div>` : ''}</div>
      <a class="btn ghost" href="#/report/${rep.id}">${esc(t('view_today'))}</a>`;
  else cta = `<a class="btn" href="#/update/${f.id}">${esc(draft ? t('continue_update') : t('start_daily_update'))}</a>`;

  return {
    html: `<div class="screen">${topbar({ back: '#/' })}
    <main class="content">
      <div class="stack" style="gap:6px">
        <div class="eyebrow">${esc(t('today'))}</div>
        <div class="h2">${esc(f.id)}${f.name ? `<br><span style="font-size:20px">${esc(f.name)}</span>` : ''}</div>
        <div class="small upper muted">${esc(f.region)}</div>
        <div class="strong upper" style="font-size:20px">${farmProgress(f)}% ${esc(t('in_progress'))}</div>
        ${progressBar(farmProgress(f))}
      </div>
      ${cta}
      <a class="btn ghost" href="#/farm/${f.id}">${ICONS.info} ${esc(t('farm_info'))}</a>
      <div class="small muted center">${esc(t('farm_info_hint'))}</div>
      ${openIssues ? `<a class="card alert flat" href="#/farm/${f.id}/issues" style="text-decoration:none">${esc(t('issues'))}: ${openIssues} ${esc(t('open'))}</a>` : ''}
      <div class="card flat stack"><div class="eyebrow muted">${esc(t('conn_last_hours', { h: conn.hours }))}</div>${connBlock(conn, { compact: true })}</div>
    </main></div>`,
  };
}

// ---------------- Daily update flow ----------------
const emptyIssue = () => ({ category: null, stage: null, note: '', photoId: null });
function getDraft(f) {
  const key = `${f.id}|${dateKey()}`;
  if (!state.drafts[key]) {
    state.drafts[key] = {
      key, farmId: f.id, date: dateKey(), step: 'intro', idx: 0, trail: [], pending: null, returnToSummary: false,
      items: STAGES.map(s => ({ stage: s.id, prev: f.stages[s.id] || 0, next: null, action: null, photoId: null })),
      issues: [], issueForm: null, issuesDone: false, location: null, startedAt: Date.now(),
    };
  }
  const d = state.drafts[key];
  if (!d.issues) {   // draft started with v0.3 (single problem)
    d.issues = d.issue?.mode === 'report' && d.issue.category ? [{ category: d.issue.category, stage: d.issue.stage, note: d.issue.note, photoId: d.issue.photoId }] : [];
    d.issuesDone = d.issue?.mode != null;
    d.issueForm = null;
    delete d.issue;
  }
  return d;
}

export function updateView({ farmId }) {
  const f = farm(farmId), u = me();
  if (!f || reportFor(f.id, dateKey())) { go(f ? `#/work/${f.id}` : '#/'); return { html: '' }; }
  const d = getDraft(f);
  const n = STAGES.length;
  const cur = d.items[d.idx];
  const photoCount = d.items.filter(i => i.photoId).length + d.issues.filter(i => i.photoId).length;

  const to = (step, patch = {}) => { d.trail.push({ step: d.step, idx: d.idx }); Object.assign(d, { step }, patch); commit(); };
  const commit = () => save().then(() => window.dispatchEvent(new Event('rerender')));
  const nextStage = () => {
    if (d.returnToSummary) return to('summary', { returnToSummary: false });
    if (d.idx < n - 1) to('stage', { idx: d.idx + 1, pending: null });
    else to('issue');
  };
  const issueCardHtml = (i, k, removable) => `<div class="card flat row between" style="gap:10px;align-items:flex-start">
    ${i.photoId ? `<button class="imgbtn" data-zoom="${i.photoId}" style="border:0;padding:0;background:none;width:64px">${photoImg(i.photoId).replace('<img', '<img style="width:64px;height:64px;object-fit:cover;border-radius:8px"')}</button>` : ''}
    <div style="flex:1;min-width:0"><strong>${k + 1}. ${esc(t('cat_' + i.category))}</strong> <span class="muted small">· ${esc(stageName(i.stage))}</span>
      ${i.note ? `<div class="small" dir="auto">${esc(i.note)}</div>` : ''}</div>
    ${removable ? `<button class="linkbtn" data-remove="${k}" style="color:var(--red)">${esc(t('remove'))}</button>` : ''}</div>`;

  let body = '', progressW = 0;
  switch (d.step) {
    case 'intro':
      body = `<div class="h2">${esc(farmTitle(f))}</div>
        <div class="eyebrow">${esc(t('todays_update'))}</div>
        <div class="h2 upper" style="font-size:22px">${n} ${esc(t('items_to_review'))}</div>
        <ul class="list">${STAGES.map(s => `<li>${esc(stageName(s.id))}<span class="r muted small">${pct(f.stages[s.id] || 0)}</span></li>`).join('')}</ul>
        <span class="spacer"></span>
        <button class="btn" data-act="start">${esc(t('start'))}</button>
        <div class="row"><span class="pill outline">${esc(t('works_offline'))}</span><span class="pill outline">${esc(t('syncs_auto'))}</span></div>`;
      break;

    case 'stage': {
      progressW = (d.idx / n) * 100;
      const head = `<div class="stepcount">${d.idx + 1} / ${n} · ${esc(stageName(cur.stage).toUpperCase())}</div>`;
      if (cur.prev >= 100) {
        body = `${head}<div class="small upper">${esc(t('current_progress'))}</div><p class="big">100%</p><span class="spacer"></span>
          <button class="btn" data-act="confirm">${esc(t('confirm'))}</button>`;
      } else if (cur.prev === 0) {
        body = `${head}<div class="small upper">${esc(t('current_progress'))}</div><p class="big sm upper">${esc(t('not_started'))}</p><span class="spacer"></span>
          <button class="btn" data-act="nochange">${esc(t('confirm'))}</button>
          <button class="btn ghost" data-act="update">${esc(t('started_today'))}</button>`;
      } else {
        body = `${head}<div class="small upper">${esc(t('current_progress'))}</div><p class="big">${cur.prev}%</p><hr>
          <span class="spacer"></span><p class="question">${esc(t('did_this_change'))}</p>
          <button class="btn ghost" data-act="nochange">${esc(t('no_change'))}</button>
          <button class="btn" data-act="update">${esc(t('update_progress'))}</button>`;
      }
      break;
    }

    case 'pick': {
      progressW = (d.idx / n) * 100;
      const opts = [];
      for (let v = cur.prev + STEP; v <= 100; v += STEP) opts.push(v);
      body = `<div class="eyebrow">${esc(stageName(cur.stage))}</div><div class="h2 upper" style="font-size:22px">${esc(t('previous'))} ${cur.prev}%</div>
        <span style="height:24px"></span><div class="eyebrow">${esc(t('today'))}</div>
        <div class="chips" dir="ltr">${opts.map(v => `<button class="chip ${d.pending === v ? 'on' : ''}" data-v="${v}">${v}</button>`).join('')}</div>
        <div class="change">${d.pending ? `${cur.prev}% → ${d.pending}%` : '&nbsp;'}</div>
        <span class="spacer"></span><button class="btn" data-act="continue" ${d.pending ? '' : 'disabled'}>${esc(t('continue'))}</button>`;
      break;
    }

    case 'photo': {
      progressW = (d.idx / n) * 100;
      const ph = d.pendingPhoto;
      body = `<div class="eyebrow">${esc(stageName(cur.stage))}</div><div class="change sm">${cur.prev}% → ${d.pending}%</div>
        ${ph ? `<button class="imgbtn" data-zoom="${ph}" style="border:0;padding:0;background:none">${photoImg(ph).replace('<img', '<img class="photo-preview"')}</button>
          <div class="center h3 upper">${esc(t('photo_attached'))}</div><span class="spacer"></span>
          <button class="btn" data-act="confirmphoto">${esc(t('confirm_pct', { p: d.pending }))}</button>
          <button class="linkbtn" data-act="camera">${esc(t('retake'))}</button>`
        : `<div class="banner warn">${esc(t('photo_required'))}</div><span class="spacer"></span>
          <button class="btn" data-act="camera">${ICONS.camera} ${esc(t('take_photo'))}</button>
          <button class="btn ghost" data-act="gallery">${esc(t('choose_from_phone'))}</button>`}`;
      break;
    }

    case 'issue': {
      progressW = 100;
      const is = d.issueForm;
      const list = d.issues.map((i, k) => issueCardHtml(i, k, true)).join('');
      if (is) {
        body = `<p class="question" style="font-size:22px">${esc(d.issues.length ? t('another_problem') : t('report_issue'))}</p>
          ${list}
          <div class="eyebrow">${esc(t('category'))}</div>
          <div class="catgrid">${CATEGORIES.map(c => `<button class="cat ${is.category === c ? 'on' : ''}" data-cat="${c}">${esc(t('cat_' + c))}</button>`).join('')}</div>
          <div class="eyebrow">${esc(t('which_stage'))}</div>
          <div class="chips">${[null, ...STAGES.map(s => s.id)].map(s => `<button class="cat ${is.stage === s ? 'on' : ''}" data-st="${s ?? ''}" style="padding:0 14px;flex:0 0 auto">${esc(stageName(s))}</button>`).join('')}</div>
          <div class="eyebrow">${esc(t('take_choose_photo'))} <span class="muted">(${esc(t('optional'))})</span></div>
          ${is.photoId ? `<button data-zoom="${is.photoId}" style="border:0;padding:0;background:none">${photoImg(is.photoId).replace('<img', '<img class="photo-preview"')}</button>` : ''}
          <div class="btn-row"><button class="btn ghost sm" data-act="icamera" style="width:100%">${esc(t('take_photo'))}</button>
            <button class="btn ghost sm" data-act="igallery" style="width:100%">${esc(t('choose_from_phone'))}</button></div>
          <textarea class="input" id="issue-note" data-note placeholder="${esc(t('describe'))}">${esc(is.note)}</textarea>
          <button class="btn" data-act="addissue" ${is.category && (is.note.trim() || is.photoId) ? '' : 'disabled'}>${esc(t('add_problem'))}</button>
          <button class="linkbtn" data-act="cancelissue">${esc(t('cancel'))}</button>`;
      } else {
        body = `<p class="question" style="font-size:22px">${esc(t('anything_blocking'))}</p>
          ${list}
          ${d.issues.length
            ? `<button class="btn ghost" data-act="newissue">+ ${esc(t('another_problem'))}</button>
               <span class="spacer"></span><button class="btn" data-act="issuesdone">${esc(t('continue'))}</button>`
            : `<div class="btn-row"><button class="btn ghost" data-act="noissue">${esc(t('no'))}</button>
               <button class="btn" data-act="newissue">${esc(t('report_issue'))}</button></div>`}`;
      }
      break;
    }

    case 'summary': {
      progressW = 100;
      const blocked = new Set(d.issues.map(i => i.stage).filter(Boolean));
      const rows = d.items.map((it, i) => {
        let val, note = '';
        if (it.action === 'updated') { val = `${it.prev} → ${it.next}%`; note = t('photo_ok'); }
        else if (it.prev >= 100) { val = '100%'; note = '✓'; }
        else if (it.prev === 0) { val = `<span style="font-weight:400">${esc(t('not_started'))}</span>`; }
        else { val = `${it.prev}%`; note = t('no_change'); }
        if (blocked.has(it.stage) && it.action !== 'updated') note = t('waiting');
        return `<tr data-edit="${i}" style="cursor:pointer"><td>${esc(stageName(it.stage))}</td><td class="num">${val}</td><td>${esc(note)}</td></tr>`;
      }).join('');
      const loc = d.location;
      const locLine = !loc ? t('checking_location')
        : loc.error ? t('location_unavailable')
        : loc.verified ? t('location_verified') : t('location_far', { km: loc.distKm.toFixed(1) });
      body = `<div class="h2">${esc(f.id)} · ${esc(t('today').toUpperCase())}</div>
        <div class="tbl-wrap"><table class="tbl"><tbody>${rows}
          ${d.issues.map(i => `<tr data-issues style="cursor:pointer"><td>${esc(t('issue_reported'))}</td><td>${esc(t('cat_' + i.category))}</td><td>${i.photoId ? esc(t('photo_ok')) : ''}</td></tr>`).join('')}
        </tbody></table></div>
        <button class="linkbtn" data-act="editissues" style="align-self:flex-start">${esc(d.issues.length ? t('edit_problems') : t('report_issue'))}</button>
        <div><div class="strong">${d.items.filter(i => i.action).length} / ${n} ${esc(t('reviewed'))} · ${photoCount} ${esc(photoCount === 1 ? t('photo_1') : t('photos_n'))}</div>
          <div style="${loc && !loc.verified ? 'color:var(--red)' : ''}">${esc(locLine)}</div></div>
        <div class="card flat stack"><div class="eyebrow muted">${esc(t('connectivity'))}</div><div data-conn>…</div></div>
        <span class="spacer"></span>
        <button class="btn" data-act="submit">${esc(t('submit_day'))}</button>`;
      break;
    }
  }

  const backBtn = d.trail.length ? `<button class="iconbtn flip" data-act="back" aria-label="${esc(t('back'))}">${ICONS.back}</button>` : `<a class="iconbtn flip" href="#/work/${esc(f.id)}" aria-label="${esc(t('back'))}">${ICONS.back}</a>`;
  return {
    html: `<div class="screen">
      <header class="topbar">${backBtn}<span class="brand">GAZI <span>FIELD</span></span><span class="muted small">· ${esc(f.id)}</span><span class="grow"></span>
        ${currentConn() === false ? `<span class="pill off"><span class="dot"></span>${esc(t('offline'))}</span>` : ''}</header>
      <div class="flowbar"><i style="width:${progressW}%"></i></div>
      <main class="content">${body}</main></div>`,

    async mount(root) {
      const on = (act, fn) => root.querySelectorAll(`[data-act=${act}]`).forEach(b => { b.onclick = fn; });
      on('back', () => { const p = d.trail.pop(); if (p) { d.step = p.step; d.idx = p.idx; commit(); } });
      on('start', () => to('stage', { idx: 0 }));
      on('confirm', () => { cur.action = 'confirmed'; cur.next = cur.prev; cur.photoId = null; nextStage(); });
      on('nochange', () => { cur.action = 'no_change'; cur.next = cur.prev; cur.photoId = null; nextStage(); });
      on('update', () => to('pick', { pending: cur.action === 'updated' ? cur.next : null }));
      root.querySelectorAll('[data-v]').forEach(b => b.onclick = () => { d.pending = +b.dataset.v; commit(); });
      on('continue', () => to('photo', { pendingPhoto: null }));

      const capture = async (useCamera, meta, done) => {
        const file = await pickPhoto(useCamera);
        if (!file) return;
        const loc = await Promise.race([getPosition(4000), new Promise(r => setTimeout(() => r(null), 4500))]);
        const rec = await savePhoto(file, { ...meta, farmId: f.id, loc });
        done(rec.id);
        commit();
      };
      const stageMeta = () => ({ stage: cur.stage, progress: d.pending, kind: 'progress' });
      on('camera', () => capture(true, stageMeta(), id => { d.pendingPhoto = id; }));
      on('gallery', () => capture(false, stageMeta(), id => { d.pendingPhoto = id; }));
      on('confirmphoto', () => {
        Object.assign(cur, { action: 'updated', next: d.pending, photoId: d.pendingPhoto });
        photoMeta(d.pendingPhoto).progress = d.pending;
        nextStage();
      });

      // problems: as many as needed
      on('noissue', () => { d.issues = []; d.issuesDone = true; to('summary'); });
      on('newissue', () => { d.issueForm = emptyIssue(); commit(); });
      on('cancelissue', () => { d.issueForm = null; commit(); });
      on('issuesdone', () => { d.issuesDone = true; to('summary'); });
      on('editissues', () => to('issue', { issueForm: d.issues.length ? null : emptyIssue() }));
      root.querySelectorAll('[data-issues]').forEach(r => r.onclick = () => to('issue', { issueForm: null }));
      root.querySelectorAll('[data-remove]').forEach(b => b.onclick = () => { d.issues.splice(+b.dataset.remove, 1); commit(); });
      const is = d.issueForm;
      if (is) {
        root.querySelectorAll('[data-cat]').forEach(b => b.onclick = () => { is.category = b.dataset.cat; commit(); });
        root.querySelectorAll('[data-st]').forEach(b => b.onclick = () => { is.stage = b.dataset.st || null; commit(); });
        const note = root.querySelector('[data-note]');
        note.oninput = () => {
          is.note = note.value;
          root.querySelector('[data-act=addissue]').disabled = !(is.category && (is.note.trim() || is.photoId));
          save();
        };
        const issueMeta = () => ({ stage: is.stage, progress: null, kind: 'issue' });
        on('icamera', () => capture(true, issueMeta(), id => { is.photoId = id; }));
        on('igallery', () => capture(false, issueMeta(), id => { is.photoId = id; }));
        on('addissue', () => { d.issues.push({ ...is, note: is.note.trim() }); d.issueForm = null; commit(); });
      }

      root.querySelectorAll('[data-edit]').forEach(r => r.onclick = () => to('stage', { idx: +r.dataset.edit, returnToSummary: true }));
      on('submit', () => submit(f, u, d));

      if (d.step === 'summary') {
        connectivitySummary().then(s => { const el = root.querySelector('[data-conn]'); if (el) el.innerHTML = connBlock(s); });
        if (!d.location) {
          getPosition().then(p => {
            d.location = p
              ? { ...p, distKm: distanceKm(p, f.gps), verified: (f.gps.lat || f.gps.lng) ? distanceKm(p, f.gps) <= LOCATION_RADIUS_KM : false, at: Date.now() }
              : { error: true, verified: false, at: Date.now() };
            commit();
          });
        }
      }
      await hydratePhotos(root);
    },
  };
}

async function submit(f, u, d) {
  if (d.items.some(i => !i.action)) { d.step = 'stage'; d.idx = d.items.findIndex(i => !i.action); await save(); window.dispatchEvent(new Event('rerender')); return; }
  const now = Date.now();
  const report = {
    id: newId(), farmId: f.id, teamId: u.teamId, userId: u.id, date: d.date, submittedAt: now, issueId: null,
    items: d.items.map(({ stage, prev, next, action, photoId }) => ({ stage, prev, next, action, photoId })),
    location: d.location && { lat: d.location.lat, lng: d.location.lng, acc: d.location.acc, distKm: d.location.distKm, verified: !!d.location.verified },
    connectivity: await connectivitySummary(undefined, now),
  };
  const lang = getLang();
  const issues = d.issues.map(i => ({ stage: i.stage, category: i.category, note: i.note, photoId: i.photoId, lang }));
  delete state.drafts[d.key];
  await queueReport(report, issues);
  location.hash = `#/done/${report.id}`;
}

export function doneView({ reportId }) {
  const r = state.reports.find(x => x.id === reportId);
  if (!r) { go('#/'); return { html: '' }; }
  const queued = state.outbox.find(o => o.id === r.id);
  const photos = queued ? queued.photoIds.length
    : r.items.filter(i => i.photoId).length + reportIssues(r).filter(i => i.photoId).length;
  const f = farm(r.farmId) || { id: r.farmId };
  return {
    html: `<div class="screen">${topbar()}<main class="content">
      <div class="eyebrow">${esc(farmTitle(f))}</div>
      <div class="check">✓</div>
      <div class="h2 upper">${esc(t('day_submitted'))}</div>
      <div class="h2" style="font-size:22px">${hhmm(r.submittedAt)}</div>
      <hr>
      <div>${r.items.length} / ${r.items.length} ${esc(t('reviewed'))}<br>${photos} ${esc(photos === 1 ? t('photo_1') : t('photos_n'))}<br>
        ${esc(r.location?.verified ? t('location_verified') : r.location?.distKm != null ? t('location_far', { km: (r.location.distKm ?? 0).toFixed(1) }) : t('location_unavailable'))}</div>
      <p class="muted">${esc(t('you_are_finished'))}${r.pending ? '<br>' + esc(t('saved_offline')) : ''}</p>
      <span class="spacer"></span>
      <div class="btn" style="cursor:default">${esc(r.farmId)} ${esc(t('updated'))}</div>
      <a class="btn ghost" href="#/">${esc(t('home'))}</a>
    </main></div>`,
  };
}
