"""Database access-rule tests for supabase/schema.sql.

Builds a minimal stand-in for Supabase's auth and storage schemas, loads schema.sql (twice, to prove it is
re-runnable) and seed.sql, then checks what each role can and cannot do.

  CI:     DATABASE_URL points at an empty Postgres (see .github/workflows/tests.yml)
  Local:  pip install "psycopg[binary]" pgserver  &&  python tests/db_test.py
"""
import os, sys, shutil, tempfile, uuid, json
import psycopg

APP = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'supabase')
if os.environ.get('DATABASE_URL'):
    conn = psycopg.connect(os.environ['DATABASE_URL'], autocommit=True)
else:
    import pgserver
    data = os.path.join(tempfile.gettempdir(), 'gazi-field-pgtest')
    shutil.rmtree(data, ignore_errors=True)
    conn = psycopg.connect(pgserver.get_server(data, cleanup_mode='stop').get_uri(), autocommit=True)
ex = conn.execute

# --- minimal Supabase environment ---
ex("""
do $r$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $r$;
create schema auth; create schema storage;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create table storage.buckets (id text primary key, name text, public boolean);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language plpgsql as $$
declare _parts text[]; begin select string_to_array(name, '/') into _parts; return _parts[1:array_length(_parts,1)-1]; end $$;
grant usage on schema public, storage, auth to authenticated, anon;
grant all on all tables in schema storage to authenticated;
alter default privileges in schema public grant all on tables to authenticated, anon;
alter default privileges in schema public grant all on functions to authenticated, anon;
grant execute on function auth.uid() to authenticated;
""")
schema = open(os.path.join(APP, 'schema.sql'), encoding='utf-8').read()
ex(schema)
ex(schema)  # must be re-runnable
ex(open(os.path.join(APP, 'seed.sql'), encoding='utf-8').read())
ex(open(os.path.join(APP, 'setup.sql'), encoding='utf-8').read())   # the one-paste file must also run cleanly on top

U = {k: str(uuid.uuid4()) for k in ['mgr', 'jamal', 'paulo', 'client', 'stranger', 'off']}
for k, v in U.items(): ex("insert into auth.users values (%s, %s)", (v, k + '@x'))
first = ex("select id, role from public.profiles").fetchall()
for k, role, team in [('mgr', 'manager', None), ('jamal', 'worker', 'A'), ('paulo', 'worker', 'B'), ('client', 'client', None), ('off', 'worker', 'A')]:
    ex("""insert into public.profiles (id, username, full_name, role, team_id, active) values (%s,%s,%s,%s,%s,%s)
          on conflict (id) do update set username = excluded.username, full_name = excluded.full_name, role = excluded.role,
          team_id = excluded.team_id, active = excluded.active""", (U[k], k, k.title(), role, team, k != 'off'))

passed = failed = 0
def check(name, cond, extra=''):
    global passed, failed
    if cond: passed += 1; print('PASS', name)
    else: failed += 1; print('FAIL', name, extra)

check('first login automatically becomes the only manager', [(str(i), r) for i, r in first] == [(U['mgr'], 'manager')], first)

def as_(who, sql, params=None, fetch=True):
    with conn.transaction():
        ex("set local role authenticated")
        ex("select set_config('request.jwt.claim.sub', %s, true)", (U[who],))
        cur = ex(sql, params)
        return cur.fetchall() if fetch and cur.description else cur.rowcount

def raises(who, sql, params=None):
    try: as_(who, sql, params); return None
    except Exception as e: return str(e)

# --- reads per role ---
nA = ex("select count(*) from farms where team_id='A'").fetchone()[0]
check(f'worker sees only own team farms ({nA})', as_('jamal', "select count(*) from farms where team_id <> 'A'")[0][0] == 0 and as_('jamal', "select count(*) from farms")[0][0] == nA)
check('manager sees all farms', as_('mgr', "select count(*) from farms")[0][0] == 60)
check('client sees all farms (progress)', as_('client', "select count(*) from farms")[0][0] == 60)
check('stranger without profile sees nothing', as_('stranger', "select count(*) from farms")[0][0] == 0)
check('switched-off worker sees nothing', as_('off', "select count(*) from farms")[0][0] == 0)
check('client sees no teams', as_('client', "select count(*) from teams")[0][0] == 0)
check('worker sees only own team row', as_('jamal', "select id from teams") == [('A',)])
check('client sees only own profile', as_('client', "select count(*) from profiles")[0][0] == 1)
check('worker sees teammates only', sorted(r[0] for r in as_('jamal', "select username from profiles")) == ['jamal', 'off'])  # 'off' is inactive but same team

# --- writes workers must not do ---
check('worker cannot edit farms directly', as_('jamal', "update farms set stages = '{}' where id='HM16'") == 0)
check('worker cannot promote self', as_('jamal', "update profiles set role='manager' where id=%s", (U['jamal'],)) == 0)
check('client cannot approve photos', as_('client', "update photos set approved=true") == 0)

