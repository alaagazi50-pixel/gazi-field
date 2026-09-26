// Management: "sees the day in seconds" dashboard and the farm list.
import { t, getLang } from './i18n.js';
import { STAGES, dateKey, hhmm, niceDate, farmProgress, farmStatus } from './data.js';
import { state, me, user, team, teamFarm, farm, reportIssues, markFollowUp, remindTeam, refresh, addFarm } from './store.js';
import { esc, stageName, topbar, timeLabel, connBlock, progressBar, fail, ago, toast, parseGps, farmTitle } from './ui.js';
import { summarize } from './connectivity.js';

export function mgrNav(active) {
  const a = (k, href, label) => `<a class="${active === k ? 'on' : ''}" href="${href}">${esc(label)}</a>`;
  return `<nav class="segmented">${a('dash', '#/manage', t('dashboard'))}${me()?.role === 'supervisor' ? a('analysis', '#/manage/analysis', t('analysis')) : ''}${a('farms', '#/manage/farms', t('farms'))}${a('people', '#/manage/people', t('people'))}${a('client', '#/client', t('client_portal'))}</nav>`;
}

let phoneHours = 12;

// Every field worker's phone: when it last had internet, and a timeline. Oldest contact first.
function phonesSection() {
  const now = Date.now();
  const workers = state.users.filter(u => u.role === 'field' && u.active).map(u => {
    const p = state.phones.find(x => x.userId === u.id);
    return { u, p, sum: p ? summarize(p.samples, phoneHours, now) : null };
  }).sort((a, b) => (a.p?.lastOnline ?? 0) - (b.p?.lastOnline ?? 0) || a.u.name.localeCompare(b.u.name));
  const seg = [12, 24, 72].map(h => `<a href="javascript:void 0" data-hours="${h}" class="${h === phoneHours ? 'on' : ''}">${h} h</a>`).join('');
  const card = ({ u, p, sum }) => {
    const stale = !p?.lastOnline || now - p.lastOnline > 6 * 3600e3;
    return `<div class="card flat stack">
      <div class="row between"><strong>${esc(u.name)}</strong><span class="small muted">${esc(team(u.teamId).name)}</span></div>
      ${p?.lastOnline
        ? `<div class="small ${stale ? 'strong' : ''}" style="${stale ? 'color:var(--red)' : ''}">${esc(t('last_internet', { t: timeLabel(p.lastOnline) }))} · ${esc(ago(p.lastOnline, now))}</div>`
        : `<div class="small strong" style="color:var(--red)">${esc(t('no_phone_data'))}</div>`}
      ${sum ? connBlock(sum, { compact: true, headline: false }) : ''}
    </div>`;
  };
  return `<div class="row between"><div class="eyebrow">${esc(t('phones_title'))}</div><nav class="segmented" data-phonehours>${seg}</nav></div>
    <div class="small muted">${esc(t('phones_note'))}</div>
    ${workers.length ? `<div class="grid c3">${workers.map(card).join('')}</div>` : `<div class="empty">—</div>`}`;
}

export function dashboardView() {
  const today = dateKey();
  const todays = state.reports.filter(r => r.date === today).sort((a, b) => b.submittedAt - a.submittedAt);
  const teamsReported = new Set(todays.map(r => r.teamId));
  const missing = state.teams.filter(tm => !teamsReported.has(tm.id));
  const openIssues = state.issues.filter(i => i.status === 'open').sort((a, b) => b.at - a.at);
  const farmsUpdated = new Set(todays.map(r => r.farmId)).size;

  const issueReport = i => state.reports.find(r => r.id === i.reportId || r.issueId === i.id);
  const attention = [
    ...openIssues.map(i => {
      const r = issueReport(i);
      return `<tr><td class="num">${esc(farmTitle(farm(i.farmId) || { id: i.farmId }))}</td><td>${esc(stageName(i.stage))} / ${esc(t('cat_' + i.category))}</td>
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

  // Each team's phone connectivity, taken from the latest report it sent.
  const teamRows = state.teams.map(tm => {
    const last = state.reports.filter(r => r.teamId === tm.id).sort((a, b) => b.submittedAt - a.submittedAt)[0];
    const tf = teamFarm(tm.id);
    const rep = todays.find(r => r.teamId === tm.id);
    return `<div class="card flat stack">
      <div class="row between"><strong>${esc(tm.name)} · ${esc(tf?.id || '—')}</strong>
        <span class="tag ${rep ? 'ok' : 'warn'}">${esc(rep ? `${t('reported')} ${hhmm(rep.submittedAt)}` : t('not_reported'))}</span></div>
      <div class="small muted">${esc(t('last_net'))}${last ? ` · ${esc(t('last_report'))} ${esc(timeLabel(last.submittedAt))}` : ''}</div>
      ${connBlock(last?.connectivity, { compact: true })}
    </div>`;
  }).join('');

  return {
    html: `<div class="screen wide">${topbar()}<main class="content">
      <div class="row between">${mgrNav('dash')}<span class="row"><span class="eyebrow muted">${esc(niceDate(Date.now(), getLang()))}${state.lastSync ? ` · ${esc(t('synced_at', { t: hhmm(state.lastSync) }))}` : ''}</span>
        <button class="btn ghost xs" data-act="refresh">${esc(t('refresh'))}</button></span></div>
      ${state.syncError ? `<div class="card alert flat small">${esc(t('sync_failed'))}</div>` : ''}
      <h1 class="h1">${esc(t('dashboard'))}</h1>
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
      ${phonesSection()}
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
      root.querySelectorAll('[data-hours]').forEach(a => a.onclick = () => { phoneHours = +a.dataset.hours; window.dispatchEvent(new Event('rerender')); });
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
    return `<tr><td class="num"><a href="#/farm/${f.id}">${esc(f.id)}</a></td><td>${esc(f.name || '')}<div class="small muted">${esc(f.region)}</div></td><td>${esc(team(f.teamId).name)}</td>
      <td style="min-width:140px"><div class="row" style="flex-wrap:nowrap"><span style="width:42px">${p}%</span><span style="flex:1">${progressBar(p)}</span></div></td>
      <td><span class="tag ${st === 'completed' ? 'ok' : st === 'in_progress' ? 'amber' : ''}">${esc(t(st))}</span></td>
      <td class="small">${lr ? esc(timeLabel(lr.submittedAt)) : '—'}</td>
      <td>${open ? `<span class="tag warn">${open}</span>` : ''}</td></tr>`;
  }).join('');
  return {
    html: `<div class="screen wide">${topbar()}<main class="content">
      <div class="row between">${mgrNav('farms')}<button class="btn xs" data-act="csv">${esc(t('export_csv'))}</button></div>
      <h1 class="h1">${esc(t('all_farms'))} · ${state.farms.length}</h1>
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
