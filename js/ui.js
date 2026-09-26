// Shared rendering helpers.
import { t, getLang } from './i18n.js';
import { hhmm, niceDate } from './data.js';
import { photoURL, photoMeta, pendingCount } from './store.js';
import { currentConn } from './connectivity.js';

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const stageName = id => (id ? t('st_' + id) : t('general'));

const P = 'fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"';
export const ICONS = {
  info: `<svg viewBox="0 0 24 24" ${P}><rect x="5" y="3" width="14" height="18" rx="1.5"/><path d="M8.5 8h7M8.5 11.5h7M8.5 15h4"/></svg>`,
  map: `<svg viewBox="0 0 24 24" ${P}><path d="M3 6l6-2.5 6 2.5 6-2.5v14.5l-6 2.5-6-2.5-6 2.5z"/><path d="M9 3.5v14.5M15 6v14.5"/></svg>`,
  drawing: `<svg viewBox="0 0 24 24" ${P}><path d="M14 4H5.5A1.5 1.5 0 0 0 4 5.5v13A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V10"/><path d="M18.5 3.5l2 2L12 14l-2.8.8.8-2.8z"/></svg>`,
  boq: `<svg viewBox="0 0 24 24" ${P}><path d="M6 3h9l3 3v15l-2-1.3-2 1.3-2-1.3-2 1.3-2-1.3L6 21z"/><path d="M12 8v8M14 9.5c-.4-.7-1.1-1-2-1-1.2 0-2 .6-2 1.5 0 2 4 1 4 3 0 .9-.8 1.5-2 1.5-.9 0-1.6-.3-2-1"/></svg>`,
  photos: `<svg viewBox="0 0 24 24" ${P}><rect x="3" y="5" width="18" height="14" rx="1"/><circle cx="15.5" cy="9.5" r="1.8"/><path d="M3 17l5.5-5.5 4 4 2.5-2.5L21 19"/></svg>`,
  history: `<svg viewBox="0 0 24 24" ${P}><path d="M20 12a8 8 0 1 0-3 6.2"/><path d="M12 7v5l3 2"/><path d="M14.5 17.5l2.5 1 1-2.5"/></svg>`,
  issues: `<svg viewBox="0 0 24 24" ${P}><path d="M5 21V4M5 4h11l-2 3.5L16 11H5"/><path d="M17 14l4 7h-8z"/><path d="M17 16.5v2"/></svg>`,
  back: `<svg viewBox="0 0 24 24" ${P}><path d="M15 5l-7 7 7 7"/></svg>`,
  menu: `<svg viewBox="0 0 24 24" ${P}><circle cx="12" cy="6" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="12" cy="18" r="1.2"/></svg>`,
  camera: `<svg viewBox="0 0 24 24" ${P}><path d="M4 8h3l2-2.5h6L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>`,
  close: `<svg viewBox="0 0 24 24" ${P}><path d="M6 6l12 12M18 6L6 18"/></svg>`,
};

export function topbar({ back, title, right = '' } = {}) {
  const conn = currentConn();
  const connPill = conn === null ? '' : `<span class="pill ${conn ? '' : 'off'}"><span class="dot"></span>${conn ? t('online') : t('offline')}</span>`;
  return `<header class="topbar">
    ${back ? `<a class="iconbtn flip" href="${back}" aria-label="${esc(t('back'))}">${ICONS.back}</a>` : ''}
    <a class="brand" href="#/">GAZI <span>FIELD</span></a>
    ${title ? `<span class="muted small">· ${esc(title)}</span>` : ''}
    <span class="grow"></span>${right}${pendingCount() ? `<a class="pill warn-pill" href="#/sync">${esc(t('waiting_sync', { n: pendingCount() }))}</a>` : ''}${connPill}
    <a class="iconbtn" href="#/settings" aria-label="${esc(t('settings'))}">${ICONS.menu}</a>
  </header>`;
}

// Show an error from a store action in the user's language.
export function fail(e) {
  const key = e?.message;
  toast(['needs_connection', 'wrong_login', 'no_access'].includes(key) ? t(key) : (key || 'Error'));
}

export function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), 2600);
}

