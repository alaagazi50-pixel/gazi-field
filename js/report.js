// Client progress report: one printable page (A4 landscape) that the phone or computer saves as PDF.
// Built only from what the client may see (farms and their stages), so it never shows internal notes or names.
import { t, getLang } from './i18n.js';
import { STAGES, farmProgress, completion, byFarmCode, byRegion, hhmm, materialsOf, ddmmyyyy } from './data.js';
import { state } from './store.js';
import { esc, stageName, topbar } from './ui.js';

const dateLong = ms => new Date(ms).toLocaleDateString(getLang() === 'pt' ? 'pt-PT' : getLang() === 'ar' ? 'ar' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
const dateShort = ms => (ms ? new Date(ms).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '.') : '—');
const CLIENT = 'NETAFIM';
// Long stage names in narrow columns: allow a hyphenated break (Commis-sioning) instead of a random split.
const soft = text => esc(text).replace(/([A-Za-zÀ-ÿ]{6})([A-Za-zÀ-ÿ]{5,})/g, '$1&shy;$2');   // the customer this report is made for
// Materials cell: delivered (date), partly (date), or not yet.
const matCell = f => {
  const m = materialsOf(f), d = m.date ? ddmmyyyy(m.date).slice(0, 5) : '';
  if (m.status === 'delivered') return `<td class="c-ok c-mat">✓ ${d}</td>`;
  if (m.status === 'partial') return `<td class="c-mid c-mat">${esc(t('mat_partial_short'))} ${d}</td>`;
  return `<td class="c-no">–</td>`;
};
const MAT_AFTER = 'room_structure';   // the partner asked for it between Room structure and Excavation
const STATUS = { completed: 'completed', no_power: 'done_no_power', in_progress: 'in_progress', not_started: 'not_started', cancelled: 'cancelled' };

