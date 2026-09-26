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

-- ---------------------------------------------------------------------------
-- submit_report: the only way progress changes from the field.
-- Validates the caller's team, requires a photo for every progress change,
-- applies stage updates and records the report and issue in one transaction.
-- ---------------------------------------------------------------------------
create or replace function public.submit_report(
  p_id uuid, p_farm text, p_date date, p_items jsonb, p_issue jsonb,
  p_location jsonb, p_connectivity jsonb, p_submitted_at timestamptz
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
  v_issue_id uuid;
  v_existing uuid;
begin
  if v_role is distinct from 'worker' then raise exception 'Only field workers can submit daily reports'; end if;

  select id into v_existing from public.reports where id = p_id;
  if v_existing is not null then return v_existing; end if;          -- retry of a report already received

  select * into v_farm from public.farms where id = p_farm for update;
  if not found then raise exception 'Unknown farm %', p_farm; end if;
  if v_farm.team_id is distinct from v_team then raise exception 'Farm % is not assigned to your team', p_farm; end if;
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

  if p_issue is not null then
    insert into public.issues (farm_id, stage, category, note, lang, photo_id, reported_by, team_id, at)
    values (p_farm, nullif(p_issue->>'stage', ''), p_issue->>'category', coalesce(p_issue->>'note', ''),
            coalesce(p_issue->>'lang', 'en'), nullif(p_issue->>'photoId', '')::uuid, auth.uid(), v_team,
            least(coalesce(p_submitted_at, now()), now()))
    returning id into v_issue_id;
  end if;

  update public.farms set stages = v_stages, updated_at = now() where id = p_farm;

  insert into public.reports (id, farm_id, team_id, user_id, date, submitted_at, items, issue_id, location, connectivity)
  values (p_id, p_farm, v_team, auth.uid(), p_date, least(coalesce(p_submitted_at, now()), now()),
          v_items, v_issue_id, p_location, p_connectivity);
  return p_id;
end $$;

revoke all on function public.submit_report from public, anon;
grant execute on function public.submit_report to authenticated;
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
