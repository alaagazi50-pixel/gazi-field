// Entry point: boot, hash router, sign-in and settings.
import { t, setLang, getLang, LANGS } from './i18n.js';
import { hhmm } from './data.js';
import { state, configured, me, team, restoreSession, signIn, signOut, refresh, sync, save, pendingCount, uploadConn, reloadLocal } from './store.js';
import { esc, topbar, toast } from './ui.js';
import { storageLimited } from './db.js';
import { startConnectivityMonitor, onConnChange, onSample } from './connectivity.js';
import { homeView, pickFarmView, workView, updateView, doneView } from './field.js';
import { farmHubView, farmSubView, reportView } from './farm.js';
import { dashboardView, farmsListView } from './manage.js';
import { peopleView } from './people.js';
import { analysisView } from './analysis.js';
import { clientView, clientFarmView } from './client.js';

export const APP_VERSION = '0.4.0';

// [path, view, roles allowed]. Roles: field (worker), manager, client.
const ROUTES = [
  ['/settings', settingsView],
  ['/sync', syncView, ['field']],
  ['/pick-farm', pickFarmView, ['field']],
  ['/update/:farmId', updateView, ['field']],
  ['/done/:reportId', doneView, ['field']],
  ['/work/:farmId', workView, ['field']],
  ['/report/:reportId', reportView, ['field', 'manager', 'supervisor']],
  ['/farm/:farmId', farmHubView, ['field', 'manager', 'supervisor']],
  ['/farm/:farmId/:sub', farmSubView, ['field', 'manager', 'supervisor']],
  ['/manage', dashboardView, ['manager', 'supervisor']],
  ['/manage/analysis', analysisView, ['supervisor']],
  ['/manage/farms', farmsListView, ['manager', 'supervisor']],
  ['/manage/people', peopleView, ['manager', 'supervisor']],
  ['/client', clientView, ['client', 'manager', 'supervisor']],
  ['/client/farm/:farmId', clientFarmView, ['client', 'manager', 'supervisor']],
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

const homeFor = u => ({ field: '#/', manager: '#/manage', supervisor: '#/manage', client: '#/client' }[u.role] || '#/');

let lastPath = null;
async function render() {
  const path = (location.hash.slice(1) || '/').split('?')[0];
  const u = me();
  let m;
  if (!u) m = { view: loginView, params: {} };
  else if (path === '/login') { location.hash = homeFor(u); return; }
  else if (path === '/') {
    if (u.role !== 'field') { location.hash = homeFor(u); return; }
    m = { view: homeView, params: {} };
  } else {
    m = match(path);
    if (!m || (m.roles && !m.roles.includes(u.role))) { location.hash = homeFor(u); return; }
  }
  const out = await m.view(m.params);
  if (!out || !out.html) return;
  const root = document.getElementById('app');
  // Don't wipe a field someone is typing in when background data arrives.
  const typing = root.contains(document.activeElement) && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && path === lastPath;
  if (typing) return;
  const keepScroll = path === lastPath ? window.scrollY : 0;
  root.innerHTML = out.html;
  window.scrollTo(0, keepScroll);
  lastPath = path;
  if (out.mount) await out.mount(root);
}

// ---------- Sign in ----------
let loginError = '';
function loginView() {
  return {
    html: `<div class="screen login"><main class="content">
      <img class="logo" src="assets/logo.jpg" alt="GAZI GROUP">
      <div class="brand">GAZI <span>FIELD</span>™</div>
      <h1 class="h1">${esc(t('tagline'))}</h1>
      <div class="langs">${Object.entries(LANGS).map(([k, v]) => `<button type="button" data-lang="${k}" class="${getLang() === k ? 'on' : ''}">${v}</button>`).join('')}</div>
      ${configured ? `<form class="form" data-login>
        <label style="color:#fff">${esc(t('username_or_email'))}<input class="input" name="id" id="login-id" autocomplete="username" autocapitalize="none" required></label>
        <label style="color:#fff">${esc(t('password'))}<input class="input" name="pw" id="login-pw" type="password" autocomplete="current-password" required></label>
        ${loginError ? `<div class="err">${esc(t(loginError))}</div>` : ''}
        <button class="btn" type="submit" style="background:#fff;color:var(--green)">${esc(t('sign_in'))}</button>
      </form>` : `<div class="err">${esc(t('not_configured'))}</div>`}
      <div class="small" style="opacity:.6">v${APP_VERSION}</div>
    </main></div>`,
    mount(root) {
      root.querySelectorAll('[data-lang]').forEach(b => b.onclick = () => { setLang(b.dataset.lang); try { localStorage.setItem('lang', b.dataset.lang); } catch { /* ignore */ } render(); });
      const form = root.querySelector('[data-login]');
      if (!form) return;
      form.onsubmit = async e => {
        e.preventDefault();
        const btn = form.querySelector('[type=submit]');
        btn.disabled = true;
        btn.textContent = t('signing_in');
        try {
          const u = await signIn(form.elements.id.value, form.elements.pw.value);
          loginError = '';
          setLang(u.lang);
          location.hash = homeFor(u);
          render();
        } catch (err) {
          loginError = ['wrong_login', 'no_access'].includes(err.message) ? err.message : 'sync_failed';
          render();
        }
      };
    },
  };
}

// ---------- Upload queue (field) ----------
function syncView() {
  return {
    html: `<div class="screen">${topbar({ back: '#/' })}<main class="content">
      <h1 class="h1">${esc(t('waiting_sync', { n: pendingCount() }))}</h1>
      <ul class="list">${state.outbox.map(o => `<li>${esc(o.report.farmId)} · ${esc(o.report.date)}<span class="r small ${o.error ? '' : 'muted'}" style="${o.error ? 'color:var(--red)' : ''}">${esc(o.error ? t('report_failed', { e: o.error }) : `${o.photoIds.length} ${t('photos_n')}`)}</span></li>`).join('')}</ul>
      ${state.syncError ? `<div class="small" style="color:var(--red)">${esc(t('sync_failed'))}</div>` : ''}
      <button class="btn" data-act="sync">${esc(t('sync_now'))}</button>
    </main></div>`,
    mount(root) { root.querySelector('[data-act=sync]').onclick = async () => { await sync(); if (!pendingCount()) location.hash = '#/'; }; },
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
      <div><div class="eyebrow muted">${esc(t('signed_in_as'))}</div>
        <div class="h3">${esc(u.name)} · ${esc(t('role_' + u.role))}${u.role === 'field' ? ' · ' + esc(team(u.teamId).name) : ''}</div>
        <div class="small muted">${esc(u.username)}${state.lastSync ? ` · ${esc(t('synced_at', { t: hhmm(state.lastSync) }))}` : ''}</div></div>
      <div class="stack"><div class="eyebrow muted">${esc(t('language'))}</div>
        <div class="langs dark">${Object.entries(LANGS).map(([k, v]) => `<button data-lang="${k}" class="${getLang() === k ? 'on' : ''}">${v}</button>`).join('')}</div></div>
      ${installPrompt ? `<button class="btn ghost" data-act="install">${esc(t('install_app'))}</button>` : ''}
      <button class="btn ghost" data-act="refresh">${esc(t('refresh'))}</button>
      <span class="spacer"></span>
      <button class="btn ghost" data-act="signout">${esc(t('sign_out'))}</button>
      <div class="small muted">GAZI FIELD v${APP_VERSION} · GAZI GROUP</div>
    </main></div>`,
    mount(root) {
      root.querySelectorAll('[data-lang]').forEach(b => b.onclick = () => {
        setLang(b.dataset.lang);
        try { localStorage.setItem('lang', b.dataset.lang); } catch { /* ignore */ }
        render();
      });
      root.querySelector('[data-act=refresh]').onclick = () => refresh().then(() => toast(t('saved')));
      root.querySelector('[data-act=signout]').onclick = async () => {
        if (pendingCount()) { toast(t('cant_sign_out')); return; }
        await signOut();
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
  let saved = null;
  try { saved = localStorage.getItem('lang'); } catch { /* ignore */ }
  setLang(saved || (navigator.language || 'en').slice(0, 2));
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW registration failed', err));
    // The service worker asks the open app to upload, or tells it that it uploaded while the app was closed.
    navigator.serviceWorker.addEventListener('message', e => {
      if (e.data === 'gazi-sync') sync();
      if (e.data === 'gazi-uploaded') reloadLocal();
    });
  }
  window.addEventListener('hashchange', render);
  window.addEventListener('rerender', render);
  startConnectivityMonitor();

  const u = await restoreSession().catch(err => { console.warn(err); return null; });
  if (u && !saved) setLang(u.lang);
  render();
  if (storageLimited) setTimeout(() => toast(t('storage_limited')), 800);
  if (u) { refresh(); sync(); }

  // Keep data fresh and the upload queue moving.
  onConnChange(online => { if (online) sync(); render(); });
  // Upload the moment the phone says it is back online (the internet check may take a few seconds).
  window.addEventListener('online', () => sync());
  onSample(online => { if (online && me()?.role === 'field') uploadConn(); });
  setInterval(() => { if (me() && document.visibilityState === 'visible') { sync(); refresh(); } }, 2 * 60e3);
  document.addEventListener('visibilitychange', () => { if (me() && document.visibilityState === 'visible') { sync(); refresh(); } });
})().catch(err => {
  console.error(err);
  document.getElementById('app').innerHTML = `<div class="screen"><main class="content"><h1 class="h1">GAZI FIELD</h1><p>${esc(err.message)}</p></main></div>`;
});

// Keep drafts saved if the phone kills the page mid-update.
window.addEventListener('pagehide', () => { save(); });