export function progressReportView() {
  const now = Date.now();
  const all = [...state.farms].sort(byFarmCode);
  const live = all.filter(f => f.status !== 'cancelled');
  const regions = [...new Set(live.map(f => f.region || '—'))].sort(byRegion);
  const count = (list, st) => list.filter(f => completion(f) === st).length;
  const mat = list => { const d = list.filter(f => materialsOf(f).status === 'delivered').length, p = list.filter(f => materialsOf(f).status === 'partial').length;
    return `${d}${p ? ` <span class="rp-part">(+${p} ${esc(t('mat_partial_short').toLowerCase())})</span>` : ''}`; };
  const avg = list => (list.length ? Math.round(list.reduce((n, f) => n + farmProgress(f), 0) / list.length) : 0);
  const dataAsOf = Math.max(0, ...live.map(f => f.updatedAt || 0)) || now;

  const kpi = (v, label, cls = '') => `<div class="rp-kpi ${cls}"><b>${v}</b><span>${esc(label)}</span></div>`;
  const regionRows = regions.map(r => {
    const fs = live.filter(f => (f.region || '—') === r);
    return `<tr><td><b>${esc(r)}</b></td><td>${fs.length}</td><td>${count(fs, 'completed')}</td><td>${count(fs, 'no_power')}</td>
      <td>${count(fs, 'in_progress')}</td><td>${count(fs, 'not_started')}</td><td>${mat(fs)}</td><td><b>${avg(fs)}%</b></td></tr>`;
  }).join('') + `<tr class="rp-total"><td><b>${esc(t('total'))}</b></td><td>${live.length}</td><td>${count(live, 'completed')}</td><td>${count(live, 'no_power')}</td>
      <td>${count(live, 'in_progress')}</td><td>${count(live, 'not_started')}</td><td>${mat(live)}</td><td><b>${avg(live)}%</b></td></tr>`;

  const cell = v => (v >= 100 ? `<td class="c-ok">✓</td>` : v > 0 ? `<td class="c-mid">${v}%</td>` : `<td class="c-no">–</td>`);
  const farmRows = r => all.filter(f => (f.region || '—') === r && f.status !== 'cancelled').map(f => {
    const st = completion(f);
    return `<tr><td><b>${esc(f.id)}</b></td><td class="rp-name">${esc(f.name || '')}</td>${STAGES.map(s => cell(f.stages[s.id] || 0) + (s.id === MAT_AFTER ? matCell(f) : '')).join('')}
      <td><b>${farmProgress(f)}%</b></td><td class="st-${st}">${esc(t(STATUS[st]))}</td><td>${dateShort(f.updatedAt)}</td></tr>`;
  }).join('');
  const farmCols = `<colgroup><col class="c-code"><col class="c-name">${STAGES.map(s => '<col class="c-st">' + (s.id === MAT_AFTER ? '<col class="c-matc">' : '')).join('')}<col class="c-pct"><col class="c-status"><col class="c-date"></colgroup>`;
  const farmHead = `<tr><th>${esc(t('farm'))}</th><th>${esc(t('name'))}</th>${STAGES.map(s => `<th class="rp-st" title="${esc(stageName(s.id))}">${soft(stageName(s.id))}</th>` + (s.id === MAT_AFTER ? `<th class="rp-st rp-mat">${soft(t('irrigation_materials_delivered'))}</th>` : '')).join('')}
    <th>%</th><th>${esc(t('status'))}</th><th>${esc(t('last_update'))}</th></tr>`;

  return {
    html: `<div class="screen wide rp-screen">${topbar({ back: '#/client' })}
    <div class="rp-tools noprint"><a class="btn ghost sm" href="#/client">${esc(t('back'))}</a>
      <button class="btn sm" data-act="print">⬇ ${esc(t('download_pdf'))}</button>
      <span class="small muted">${esc(t('pdf_hint'))}</span></div>
    <article class="rp"><table class="rp-page"><tbody><tr><td>
      <header class="rp-head">
        <img src="assets/logo.jpg" alt="GAZI GROUP" class="rp-gazi">
        <div class="rp-title"><h1>${esc(t('progress_report'))}</h1>
          <div class="rp-project"><b>${CLIENT}</b> · ${esc(state.project.name)}${state.project.country ? ` · ${esc(state.project.country)}` : ''}</div>
          <div class="rp-dates">${esc(t('report_date'))}: <b>${esc(dateLong(now))} · ${hhmm(now)}</b> &nbsp;·&nbsp; ${esc(t('data_as_of'))}: <b>${esc(dateLong(dataAsOf))}</b></div></div>
      </header>

      <section class="rp-kpis">
        ${kpi(avg(live) + '%', t('project_progress'), 'main')}
        ${kpi(count(live, 'completed'), t('completed'), 'ok')}
        ${kpi(count(live, 'no_power'), t('done_no_power'), 'np')}
        ${kpi(count(live, 'in_progress'), t('in_progress'))}
        ${kpi(count(live, 'not_started'), t('not_started'))}
      </section>
      <div class="rp-overall"><span class="rp-bar big"><i style="width:${avg(live)}%"></i></span></div>

      <section class="rp-regions">
        <h2>${esc(t('by_region'))}</h2>
          <table class="rp-tbl"><thead><tr><th>${esc(t('region'))}</th><th>${esc(t('farms'))}</th><th>${esc(t('completed'))}</th><th>${esc(t('done_no_power'))}</th>
            <th>${esc(t('in_progress'))}</th><th>${esc(t('not_started'))}</th><th>🚚 ${esc(t('materials_delivered_n'))}</th><th>${esc(t('progress'))}</th></tr></thead><tbody>${regionRows}</tbody></table>
      </section>

      ${regions.map(r => `<section class="rp-region"><h2>${esc(r)} · ${live.filter(f => (f.region || '—') === r).length} ${esc(t('farms').toLowerCase())} · ${avg(live.filter(f => (f.region || '—') === r))}%</h2>
        <table class="rp-tbl rp-farms">${farmCols}<thead>${farmHead}</thead><tbody>${farmRows(r)}</tbody></table></section>`).join('')}
      <p class="rp-note">✓ ${esc(t('ready'))} · 50% ${esc(t('in_progress'))} · – ${esc(t('not_started'))} · 🚚 ${esc(t('mat_note'))}</p>
      </td></tr></tbody><tfoot><tr><td><div class="rp-foot-space"></div></td></tr></tfoot></table>

      <footer class="rp-foot"><span>GAZI FIELD · ${esc(t('progress_report'))} · ${esc(dateShort(now))}</span>
        <span class="rp-powered">${esc(t('powered_by'))} <img src="assets/edison-vision.png" alt="Edison Vision"></span></footer>
    </article></div>`,
    mount(root) {
      root.querySelector('[data-act=print]').onclick = () => {
        const old = document.title;
        document.title = `GAZI - ${t('progress_report')} - ${dateShort(now)}`;   // becomes the PDF file name
        window.print();
        setTimeout(() => { document.title = old; }, 1000);
      };
    },
  };
}
