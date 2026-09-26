-- GAZI FIELD database schema (Supabase / Postgres).
-- Run once in Supabase: SQL Editor → New query → paste this file → Run.
-- Safe to re-run: it drops and recreates policies and functions, never data.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists public.project (
  id int primary key default 1 check (id = 1),
  name text not null default '60 Farms Project',
  country text not null default 'Angola'
);
insert into public.project (id) values (1) on conflict do nothing;

create table if not exists public.teams (
  id text primary key,                         -- 'A', 'B', …
  name text not null,
  today_farm_id text
);

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text unique not null,
  full_name text not null,
  role text not null check (role in ('worker', 'manager', 'client')),
  team_id text references public.teams (id) on delete set null,
  lang text not null default 'en' check (lang in ('en', 'pt', 'ar')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.farms (
  id text primary key,                         -- 'HM16'
  region text not null,
  lat double precision,
  lng double precision,
  team_id text references public.teams (id) on delete set null,
  stages jsonb not null default '{"room":0,"main_lines":0,"drip":0,"sprinklers":0,"electrical":0,"generator":0,"testing":0}',
  boq jsonb not null default '[]',
  drawing_photo_id uuid,
  updated_at timestamptz not null default now()
);
alter table public.teams drop constraint if exists teams_today_farm_fk;
alter table public.teams add constraint teams_today_farm_fk foreign key (today_farm_id) references public.farms (id) on delete set null;

create table if not exists public.photos (
  id uuid primary key,                         -- generated on the phone so offline retries are idempotent
  farm_id text not null references public.farms (id) on delete cascade,
  stage text,
  progress int check (progress between 0 and 100),
  kind text not null check (kind in ('progress', 'issue', 'drawing')),
  label text not null,
  path text not null,                          -- object path in the "photos" storage bucket
  taken_at timestamptz not null,
  user_id uuid references auth.users (id) on delete set null,
  team_id text,
  loc jsonb,
  approved boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists photos_farm_idx on public.photos (farm_id);

create table if not exists public.issues (
  id uuid primary key default gen_random_uuid(),
  farm_id text not null references public.farms (id) on delete cascade,
  stage text,
  category text not null check (category in ('access', 'material', 'equipment', 'technical', 'client', 'other')),
  note text not null default '',
  lang text not null default 'en',
  photo_id uuid references public.photos (id) on delete set null,
  reported_by uuid references auth.users (id) on delete set null,
  team_id text,
  at timestamptz not null default now(),
  status text not null default 'open' check (status in ('open', 'resolved')),
  resolved_at timestamptz
);

create table if not exists public.reports (
  id uuid primary key,                         -- generated on the phone
  farm_id text not null references public.farms (id) on delete cascade,
  team_id text,
  user_id uuid references auth.users (id) on delete set null,
  date date not null,
  submitted_at timestamptz not null,
  received_at timestamptz not null default now(),
  items jsonb not null,
  issue_id uuid references public.issues (id) on delete set null,
  location jsonb,
  connectivity jsonb,
  unique (farm_id, date)
);
create index if not exists reports_date_idx on public.reports (date);

create table if not exists public.follow_ups (
  team_id text not null references public.teams (id) on delete cascade,
  date date not null,
  at timestamptz not null default now(),
  by uuid references auth.users (id) on delete set null,
  primary key (team_id, date)
);

-- ---------------------------------------------------------------------------
-- Who is calling? (security definer so policies can use them without recursion)
-- ---------------------------------------------------------------------------
create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and active
$$;

create or replace function public.my_team() returns text
language sql stable security definer set search_path = public as $$
  select team_id from public.profiles where id = auth.uid() and active
$$;

-- ---------------------------------------------------------------------------
-- Row level security
--   manager: everything
--   worker:  own team's farms, reports, issues, photos; submits only through submit_report()
--   client:  project, farms (progress) and approved photos only
-- ---------------------------------------------------------------------------
alter table public.project enable row level security;
alter table public.teams enable row level security;
alter table public.profiles enable row level security;
alter table public.farms enable row level security;
alter table public.photos enable row level security;
alter table public.issues enable row level security;
alter table public.reports enable row level security;
alter table public.follow_ups enable row level security;

do $$ declare r record; begin
  for r in select policyname, tablename from pg_policies where schemaname = 'public'
    and tablename in ('project','teams','profiles','farms','photos','issues','reports','follow_ups') loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- project
create policy project_read on public.project for select to authenticated using ((select public.my_role()) is not null);
create policy project_mgr on public.project for update to authenticated using ((select public.my_role()) = 'manager');

-- teams
create policy teams_read on public.teams for select to authenticated
  using ((select public.my_role()) = 'manager' or id = (select public.my_team()));
create policy teams_mgr on public.teams for all to authenticated
  using ((select public.my_role()) = 'manager') with check ((select public.my_role()) = 'manager');

-- profiles
create policy profiles_read on public.profiles for select to authenticated
  using (id = auth.uid()
      or (select public.my_role()) = 'manager'
      or ((select public.my_role()) = 'worker' and team_id = (select public.my_team())));
create policy profiles_mgr on public.profiles for update to authenticated
  using ((select public.my_role()) = 'manager') with check ((select public.my_role()) = 'manager');

-- farms
create policy farms_read on public.farms for select to authenticated
  using ((select public.my_role()) in ('manager', 'client')
      or ((select public.my_role()) = 'worker' and team_id = (select public.my_team())));
create policy farms_mgr on public.farms for all to authenticated
  using ((select public.my_role()) = 'manager') with check ((select public.my_role()) = 'manager');

-- photos
create policy photos_read on public.photos for select to authenticated
  using ((select public.my_role()) = 'manager'
      or ((select public.my_role()) = 'worker' and farm_id in (select id from public.farms where team_id = (select public.my_team())))
      or ((select public.my_role()) = 'client' and approved));
create policy photos_insert on public.photos for insert to authenticated
  with check ((select public.my_role()) = 'manager'
      or ((select public.my_role()) = 'worker' and user_id = auth.uid() and approved = false
          and farm_id in (select id from public.farms where team_id = (select public.my_team()))));
create policy photos_mgr on public.photos for update to authenticated
  using ((select public.my_role()) = 'manager') with check ((select public.my_role()) = 'manager');
create policy photos_mgr_del on public.photos for delete to authenticated using ((select public.my_role()) = 'manager');

-- issues
create policy issues_read on public.issues for select to authenticated
  using ((select public.my_role()) = 'manager'
      or ((select public.my_role()) = 'worker' and team_id = (select public.my_team())));
create policy issues_mgr on public.issues for update to authenticated
  using ((select public.my_role()) = 'manager') with check ((select public.my_role()) = 'manager');

-- reports
create policy reports_read on public.reports for select to authenticated
  using ((select public.my_role()) = 'manager'
      or ((select public.my_role()) = 'worker' and team_id = (select public.my_team())));

-- follow-ups
create policy follow_ups_mgr on public.follow_ups for all to authenticated
  using ((select public.my_role()) = 'manager') with check ((select public.my_role()) = 'manager');

-- (submit_report is defined further down, in the v0.4 section)
revoke all on function public.my_role from public, anon;
revoke all on function public.my_team from public, anon;
grant execute on function public.my_role to authenticated;
grant execute on function public.my_team to authenticated;

-- ---------------------------------------------------------------------------
-- Photo storage: private bucket, files stored as <farm_id>/<photo_id>.jpg
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('photos', 'photos', false) on conflict (id) do nothing;

drop policy if exists "gazi photos read" on storage.objects;
drop policy if exists "gazi photos upload" on storage.objects;
drop policy if exists "gazi photos manage" on storage.objects;

create policy "gazi photos read" on storage.objects for select to authenticated using (
  bucket_id = 'photos' and (
    (select public.my_role()) = 'manager'
    or ((select public.my_role()) = 'worker' and (storage.foldername(name))[1] in (select id from public.farms where team_id = (select public.my_team())))
    or ((select public.my_role()) = 'client' and exists (select 1 from public.photos p where p.path = name and p.approved))
  ));
create policy "gazi photos upload" on storage.objects for insert to authenticated with check (
  bucket_id = 'photos' and (
    (select public.my_role()) = 'manager'
    or ((select public.my_role()) = 'worker' and (storage.foldername(name))[1] in (select id from public.farms where team_id = (select public.my_team())))
  ));
create policy "gazi photos manage" on storage.objects for delete to authenticated using (
  bucket_id = 'photos' and (select public.my_role()) = 'manager');

-- ---------------------------------------------------------------------------
-- The very first login created in Authentication → Users becomes the manager automatically.
-- Everyone after that is created from the app's People page (admin-users function).
-- ---------------------------------------------------------------------------
create or replace function public.first_user_is_manager() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.profiles where role = 'manager') then
    insert into public.profiles (id, username, full_name, role, lang)
    values (new.id, lower(split_part(new.email, '@', 1)), split_part(new.email, '@', 1), 'manager', 'en')
    on conflict (id) do nothing;
  end if;
  return new;
end $$;
drop trigger if exists first_user_is_manager on auth.users;
create trigger first_user_is_manager after insert on auth.users
  for each row execute function public.first_user_is_manager();

-- ---------------------------------------------------------------------------

create table if not exists public.phone_connectivity (
  user_id uuid not null references auth.users (id) on delete cascade,
  t timestamptz not null,           -- when the phone tested its connection
  online boolean not null,          -- true = a real request to the internet succeeded
  src text,                         -- app | start | resume | event | sw-periodic …
  primary key (user_id, t)
);
create index if not exists phone_connectivity_t_idx on public.phone_connectivity (t);
alter table public.phone_connectivity enable row level security;

drop policy if exists phone_conn_insert on public.phone_connectivity;
drop policy if exists phone_conn_read on public.phone_connectivity;
drop policy if exists phone_conn_mgr_delete on public.phone_connectivity;
-- Each signed-in person can only add checks for themselves.
create policy phone_conn_insert on public.phone_connectivity for insert to authenticated
  with check (user_id = auth.uid() and (select public.my_role()) is not null);
-- Management sees everyone's; a person sees their own. Clients see nothing.
create policy phone_conn_read on public.phone_connectivity for select to authenticated
  using ((select public.my_role()) = 'manager' or user_id = auth.uid());
create policy phone_conn_mgr_delete on public.phone_connectivity for delete to authenticated
  using ((select public.my_role()) = 'manager');

-- One row per person with their checks since p_hours ago: [[epoch_ms, online], …].
-- Runs with the caller's rights, so the rules above still apply.
create or replace function public.phone_status(p_hours int default 24)
returns table (user_id uuid, samples jsonb, last_online timestamptz, last_seen timestamptz)
language sql stable as $$
  select c.user_id,
         jsonb_agg(jsonb_build_array((extract(epoch from c.t) * 1000)::bigint, c.online) order by c.t),
         max(c.t) filter (where c.online),
         max(c.t)
  from public.phone_connectivity c
  where c.t > now() - make_interval(hours => least(greatest(p_hours, 1), 24 * 7))
  group by c.user_id
$$;
revoke all on function public.phone_status from public, anon;
grant execute on function public.phone_status to authenticated;

-- Keep 30 days of checks.
delete from public.phone_connectivity where t < now() - interval '30 days';

-- ---------------------------------------------------------------------------
-- v0.4 (migration 003)
-- GAZI FIELD v0.4
--   * Supervisor role: everything a manager can do, plus team/worker analysis (in the app).
--   * Farm names next to the codes.
--   * Workers can report on any farm (not only their team's).
--   * Several problems per daily report.
--   * Push reminders (subscriptions + a log so nobody is reminded twice).
-- Supabase → SQL Editor → New query → paste → Run. Safe to run again.

-- ---------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('worker', 'manager', 'supervisor', 'client'));

-- Access rules treat a supervisor exactly like a manager.
create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select case when role = 'supervisor' then 'manager' else role end
  from public.profiles where id = auth.uid() and active
$$;

-- ---------------------------------------------------------------------------
-- Farm names, problems linked to their report
-- ---------------------------------------------------------------------------
alter table public.farms add column if not exists name text;
alter table public.issues add column if not exists report_id uuid references public.reports (id) on delete cascade;
update public.issues i set report_id = r.id from public.reports r where r.issue_id = i.id and i.report_id is null;

-- ---------------------------------------------------------------------------
-- Workers may work on any farm: they can read every farm and its history,
-- and upload photos for any farm. Clients still see progress + approved photos only.
-- ---------------------------------------------------------------------------
drop policy if exists teams_read on public.teams;
create policy teams_read on public.teams for select to authenticated
  using ((select public.my_role()) in ('manager', 'worker'));

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated
  using (id = auth.uid()
      or (select public.my_role()) = 'manager'
      or ((select public.my_role()) = 'worker' and role <> 'client'));

drop policy if exists farms_read on public.farms;
create policy farms_read on public.farms for select to authenticated
  using ((select public.my_role()) is not null);

drop policy if exists photos_read on public.photos;
create policy photos_read on public.photos for select to authenticated
  using ((select public.my_role()) in ('manager', 'worker')
      or ((select public.my_role()) = 'client' and approved));
drop policy if exists photos_insert on public.photos;
create policy photos_insert on public.photos for insert to authenticated
  with check ((select public.my_role()) = 'manager'
      or ((select public.my_role()) = 'worker' and user_id = auth.uid() and approved = false));

drop policy if exists issues_read on public.issues;
create policy issues_read on public.issues for select to authenticated
  using ((select public.my_role()) in ('manager', 'worker'));

drop policy if exists reports_read on public.reports;
create policy reports_read on public.reports for select to authenticated
  using ((select public.my_role()) in ('manager', 'worker'));

drop policy if exists "gazi photos read" on storage.objects;
drop policy if exists "gazi photos upload" on storage.objects;
create policy "gazi photos read" on storage.objects for select to authenticated using (
  bucket_id = 'photos' and (
    (select public.my_role()) in ('manager', 'worker')
    or ((select public.my_role()) = 'client' and exists (select 1 from public.photos p where p.path = name and p.approved))
  ));
create policy "gazi photos upload" on storage.objects for insert to authenticated with check (
  bucket_id = 'photos' and (select public.my_role()) in ('manager', 'worker'));

-- ---------------------------------------------------------------------------
-- submit_report: any farm, several problems (p_issues). p_issue still accepted
-- so reports queued on phones by older versions of the app still go through.
-- ---------------------------------------------------------------------------
drop function if exists public.submit_report(uuid, text, date, jsonb, jsonb, jsonb, jsonb, timestamptz);
drop function if exists public.submit_report(uuid, text, date, jsonb, jsonb, jsonb, timestamptz, jsonb, jsonb);
create function public.submit_report(
  p_id uuid, p_farm text, p_date date, p_items jsonb,
  p_location jsonb, p_connectivity jsonb, p_submitted_at timestamptz,
  p_issue jsonb default null, p_issues jsonb default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_role text := public.my_role();
  v_team text := public.my_team();
  v_farm public.farms;
  v_stage text;
  v_item jsonb;
  v_prev int;
  v_next int;
  v_items jsonb := '[]';
  v_stages jsonb;
  v_issues jsonb;
  v_issue jsonb;
  v_issue_id uuid;
  v_first_issue uuid;
  v_at timestamptz := least(coalesce(p_submitted_at, now()), now());
begin
  if v_role is distinct from 'worker' then raise exception 'Only field workers can submit daily reports'; end if;
  if exists (select 1 from public.reports where id = p_id) then return p_id; end if;   -- retry of a report already received

  select * into v_farm from public.farms where id = p_farm for update;
  if not found then raise exception 'Unknown farm %', p_farm; end if;
  if exists (select 1 from public.reports where farm_id = p_farm and date = p_date) then
    raise exception 'ALREADY_SUBMITTED: % already has a report for %', p_farm, p_date;
  end if;

  v_stages := v_farm.stages;
  foreach v_stage in array array['room','main_lines','drip','sprinklers','electrical','generator','testing'] loop
    select x into v_item from jsonb_array_elements(p_items) x where x->>'stage' = v_stage limit 1;
    if v_item is null then raise exception 'Stage % was not reviewed', v_stage; end if;
    v_prev := coalesce((v_stages->>v_stage)::int, 0);
    if v_item->>'action' = 'updated' then
      v_next := (v_item->>'next')::int;
      if v_next is null or v_next < 0 or v_next > 100 then raise exception 'Invalid progress for %', v_stage; end if;
      if not exists (select 1 from public.photos where id = (v_item->>'photoId')::uuid and farm_id = p_farm and user_id = auth.uid()) then
        raise exception 'Photo missing for %', v_stage;
      end if;
      v_next := greatest(v_prev, v_next);                                 -- never move progress backwards
      v_stages := jsonb_set(v_stages, array[v_stage], to_jsonb(v_next));
      v_items := v_items || jsonb_build_object('stage', v_stage, 'prev', v_prev, 'next', v_next, 'action', 'updated', 'photoId', v_item->>'photoId');
    else
      v_items := v_items || jsonb_build_object('stage', v_stage, 'prev', v_prev, 'next', v_prev,
        'action', case when v_item->>'action' = 'confirmed' then 'confirmed' else 'no_change' end, 'photoId', null);
    end if;
  end loop;

  update public.farms set stages = v_stages, updated_at = now() where id = p_farm;
  insert into public.reports (id, farm_id, team_id, user_id, date, submitted_at, items, location, connectivity)
  values (p_id, p_farm, v_team, auth.uid(), p_date, v_at, v_items, p_location, p_connectivity);

  v_issues := coalesce(p_issues, case when p_issue is null then '[]'::jsonb else jsonb_build_array(p_issue) end);
  for v_issue in select * from jsonb_array_elements(v_issues) loop
    insert into public.issues (farm_id, stage, category, note, lang, photo_id, reported_by, team_id, at, report_id)
    values (p_farm, nullif(v_issue->>'stage', ''), v_issue->>'category', coalesce(v_issue->>'note', ''),
            coalesce(v_issue->>'lang', 'en'), nullif(v_issue->>'photoId', '')::uuid, auth.uid(), v_team, v_at, p_id)
    returning id into v_issue_id;
    v_first_issue := coalesce(v_first_issue, v_issue_id);
  end loop;
  update public.reports set issue_id = v_first_issue where id = p_id;
  return p_id;
end $$;
revoke all on function public.submit_report from public, anon;
grant execute on function public.submit_report to authenticated;

-- ---------------------------------------------------------------------------
-- Push reminders
-- ---------------------------------------------------------------------------
create table if not exists public.push_subscriptions (
  endpoint text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  p256dh text not null,
  auth text not null,
  lang text not null default 'en',
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
drop policy if exists push_own_read on public.push_subscriptions;
drop policy if exists push_own_delete on public.push_subscriptions;
create policy push_own_read on public.push_subscriptions for select to authenticated using (user_id = auth.uid());
create policy push_own_delete on public.push_subscriptions for delete to authenticated using (user_id = auth.uid());

-- A phone's subscription belongs to whoever signed in on it last.
create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_lang text default 'en')
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.my_role() is null then raise exception 'Not signed in'; end if;
  insert into public.push_subscriptions (endpoint, user_id, p256dh, auth, lang)
  values (p_endpoint, auth.uid(), p_p256dh, p_auth, coalesce(p_lang, 'en'))
  on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh,
    auth = excluded.auth, lang = excluded.lang, created_at = now();
end $$;
revoke all on function public.save_push_subscription from public, anon;
grant execute on function public.save_push_subscription to authenticated;

create table if not exists public.reminders_sent (
  user_id uuid not null references auth.users (id) on delete cascade,
  date date not null,
  kind text not null,
  at timestamptz not null default now(),
  primary key (user_id, date, kind)
);
alter table public.reminders_sent enable row level security;
drop policy if exists reminders_mgr_read on public.reminders_sent;
create policy reminders_mgr_read on public.reminders_sent for select to authenticated
  using ((select public.my_role()) = 'manager');

-- ---------------------------------------------------------------------------
-- v0.5 (migration 004)
-- GAZI FIELD v0.5
--   * The project's real 9 stages (as in the PDAC progress tracking table).
--   * Farm details (system, area, crop, client, project no., map outline, stage dates) and cancelled farms.
--   * Urgent problems reported on their own, without a daily report.
-- Supabase → SQL Editor → New query → paste → Run. Safe to run again.

-- The stages, in order. submit_report() and the app use the same list.
create or replace function public.gazi_stages() returns text[]
language sql immutable as $$
  select array['concrete_floor','room_structure','excavation','room_irrigation','drip_sprinklers',
               'main_line','secondary_lines','electricity','commissioning']
$$;
grant execute on function public.gazi_stages to authenticated;

alter table public.farms alter column stages set default
  '{"concrete_floor":0,"room_structure":0,"excavation":0,"room_irrigation":0,"drip_sprinklers":0,"main_line":0,"secondary_lines":0,"electricity":0,"commissioning":0}';
alter table public.farms add column if not exists details jsonb not null default '{}';
alter table public.farms add column if not exists status text not null default 'active';
alter table public.farms drop constraint if exists farms_status_check;
alter table public.farms add constraint farms_status_check check (status in ('active', 'cancelled'));

alter table public.issues add column if not exists urgent boolean not null default false;

-- ---------------------------------------------------------------------------
-- submit_report: same as v0.4, over the 9 stages; cancelled farms refused.
-- ---------------------------------------------------------------------------
drop function if exists public.submit_report(uuid, text, date, jsonb, jsonb, jsonb, timestamptz, jsonb, jsonb);
create function public.submit_report(
  p_id uuid, p_farm text, p_date date, p_items jsonb,
  p_location jsonb, p_connectivity jsonb, p_submitted_at timestamptz,
  p_issue jsonb default null, p_issues jsonb default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_role text := public.my_role();
  v_team text := public.my_team();
  v_farm public.farms;
  v_stage text;
  v_item jsonb;
  v_prev int;
  v_next int;
  v_items jsonb := '[]';
  v_stages jsonb;
  v_issues jsonb;
  v_issue jsonb;
  v_issue_id uuid;
  v_first_issue uuid;
  v_at timestamptz := least(coalesce(p_submitted_at, now()), now());
begin
  if v_role is distinct from 'worker' then raise exception 'Only field workers can submit daily reports'; end if;
  if exists (select 1 from public.reports where id = p_id) then return p_id; end if;   -- retry of a report already received

  select * into v_farm from public.farms where id = p_farm for update;
  if not found then raise exception 'Unknown farm %', p_farm; end if;
  if v_farm.status = 'cancelled' then raise exception 'Unknown farm %: cancelled', p_farm; end if;
  if exists (select 1 from public.reports where farm_id = p_farm and date = p_date) then
    raise exception 'ALREADY_SUBMITTED: % already has a report for %', p_farm, p_date;
  end if;

  v_stages := v_farm.stages;
  foreach v_stage in array public.gazi_stages() loop
    select x into v_item from jsonb_array_elements(p_items) x where x->>'stage' = v_stage limit 1;
    if v_item is null then raise exception 'Stage % was not reviewed', v_stage; end if;
    v_prev := coalesce((v_stages->>v_stage)::int, 0);
    if v_item->>'action' = 'updated' then
      v_next := (v_item->>'next')::int;
      if v_next is null or v_next < 0 or v_next > 100 then raise exception 'Invalid progress for %', v_stage; end if;
      if not exists (select 1 from public.photos where id = (v_item->>'photoId')::uuid and farm_id = p_farm and user_id = auth.uid()) then
        raise exception 'Photo missing for %', v_stage;
      end if;
      v_next := greatest(v_prev, v_next);                                 -- never move progress backwards
      v_stages := jsonb_set(v_stages, array[v_stage], to_jsonb(v_next));
      v_items := v_items || jsonb_build_object('stage', v_stage, 'prev', v_prev, 'next', v_next, 'action', 'updated', 'photoId', v_item->>'photoId');
    else
      v_items := v_items || jsonb_build_object('stage', v_stage, 'prev', v_prev, 'next', v_prev,
        'action', case when v_item->>'action' = 'confirmed' then 'confirmed' else 'no_change' end, 'photoId', null);
    end if;
  end loop;

  update public.farms set stages = v_stages, updated_at = now() where id = p_farm;
  insert into public.reports (id, farm_id, team_id, user_id, date, submitted_at, items, location, connectivity)
  values (p_id, p_farm, v_team, auth.uid(), p_date, v_at, v_items, p_location, p_connectivity);

  v_issues := coalesce(p_issues, case when p_issue is null then '[]'::jsonb else jsonb_build_array(p_issue) end);
  for v_issue in select * from jsonb_array_elements(v_issues) loop
    insert into public.issues (farm_id, stage, category, note, lang, photo_id, reported_by, team_id, at, report_id)
    values (p_farm, nullif(v_issue->>'stage', ''), v_issue->>'category', coalesce(v_issue->>'note', ''),
            coalesce(v_issue->>'lang', 'en'), nullif(v_issue->>'photoId', '')::uuid, auth.uid(), v_team, v_at, p_id)
    returning id into v_issue_id;
    v_first_issue := coalesce(v_first_issue, v_issue_id);
  end loop;
  update public.reports set issue_id = v_first_issue where id = p_id;
  return p_id;
end $$;
revoke all on function public.submit_report from public, anon;
grant execute on function public.submit_report to authenticated;

-- ---------------------------------------------------------------------------
-- report_issue: a problem reported straight away, without a daily report (urgent).
-- The id comes from the phone, so an upload retried after losing signal is not duplicated.
-- ---------------------------------------------------------------------------
drop function if exists public.report_issue(uuid, text, jsonb, timestamptz);
create function public.report_issue(p_id uuid, p_farm text, p_issue jsonb, p_at timestamptz default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_role text := public.my_role();
begin
  if v_role is null or v_role = 'client' then raise exception 'Not allowed to report problems'; end if;
  if exists (select 1 from public.issues where id = p_id) then return p_id; end if;
  if not exists (select 1 from public.farms where id = p_farm) then raise exception 'Unknown farm %', p_farm; end if;
  if nullif(p_issue->>'photoId', '') is not null
     and not exists (select 1 from public.photos where id = (p_issue->>'photoId')::uuid and user_id = auth.uid()) then
    raise exception 'Photo missing';
  end if;
  insert into public.issues (id, farm_id, stage, category, note, lang, photo_id, reported_by, team_id, at, urgent)
  values (p_id, p_farm, nullif(p_issue->>'stage', ''), p_issue->>'category', coalesce(p_issue->>'note', ''),
          coalesce(p_issue->>'lang', 'en'), nullif(p_issue->>'photoId', '')::uuid, auth.uid(), public.my_team(),
          least(coalesce(p_at, now()), now()), coalesce((p_issue->>'urgent')::boolean, true));
  return p_id;
end $$;
revoke all on function public.report_issue from public, anon;
grant execute on function public.report_issue to authenticated;

-- ---------------------------------------------------------------------------
-- The phone internet check was removed from the app: delete its data too.
-- ---------------------------------------------------------------------------
drop function if exists public.phone_status(int);
drop table if exists public.phone_connectivity;
