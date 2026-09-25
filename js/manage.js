// Management: "sees the day in seconds" dashboard and the farm list.
import { t, getLang } from './i18n.js';
import { STAGES, dateKey, hhmm, niceDate, farmProgress, farmStatus } from './data.js';
import { state, save, user, team, teamFarm, reportFor } from './store.js';
import { esc, stageName, topbar, timeLabel, connBlock, progressBar } from './ui.js';

export function mgrNav(active) {
  const a = (k, href, label) => `<a class="${active === k ? 'on' : ''}" href="${href}">${esc(label)}</a>`;
  return `<nav class="segmented">${a('dash', '#/manage', t('dashboard'))}${a('farms', '#/manage/farms', t('farms'))}${a('client', '#/client', t('client_portal'))}</nav>`;
}

export function dashboardView() {
  const today = dateKey();
  const todays = state.reports.filter(r => r.date === today).sort((a, b) => b.submittedAt - a.submittedAt);
  const teamsReported = new Set(todays.map(r => r.teamId));
  const missing = state.teams.filter(tm => !teamsReported.has(tm.id));
  const openIssues = state.issues.filter(i => i.status === 'open').sort((a, b) => b.at - a.at);
  const farmsUpdated = new Set(todays.map(r => r.farmId)).size;

  const issueReport = i => state.reports.find(r => r.issueId === i.id);
  const attention = [
    ...openIssues.map(i => {
      const r = issueReport(i);
      return `<tr><td class="num">${esc(i.farmId)}</td><td>${esc(stageName(i.stage))} / ${esc(t('cat_' + i.category))}</td>
        <td>${esc(t('reported_by', { n: user(i.reportedBy)?.name || '—', t: hhmm(i.at) }))}</td>
        <td><a class="btn xs" href="${r ? `#/report/${r.id}` : `#/farm/${i.farmId}/issues`}">${esc(t('review'))}</a></td></tr>`;
    }),
    ...missing.map(tm => {
      const f = teamFarm(tm.id);
      const fu = state.followUps[`${tm.id}|${today}`];
      return `<tr><td class="num">${esc(f.id)}</td><td>${esc(t('daily_report_missing'))}</td>
        <td>${esc(tm.name)} · ${esc(fu ? t('followed_up', { t: hhmm(fu) }) : t('awaiting_report'))}</td>
        <td><button class="btn xs" data-follow="${tm.id}" ${fu ? 'disabled' : ''}>${esc(t('follow_up'))}</button></td></tr>`;
    }),
  ].join('');

  const reported = todays.map(r => {
    const changes = r.items.filter(i => i.action === 'updated').map(i => `${stageName(i.stage)} ${i.prev} → ${i.next}%`).join(' · ');
    return `<tr><td class="num">${esc(r.farmId)}</td><td>${esc(changes || t('no_changes'))}${r.issueId ? ` <span class="tag warn">${esc(t('issues'))}</span>` : ''}</td>
      <td>${esc(team(r.teamId).name)} / ${esc(user(r.userId)?.name)} · ${hhmm(r.submittedAt)}
        ${r.location && !r.location.verified ? `<span class="tag warn">GPS</span>` : ''}</td>
      <td><a class="btn xs" href="#/report/${r.id}">${esc(t('review'))}</a></td></tr>`;
  }).join('');

  // Each team's phone connectivity, taken from the latest report it sent.
  const teamRows = state.teams.map(tm => {
    const last = state.reports.filter(r => r.teamId === tm.id).sort((a, b) => b.submittedAt - a.submittedAt)[0];
    const rep = reportFor(teamFarm(tm.id).id, today);
    return `<div class="card flat stack">
      <div class="row between"><strong>${esc(tm.name)} · ${esc(teamFarm(tm.id).id)}</strong>
        <span class="tag ${rep ? 'ok' : 'warn'}">${esc(rep ? `${t('reported')} ${hhmm(rep.submittedAt)}` : t('not_reported'))}</span></div>
      <div class="small muted">${esc(t('last_net'))}${last ? ` · ${esc(t('last_report'))} ${esc(timeLabel(last.submittedAt))}` : ''}</div>
      ${connBlock(last?.connectivity, { compact: true })}
    </div>`;
  }).join('');

  return {
    html: `<div class="screen wide">${topbar()}<main class="content">
      <div class="row between">${mgrNav('dash')}<span class="eyebrow muted">${esc(niceDate(Date.now(), getLang()))}</span></div>
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
    </main></div>`,
    mount(root) {
      root.querySelectorAll('[data-follow]').forEach(b => b.onclick = async () => {
        state.followUps[`${b.dataset.follow}|${today}`] = Date.now();
        await save();
        window.dispatchEvent(new Event('rerender'));
      });
    },
  };
}

export function farmsListView() {
  const q = (new URLSearchParams(location.hash.split('?')[1] || '').get('q') || '').toLowerCase();
  const farms = state.farms.filter(f => !q || f.id.toLowerCase().includes(q) || f.region.toLowerCase().includes(q));
  const lastRep = f => state.reports.filter(r => r.farmId === f.id).sort((a, b) => b.submittedAt - a.submittedAt)[0];
  const rows = farms.map(f => {
    const p = farmProgress(f), lr = lastRep(f);
    const open = state.issues.filter(i => i.farmId === f.id && i.status === 'open').length;
    const st = farmStatus(f);
    return `<tr><td class="num"><a href="#/farm/${f.id}">${esc(f.id)}</a></td><td>${esc(f.region)}</td><td>${esc(team(f.teamId).name)}</td>
      <td style="min-width:140px"><div class="row" style="flex-wrap:nowrap"><span style="width:42px">${p}%</span><span style="flex:1">${progressBar(p)}</span></div></td>
      <td><span class="tag ${st === 'completed' ? 'ok' : st === 'in_progress' ? 'amber' : ''}">${esc(t(st))}</span></td>
      <td class="small">${lr ? esc(timeLabel(lr.submittedAt)) : '—'}</td>
      <td>${open ? `<span class="tag warn">${open}</span>` : ''}</td></tr>`;
  }).join('');
  return {
    html: `<div class="screen wide">${topbar()}<main class="content">
      <div class="row between">${mgrNav('farms')}<button class="btn xs" data-act="csv">${esc(t('export_csv'))}</button></div>
      <h1 class="h1">${esc(t('all_farms'))} · ${state.farms.length}</h1>
      <input class="input" data-q placeholder="${esc(t('search'))}" value="${esc(q)}" style="max-width:360px">
      <div class="card"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>${esc(t('farm'))}</th><th></th><th>${esc(t('team'))}</th><th>${esc(t('progress'))}</th><th></th><th>${esc(t('last_report'))}</th><th>${esc(t('issues'))}</th></tr></thead>
      <tbody>${rows}</tbody></table></div></div>
    </main></div>`,
    mount(root) {
      const inp = root.querySelector('[data-q]');
      inp.onchange = () => { location.hash = `#/manage/farms?q=${encodeURIComponent(inp.value)}`; };
      root.querySelector('[data-act=csv]').onclick = exportCSV;
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
