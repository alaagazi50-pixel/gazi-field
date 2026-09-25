// Entry point: boot, hash router, login and settings.
import { t, setLang, getLang, LANGS } from './i18n.js';
import { state, loadState, save, me, user, team, resetAll } from './store.js';
import { esc, topbar, toast } from './ui.js';
import { startConnectivityMonitor, onConnChange } from './connectivity.js';
import { homeView, pickFarmView, updateView, doneView } from './field.js';
import { farmHubView, farmSubView, reportView } from './farm.js';
import { dashboardView, farmsListView } from './manage.js';
import { clientView, clientFarmView } from './client.js';

export const APP_VERSION = '0.1.0';

const ROUTES = [
  ['/login', loginView],
  ['/settings', settingsView],
  ['/pick-farm', pickFarmView, ['field']],
  ['/update/:farmId', updateView, ['field']],
  ['/done/:reportId', doneView, ['field']],
  ['/report/:reportId', reportView, ['field', 'manager']],
  ['/farm/:farmId', farmHubView, ['field', 'manager']],
  ['/farm/:farmId/:sub', farmSubView, ['field', 'manager']],
  ['/manage', dashboardView, ['manager']],
  ['/manage/farms', farmsListView, ['manager']],
  ['/client', clientView, ['client', 'manager']],
  ['/client/farm/:farmId', clientFarmView, ['client', 'manager']],
];

function match(path) {
  for (const [pattern, view, roles] of ROUTES) {
    const pp = pattern.split('/'), ap = path.split('/');
    if (pp.length !== ap.length) continue;
    const params = {};
    if (pp.every((seg, i) => (seg.startsWith(':') ? ((params[seg.slice(1)] = decodeURIComponent(ap[i])), true) : seg === ap[i]))) return { view, params, roles };
  }
  return null;
}

const homeFor = u => ({ field: '#/', manager: '#/manage', client: '#/client' }[u.role]);

let lastPath = null;
async function render() {
  const path = (location.hash.slice(1) || '/').split('?')[0];
  const u = me();
  if (!u && path !== '/login') { location.hash = '#/login'; return; }
  let m;
  if (path === '/' && u) {
    if (u.role !== 'field') { location.hash = homeFor(u); return; }
    m = { view: homeView, params: {} };
  } else m = match(path);
  if (!m || (m.roles && !m.roles.includes(u.role))) { location.hash = u ? homeFor(u) : '#/login'; return; }

  const out = await m.view(m.params);
  if (!out || !out.html) return;
  const root = document.getElementById('app');
  const keepScroll = path === lastPath ? window.scrollY : 0;
  root.innerHTML = out.html;
  window.scrollTo(0, keepScroll);
  lastPath = path;
  if (out.mount) await out.mount(root);
}

// ---------- Login ----------
function loginView() {
  const group = role => state.users.filter(u => u.role === role).map(u => `<button class="userbtn" data-user="${u.id}">
      <span class="av">${esc(u.name[0])}</span><span>${esc(u.name)}<small>${u.teamId ? esc(team(u.teamId).name) + ' · ' : ''}${esc(LANGS[u.lang])}</small></span></button>`).join('');
  return {
    html: `<div class="screen login"><main class="content">
      <img class="logo" src="assets/logo.jpg" alt="GAZI GROUP">
      <div class="brand">GAZI <span>FIELD</span>™</div>
      <h1 class="h1">${esc(t('tagline'))}</h1>
      <div class="langs">${Object.entries(LANGS).map(([k, v]) => `<button data-lang="${k}" class="${getLang() === k ? 'on' : ''}">${v}</button>`).join('')}</div>
      <div class="eyebrow" style="color:#9fd3a6">${esc(t('who'))}</div>
      <div class="eyebrow" style="color:#fff">${esc(t('field_team'))}</div><div class="stack">${group('field')}</div>
      <div class="eyebrow" style="color:#fff">${esc(t('management'))} · ${esc(t('client'))}</div><div class="stack">${group('manager')}${group('client')}</div>
    </main></div>`,
    mount(root) {
      root.querySelectorAll('[data-lang]').forEach(b => b.onclick = () => { setLang(b.dataset.lang); render(); });
      root.querySelectorAll('[data-user]').forEach(b => b.onclick = async () => {
        const u = user(b.dataset.user);
        state.session = { userId: u.id, lang: u.lang };
        setLang(u.lang);
        await save();
        location.hash = homeFor(u);
      });
    },
  };
}

// ---------- Settings ----------
let installPrompt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; });

function settingsView() {
  const u = me();
  return {
    html: `<div class="screen">${topbar({ back: homeFor(u) })}<main class="content">
      <h1 class="h1">${esc(t('settings'))}</h1>
      <div><div class="eyebrow muted">${esc(t('signed_in_as'))}</div><div class="h3">${esc(u.name)}${u.teamId ? ' · ' + esc(team(u.teamId).name) : ''}</div></div>
      <div class="stack"><div class="eyebrow muted">${esc(t('language'))}</div>
        <div class="langs dark">${Object.entries(LANGS).map(([k, v]) => `<button data-lang="${k}" class="${getLang() === k ? 'on' : ''}">${v}</button>`).join('')}</div></div>
      ${installPrompt ? `<button class="btn ghost" data-act="install">${esc(t('install_app'))}</button>` : ''}
      <button class="btn ghost" data-act="switch">${esc(t('switch_user'))}</button>
      <span class="spacer"></span>
      <button class="linkbtn" data-act="reset" style="color:var(--red);align-self:flex-start">${esc(t('reset_demo'))}</button>
      <div class="card flat stack" data-confirm hidden><div>${esc(t('reset_confirm'))}</div>
        <div class="btn-row"><button class="btn ghost sm" data-act="cancel" style="width:100%">${esc(t('no'))}</button>
        <button class="btn warn sm" data-act="doreset" style="width:100%">${esc(t('reset_demo'))}</button></div></div>
      <div class="small muted">GAZI FIELD v${APP_VERSION} · GAZI GROUP</div>
    </main></div>`,
    mount(root) {
      root.querySelectorAll('[data-lang]').forEach(b => b.onclick = async () => {
        setLang(b.dataset.lang);
        state.session.lang = b.dataset.lang;
        await save();
        render();
      });
      root.querySelector('[data-act=switch]').onclick = async () => { state.session = null; await save(); location.hash = '#/login'; };
      const box = root.querySelector('[data-confirm]');
      root.querySelector('[data-act=reset]').onclick = () => { box.hidden = false; };
      root.querySelector('[data-act=cancel]').onclick = () => { box.hidden = true; };
      root.querySelector('[data-act=doreset]').onclick = async () => {
        await resetAll();
        location.hash = '#/login';
        render();
      };
      const inst = root.querySelector('[data-act=install]');
      if (inst) inst.onclick = async () => { await installPrompt.prompt(); installPrompt = null; render(); };
    },
  };
}

// ---------- Boot ----------
(async function boot() {
  await loadState();
  setLang(state.session?.lang || me()?.lang || (navigator.language || 'en').slice(0, 2));
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW registration failed', err));
  }
  window.addEventListener('hashchange', render);
  window.addEventListener('rerender', render);
  onConnChange(() => { if (!document.querySelector('textarea:focus, input:focus')) render(); });
  startConnectivityMonitor();
  render();
})().catch(err => {
  console.error(err);
  document.getElementById('app').innerHTML = `<div class="screen"><main class="content"><h1 class="h1">GAZI FIELD</h1><p>${esc(err.message)}</p></main></div>`;
  toast('Error');
});
