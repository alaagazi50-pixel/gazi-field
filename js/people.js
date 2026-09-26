// Management: accounts (create, role, team, reset password, switch off) and teams.
import { t, LANGS } from './i18n.js';
import { state, me, user, team, teamFarms, adminUsers, updateProfile, setTodayFarm, addTeam } from './store.js';
import { esc, topbar, toast, fail } from './ui.js';
import { mgrNav } from './manage.js';

let editing = null;   // profile id whose edit panel is open
let created = null;   // { username, password } shown once after creating an account

const ROLES = ['field', 'supervisor', 'manager', 'client'];
const dbRole = r => (r === 'field' ? 'worker' : r);
const genPassword = () => {
  const words = ['farm', 'drip', 'pump', 'field', 'green', 'water', 'solar', 'valve', 'river', 'maize'];
  const w = () => words[Math.floor(Math.random() * words.length)];
  return `${w()}-${w()}-${Math.floor(1000 + Math.random() * 9000)}`;
};
const teamOptions = sel => `<option value="">${esc(t('no_team'))}</option>` +
  state.teams.map(tm => `<option value="${esc(tm.id)}" ${tm.id === sel ? 'selected' : ''}>${esc(tm.name)}</option>`).join('');
const langOptions = sel => Object.entries(LANGS).map(([k, v]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${v}</option>`).join('');
const roleOptions = sel => ROLES.map(r => `<option value="${r}" ${r === sel ? 'selected' : ''}>${esc(t('role_' + r))}</option>`).join('');

export function peopleView() {
  const people = [...state.users].sort((a, b) => ROLES.indexOf(a.role) - ROLES.indexOf(b.role) || (a.teamId || '').localeCompare(b.teamId || '') || a.name.localeCompare(b.name));

  const row = u => {
    const open = editing === u.id;
    return `<tr>
      <td><strong>${esc(u.name)}</strong><div class="small muted">${esc(u.username)}</div></td>
      <td>${esc(t('role_' + u.role))}</td>
      <td>${u.role === 'field' ? esc(team(u.teamId).name) : '—'}</td>
      <td>${esc(LANGS[u.lang] || u.lang)}</td>
      <td>${u.active ? '' : `<span class="tag warn">${esc(t('inactive'))}</span>`}</td>
      <td><button class="btn ghost xs" data-edit="${u.id}">${esc(open ? t('cancel') : t('edit'))}</button></td>
    </tr>${open ? `<tr><td colspan="6">
      <form class="form" data-editform="${u.id}" style="max-width:520px">
        <label>${esc(t('full_name'))}<input class="input" name="full_name" value="${esc(u.name)}" required></label>
        <label>${esc(t('role'))}<select class="input" name="role" ${u.id === me().id ? 'disabled' : ''}>${roleOptions(u.role)}</select></label>
        <label>${esc(t('team'))}<select class="input" name="team_id">${teamOptions(u.teamId)}</select></label>
        <label>${esc(t('language'))}<select class="input" name="lang">${langOptions(u.lang)}</select></label>
        <button class="btn sm" type="submit" style="align-self:flex-start">${esc(t('save'))}</button>
      </form>
      <form class="form" data-pwform="${u.id}" style="max-width:520px;margin-top:16px">
        <label>${esc(t('new_password'))}<span class="row"><input class="input" name="password" minlength="8" required style="flex:1">
          <button class="btn ghost xs" type="button" data-gen>${esc(t('generate'))}</button></span></label>
        <button class="btn ghost sm" type="submit" style="align-self:flex-start">${esc(t('reset_password'))}</button>
      </form>
      ${u.id !== me().id ? `<button class="linkbtn" data-active="${u.id}" data-to="${u.active ? '0' : '1'}" style="color:${u.active ? 'var(--red)' : 'var(--teal)'}">${esc(u.active ? t('deactivate') : t('activate'))}</button>` : ''}
    </td></tr>` : ''}`;
  };

  const teamRows = state.teams.map(tm => `<tr><td class="num">${esc(tm.id)}</td><td>${esc(tm.name)}</td>
    <td><select class="input" data-today="${esc(tm.id)}" style="max-width:200px"><option value="">—</option>
      ${teamFarms(tm.id).map(f => `<option value="${f.id}" ${f.id === tm.todayFarm ? 'selected' : ''}>${f.id} · ${esc(f.region)}</option>`).join('')}</select></td>
    <td class="small muted">${state.users.filter(u => u.teamId === tm.id && u.role === 'field').map(u => esc(u.name)).join(', ')}</td></tr>`).join('');

  return {
    html: `<div class="screen wide">${topbar()}<main class="content">
      ${mgrNav('people')}
      <h1 class="h1">${esc(t('people'))}</h1>
      ${created ? `<div class="card dark flat stack"><strong>${esc(t('account_created', { u: created.username, p: created.password }))}</strong>
        <button class="btn ghost xs" data-act="closecreated" style="align-self:flex-start">OK</button></div>` : ''}
      <details class="card flat" ${state.users.length < 2 ? 'open' : ''}><summary class="h3" style="cursor:pointer">${esc(t('add_person'))}</summary>
        <form class="form" data-create style="max-width:520px;margin-top:14px">
          <label>${esc(t('full_name'))}<input class="input" name="full_name" required></label>
          <label>${esc(t('username'))}<input class="input" name="username" required pattern="[a-zA-Z0-9._\\-]{3,30}" autocapitalize="none" autocomplete="off"></label>
          <label>${esc(t('password'))}<span class="row"><input class="input" name="password" minlength="8" required style="flex:1" value="${genPassword()}">
            <button class="btn ghost xs" type="button" data-gen>${esc(t('generate'))}</button></span></label>
          <label>${esc(t('role'))}<select class="input" name="role">${roleOptions('field')}</select></label>
          <label data-teamfield>${esc(t('team'))}<select class="input" name="team_id">${teamOptions(state.teams[0]?.id)}</select></label>
          <label>${esc(t('language'))}<select class="input" name="lang">${langOptions('pt')}</select></label>
          <label>${esc(t('email_optional'))}<input class="input" name="email" type="email" autocomplete="off"></label>
          <button class="btn sm" type="submit" style="align-self:flex-start">${esc(t('create_account'))}</button>
        </form></details>
      <div class="card"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>${esc(t('full_name'))}</th><th>${esc(t('role'))}</th><th>${esc(t('team'))}</th><th>${esc(t('language'))}</th><th></th><th></th></tr></thead>
        <tbody>${people.map(row).join('')}</tbody></table></div></div>
      <h2 class="h1" style="font-size:24px">${esc(t('teams'))}</h2>
      <div class="card"><div class="tbl-wrap"><table class="tbl"><thead><tr><th></th><th>${esc(t('team_name'))}</th><th>${esc(t('today_farm'))}</th><th>${esc(t('people'))}</th></tr></thead>
        <tbody>${teamRows}</tbody></table></div>
        <form class="row" data-addteam style="margin-top:14px">
          <input class="input" name="id" placeholder="${esc(t('team_code'))}" required maxlength="4" style="width:120px">
          <input class="input" name="name" placeholder="${esc(t('team_name'))}" required style="flex:1;min-width:140px">
          <button class="btn sm" type="submit">${esc(t('add_team'))}</button></form></div>
    </main></div>`,

    mount(root) {
      const busy = async (form, fn) => {
        const btn = form.querySelector('[type=submit]');
        btn.disabled = true;
        try { await fn(); } catch (err) { fail(err); } finally { btn.disabled = false; }
      };
      root.querySelectorAll('[data-gen]').forEach(b => b.onclick = () => { b.closest('label').querySelector('input').value = genPassword(); });

      const create = root.querySelector('[data-create]');
      const syncTeamField = () => { root.querySelector('[data-teamfield]').hidden = create.elements.role.value !== 'field'; };
      create.elements.role.onchange = syncTeamField;
      syncTeamField();
      create.onsubmit = e => {
        e.preventDefault();
        const v = Object.fromEntries(new FormData(create));
        busy(create, async () => {
          await adminUsers({
            action: 'create', full_name: v.full_name, username: v.username.trim().toLowerCase(), password: v.password,
            role: dbRole(v.role), team_id: v.role === 'field' ? v.team_id : null, lang: v.lang, email: v.email || null,
          });
          created = { username: v.username.trim().toLowerCase(), password: v.password };
          window.dispatchEvent(new Event('rerender'));
        });
      };
      const closeCreated = root.querySelector('[data-act=closecreated]');
      if (closeCreated) closeCreated.onclick = () => { created = null; window.dispatchEvent(new Event('rerender')); };

      root.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => {
        editing = editing === b.dataset.edit ? null : b.dataset.edit;
        window.dispatchEvent(new Event('rerender'));
      });
      root.querySelectorAll('[data-editform]').forEach(f => f.onsubmit = e => {
        e.preventDefault();
        const v = Object.fromEntries(new FormData(f));
        const patch = { full_name: v.full_name, team_id: v.team_id || null, lang: v.lang };
        if (v.role) patch.role = dbRole(v.role);
        busy(f, async () => { await updateProfile(f.dataset.editform, patch); editing = null; toast(t('saved')); });
      });
      root.querySelectorAll('[data-pwform]').forEach(f => f.onsubmit = e => {
        e.preventDefault();
        const pw = f.elements.password.value;
        busy(f, async () => {
          await adminUsers({ action: 'reset_password', id: f.dataset.pwform, password: pw });
          created = { username: user(f.dataset.pwform)?.username, password: pw };
          editing = null;
          window.dispatchEvent(new Event('rerender'));
        });
      });
      root.querySelectorAll('[data-active]').forEach(b => b.onclick = async () => {
        try { await adminUsers({ action: 'set_active', id: b.dataset.active, active: b.dataset.to === '1' }); } catch (err) { fail(err); }
      });
      root.querySelectorAll('[data-today]').forEach(s => s.onchange = async () => {
        try { await setTodayFarm(s.dataset.today, s.value); toast(t('saved')); } catch (err) { fail(err); }
      });
      const addT = root.querySelector('[data-addteam]');
      addT.onsubmit = e => {
        e.preventDefault();
        const v = Object.fromEntries(new FormData(addT));
        busy(addT, () => addTeam(v.id.trim().toUpperCase(), v.name.trim()));
      };
    },
  };
}