// <img data-photo="id"> placeholders are filled after render.
export function photoImg(id, alt = '') {
  return id ? `<img data-photo="${esc(id)}" alt="${esc(alt)}">` : `<div class="noimg">—</div>`;
}
export async function hydratePhotos(root = document) {
  for (const img of root.querySelectorAll('img[data-photo]')) {
    const url = await photoURL(img.dataset.photo);
    if (url) img.src = url;
  }
  root.querySelectorAll('[data-zoom]').forEach(b => b.addEventListener('click', () => zoom(b.dataset.zoom)));
}
export async function zoom(id) {
  const url = await photoURL(id);
  const m = photoMeta(id);
  const el = document.createElement('div');
  el.className = 'modal';
  el.innerHTML = `<div><img src="${url}" alt=""><div class="cap">${esc(m?.label || '')}
    · <a href="${url}" download="${esc((m?.label || 'photo').replace(/ · /g, '_').replace(/\s+/g, '-'))}.jpg" style="color:#9fd3a6">${esc(t('download'))}</a></div></div>`;
  el.addEventListener('click', e => { if (e.target.tagName !== 'A') el.remove(); });
  document.body.appendChild(el);
}

export function progressBar(p) { return `<div class="progressbar"><i style="width:${p}%"></i></div>`; }
export const pct = v => (v === 0 ? t('not_started') : `${v}%`);
export const timeLabel = ms => `${niceDate(ms, getLang())} · ${hhmm(ms)}`;
export function ago(ms, now = Date.now()) {
  const min = Math.round((now - ms) / 60e3);
  if (min < 2) return t('just_now');
  if (min < 60) return t('ago_min', { n: min });
  if (min < 48 * 60) return t('ago_h', { n: Math.round(min / 60) });
  return t('ago_d', { n: Math.round(min / 1440) });
}

// Connectivity timeline bar for a summary produced by connectivity.js.
export function connBlock(sum, { compact = false, headline = true } = {}) {
  if (!sum) return `<div class="small muted">—</div>`;
  const span = sum.to - sum.from;
  let cursor = sum.from, parts = '';
  for (const [a, b, s] of sum.segments) {
    if (a > cursor) parts += `<i class="unk" style="width:${((a - cursor) / span) * 100}%"></i>`;
    parts += `<i class="${s}" style="width:${((b - a) / span) * 100}%;min-width:3px"></i>`;
    cursor = b;
  }
  const observed = sum.onlineMs + sum.offlineMs;
  const share = observed ? Math.round((sum.onlineMs / observed) * 100) : null;
  const headlineText = sum.lastOnline
    ? t('last_internet', { t: hhmm(sum.lastOnline) })
    : t('never_seen', { h: sum.hours });
  return `<div class="conn">
    <div class="row between small">${headline ? `<span class="${sum.lastOnline ? '' : 'strong'}" style="${sum.lastOnline ? '' : 'color:var(--red)'}">${esc(headlineText)}</span>` : '<span></span>'}
      ${share != null ? `<span class="muted">${esc(t('online_share', { p: share }))}</span>` : ''}</div>
    <div class="conn-bar" title="${esc(t('conn_last_hours', { h: sum.hours }))}">${parts}</div>
    <div class="conn-axis">${[sum.from, sum.from + span / 2, sum.to].map(x => `<span>${sum.hours > 24 ? esc(niceDate(x, getLang())) + ' ' : ''}${hhmm(x)}</span>`).join('')}</div>
    ${compact ? '' : `<div class="legend"><span><b style="background:var(--ok)"></b>${esc(t('had_internet'))}</span>
      <span><b style="background:var(--orange)"></b>${esc(t('no_internet'))}</span>
      <span><b style="background:#e6e9e7"></b>${esc(t('not_observed'))}</span></div>`}
  </div>`;
}

export function getPosition(timeout = 12000) {
  return new Promise(resolve => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy) }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout, maximumAge: 5 * 60e3 },
    );
  });
}

// Hidden file input: capture=environment opens the rear camera on phones.
export function pickPhoto(capture) {
  return new Promise(resolve => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/*';
    if (capture) inp.capture = 'environment';
    inp.onchange = () => resolve(inp.files[0] || null);
    inp.click();
  });
}
