// Management: "sees the day in seconds" dashboard and the farm list.
import { t, getLang } from './i18n.js';
import { STAGES, dateKey, hhmm, niceDate, farmProgress, farmStatus } from './data.js';
import { state, me, user, team, teamFarm, farm, reportIssues, markFollowUp, remindTeam, refresh, addFarm, uploadDrawings, pushState, enablePush, testPush } from './store.js';
import { esc, stageName, topbar, timeLabel, progressBar, fail, toast, parseGps, farmTitle } from './ui.js';

export function mgrNav(active) {
  const a = (k, href, label) => `<a class="${active === k ? 'on' : ''}" href="${href}">${esc(label)}</a>`;
  return `<nav class="segmented">${a('dash', '#/manage', t('dashboard'))}${me()?.role === 'supervisor' ? a('analysis', '#/manage/analysis', t('analysis')) : ''}${a('farms', '#/manage/farms', t('farms'))}${a('people', '#/manage/people', t('people'))}${a('client', '#/client', t('client_portal'))}</nav>`;
}

async function alertsCard() {
  const st = await pushState();
  if (st !== 'off') return '';
  return `<div class="card flat row between"><div class="stack" style="gap:2px;flex:1;min-width:200px"><strong>${esc(t('urgent_alerts'))}</strong>
    <span class="small muted">${esc(t('urgent_alerts_why'))}</span></div><button class="btn sm" data-act="alerts">${esc(t('push_enable'))}</button></div>`;
}

