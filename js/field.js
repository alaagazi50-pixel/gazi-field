// Field team screens: home, farm picker, and the daily update flow.
import { t, getLang } from './i18n.js';
import { STAGES, CATEGORIES, STEP, LOCATION_RADIUS_KM, dateKey, hhmm, farmProgress, distanceKm } from './data.js';
import { state, save, me, farm, team, teamFarm, teamFarms, reportFor, savePhoto, photoMeta, queueReport, newId, dismissFailed } from './store.js';
import { esc, stageName, ICONS, topbar, photoImg, hydratePhotos, pct, connBlock, getPosition, pickPhoto, progressBar } from './ui.js';
import { connectivitySummary, currentConn } from './connectivity.js';

const go = h => { location.hash = h; };

// ---------------- Home ----------------
export async function homeView() {
  const u = me(), tm = team(u.teamId), f = teamFarm(u.teamId);
  if (!f) return { html: `<div class="screen">${topbar()}<main class="content"><p class="greet">${esc(u.name)}</p><div class="empty">${esc(t('no_farm_assigned'))}</div></main></div>` };
  const today = dateKey();
  const rep = reportFor(f.id, today);
  const draft = state.drafts[`${f.id}|${today}`];
  const h = new Date().getHours();
  const greet = h < 12 ? t('good_morning') : h < 18 ? t('good_afternoon') : t('good_evening');
  const conn = await connectivitySummary();
  const openIssues = state.issues.filter(i => i.farmId === f.id && i.status === 'open').length;

  let cta;
  if (rep) cta = `<div class="card dark flat"><div class="check" style="color:#fff;font-size:44px">✓</div>
      <div class="h3 upper" style="margin-top:6px">${esc(t('day_submitted'))} · ${hhmm(rep.submittedAt)}</div>
      ${rep.pending ? `<div class="small" style="margin-top:6px;color:#9fd3a6">${esc(t('pending_upload'))}</div>` : ''}</div>
      <a class="btn ghost" href="#/report/${rep.id}">${esc(t('view_today'))}</a>`;
  else cta = `<a class="btn" href="#/update/${f.id}">${esc(draft ? t('continue_update') : t('start_daily_update'))}</a>`;

  const tile = (href, icon, label, badge) => `<a class="tile" href="${href}">${ICONS[icon]}<span>${esc(label)}${badge ? ` <span class="badge">${badge}</span>` : ''}</span></a>`;
  return {
    html: `<div class="screen">${topbar()}
    <main class="content">
      <div><p class="greet">${esc(greet)}<br>${esc(u.name)}.</p><div class="small upper" style="margin-top:8px">${esc(tm.name)}</div></div>
      <hr>
      <div class="stack" style="gap:6px">
        <div class="eyebrow">${esc(t('today'))}</div>
        <div class="h2">${esc(f.id)} · ${esc(f.region.toUpperCase())}</div>
        <div class="strong upper" style="font-size:20px">${farmProgress(f)}% ${esc(t('in_progress'))}</div>
        ${progressBar(farmProgress(f))}
        <button class="linkbtn" data-act="pick" style="align-self:flex-start">${esc(t('change_farm'))}</button>
      </div>
      ${cta}
      <nav class="tiles">
        ${tile(`#/farm/${f.id}`, 'info', t('project_info'))}
        ${tile(`#/farm/${f.id}/location`, 'map', t('map'))}
        ${tile(`#/farm/${f.id}/drawing`, 'drawing', t('drawing'))}
        ${tile(`#/farm/${f.id}/boq`, 'boq', t('boq'))}
        ${tile(`#/farm/${f.id}/photos`, 'photos', t('photos'))}
        ${tile(`#/farm/${f.id}/history`, 'history', t('history'))}
      </nav>
      ${failedCards()}
      ${openIssues ? `<a class="card alert flat" href="#/farm/${f.id}/issues" style="text-decoration:none">${esc(t('issues'))}: ${openIssues} ${esc(t('open'))}</a>` : ''}
      <div class="card flat stack"><div class="eyebrow muted">${esc(t('conn_last_hours', { h: conn.hours }))}</div>${connBlock(conn, { compact: true })}</div>
    </main></div>`,
    mount(root) {
      root.querySelector('[data-act=pick]').onclick = () => go('#/pick-farm');
      root.querySelectorAll('[data-dismiss]').forEach(b => b.onclick = () => dismissFailed(b.dataset.dismiss));
    },
  };
}

// Reports the server refused (e.g. a teammate already sent this farm's report today).
function failedCards() {
  return state.outbox.filter(o => o.error).map(o => `<div class="card alert flat stack">
    <strong>${esc(o.report.farmId)} · ${esc(o.report.date)}</strong><div class="small">${esc(t('report_failed', { e: o.error }))}</div>
    <button class="btn ghost xs" data-dismiss="${esc(o.id)}" style="align-self:flex-start">${esc(t('dismiss'))}</button></div>`).join('');
}

export function pickFarmView() {
  const u = me();
  const farms = teamFarms(u.teamId);
  const cur = teamFarm(u.teamId)?.id;
  return {
    html: `<div class="screen">${topbar({ back: '#/' })}<main class="content">
      <h1 class="h1">${esc(t('your_farms'))}</h1>
      <ul class="list">${farms.map(f => `<li><button class="linkbtn rowlink" data-farm="${f.id}" style="text-decoration:none;color:var(--ink);width:100%;display:flex;gap:12px;align-items:center">
        <strong style="min-width:52px">${f.id}</strong><span class="muted">${esc(f.region)}</span>
        <span class="r">${farmProgress(f)}%</span>${f.id === cur ? '<span class="tag dark">✓</span>' : ''}</button></li>`).join('')}</ul>
    </main></div>`,
    mount(root) {
      root.querySelectorAll('[data-farm]').forEach(b => b.onclick = async () => {
        state.farmPick[u.teamId] = b.dataset.farm;
        await save();
        go('#/');
      });
    },
  };
}

// ---------------- Daily update flow ----------------
function getDraft(f) {
  const key = `${f.id}|${dateKey()}`;
  if (!state.drafts[key]) {
    state.drafts[key] = {
      key, farmId: f.id, date: dateKey(), step: 'intro', idx: 0, trail: [], pending: null, returnToSummary: false,
      items: STAGES.map(s => ({ stage: s.id, prev: f.stages[s.id] || 0, next: null, action: null, photoId: null })),
      issue: { mode: null, category: null, stage: null, note: '', photoId: null },
      location: null, startedAt: Date.now(),
    };
  }
  return state.drafts[key];
}

export function updateView({ farmId }) {
  const f = farm(farmId), u = me();
  if (reportFor(f.id, dateKey())) { go('#/'); return { html: '' }; }
  const d = getDraft(f);
  const n = STAGES.length;
  const cur = d.items[d.idx];
  const photoCount = d.items.filter(i => i.photoId).length + (d.issue.photoId ? 1 : 0);

  const to = (step, patch = {}) => { d.trail.push({ step: d.step, idx: d.idx }); Object.assign(d, { step }, patch); commit(); };
  const commit = () => save().then(() => window.dispatchEvent(new Event('rerender')));
  const nextStage = () => {
    if (d.returnToSummary) return to('summary', { returnToSummary: false });
    if (d.idx < n - 1) to('stage', { idx: d.idx + 1, pending: null });
    else to('issue');
  };

  let body = '', progressW = 0;
  switch (d.step) {
    case 'intro':
      body = `<div class="h2">${esc(f.id)}</div>
        <div class="eyebrow">${esc(t('todays_update'))}</div>
        <div class="h2 upper" style="font-size:22px">${n} ${esc(t('items_to_review'))}</div>
        <ul class="list">${STAGES.map(s => `<li>${esc(stageName(s.id))}<span class="r muted small">${pct(f.stages[s.id])}</span></li>`).join('')}</ul>
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
      const is = d.issue;
      body = `<p class="question" style="font-size:22px">${esc(t('anything_blocking'))}</p>
        <div class="btn-row"><button class="btn ghost" data-act="noissue">${esc(t('no'))}</button>
        <button class="btn ${is.mode === 'report' ? '' : 'ghost'}" data-act="reportmode">${esc(t('report_issue'))}</button></div>
        ${is.mode === 'report' ? `
          <div class="eyebrow">${esc(t('category'))}</div>
          <div class="catgrid">${CATEGORIES.map(c => `<button class="cat ${is.category === c ? 'on' : ''}" data-cat="${c}">${esc(t('cat_' + c))}</button>`).join('')}</div>
          <div class="eyebrow">${esc(t('which_stage'))}</div>
          <div class="chips">${[null, ...STAGES.map(s => s.id)].map(s => `<button class="cat ${is.stage === s ? 'on' : ''}" data-st="${s ?? ''}" style="padding:0 14px;flex:0 0 auto">${esc(stageName(s))}</button>`).join('')}</div>
          <div class="eyebrow">${esc(t('take_choose_photo'))} <span class="muted">(${esc(t('optional'))})</span></div>
          ${is.photoId ? `<button data-zoom="${is.photoId}" style="border:0;padding:0;background:none">${photoImg(is.photoId).replace('<img', '<img class="photo-preview"')}</button>` : ''}
          <div class="btn-row"><button class="btn ghost sm" data-act="icamera" style="width:100%">${esc(t('take_photo'))}</button>
            <button class="btn ghost sm" data-act="igallery" style="width:100%">${esc(t('choose_from_phone'))}</button></div>
          <textarea class="input" data-note placeholder="${esc(t('describe'))}">${esc(is.note)}</textarea>
          <button class="btn" data-act="report" ${is.category && (is.note.trim() || is.photoId) ? '' : 'disabled'}>${esc(t('report'))}</button>` : ''}`;
      break;
    }

    case 'summary': {
      progressW = 100;
      const rows = d.items.map((it, i) => {
        let val, note = '';
        const waiting = d.issue.mode === 'report' && d.issue.stage === it.stage && it.action !== 'updated';
        if (it.action === 'updated') { val = `${it.prev} → ${it.next}%`; note = t('photo_ok'); }
        else if (it.prev >= 100) { val = '100%'; note = '✓'; }
        else if (it.prev === 0) { val = `<span style="font-weight:400">${esc(t('not_started'))}</span>`; }
        else { val = `${it.prev}%`; note = t('no_change'); }
        if (waiting) note = t('waiting');
        return `<tr data-edit="${i}" style="cursor:pointer"><td>${esc(stageName(it.stage))}</td><td class="num">${val}</td><td>${esc(note)}</td></tr>`;
      }).join('');
      const is = d.issue;
      const loc = d.location;
      const locLine = !loc ? t('checking_location')
        : loc.error ? t('location_unavailable')
        : loc.verified ? t('location_verified') : t('location_far', { km: loc.distKm.toFixed(1) });
      body = `<div class="h2">${esc(f.id)} · ${esc(t('today').toUpperCase())}</div>
        <div class="tbl-wrap"><table class="tbl"><tbody>${rows}
          ${is.mode === 'report' ? `<tr><td>${esc(t('issue_reported'))}</td><td>${esc(t('cat_' + is.category))}</td><td>${is.photoId ? esc(t('photo_ok')) : ''}</td></tr>` : ''}
        </tbody></table></div>
        <div><div class="strong">${d.items.filter(i => i.action).length} / ${n} ${esc(t('reviewed'))} · ${photoCount} ${esc(photoCount === 1 ? t('photo_1') : t('photos_n'))}</div>
          <div style="${loc && !loc.verified ? 'color:var(--red)' : ''}">${esc(locLine)}</div></div>
        <div class="card flat stack"><div class="eyebrow muted">${esc(t('connectivity'))}</div><div data-conn>…</div></div>
        <span class="spacer"></span>
        <button class="btn" data-act="submit">${esc(t('submit_day'))}</button>`;
      break;
    }
  }

  const backBtn = d.trail.length ? `<button class="iconbtn flip" data-act="back" aria-label="${esc(t('back'))}">${ICONS.back}</button>` : `<a class="iconbtn flip" href="#/" aria-label="${esc(t('home'))}">${ICONS.back}</a>`;
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

      const is = d.issue;
      on('noissue', () => { Object.assign(is, { mode: 'none', category: null, stage: null, note: '', photoId: null }); to('summary'); });
      on('reportmode', () => { is.mode = 'report'; commit(); });
      root.querySelectorAll('[data-cat]').forEach(b => b.onclick = () => { is.category = b.dataset.cat; commit(); });
      root.querySelectorAll('[data-st]').forEach(b => b.onclick = () => { is.stage = b.dataset.st || null; commit(); });
      const note = root.querySelector('[data-note]');
      if (note) note.oninput = () => {
        is.note = note.value;
        root.querySelector('[data-act=report]').disabled = !(is.category && (is.note.trim() || is.photoId));
        save();
      };
      const issueMeta = () => ({ stage: is.stage, progress: null, kind: 'issue' });
      on('icamera', () => capture(true, issueMeta(), id => { is.photoId = id; }));
      on('igallery', () => capture(false, issueMeta(), id => { is.photoId = id; }));
      on('report', () => to('summary'));

      root.querySelectorAll('[data-edit]').forEach(r => r.onclick = () => to('stage', { idx: +r.dataset.edit, returnToSummary: true }));
      on('submit', () => submit(f, u, d));

      if (d.step === 'summary') {
        connectivitySummary().then(s => { const el = root.querySelector('[data-conn]'); if (el) el.innerHTML = connBlock(s); });
        if (!d.location) {
          getPosition().then(p => {
            d.location = p
              ? { ...p, distKm: distanceKm(p, f.gps), verified: distanceKm(p, f.gps) <= LOCATION_RADIUS_KM, at: Date.now() }
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
  const issue = d.issue.mode === 'report'
    ? { stage: d.issue.stage, category: d.issue.category, note: d.issue.note.trim(), photoId: d.issue.photoId, lang: getLang() }
    : null;
  delete state.drafts[d.key];
  await queueReport(report, issue);
  location.hash = `#/done/${report.id}`;
}

export function doneView({ reportId }) {
  const r = state.reports.find(x => x.id === reportId);
  if (!r) { go('#/'); return { html: '' }; }
  const queued = state.outbox.find(o => o.id === r.id);
  const photos = queued ? queued.photoIds.length
    : r.items.filter(i => i.photoId).length + (r.issueId && state.issues.find(i => i.id === r.issueId)?.photoId ? 1 : 0);
  return {
    html: `<div class="screen">${topbar()}<main class="content">
      <div class="eyebrow">${esc(r.farmId)}</div>
      <div class="check">✓</div>
      <div class="h2 upper">${esc(t('day_submitted'))}</div>
      <div class="h2" style="font-size:22px">${hhmm(r.submittedAt)}</div>
      <hr>
      <div>${r.items.length} / ${r.items.length} ${esc(t('reviewed'))}<br>${photos} ${esc(photos === 1 ? t('photo_1') : t('photos_n'))}<br>
        ${esc(r.location?.verified ? t('location_verified') : r.location ? t('location_far', { km: (r.location.distKm ?? 0).toFixed(1) }) : t('location_unavailable'))}</div>
      <p class="muted">${esc(t('you_are_finished'))}${r.pending ? '<br>' + esc(t('saved_offline')) : ''}</p>
      <span class="spacer"></span>
      <div class="btn" style="cursor:default">${esc(r.farmId)} ${esc(t('updated'))}</div>
      <a class="btn ghost" href="#/">${esc(t('home'))}</a>
    </main></div>`,
  };
}