# --- photos ---
p1, p2, p3 = (str(uuid.uuid4()) for _ in range(3))
ins = "insert into photos (id, farm_id, stage, progress, kind, label, path, taken_at, user_id, team_id) values (%s,%s,'room',80,'progress','L',%s, now(), %s, 'A')"
check('worker uploads photo for own farm', raises('jamal', ins, (p1, 'HM16', f'HM16/{p1}.jpg', U['jamal'])) is None)
check('worker cannot upload for other team farm', raises('jamal', ins, (p2, 'BI07', f'BI07/{p2}.jpg', U['jamal'])) is not None)
check('worker cannot upload as someone else', raises('jamal', ins, (p2, 'HM16', f'HM16/{p2}.jpg', U['paulo'])) is not None)
check('worker cannot self-approve photo', raises('jamal', "insert into photos (id, farm_id, kind, label, path, taken_at, user_id, approved) values (%s,'HM16','progress','L','x', now(), %s, true)", (p2, U['jamal'])) is not None)
check('storage: worker upload own farm folder', raises('jamal', "insert into storage.objects (bucket_id, name) values ('photos', %s)", (f'HM16/{p1}.jpg',)) is None)
check('storage: worker blocked for other farm', raises('jamal', "insert into storage.objects (bucket_id, name) values ('photos', 'BI07/x.jpg')") is not None)
check('other team cannot see photo', as_('paulo', "select count(*) from photos")[0][0] == 0)

# --- submit_report ---
items = lambda photo: json.dumps([{'stage': s, 'action': 'no_change'} for s in ['main_lines','drip','sprinklers','electrical','generator','testing']] +
                                  [{'stage': 'room', 'action': 'updated', 'next': 80, 'photoId': photo}])
rid = str(uuid.uuid4())
call = "select submit_report(%s::uuid, 'HM16', current_date, %s::jsonb, %s::jsonb, '{\"verified\":true}'::jsonb, '{\"hours\":12}'::jsonb, now())"
e = raises('jamal', call, (rid, items(p3), None))
check('progress change without photo is refused', e and 'Photo missing' in e, e)
e = raises('paulo', call, (rid, items(p1), None))
check('other team cannot report on HM16', e and 'not assigned' in e, e)
e = raises('mgr', call, (rid, items(p1), None))
check('manager cannot submit field report', e and 'Only field workers' in e, e)
issue = json.dumps({'stage': 'generator', 'category': 'material', 'note': 'Falta material', 'lang': 'pt', 'photoId': None})
r = as_('jamal', call, (rid, items(p1), issue))
check('worker submits report', r[0][0] is not None)
check('farm progress applied', as_('mgr', "select stages->>'room' from farms where id='HM16'")[0][0] == '80')
check('issue created and visible to manager', as_('mgr', "select category, lang from issues") == [('material', 'pt')])
check('retry with same id is idempotent', as_('jamal', call, (rid, items(p1), issue))[0][0] is not None and as_('mgr', "select count(*) from reports")[0][0] == 1)
e = raises('jamal', call, (str(uuid.uuid4()), items(p1), None))
check('second report same farm/day refused', e and 'ALREADY_SUBMITTED' in e, e)
room = [i for i in as_('mgr', "select items from reports")[0][0] if i['stage'] == 'room'][0]
check('report stores server-side previous value', room['prev'] == 70 and room['next'] == 80)
check('client cannot read reports', as_('client', "select count(*) from reports")[0][0] == 0)
check('client cannot read issues', as_('client', "select count(*) from issues")[0][0] == 0)
check('other team cannot read report', as_('paulo', "select count(*) from reports")[0][0] == 0)
check('teammate history visible', as_('jamal', "select count(*) from reports")[0][0] == 1)

# --- client sees only approved photos ---
check('client sees no unapproved photo', as_('client', "select count(*) from photos")[0][0] == 0)
check('client storage read blocked before approval', as_('client', "select count(*) from storage.objects")[0][0] == 0)
check('manager approves photo', as_('mgr', "update photos set approved=true where id=%s", (p1,)) == 1)
check('client sees approved photo', as_('client', "select count(*) from photos")[0][0] == 1)
check('client storage read allowed after approval', as_('client', "select count(*) from storage.objects")[0][0] == 1)

# --- manager actions ---
check('manager resolves issue', as_('mgr', "update issues set status='resolved'") == 1)
check('manager follow-up', raises('mgr', "insert into follow_ups (team_id, date) values ('E', current_date)") is None)
check('worker cannot follow-up', raises('jamal', "insert into follow_ups (team_id, date) values ('E', current_date)") is not None)
check('manager changes role', as_('mgr', "update profiles set team_id='B' where id=%s", (U['off'],)) == 1)

# --- phone connectivity ---
ins_c = "insert into phone_connectivity (user_id, t, online, src) values (%s, now() - (%s || ' minutes')::interval, %s, 'app')"
check('worker records own phone checks', raises('jamal', ins_c, (U['jamal'], '30', False)) is None and raises('jamal', ins_c, (U['jamal'], '5', True)) is None)
check('worker cannot record checks for someone else', raises('jamal', ins_c, (U['paulo'], '4', True)) is not None)
check('client cannot record for a worker', raises('client', ins_c, (U['jamal'], '3', True)) is not None)
check('switched-off account cannot record', raises('off', ins_c, (U['off'], '3', True)) is not None)
raises('paulo', ins_c, (U['paulo'], '10', True))
rows = as_('mgr', "select user_id::text, jsonb_array_length(samples), last_online is not null from phone_status(12) order by 1")
check('manager sees every worker phone summary', sorted(r[0] for r in rows) == sorted([U['jamal'], U['paulo']]) and all(r[2] for r in rows))
check('summary keeps offline and online checks', [r for r in rows if r[0] == U['jamal']][0][1] == 2)
check('worker sees only own phone history', [r[0] for r in as_('jamal', "select user_id::text from phone_status(12)")] == [U['jamal']])
check('other worker cannot see Jamal', U['jamal'] not in [r[0] for r in as_('paulo', "select user_id::text from phone_status(12)")])
check('client sees no phone data', as_('client', "select count(*) from phone_connectivity")[0][0] == 0 and as_('client', "select count(*) from phone_status(12)")[0][0] == 0)

print(f'\n{passed} passed, {failed} failed')
conn.close()
sys.exit(1 if failed else 0)