export async function dashboardView() {
  const today = dateKey();
  const todays = state.reports.filter(r => r.date === today).sort((a, b) => b.submittedAt - a.submittedAt);
  const teamsReported = new Set(todays.map(r => r.teamId));
  const missing = state.teams.filter(tm => !teamsReported.has(tm.id));
  const openIssues = state.issues.filter(i => i.status === 'open' && !i.pending).sort((a, b) => (b.urgent - a.urgent) || b.at - a.at);
  const farmsUpdated = new Set(todays.map(r => r.farmId)).size;

  const issueReport = i => state.reports.find(r => r.id === i.reportId || r.issueId === i.id);
  const attention = [
    ...openIssues.map(i => {
      const r = issueReport(i);
      return `<tr style="${i.urgent ? 'background:#fdecE4' : ''}"><td class="num">${esc(farmTitle(farm(i.farmId) || { id: i.farmId }))}</td>
        <td>${i.urgent ? `<span class="tag warn">⚠ ${esc(t('urgent_tag'))}</span> ` : ''}${esc(stageName(i.stage))} / ${esc(t('cat_' + i.category))}${i.note ? `<div class="small muted" dir="auto">${esc(i.note.slice(0, 90))}</div>` : ''}</td>
        <td>${esc(t('reported_by', { n: user(i.reportedBy)?.name || '—', t: hhmm(i.at) }))}</td>
        <td><a class="btn xs" href="${r ? `#/report/${r.id}` : `#/farm/${i.farmId}/issues`}">${esc(t('review'))}</a></td></tr>`;
    }),
    ...missing.map(tm => {
      const f = tm.todayFarm && farm(tm.todayFarm);
      const fu = state.followUps[`${tm.id}|${today}`];
      return `<tr><td class="num">${esc(f ? farmTitle(f) : tm.name)}</td><td>${esc(t('daily_report_missing'))}</td>
        <td>${esc(tm.name)} · ${esc(fu ? t('followed_up', { t: hhmm(fu) }) : t('awaiting_report'))}</td>
        <td><button class="btn xs" data-follow="${tm.id}" ${fu ? 'disabled' : ''}>${esc(t('follow_up'))}</button></td></tr>`;
    }),
  ].join('');

  const reported = todays.map(r => {
    const changes = r.items.filter(i => i.action === 'updated').map(i => `${stageName(i.stage)} ${i.prev} → ${i.next}%`).join(' · ');
    const n = reportIssues(r).length;
    return `<tr><td class="num">${esc(farmTitle(farm(r.farmId) || { id: r.farmId }))}</td><td>${esc(changes || t('no_changes'))}${n ? ` <span class="tag warn">${esc(t('issues'))} · ${n}</span>` : ''}</td>
      <td>${r.teamId ? esc(team(r.teamId).name) + ' / ' : ''}${esc(user(r.userId)?.name)} · ${hhmm(r.submittedAt)}
        ${r.location && !r.location.verified ? `<span class="tag warn">GPS</span>` : ''}</td>
      <td><a class="btn xs" href="#/report/${r.id}">${esc(t('review'))}</a></td></tr>`;
  }).join('');

  const teamRows = state.teams.map(tm => {
    const tf = teamFarm(tm.id);
    const rep = todays.find(r => r.teamId === tm.id);
    return `<div class="card flat stack">
      <div class="row between"><strong>${esc(tm.name)} · ${esc(tf?.id || '—')}</strong>
        <span class="tag ${rep ? 'ok' : 'warn'}">${esc(rep ? `${t('reported')} ${hhmm(rep.submittedAt)}` : t('not_reported'))}</span></div>
    </div>`;
  }).join('');

  return {
    html: `<div class="screen wide">${topbar()}<main class="content">
      <div class="row between">${mgrNav('dash')}<span class="row"><span class="eyebrow muted">${esc(niceDate(Date.now(), getLang()))}${state.lastSync ? ` · ${esc(t('synced_at', { t: hhmm(state.lastSync) }))}` : ''}</span>
        <button class="btn ghost xs" data-act="refresh">${esc(t('refresh'))}</button></span></div>
      ${state.syncError ? `<div class="card alert flat small">${esc(t('sync_failed'))}</div>` : ''}
      <h1 class="h1">${esc(t('dashboard'))}</h1>
      ${await alertsCard()}
      <div class="card stack" style="gap:18px">
        <div class="eyebrow">GAZI FIELD · ${esc(state.project.name.toUpperCase())} · ${esc(t('today').toUpperCase())}</div>
        <div class="grid c3">
          <div class="kpi"><span class="v">${teamsReported.size} / ${state.teams.length}</span><span>${esc(t('teams_reported'))}</span></div>
          <div class="kpi"><span class="v">${farmsUpdated}</span><span>${esc(t('farms_updated'))}</span></div>
          <div class="kpi ${openIssues.length + missing.length ? 'hot' : ''}"><span class="v">${openIssues.length + missing.length}</span><span>${esc(t('need_attention'))}</span></div>
        </div>
        ${attention ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>${esc(t('farm'))}</th><th>${esc(t('update'))}</th><th>${esc(t('reported'))}</th><th>${esc(t('action'))}</th></tr></thead><tbody>${attention}</tbody></table></div>` : ''}
      </div>
      <div class="card stack">
        <div class="eyebrow">${esc(t('reported_today'))}</div>
        ${reported ? `<div class="tbl-wrap"><table class="tbl"><tbody>${reported}</tbody></table></div>` : `<div class="empty">${esc(t('no_history'))}</div>`}
      </div>
      <div class="eyebrow">${esc(t('teams_status'))}</div>
      <div class="grid c3">${teamRows}</div>
    </main></div>`,
    mount(root) {
      root.querySelectorAll('[data-follow]').forEach(b => b.onclick = async () => {
        try {
          await markFollowUp(b.dataset.follow, today);
          // Also push a reminder to that team's phones (only if reminders are set up in Supabase).
          const res = await remindTeam(b.dataset.follow).catch(() => null);
          toast(res ? t('reminder_sent', { n: res.people || 0 }) : t('followed_up', { t: hhmm(Date.now()) }));
        } catch (err) { fail(err); }
      });
      root.querySelector('[data-act=refresh]').onclick = () => refresh();
      const alerts = root.querySelector('[data-act=alerts]');
      if (alerts) alerts.onclick = async () => {
        try { await enablePush(); toast(t('push_on')); testPush().catch(() => {}); window.dispatchEvent(new Event('rerender')); } catch (err) { fail(err); }
      };
    },
  };
}

export function farmsListView() {
  const q = (new URLSearchParams(location.hash.split('?')[1] || '').get('q') || '').toLowerCase();
  const farms = state.farms.filter(f => !q || [f.id, f.name, f.region].some(x => (x || '').toLowerCase().includes(q)));
  const lastRep = f => state.reports.filter(r => r.farmId === f.id).sort((a, b) => b.submittedAt - a.submittedAt)[0];
  const rows = farms.map(f => {
    const p = farmProgress(f), lr = lastRep(f);
    const open = state.issues.filter(i => i.farmId === f.id && i.status === 'open').length;
    const st = farmStatus(f);
    return `<tr style="${f.status === 'cancelled' ? 'opacity:.55' : ''}"><td class="num"><a href="#/farm/${f.id}">${esc(f.id)}</a>${f.status === 'cancelled' ? `<div><span class="tag warn">${esc(t('cancelled'))}</span></div>` : ''}${f.drawingPhotoId ? '' : ''}</td><td>${esc(f.name || '')}<div class="small muted">${esc(f.region)}</div></td><td>${esc(team(f.teamId).name)}</td>
      <td style="min-width:140px"><div class="row" style="flex-wrap:nowrap"><span style="width:42px">${p}%</span><span style="flex:1">${progressBar(p)}</span></div></td>
      <td><span class="tag ${st === 'completed' ? 'ok' : st === 'in_progress' ? 'amber' : ''}">${esc(t(st))}</span></td>
      <td class="small">${lr ? esc(timeLabel(lr.submittedAt)) : '—'}</td>
      <td>${open ? `<span class="tag warn">${open}</span>` : ''}</td></tr>`;
  }).join('');
  return {
    html: `<div class="screen wide">${topbar()}<main class="content">
      <div class="row between">${mgrNav('farms')}<button class="btn xs" data-act="csv">${esc(t('export_csv'))}</button></div>
      <h1 class="h1">${esc(t('all_farms'))} · ${state.farms.length}</h1>
      <div class="card flat row between"><div class="stack" style="gap:2px;flex:1;min-width:220px"><strong>${esc(t('upload_drawings'))}</strong>
        <span class="small muted">${esc(t('upload_drawings_hint'))}</span></div>
        <button class="btn ghost sm" data-act="drawings">${esc(t('upload_drawings'))}</button></div>
      <details class="card flat"><summary class="h3" style="cursor:pointer">${esc(t('add_farm'))}</summary>
        <form class="form" data-addfarm style="max-width:520px;margin-top:14px">
          <label>${esc(t('farm_code'))}<input class="input" name="id" id="nf-id" required pattern="[A-Za-z0-9_\\-]{2,12}" placeholder="HM25" autocomplete="off"></label>
          <label>${esc(t('farm_name'))}<input class="input" name="name" id="nf-name" placeholder="${esc(t('farm_name_hint'))}" autocomplete="off"></label>
          <label>${esc(t('region'))}<input class="input" name="region" id="nf-region" required placeholder="Huambo" list="nf-regions">
            <datalist id="nf-regions">${[...new Set(state.farms.map(f => f.region))].map(r => `<option value="${esc(r)}">`).join('')}</datalist></label>
          <label>${esc(t('team'))}<select class="input" name="team" id="nf-team"><option value="">${esc(t('no_team'))}</option>
            ${state.teams.map(tm => `<option value="${esc(tm.id)}">${esc(tm.name)}</option>`).join('')}</select></label>
          <label>${esc(t('gps_optional'))}<input class="input" name="gps" id="nf-gps" placeholder="-12.7765, 15.7391" inputmode="decimal"></label>
          <button class="btn sm" type="submit" style="align-self:flex-start">${esc(t('add_farm'))}</button>
        </form></details>
      <input class="input" data-q placeholder="${esc(t('search'))}" value="${esc(q)}" style="max-width:360px">
      <div class="card"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>${esc(t('farm'))}</th><th></th><th>${esc(t('team'))}</th><th>${esc(t('progress'))}</th><th></th><th>${esc(t('last_report'))}</th><th>${esc(t('issues'))}</th></tr></thead>
      <tbody>${rows}</tbody></table></div></div>
    </main></div>`,
    mount(root) {
      const inp = root.querySelector('[data-q]');
      inp.onchange = () => { location.hash = `#/manage/farms?q=${encodeURIComponent(inp.value)}`; };
      root.querySelector('[data-act=csv]').onclick = exportCSV;
      root.querySelector('[data-act=drawings]').onclick = () => {
        const inp = document.createElement('input');
        inp.type = 'file'; inp.accept = 'image/*'; inp.multiple = true;
        inp.onchange = async () => {
          const files = [...inp.files];
          if (!files.length) return;
          try {
            const res = await uploadDrawings(files, (i, n) => toast(t('uploading_n', { i, n })));
            toast(t('drawings_uploaded', { n: res.done }) + (res.missing.length ? ' · ' + t('drawing_no_farm', { f: res.missing.join(', ') }) : ''));
          } catch (err) { fail(err); }
        };
        inp.click();
      };
      const form = root.querySelector('[data-addfarm]');
      form.onsubmit = async e => {
        e.preventDefault();
        const btn = form.querySelector('[type=submit]');
        btn.disabled = true;
        try {
          const v = Object.fromEntries(new FormData(form));
          const gps = parseGps(v.gps);
          const id = v.id.trim().toUpperCase();
          await addFarm({ id, name: v.name.trim(), region: v.region.trim(), teamId: v.team, lat: gps?.lat, lng: gps?.lng });
          toast(t('farm_added', { id }));
          location.hash = `#/farm/${id}`;
        } catch (err) { fail(err); } finally { btn.disabled = false; }
      };
    },
  };
}

function exportCSV() {
  const head = ['farm', 'region', 'team', 'progress', ...STAGES.map(s => s.id), 'open_issues', 'last_report'];
  const lines = [head.join(',')];
  for (const f of state.farms) {
    const lr = state.reports.filter(r => r.farmId === f.id).sort((a, b) => b.submittedAt - a.submittedAt)[0];
    lines.push([f.id, f.region, f.teamId, farmProgress(f), ...STAGES.map(s => f.stages[s.id]),
      state.issues.filter(i => i.farmId === f.id && i.status === 'open').length,
      lr ? new Date(lr.submittedAt).toISOString() : ''].join(','));
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
  a.download = `gazi-field-progress-${dateKey()}.csv`;
  a.click();
}
