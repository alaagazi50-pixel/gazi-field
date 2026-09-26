// Supabase Edge Function "reminders": push notifications reminding workers to send the daily report.
//   { action: "cron" }                 daily reminder; called by the database scheduler with header x-cron-secret
//   { action: "remind_team", team_id } a manager/supervisor's "Follow up" button
//   { action: "test" }                 sends a test notification to the caller's own phone
//   { action: "urgent", issue_id }      an urgent problem was reported: alert managers and supervisors
// Secrets (Edge Functions → Secrets): VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, CRON_SECRET, optional TIMEZONE.
// Deploy: Edge Functions → Deploy a new function → Via editor → paste → Deploy; then turn "Verify JWT" OFF
// (the scheduler has no user login; this function checks the caller itself).
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const TEXT: Record<string, { title: string; daily: string; followup: string; test: string; urgent: string }> = {
  en: { title: 'GAZI FIELD', daily: "Don't forget today's daily report.", followup: 'Management is waiting for today\'s report. Please send it.', test: 'Notifications are working.', urgent: 'Urgent problem' },
  pt: { title: 'GAZI FIELD', daily: 'Não se esqueça do relatório diário de hoje.', followup: 'A gestão aguarda o relatório de hoje. Por favor envie-o.', test: 'As notificações estão a funcionar.', urgent: 'Problema urgente' },
  ar: { title: 'GAZI FIELD', daily: 'لا تنسَ تقرير اليوم.', followup: 'الإدارة بانتظار تقرير اليوم. يرجى إرساله.', test: 'الإشعارات تعمل.', urgent: 'مشكلة عاجلة' },
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const env = (k: string) => Deno.env.get(k) || '';
    if (!env('VAPID_PUBLIC_KEY') || !env('VAPID_PRIVATE_KEY')) return json({ error: 'VAPID keys are not set in Edge Function secrets' }, 500);
    webpush.setVapidDetails(env('VAPID_SUBJECT') || 'mailto:admin@gaziltd.com', env('VAPID_PUBLIC_KEY'), env('VAPID_PRIVATE_KEY'));
    const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));
    const today = new Date().toLocaleDateString('en-CA', { timeZone: env('TIMEZONE') || 'Africa/Luanda' });
    const body = await req.json().catch(() => ({}));

    // Who may call what
    let caller: { id: string; role: string } | null = null;
    if (body.action === 'cron') {
      if (!env('CRON_SECRET') || req.headers.get('x-cron-secret') !== env('CRON_SECRET')) return json({ error: 'Forbidden' }, 403);
    } else {
      const jwt = (req.headers.get('Authorization') || '').replace('Bearer ', '');
      const { data: { user } } = await admin.auth.getUser(jwt);
      if (!user) return json({ error: 'Not signed in' }, 401);
      const { data: p } = await admin.from('profiles').select('id, role, active').eq('id', user.id).single();
      if (!p?.active) return json({ error: 'No access' }, 403);
      caller = p;
      if (body.action === 'remind_team' && !['manager', 'supervisor'].includes(p.role)) return json({ error: 'Only managers and supervisors' }, 403);
    }

    // Who gets a notification
    let targets: string[] = [];
    let kind = '';
    let message: 'daily' | 'followup' | 'test' | 'urgent' = 'daily';
    let extra = '';
    if (body.action === 'cron') {
      const { data: workers } = await admin.from('profiles').select('id, team_id').eq('role', 'worker').eq('active', true);
      const { data: reps } = await admin.from('reports').select('user_id, team_id').eq('date', today);
      const reportedUsers = new Set((reps || []).map(r => r.user_id));
      const reportedTeams = new Set((reps || []).map(r => r.team_id).filter(Boolean));
      targets = (workers || []).filter(w => !reportedUsers.has(w.id) && !(w.team_id && reportedTeams.has(w.team_id))).map(w => w.id);
      kind = `daily-${body.slot || 'afternoon'}`;
    } else if (body.action === 'remind_team') {
      const { data: workers } = await admin.from('profiles').select('id').eq('role', 'worker').eq('active', true).eq('team_id', body.team_id);
      targets = (workers || []).map(w => w.id);
      kind = `followup-${Date.now()}`;
      message = 'followup';
    } else if (body.action === 'urgent') {
      if (caller!.role === 'client') return json({ error: 'Not allowed' }, 403);
      const { data: iss } = await admin.from('issues').select('farm_id, category, note, reported_by, urgent').eq('id', body.issue_id).single();
      if (!iss?.urgent || iss.reported_by !== caller!.id) return json({ error: 'Not an urgent problem of yours' }, 403);
      const { data: mgrs } = await admin.from('profiles').select('id').in('role', ['manager', 'supervisor']).eq('active', true);
      targets = (mgrs || []).map(m => m.id);
      kind = `urgent-${body.issue_id}`;
      message = 'urgent';
      extra = ` · ${iss.farm_id} · ${iss.category}${iss.note ? ': ' + String(iss.note).slice(0, 80) : ''}`;
    } else if (body.action === 'test') {
      targets = [caller!.id];
      kind = `test-${Date.now()}`;
      message = 'test';
    } else {
      return json({ error: 'Unknown action' }, 400);
    }
    if (!targets.length) return json({ sent: 0, failed: 0, removed: 0, note: 'nobody to remind' });

    // Skip anyone already reminded with this kind today (the scheduler may retry)
    const { data: done } = await admin.from('reminders_sent').select('user_id').eq('date', today).eq('kind', kind).in('user_id', targets);
    const already = new Set((done || []).map(d => d.user_id));
    targets = targets.filter(t => !already.has(t));

    const { data: subs } = await admin.from('push_subscriptions').select('*').in('user_id', targets);
    let sent = 0, failed = 0, removed = 0;
    const reached = new Set<string>();
    for (const s of subs || []) {
      const t = TEXT[s.lang] || TEXT.en;
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify({ title: t.title, body: `${message === 'urgent' ? '⚠ ' : ''}${t[message]}${extra}`, url: './', tag: `gazi-${message}` }), { TTL: 6 * 3600 });
        sent++; reached.add(s.user_id);
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) { await admin.from('push_subscriptions').delete().eq('endpoint', s.endpoint); removed++; }
        else failed++;
      }
    }
    if (reached.size) await admin.from('reminders_sent').upsert([...reached].map(user_id => ({ user_id, date: today, kind })));
    return json({ sent, failed, removed, people: reached.size, without_phone: targets.length - reached.size });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
