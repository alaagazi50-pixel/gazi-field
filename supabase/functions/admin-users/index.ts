// Supabase Edge Function "admin-users": managers create accounts and reset passwords.
// Creating logins needs the service-role key, which must never reach the browser, so it lives here.
// Deploy: Supabase dashboard → Edge Functions → Deploy a new function → Via editor → name "admin-users" → paste → Deploy.
import { createClient } from 'npm:@supabase/supabase-js@2';

const USERNAME_DOMAIN = 'users.gazi-field.app'; // keep in sync with js/config.js

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    // Who is calling? Must be an active manager or supervisor.
    const jwt = (req.headers.get('Authorization') || '').replace('Bearer ', '');
    const { data: { user }, error: userErr } = await admin.auth.getUser(jwt);
    if (userErr || !user) return json({ error: 'Not signed in' }, 401);
    const { data: me } = await admin.from('profiles').select('role, active').eq('id', user.id).single();
    if (!me || !['manager', 'supervisor'].includes(me.role) || !me.active) return json({ error: 'Only managers and supervisors can manage accounts' }, 403);

    const body = await req.json();

    if (body.action === 'create') {
      const username = String(body.username || '').trim().toLowerCase();
      if (!/^[a-z0-9._-]{3,30}$/.test(username)) return json({ error: 'Username: 3–30 letters, numbers, dot, dash or underscore' }, 400);
      if (!body.password || String(body.password).length < 8) return json({ error: 'Password must be at least 8 characters' }, 400);
      if (!['worker', 'manager', 'supervisor', 'client'].includes(body.role)) return json({ error: 'Invalid role' }, 400);

      const email = body.email ? String(body.email).trim().toLowerCase() : `${username}@${USERNAME_DOMAIN}`;
      const { data: created, error } = await admin.auth.admin.createUser({
        email, password: String(body.password), email_confirm: true, user_metadata: { username },
      });
      if (error) return json({ error: error.message }, 400);

      const { error: pErr } = await admin.from('profiles').insert({
        id: created.user.id, username, full_name: String(body.full_name || username).trim(),
        role: body.role, team_id: body.role === 'worker' ? body.team_id : null, lang: body.lang || 'en',
      });
      if (pErr) {
        await admin.auth.admin.deleteUser(created.user.id);
        return json({ error: pErr.message.includes('duplicate') ? 'That username is taken' : pErr.message }, 400);
      }
      return json({ id: created.user.id, email });
    }

    if (body.action === 'reset_password') {
      if (!body.password || String(body.password).length < 8) return json({ error: 'Password must be at least 8 characters' }, 400);
      const { error } = await admin.auth.admin.updateUserById(body.id, { password: String(body.password) });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    if (body.action === 'set_active') {
      if (body.id === user.id) return json({ error: 'You cannot switch off your own account' }, 400);
      const active = !!body.active;
      const { error } = await admin.auth.admin.updateUserById(body.id, { ban_duration: active ? 'none' : '876000h' });
      if (error) return json({ error: error.message }, 400);
      await admin.from('profiles').update({ active }).eq('id', body.id);
      return json({ ok: true });
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (e) {
    return json({ error: String(e?.message || e) }, 500);
  }
});
