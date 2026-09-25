-- GAZI FIELD: complete database setup (schema + starter teams and farms).
-- Supabase → SQL Editor → New query → paste this whole file → Run. Safe to run again.

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

-- GAZI FIELD starter data: 5 teams, 60 farms (demo progress and BOQ). Run after schema.sql.
-- Safe to re-run: existing farms and teams are left unchanged.
insert into public.teams (id, name) values
  ('A', 'Team A'),
  ('B', 'Team B'),
  ('C', 'Team C'),
  ('D', 'Team D'),
  ('E', 'Team E')
on conflict (id) do nothing;

insert into public.farms (id, region, lat, lng, team_id, stages, boq) values
  ('HM01', 'Huambo', -12.89132, 15.78577, 'A', '{"room": 100, "main_lines": 100, "drip": 100, "sprinklers": 100, "electrical": 100, "generator": 100, "testing": 100}', '[{"item": "Pump room (civil works)", "unit": "m²", "qty": 24}, {"item": "Main line HDPE Ø110", "unit": "m", "qty": 1850}, {"item": "Sub-main HDPE Ø63", "unit": "m", "qty": 2400}, {"item": "Drip line 16 mm", "unit": "m", "qty": 38000}, {"item": "Sprinklers", "unit": "pcs", "qty": 120}, {"item": "Filtration station", "unit": "set", "qty": 1}, {"item": "Pump 15 kW", "unit": "pcs", "qty": 1}, {"item": "Generator 30 kVA", "unit": "pcs", "qty": 1}, {"item": "Electrical panel", "unit": "pcs", "qty": 1}, {"item": "Cable 4×16 mm²", "unit": "m", "qty": 160}]'),
  ('HM02', 'Huambo', -12.91663, 15.92374, 'B', '{"room": 0, "main_lines": 0, "drip": 0, "sprinklers": 0, "electrical": 0, "generator": 0, "testing": 0}', '[{"item": "Pump room (civil works)", "unit": "m²", "qty": 24}, {"item": "Main line HDPE Ø110", "unit": "m", "qty": 1850}, {"item": "Sub-main HDPE Ø63", "unit": "m", "qty": 2400}, {"item": "Drip line 16 mm", "unit": "m", "qty": 38000}, {"item": "Sprinklers", "unit": "pcs", "qty": 120}, {"item": "Filtration station", "unit": "set", "qty": 1}, {"item": "Pump 15 kW", "unit": "pcs", "qty": 1}, {"item": "Generator 30 kVA", "unit": "pcs", "qty": 1}, {"item": "Electrical panel", "unit": "pcs", "qty": 1}, {"item": "Cable 4×16 mm²", "unit": "m", "qty": 160}]'),
  ('HM03', 'Huambo', -12.79567, 15.63851, 'C', '{"room": 100, "main_lines": 100, "drip": 100, "sprinklers": 100, "electrical": 100, "generator": 100, "testing": 100}', '[{"item": "Pump room (civil works)", "unit": "m²", "qty": 24}, {"item": "Main line HDPE Ø110", "unit": "m", "qty": 1850}, {"item": "Sub-main HDPE Ø63", "unit": "m", "qty": 2400}, {"item": "Drip line 16 mm", "unit": "m", "qty": 38000}, {"item": "Sprinklers", "unit": "pcs", "qty": 120}, {"item": "Filtration station", "unit": "set", "qty": 1}, {"item": "Pump 15 kW", "unit": "pcs", "qty": 1}, {"item": "Generator 30 kVA", "unit": "pcs", "qty": 1}, {"item": "Electrical panel", "unit": "pcs", "qty": 1}, {"item": "Cable 4×16 mm²", "unit": "m", "qty": 160}]'),
  ('HM04', 'Huambo', -12.53795, 15.91445, 'D', '{"room": 100, "main_lines": 95, "drip": 70, "sprinklers": 55, "electrical": 50, "generator": 30, "testing": 0}', '[{"item": "Pump room (civil works)", "unit": "m²", "qty": 24}, {"item": "Main line HDPE Ø110", "unit": "m", "qty": 1850}, {"item": "Sub-main HDPE Ø63", "unit": "m", "qty": 2400}, {"item": "Drip line 16 mm", "unit": "m", "qty": 38000}, {"item": "Sprinklers", "unit": "pcs", "qty": 120}, {"item": "Filtration station", "unit": "set", "qty": 1}, {"item": "Pump 15 kW", "unit": "pcs", "qty": 1}, {"item": "Generator 30 kVA", "unit": "pcs", "qty": 1}, {"item": "Electrical panel", "unit": "pcs", "qty": 1}, {"item": "Cable 4×16 mm²", "unit": "m", "qty": 160}]'),
  ('HM05', 'Huambo', -12.56023, 15.83849, 'E', '{"room": 100, "main_lines": 100, "drip": 100, "sprinklers": 100, "electrical": 100, "generator": 100, "testing": 100}', '[{"item": "Pump room (civil works)", "unit": "m²", "qty": 24}, {"item": "Main line HDPE Ø110", "unit": "m", "qty": 1850}, {"item": "Sub-main HDPE Ø63", "unit": "m", "qty": 2400}, {"item": "Drip line 16 mm", "unit": "m", "qty": 38000}, {"item": "Sprinklers", "unit": "pcs", "qty": 120}, {"item": "Filtration station", "unit": "set", "qty": 1}, {"item": "Pump 15 kW", "unit": "pcs", "qty": 1}, {"item": "Generator 30 kVA", "unit": "pcs", "qty": 1}, {"item": "Electrical panel", "unit": "pcs", "qty": 1}, {"item": "Cable 4×16 mm²", "unit": "m", "qty": 160}]'),
  ('HM06', 'Huambo', -12.96472, 15.67296, 'A', '{"room": 100, "main_lines": 100, "drip": 90, "sprinklers": 75, "electrical": 60, "generator": 50, "testing": 35}', '[{"item": "Pump room (civil works)", "unit": "m²", "qty": 24}, {"item": "Main line HDPE Ø110", "unit": "m", "qty": 1850}, {"item": "Sub-main HDPE Ø63", "unit": "m", "qty": 2400}, {"item": "Drip line 16 mm", "unit": "m", "qty": 38000}, {"item": "Sprinklers", "unit": "pcs", "qty": 120}, {"item": "Filtration station", "unit": "set", "qty": 1}, {"item": "Pump 15 kW", "unit": "pcs", "qty": 1}, {"item": "Generator 30 kVA", "unit": "pcs", "qty": 1}, {"item": "Electrical panel", "unit": "pcs", "qty": 1}, {"item": "Cable 4×16 mm²", "unit": "m", "qty": 160}]'),
  ('HM07', 'Huambo', -12.93234, 15.91488, 'B', '{"room": 100, "main_lines": 100, "drip": 100, "sprinklers": 100, "electrical": 100, "generator": 100, "testing": 100}', '[{"item": "Pump room (civil works)", "unit": "m²", "qty": 24}, {"item": "Main line HDPE Ø110", "unit": "m", "qty": 1850}, {"item": "Sub-main HDPE Ø63", "unit": "m", "qty": 2400}, {"item": "Drip line 16 mm", "unit": "m", "qty": 38000}, {"item": "Sprinklers", "unit": "pcs", "qty": 120}, {"item": "Filtration station", "unit": "set", "qty": 1}, {"item": "Pump 15 kW", "unit": "pcs", "qty": 1}, {"item": "Generator 30 kVA", "unit": "pcs", "qty": 1}, {"item": "Electrical panel", "unit": "pcs", "qty": 1}, {"item": "Cable 4×16 mm²", "unit": "m", "qty": 160}]'),
  ('HM08', 'Huambo', -13.07049, 15.91333, 'C', '{"room": 100, "main_lines": 100, "drip": 95, "sprinklers": 65, "electrical": 60, "generator": 40, "testing": 20}', '[{"item": "Pump room (civil works)", "unit": "m²", "qty": 24}, {"item": "Main line HDPE Ø110", "unit": "m", "qty": 1850}, {"item": "Sub-main HDPE Ø63", "unit": "m", "qty": 2400}, {"item": "Drip line 16 mm", "unit": "m", "qty": 38000}, {"item": "Sprinklers", "unit": "pcs", "qty": 120}, {"item": "Filtration station", "unit": "set", "qty": 1}, {"item": "Pump 15 kW", "unit": "pcs", "qty": 1}, {"item": "Generator 30 kVA", "unit": "pcs", "qty": 1}, {"item": "Electrical panel", "unit": "pcs", "qty": 1}, {"item": "Cable 4×16 mm²", "unit": "m", "qty": 160}]'),
  ('HM09', 'Huambo', -12.97593, 15.62269, 'D', '{"room": 100, "main_lines": 100, "drip": 100, "sprinklers": 100, "electrical": 100, "generator": 100, "testing": 100}', '[{"item": "Pump room (civil works)", "unit": "m²", "qty": 24}, {"item": "Main line HDPE Ø110", "unit": "m", "qty": 1850}, {"item": "Sub-main HDPE Ø63", "unit": "m", "qty": 2400}, {"item": "Drip line 16 mm", "unit": "m", "qty": 38000}, {"item": "Sprinklers", "unit": "pcs", "qty": 120}, {"item": "Filtration station", "unit": "set", "qty": 1}, {"item": "Pump 15 kW", "unit": "pcs", "qty": 1}, {"item": "Generator 30 kVA", "unit": "pcs", "qty": 1}, {"item": "Electrical panel", "unit": "pcs", "qty": 1}, {"item": "Cable 4×16 mm²", "unit": "m", "qty": 160}]'),
  ('HM10', 'Huambo', -12.69879, 15.84395, 'E', '{"room": 95, "main_lines": 95, "drip": 70, "sprinklers": 60, "electrical": 35, "generator": 20, "testing": 5}', '[{"item": "Pump room (civil works)", "unit": "m²", "qty": 24}, {"item": "Main line HDPE Ø110", "unit": "m", "qty": 1850}, {"item": "Sub-main HDPE Ø63", "unit": "m", "qty": 2400}, {"item": "Drip line 16 mm", "unit": "m", "qty": 38000}, {"item": "Sprinklers", "unit": "pcs", "qty": 120}, {"item": "Filtration station", "unit": "set", "qty": 1}, {"item": "Pump 15 kW", "unit": "pcs", "qty": 1}, {"item": "Generator 30 kVA", "unit": "pcs", "qty": 1}, {"item": "Electrical panel", "unit": "pcs", "qty": 1}, {"item": "Cable 4×16 mm²", "unit": "m", "qty": 160}]'),
  ('HM11', 'Huambo', -12.76856, 15.77273, 'A', '{"room": 100, "main_lines": 85, "drip": 65, "sprinklers": 50, "electrical": 40, "generator": 25, "testing": 10}', '[{"item": "Pump room (civil works)", "unit": "m²", "qty": 24}, {"item": "Main line HDPE Ø110", "unit": "m", "qty": 1850}, {"item": "Sub-main HDPE Ø63", "unit": "m", "qty": 2400}, {"item": "Drip line 16 mm", "unit": "m", "qty": 38000}, {"item": "Sprinklers", "unit": "pcs", "qty": 120}, {"item": "Filtration station", "unit": "set", "qty": 1}, {"item": "Pump 15 kW", "unit": "pcs", "qty": 1}, {"item": "Generator 30 kVA", "unit": "pcs", "qty": 1}, {"item": "Electrical panel", "unit": "pcs", "qty": 1}, {"item": "Cable 4×16 mm²", "unit": "m", "qty": 160}]'),
  ('HM12', 'Huambo', -12.72267, 15.79918, 'B', '{"room": 0, "main_lines": 0, "drip": 0, "sprinklers": 0, "electrical": 0, "generator": 0, "testing": 0}', '[{"item": "Pump room (civil works)", "unit": "m²", "qty": 24}, {"item": "Main line HDPE Ø110", "unit": "m", "qty": 1850}, {"item": "Sub-main HDPE Ø63", "unit": "m", "qty": 2400}, {"item": "Drip line 16 mm", "unit": "m", "qty": 38000}, {"item": "Sprinklers", "unit": "pcs", "qty": 120}, {"item": "Filtration station", "unit": "set", "qty": 1}, {"item": "Pump 15 kW", "unit": "pcs", "qty": 1}, {"item": "Generator 30 kVA", "unit": "pcs", "qty": 1}, {"item": "Electrical panel", "unit": "pcs", "qty": 1}, {"item": "Cable 4×16 mm²", "unit": "m", "qty": 160}]'),
  ('HM13', 'Huambo', -13.01102, 15.62012, 'C', '{"room": 0, "main_lines": 0, "drip": 0, "sprinklers": 0, "electrical": 0, "generator": 0, "testing": 0}', '[{"item": "Pump room (civil works)", "unit": "m²", "qty": 24}, {"item": "Main line HDPE Ø110", "unit": "m", "qty": 1850}, {"item": "Sub-main HDPE Ø63", "unit": "m", "qty": 2400}, {"item": "Drip line 16 mm", "unit": "m", "qty": 38000}, {"item": "Sprinklers", "unit": "pcs", "qty": 120}, {"item": "Filtration station", "unit": "set", "qty": 1}, {"item": "Pump 15 kW", "unit": "pcs", "qty": 1}, {"item": "Generator 30 kVA", "unit": "pcs", "qty": 1}, {"item": "Electrical panel", "unit": "pcs", "qty": 1}, {"item": "Cable 4×16 mm²", "unit": "m", "qty": 160}]'),
  ('HM14', 'Huambo', -13.0637, 15.77908, 'D', '{"room": 100, "main_lines": 100, "drip": 100, "sprinklers": 100, "electrical": 100, "generator": 100, "testing": 100}', '[{"item": "Pump room (civil works)", "unit": "m²", "qty": 24}, {"item": "Main line HDPE Ø110", "unit": "m", "qty": 1850}, {"item": "Sub-main HDPE Ø63", "unit": "m", "qty": 2400}, {"item": "Drip line 16 mm", "unit": "m", "qty": 38000}, {"item": "Sprinklers", "unit": "pcs", "qty": 120}, {"item": "Filtration station", "unit": "set", "qty": 1}, {"item": "Pump 15 kW", "unit": "pcs", "qty": 1}, {"item": "Generator 30 kVA", "unit": "pcs", "qty": 1}, {"item": "Electrical panel", "unit": "pcs", "qty": 1}, {"item": "Cable 4×16 mm²", "unit": "m", "qty": 160}]'),
  ('HM15', 'Huambo', -12.8993, 15.58429, 'E', '{"room": 100, "main_lines": 100, "drip": 100, "sprinklers": 100, "electrical": 70, "generator": 70, "testing": 35}', '[{"item": "Pump room (civil works)", "unit": "m²", "qty": 24}, {"item": "Main line HDPE Ø110", "unit": "m", "qty": 1850}, {"item": "Sub-main HDPE Ø63", "unit": "m", "qty": 2400}, {"item": "Drip line 16 mm", "unit": "m", "qty": 38000}, {"item": "Sprinklers", "unit": "pcs", "qty": 120}, {"item": "Filtration station", "unit": "set", "qty": 1}, {"item": "Pump 15 kW", "unit": "pcs", "qty": 1}, {"item": "Generator 30 kVA", "unit": "pcs", "qty": 1}, {"item": "Electrical panel", "unit": "pcs", "qty": 1}, {"item": "Cable 4×16 mm²", "unit": "m", "qty": 160}]'),
  ('HM16', 'Huambo', -12.91133, 16.00376, 'A', '{"room": 70, "main_lines": 100, "drip": 40, "sprinklers": 0, "electrical": 35, "generator": 20, "testing": 0}', '[{"item": "Pump room (civil works)", "unit": "m²", "qty": 24}, {"item": "Main line HDPE Ø110", "unit": "m", "qty": 1850}, {"item": "Sub-main HDPE Ø63", "unit": "m", "qty": 2400}, {"item": "Drip line 16 mm", "unit": "m", "qty": 38000}, {"item": "Sprinklers", "unit": "pcs", "qty": 120}, {"item": "Filtration station", "unit": "set", "qty": 1}, {"item": "Pump 15 kW", "unit": "pcs", "qty": 1}, {"item": "Generator 30 kVA", "unit": "pcs", "qty": 1}, {"item": "Electrical panel", "unit": "pcs", "qty": 1}, {"item": "Cable 4×16 mm²", "unit": "m", "qty": 160}]'),
  ('HM17', 'Huambo', -12.99906, 15.98017, 'B', '{"room": 100, "main_lines": 75, "drip": 70, "sprinklers": 55, "electrical": 40, "generator": 25, "testing": 0}', '[{"item": "Pump room (civil works)", "unit": "m²", "qty": 24}, {"item": "Main line HDPE Ø110", "unit": "m", "qty": 1850}, {"item": "Sub-main HDPE Ø63", "unit": "m", "qty": 2400}, {"item": "Drip line 16 mm", "unit": "m", "qty": 38000}, {"item": "Sprinklers", "unit": "pcs", "qty": 120}, {"item": "Filtration station", "unit": "set", "qty": 1}, {"item": "Pump 15 kW", "unit": "pcs", "qty": 1}, {"item": "Generator 30 kVA", "unit": "pcs", "qty": 1}, {"item": "Electrical panel", "unit": "pcs", "qty": 1}, {"item": "Cable 4×16 mm²", "unit": "m", "qty": 160}]'),
  ('HM18', 'Huambo', -12.5341, 15.56128, 'C', '{"room": 75, "main_lines": 75, "drip": 45, "sprinklers": 35, "electrical": 20, "generator": 0, "testing": 0}', '[{"item": "Pump room (civil works)", "unit": "m²", "qty": 24}, {"item": "Main line HDPE Ø110", "unit": "m", "qty": 1850}, {"item": "Sub-main HDPE Ø63", "unit": "m", "qty": 2400}, {"item": "Drip line 16 mm", "unit": "m", "qty": 38000}, {"item": "Sprinklers", "unit": "pcs", "qty": 120}, {"item": "Filtration station", "unit": "set", "qty": 1}, {"item": "Pump 15 kW", "unit": "pcs", "qty": 1}, {"item": "Generator 30 kVA", "unit": "pcs", "qty": 1}, {"item": "Electrical panel", "unit": "pcs", "qty": 1}, {"item": "Cable 4×16 mm²", "unit": "m", "qty": 160}]'),
  ('HM19', 'Huambo', -12.57812, 15.55646, 'E', '{"room": 100, "main_lines": 100, "drip": 85, "sprinklers": 65, "electrical": 30, "generator": 20, "testing": 0}', '[{"item": "Pump room (civil works)", "unit": "m²", "qty": 24}, {"item": "Main line HDPE Ø110", "unit": "m", "qty": 1850}, {"item": "Sub-main HDPE Ø63", "unit": "m", "qty": 2400}, {"item": "Drip line 16 mm", "unit": "m", "qty": 38000}, {"item": "Sprinklers", "unit": "pcs", "qty": 120}, {"item": "Filtration station", "unit": "set", "qty": 1}, {"item": "Pump 15 kW", "unit": "pcs", "qty": 1}, {"item": "Generator 30 kVA", "unit": "pcs", "qty": 1}, {"item": "Electrical panel", "unit": "pcs", "qty": 1}, {"item": "Cable 4×16 mm²", "unit": "m", "qty": 160}]'),
  ('HM20', 'Huambo', -12.68848, 15.51222, 'E', '{"room": 100, "main_lines": 100, "drip": 100, "sprinklers": 100, "electrical": 100, "generator": 100, "testing": 100}', '[{"item": "Pump room (civil works)", "unit": "m²", "qty": 24}, {"item": "Main line HDPE Ø110", "unit": "m", "qty": 1850}, {"item": "Sub-main HDPE Ø63", "unit": "m", "qty": 2400}, {"item": "Drip line 16 mm", "unit": "m", "qty": 38000}, {"item": "Sprinklers", "unit": "pcs", "qty": 120}, {"item": "Filtration station", "unit": "set", "qty": 1}, {"item": "Pump 15 kW", "unit": "pcs", "qty": 1}, {"item": "Generator 30 kVA", "unit": "pcs", "qty": 1}, {"item": "Electrical panel", "unit": "pcs", "qty": 1}, {"item": "Cable 4×16 mm²", "unit": "m", "qty": 160}]'),
  ('HM21', 'Huambo', -12.88496, 15.73528, 'A', '{"room": 0, "main_lines": 0, "drip": 0, "sprinklers": 0, "electrical": 0, "generator": 0, "testing": 0}', '[{"item": "Pump room (civil works)", "unit": "m²", "qty": 24}, {"item": "Main line HDPE Ø110", "unit": "m", "qty": 1850}, {"item": "Sub-main HDPE Ø63", "unit": "m", "qty": 2400}, {"item": "Drip line 16 mm", "unit": "m", "qty": 38000}, {"item": "Sprinklers", "unit": "pcs", "qty": 120}, {"item": "Filtration station", "unit": "set", "qty": 1}, {"item": "Pump 15 kW", "unit": "pcs", "qty": 1}, {"item": "Generator 30 kVA", "unit": "pcs", "qty": 1}, {"item": "Electrical panel", "unit": "pcs", "qty": 1}, {"item": "Cable 4×16 mm²", "unit": "m", "qty": 160}]'),
  ('HM22', 'Huambo', -12.85015, 15.93438, 'B', '{"room": 0, "main_lines": 0, "drip": 0, "sprinklers": 0, "electrical": 0, "generator": 0, "testing": 0}', '[{"item": "Pump room (civil works)", "unit": "m²", "qty": 24}, {"item": "Main line HDPE Ø110", "unit": "m", "qty": 1850}, {"item": "Sub-main HDPE Ø63", "unit": "m", "qty": 2400}, {"item": "Drip line 16 mm", "unit": "m", "qty": 38000}, {"item": "Sprinklers", "unit": "pcs", "qty": 120}, {"item": "Filtration station", "unit": "set", "qty": 1}, {"item": "Pump 15 kW", "unit": "pcs", "qty": 1}, {"item": "Generator 30 kVA", "unit": "pcs", "qty": 1}, {"item": "Electrical panel", "unit": "pcs", "qty": 1}, {"item": "Cable 4×16 mm²", "unit": "m", "qty": 160}]'),
  ('HM23', 'Huambo', -12.68807, 15.45911, 'C', '{"room": 100, "main_lines": 100, "drip": 100, "sprinklers": 100, "electrical": 100, "generator": 100, "testing": 100}', '[{"item": "Pump room (civil works)", "unit": "m²", "qty": 24}, {"item": "Main line HDPE Ø110", "unit": "m", "qty": 1850}, {"item": "Sub-main HDPE Ø63", "unit": "m", "qty": 2400}, {"item": "Drip line 16 mm", "unit": "m", "qty": 38000}, {"item": "Sprinklers", "unit": "pcs", "qty": 120}, {"item": "Filtration station", "unit": "set", "qty": 1}, {"item": "Pump 15 kW", "unit": "pcs", "qty": 1}, {"item": "Generator 30 kVA", "unit": "pcs", "qty": 1}, {"item": "Electrical panel", "unit": "pcs", "qty": 1}, {"item": "Cable 4×16 mm²", "unit": "m", "qty": 160}]'),
  ('HM24', 'Huambo', -12.74112, 15.49378, 'D', '{"room": 100, "main_lines": 100, "drip": 100, "sprinklers": 100, "electrical": 100, "generator": 100, "testing": 100}', '[{"item": "Pump room (civil works)", "unit": "m²", "qty": 24}, {"item": "Main line HDPE Ø110", "unit": "m", "qty": 1850}, {"item": "Sub-main HDPE Ø63", "unit": "m", "qty": 2400}, {"item": "Drip line 16 mm", "unit": "m", "qty": 38000}, {"item": "Sprinklers", "unit": "pcs", "qty": 120}, {"item": "Filtration station", "unit": "set", "qty": 1}, {"item": "Pump 15 kW", "unit": "pcs", "qty": 1}, {"item": "Generator 30 kVA", "unit": "pcs", "qty": 1}, {"item": "Electrical panel", "unit": "pcs", "qty": 1}, {"item": "Cable 4×16 mm²", "unit": "m", "qty": 160}]'),
  ('BI01', 'Bié', -12.57801, 16.86681, 'E', '{"room": 80, "main_lines": 60, "drip": 40, "sprinklers": 15, "electrical": 10, "generator": 0, "testing": 0}', '[{"item": "Pump room (civil works)", "unit": "m²", "qty": 24}, {"item": "Main line HDPE Ø110", "unit": "m", "qty": 1850}, {"item": "Sub-main HDPE Ø63", "unit": "m", "qty": 2400}, {"item": "Drip line 16 mm", "unit": "m", "qty": 38000}, {"item": "Sprinklers", "unit": "pcs", "qty": 120}, {"item": "Filtration station", "unit": "set", "qty": 1}, {"item": "Pump 15 kW", "unit": "pcs", "qty": 1}, {"item": "Generator 30 kVA", "unit": "pcs", "qty": 1}, {"item": "Electrical panel", "unit": "pcs", "qty": 1}, {"item": "Cable 4×16 mm²", "unit": "m", "qty": 160}]'),
  ('BI02', 'Bié', -12.49383, 16.96668, 'A', '{"room": 0, "main_lines": 0, "drip": 0, "sprinklers": 0, "electrical": 0, "generator": 0, "testing": 0}', '[{"item": "Pump room (civil works)", "unit": "m²", "qty": 24}, {"item": "Main line HDPE Ø110", "unit": "m", "qty": 1850}, {"item": "Sub-main HDPE Ø63", "unit": "m", "qty": 2400}, {"item": "Drip line 16 mm", "unit": "m", "qty": 38000}, {"item": "Sprinklers", "unit": "pcs", "qty": 120}, {"item": "Filtration station", "unit": "set", "qty": 1}, {"item": "Pump 15 kW", "unit": "pcs", "qty": 1}, {"item": "Generator 30 kVA", "unit": "pcs", "qty": 1}, {"item": "Electrical panel", "unit": "pcs", "qty": 1}, {"item": "Cable 4×16 mm²", "unit": "m", "qty": 160}]'),
  ('BI03', 'Bié', -12.09311, 17.10059, 'B', '{"room": 100, "main_lines": 100, "drip": 100, "sprinklers": 100, "electrical": 100, "generator": 100, "testing": 100}', '[{"item": "Pump room (civil works)", "unit": "m²", "qty": 24}, {"item": "Main line HDPE Ø110", "unit": "m", "qty": 1850}, {"item": "Sub-main HDPE Ø63", "unit": "m", "qty": 2400}, {"item": "Drip line 16 mm", "unit": "m", "qty": 38000}, {"item": "Sprinklers", "unit": "pcs", "qty": 120}, {"item": "Filtration station", "unit": "set", "qty": 1}, {"item": "Pump 15 kW", "unit": "pcs", "qty": 1}, {"item": "Generator 30 kVA", "unit": "pcs", "qty": 1}, {"item": "Electrical panel", "unit": "pcs", "qty": 1}, {"item": "Cable 4×16 mm²", "unit": "m", "qty": 160}]'),
  ('BI04', 'Bié', -12.35573, 17.13668, 'C', '{"room": 0, "main_lines": 0, "drip": 0, "sprinklers": 0, "electrical": 0, "generator": 0, "testing": 0}', '[{"item": "Pump room (civil works)", "unit": "m²", "qty": 24}, {"item": "Main line HDPE Ø110", "unit": "m", "qty": 1850}, {"item": "Sub-main HDPE Ø63", "unit": "m", "qty": 2400}, {"item": "Drip line 16 mm", "unit": "m", "qty": 38000}, {"item": "Sprinklers", "unit": "pcs", "qty": 120}, {"item": "Filtration station", "unit": "set", "qty": 1}, {"item": "Pump 15 kW", "unit": "pcs", "qty": 1}, {"item": "Generator 30 kVA", "unit": "pcs", "qty": 1}, {"item": "Electrical panel", "unit": "pcs", "qty": 1}, {"item": "Cable 4×16 mm²", "unit": "m", "qty": 160}]'),
  ('BI05', 'Bié', -12.58177, 17.06254, 'D', '{"room": 100, "main_lines": 100, "drip": 100, "sprinklers": 100, "electrical": 100, "generator": 100, "testing": 100}', '[{"item": "Pump room (civil works)", "unit": "m²", "qty": 24}, {"item": "Main line HDPE Ø110", "unit": "m", "qty": 1850}, {"item": "Sub-main HDPE Ø63", "unit": "m", "qty": 2400}, {"item": "Drip line 16 mm", "unit": "m", "qty": 38000}, {"item": "Sprinklers", "unit": "pcs", "qty": 120}, {"item": "Filtration station", "unit": "set", "qty": 1}, {"item": "Pump 15 kW", "unit": "pcs", "qty": 1}, {"item": "Generator 30 kVA", "unit": "pcs", "qty": 1}, {"item": "Electrical panel", "unit": "pcs", "qty": 1}, {"item": "Cable 4×16 mm²", "unit": "m", "qty": 160}]'),
  ('BI06', 'Bié', -12.10003, 17.19818, 'E', '{"room": 0, "main_lines": 0, "drip": 0, "sprinklers": 0, "electrical": 0, "generator": 0, "testing": 0}', '[{"item": "Pump room (civil works)", "unit": "m²", "qty": 24}, {"item": "Main line HDPE Ø110", "unit": "m", "qty": 1850}, {"item": "Sub-main HDPE Ø63", "unit": "m", "qty": 2400}, {"item": "Drip line 16 mm", "unit": "m", "qty": 38000}, {"item": "Sprinklers", "unit": "pcs", "qty": 120}, {"item": "Filtration station", "unit": "set", "qty": 1}, {"item": "Pump 15 kW", "unit": "pcs", "qty": 1}, {"item": "Generator 30 kVA", "unit": "pcs", "qty": 1}, {"item": "Electrical panel", "unit": "pcs", "qty": 1}, {"item": "Cable 4×16 mm²", "unit": "m", "qty": 160}]'),
  ('BI07', 'Bié', -12.37675, 16.98866, 'B', '{"room": 100, "main_lines": 100, "drip": 95, "sprinklers": 80, "electrical": 75, "generator": 55, "testing": 35}', '[{"item": "Pump room (civil works)", "unit": "m²", "qty": 24}, {"item": "Main line HDPE Ø110", "unit": "m", "qty": 1850}, {"item": "Sub-main HDPE Ø63", "unit": "m", "qty": 2400}, {"item": "Drip line 16 mm", "unit": "m", "qty": 38000}, {"item": "Sprinklers", "unit": "pcs", "qty": 120}, {"item": "Filtration station", "unit": "set", "qty": 1}, {"item": "Pump 15 kW", "unit": "pcs", "qty": 1}, {"item": "Generator 30 kVA", "unit": "pcs", "qty": 1}, {"item": "Electrical panel", "unit": "pcs", "qty": 1}, {"item": "Cable 4×16 mm²", "unit": "m", "qty": 160}]'),
  ('BI08', 'Bié', -12.45277, 16.89672, 'B', '{"room": 0, "main_lines": 0, "drip": 0, "sprinklers": 0, "electrical": 0, "generator": 0, "testing": 0}', '[{"item": "Pump room (civil works)", "unit": "m²", "qty": 24}, {"item": "Main line HDPE Ø110", "unit": "m", "qty": 1850}, {"item": "Sub-main HDPE Ø63", "unit": "m", "qty": 2400}, {"item": "Drip line 16 mm", "unit": "m", "qty": 38000}, {"item": "Sprinklers", "unit": "pcs", "qty": 120}, {"item": "Filtration station", "unit": "set", "qty": 1}, {"item": "Pump 15 kW", "unit": "pcs", "qty": 1}, {"item": "Generator 30 kVA", "unit": "pcs", "qty": 1}, {"item": "Electrical panel", "unit": "pcs", "qty": 1}, {"item": "Cable 4×16 mm²", "unit": "m", "qty": 160}]'),
  ('BI09', 'Bié', -12.08942, 16.71281, 'C', '{"room": 100, "main_lines": 100, "drip": 100, "sprinklers": 100, "electrical": 100, "generator": 100, "testing": 100}', '[{"item": "Pump room (civil works)", "unit": "m²", "qty": 24}, {"item": "Main line HDPE Ø110", "unit": "m", "qty": 1850}, {"item": "Sub-main HDPE Ø63", "unit": "m", "qty": 2400}, {"item": "Drip line 16 mm", "unit": "m", "qty": 38000}, {"item": "Sprinklers", "unit": "pcs", "qty": 120}, {"item": "Filtration station", "unit": "set", "qty": 1}, {"item": "Pump 15 kW", "unit": "pcs", "qty": 1}, {"item": "Generator 30 kVA", "unit": "pcs", "qty": 1}, {"item": "Electrical panel", "unit": "pcs", "qty": 1}, {"item": "Cable 4×16 mm²", "unit": "m", "qty": 160}]'),
  ('BI10', 'Bié', -12.16939, 16.76786, 'D', '{"room": 100, "main_lines": 100, "drip": 100, "sprinklers": 100, "electrical": 100, "generator": 100, "testing": 100}', '[{"item": "Pump room (civil works)", "unit": "m²", "qty": 24}, {"item": "Main line HDPE Ø110", "unit": "m", "qty": 1850}, {"item": "Sub-main HDPE Ø63", "unit": "m", "qty": 2400}, {"item": "Drip line 16 mm", "unit": "m", "qty": 38000}, {"item": "Sprinklers", "unit": "pcs", "qty": 120}, {"item": "Filtration station", "unit": "set", "qty": 1}, {"item": "Pump 15 kW", "unit": "pcs", "qty": 1}, {"item": "Generator 30 kVA", "unit": "pcs", "qty": 1}, {"item": "Electrical panel", "unit": "pcs", "qty": 1}, {"item": "Cable 4×16 mm²", "unit": "m", "qty": 160}]'),
  ('BI11', 'Bié', -12.34958, 16.96212, 'E', '{"room": 100, "main_lines": 100, "drip": 95, "sprinklers": 80, "electrical": 70, "generator": 45, "testing": 30}', '[{"item": "Pump room (civil works)", "unit": "m²", "qty": 24}, {"item": "Main line HDPE Ø110", "unit": "m", "qty": 1850}, {"item": "Sub-main HDPE Ø63", "unit": "m", "qty": 2400}, {"item": "Drip line 16 mm", "unit": "m", "qty": 38000}, {"item": "Sprinklers", "unit": "pcs", "qty": 120}, {"item": "Filtration station", "unit": "set", "qty": 1}, {"item": "Pump 15 kW", "unit": "pcs", "qty": 1}, {"item": "Generator 30 kVA", "unit": "pcs", "qty": 1}, {"item": "Electrical panel", "unit": "pcs", "qty": 1}, {"item": "Cable 4×16 mm²", "unit": "m", "qty": 160}]'),
  ('BI12', 'Bié', -12.65537, 16.9218, 'C', '{"room": 85, "main_lines": 65, "drip": 40, "sprinklers": 25, "electrical": 0, "generator": 0, "testing": 0}', '[{"item": "Pump room (civil works)", "unit": "m²", "qty": 24}, {"item": "Main line HDPE Ø110", "unit": "m", "qty": 1850}, {"item": "Sub-main HDPE Ø63", "unit": "m", "qty": 2400}, {"item": "Drip line 16 mm", "unit": "m", "qty": 38000}, {"item": "Sprinklers", "unit": "pcs", "qty": 120}, {"item": "Filtration station", "unit": "set", "qty": 1}, {"item": "Pump 15 kW", "unit": "pcs", "qty": 1}, {"item": "Generator 30 kVA", "unit": "pcs", "qty": 1}, {"item": "Electrical panel", "unit": "pcs", "qty": 1}, {"item": "Cable 4×16 mm²", "unit": "m", "qty": 160}]'),
  ('BI13', 'Bié', -12.67338, 17.19827, 'B', '{"room": 75, "main_lines": 50, "drip": 25, "sprinklers": 10, "electrical": 0, "generator": 0, "testing": 0}', '[{"item": "Pump room (civil works)", "unit": "m²", "qty": 24}, {"item": "Main line HDPE Ø110", "unit": "m", "qty": 1850}, {"item": "Sub-main HDPE Ø63", "unit": "m", "qty": 2400}, {"item": "Drip line 16 mm", "unit": "m", "qty": 38000}, {"item": "Sprinklers", "unit": "pcs", "qty": 120}, {"item": "Filtration station", "unit": "set", "qty": 1}, {"item": "Pump 15 kW", "unit": "pcs", "qty": 1}, {"item": "Generator 30 kVA", "unit": "pcs", "qty": 1}, {"item": "Electrical panel", "unit": "pcs", "qty": 1}, {"item": "Cable 4×16 mm²", "unit": "m", "qty": 160}]'),
  ('BI14', 'Bié', -12.11989, 16.98056, 'C', '{"room": 95, "main_lines": 70, "drip": 45, "sprinklers": 30, "electrical": 25, "generator": 10, "testing": 0}', '[{"item": "Pump room (civil works)", "unit": "m²", "qty": 24}, {"item": "Main line HDPE Ø110", "unit": "m", "qty": 1850}, {"item": "Sub-main HDPE Ø63", "unit": "m", "qty": 2400}, {"item": "Drip line 16 mm", "unit": "m", "qty": 38000}, {"item": "Sprinklers", "unit": "pcs", "qty": 120}, {"item": "Filtration station", "unit": "set", "qty": 1}, {"item": "Pump 15 kW", "unit": "pcs", "qty": 1}, {"item": "Generator 30 kVA", "unit": "pcs", "qty": 1}, {"item": "Electrical panel", "unit": "pcs", "qty": 1}, {"item": "Cable 4×16 mm²", "unit": "m", "qty": 160}]'),
  ('BI15', 'Bié', -12.22142, 17.07107, 'D', '{"room": 100, "main_lines": 100, "drip": 80, "sprinklers": 50, "electrical": 35, "generator": 30, "testing": 10}', '[{"item": "Pump room (civil works)", "unit": "m²", "qty": 24}, {"item": "Main line HDPE Ø110", "unit": "m", "qty": 1850}, {"item": "Sub-main HDPE Ø63", "unit": "m", "qty": 2400}, {"item": "Drip line 16 mm", "unit": "m", "qty": 38000}, {"item": "Sprinklers", "unit": "pcs", "qty": 120}, {"item": "Filtration station", "unit": "set", "qty": 1}, {"item": "Pump 15 kW", "unit": "pcs", "qty": 1}, {"item": "Generator 30 kVA", "unit": "pcs", "qty": 1}, {"item": "Electrical panel", "unit": "pcs", "qty": 1}, {"item": "Cable 4×16 mm²", "unit": "m", "qty": 160}]'),
  ('BI16', 'Bié', -12.55894, 16.67398, 'E', '{"room": 0, "main_lines": 0, "drip": 0, "sprinklers": 0, "electrical": 0, "generator": 0, "testing": 0}', '[{"item": "Pump room (civil works)", "unit": "m²", "qty": 24}, {"item": "Main line HDPE Ø110", "unit": "m", "qty": 1850}, {"item": "Sub-main HDPE Ø63", "unit": "m", "qty": 2400}, {"item": "Drip line 16 mm", "unit": "m", "qty": 38000}, {"item": "Sprinklers", "unit": "pcs", "qty": 120}, {"item": "Filtration station", "unit": "set", "qty": 1}, {"item": "Pump 15 kW", "unit": "pcs", "qty": 1}, {"item": "Generator 30 kVA", "unit": "pcs", "qty": 1}, {"item": "Electrical panel", "unit": "pcs", "qty": 1}, {"item": "Cable 4×16 mm²", "unit": "m", "qty": 160}]'),
  ('BI17', 'Bié', -12.45815, 16.88538, 'A', '{"room": 0, "main_lines": 0, "drip": 0, "sprinklers": 0, "electrical": 0, "generator": 0, "testing": 0}', '[{"item": "Pump room (civil works)", "unit": "m²", "qty": 24}, {"item": "Main line HDPE Ø110", "unit": "m", "qty": 1850}, {"item": "Sub-main HDPE Ø63", "unit": "m", "qty": 2400}, {"item": "Drip line 16 mm", "unit": "m", "qty": 38000}, {"item": "Sprinklers", "unit": "pcs", "qty": 120}, {"item": "Filtration station", "unit": "set", "qty": 1}, {"item": "Pump 15 kW", "unit": "pcs", "qty": 1}, {"item": "Generator 30 kVA", "unit": "pcs", "qty": 1}, {"item": "Electrical panel", "unit": "pcs", "qty": 1}, {"item": "Cable 4×16 mm²", "unit": "m", "qty": 160}]'),
  ('BI18', 'Bié', -12.38734, 17.03682, 'B', '{"room": 0, "main_lines": 0, "drip": 0, "sprinklers": 0, "electrical": 0, "generator": 0, "testing": 0}', '[{"item": "Pump room (civil works)", "unit": "m²", "qty": 24}, {"item": "Main line HDPE Ø110", "unit": "m", "qty": 1850}, {"item": "Sub-main HDPE Ø63", "unit": "m", "qty": 2400}, {"item": "Drip line 16 mm", "unit": "m", "qty": 38000}, {"item": "Sprinklers", "unit": "pcs", "qty": 120}, {"item": "Filtration station", "unit": "set", "qty": 1}, {"item": "Pump 15 kW", "unit": "pcs", "qty": 1}, {"item": "Generator 30 kVA", "unit": "pcs", "qty": 1}, {"item": "Electrical panel", "unit": "pcs", "qty": 1}, {"item": "Cable 4×16 mm²", "unit": "m", "qty": 160}]'),
  ('ML01', 'Malanje', -9.38823, 16.379, 'C', '{"room": 100, "main_lines": 100, "drip": 100, "sprinklers": 100, "electrical": 100, "generator": 100, "testing": 100}', '[{"item": "Pump room (civil works)", "unit": "m²", "qty": 24}, {"item": "Main line HDPE Ø110", "unit": "m", "qty": 1850}, {"item": "Sub-main HDPE Ø63", "unit": "m", "qty": 2400}, {"item": "Drip line 16 mm", "unit": "m", "qty": 38000}, {"item": "Sprinklers", "unit": "pcs", "qty": 120}, {"item": "Filtration station", "unit": "set", "qty": 1}, {"item": "Pump 15 kW", "unit": "pcs", "qty": 1}, {"item": "Generator 30 kVA", "unit": "pcs", "qty": 1}, {"item": "Electrical panel", "unit": "pcs", "qty": 1}, {"item": "Cable 4×16 mm²", "unit": "m", "qty": 160}]'),
  ('ML02', 'Malanje', -9.84373, 16.24217, 'D', '{"room": 100, "main_lines": 100, "drip": 100, "sprinklers": 100, "electrical": 100, "generator": 100, "testing": 100}', '[{"item": "Pump room (civil works)", "unit": "m²", "qty": 24}, {"item": "Main line HDPE Ø110", "unit": "m", "qty": 1850}, {"item": "Sub-main HDPE Ø63", "unit": "m", "qty": 2400}, {"item": "Drip line 16 mm", "unit": "m", "qty": 38000}, {"item": "Sprinklers", "unit": "pcs", "qty": 120}, {"item": "Filtration station", "unit": "set", "qty": 1}, {"item": "Pump 15 kW", "unit": "pcs", "qty": 1}, {"item": "Generator 30 kVA", "unit": "pcs", "qty": 1}, {"item": "Electrical panel", "unit": "pcs", "qty": 1}, {"item": "Cable 4×16 mm²", "unit": "m", "qty": 160}]'),
  ('ML03', 'Malanje', -9.46827, 16.57477, 'E', '{"room": 0, "main_lines": 0, "drip": 0, "sprinklers": 0, "electrical": 0, "generator": 0, "testing": 0}', '[{"item": "Pump room (civil works)", "unit": "m²", "qty": 24}, {"item": "Main line HDPE Ø110", "unit": "m", "qty": 1850}, {"item": "Sub-main HDPE Ø63", "unit": "m", "qty": 2400}, {"item": "Drip line 16 mm", "unit": "m", "qty": 38000}, {"item": "Sprinklers", "unit": "pcs", "qty": 120}, {"item": "Filtration station", "unit": "set", "qty": 1}, {"item": "Pump 15 kW", "unit": "pcs", "qty": 1}, {"item": "Generator 30 kVA", "unit": "pcs", "qty": 1}, {"item": "Electrical panel", "unit": "pcs", "qty": 1}, {"item": "Cable 4×16 mm²", "unit": "m", "qty": 160}]'),
  ('ML04', 'Malanje', -9.83584, 16.4751, 'D', '{"room": 40, "main_lines": 25, "drip": 25, "sprinklers": 5, "electrical": 0, "generator": 0, "testing": 0}', '[{"item": "Pump room (civil works)", "unit": "m²", "qty": 24}, {"item": "Main line HDPE Ø110", "unit": "m", "qty": 1850}, {"item": "Sub-main HDPE Ø63", "unit": "m", "qty": 2400}, {"item": "Drip line 16 mm", "unit": "m", "qty": 38000}, {"item": "Sprinklers", "unit": "pcs", "qty": 120}, {"item": "Filtration station", "unit": "set", "qty": 1}, {"item": "Pump 15 kW", "unit": "pcs", "qty": 1}, {"item": "Generator 30 kVA", "unit": "pcs", "qty": 1}, {"item": "Electrical panel", "unit": "pcs", "qty": 1}, {"item": "Cable 4×16 mm²", "unit": "m", "qty": 160}]'),
  ('ML05', 'Malanje', -9.55938, 16.24452, 'B', '{"room": 35, "main_lines": 20, "drip": 10, "sprinklers": 0, "electrical": 0, "generator": 0, "testing": 0}', '[{"item": "Pump room (civil works)", "unit": "m²", "qty": 24}, {"item": "Main line HDPE Ø110", "unit": "m", "qty": 1850}, {"item": "Sub-main HDPE Ø63", "unit": "m", "qty": 2400}, {"item": "Drip line 16 mm", "unit": "m", "qty": 38000}, {"item": "Sprinklers", "unit": "pcs", "qty": 120}, {"item": "Filtration station", "unit": "set", "qty": 1}, {"item": "Pump 15 kW", "unit": "pcs", "qty": 1}, {"item": "Generator 30 kVA", "unit": "pcs", "qty": 1}, {"item": "Electrical panel", "unit": "pcs", "qty": 1}, {"item": "Cable 4×16 mm²", "unit": "m", "qty": 160}]'),
  ('ML06', 'Malanje', -9.32385, 16.21469, 'C', '{"room": 100, "main_lines": 100, "drip": 100, "sprinklers": 100, "electrical": 100, "generator": 100, "testing": 100}', '[{"item": "Pump room (civil works)", "unit": "m²", "qty": 24}, {"item": "Main line HDPE Ø110", "unit": "m", "qty": 1850}, {"item": "Sub-main HDPE Ø63", "unit": "m", "qty": 2400}, {"item": "Drip line 16 mm", "unit": "m", "qty": 38000}, {"item": "Sprinklers", "unit": "pcs", "qty": 120}, {"item": "Filtration station", "unit": "set", "qty": 1}, {"item": "Pump 15 kW", "unit": "pcs", "qty": 1}, {"item": "Generator 30 kVA", "unit": "pcs", "qty": 1}, {"item": "Electrical panel", "unit": "pcs", "qty": 1}, {"item": "Cable 4×16 mm²", "unit": "m", "qty": 160}]'),
  ('ML07', 'Malanje', -9.70608, 16.37209, 'D', '{"room": 100, "main_lines": 100, "drip": 85, "sprinklers": 65, "electrical": 50, "generator": 30, "testing": 25}', '[{"item": "Pump room (civil works)", "unit": "m²", "qty": 24}, {"item": "Main line HDPE Ø110", "unit": "m", "qty": 1850}, {"item": "Sub-main HDPE Ø63", "unit": "m", "qty": 2400}, {"item": "Drip line 16 mm", "unit": "m", "qty": 38000}, {"item": "Sprinklers", "unit": "pcs", "qty": 120}, {"item": "Filtration station", "unit": "set", "qty": 1}, {"item": "Pump 15 kW", "unit": "pcs", "qty": 1}, {"item": "Generator 30 kVA", "unit": "pcs", "qty": 1}, {"item": "Electrical panel", "unit": "pcs", "qty": 1}, {"item": "Cable 4×16 mm²", "unit": "m", "qty": 160}]'),
  ('ML08', 'Malanje', -9.45654, 16.14146, 'E', '{"room": 80, "main_lines": 70, "drip": 35, "sprinklers": 35, "electrical": 20, "generator": 0, "testing": 0}', '[{"item": "Pump room (civil works)", "unit": "m²", "qty": 24}, {"item": "Main line HDPE Ø110", "unit": "m", "qty": 1850}, {"item": "Sub-main HDPE Ø63", "unit": "m", "qty": 2400}, {"item": "Drip line 16 mm", "unit": "m", "qty": 38000}, {"item": "Sprinklers", "unit": "pcs", "qty": 120}, {"item": "Filtration station", "unit": "set", "qty": 1}, {"item": "Pump 15 kW", "unit": "pcs", "qty": 1}, {"item": "Generator 30 kVA", "unit": "pcs", "qty": 1}, {"item": "Electrical panel", "unit": "pcs", "qty": 1}, {"item": "Cable 4×16 mm²", "unit": "m", "qty": 160}]'),
  ('ML09', 'Malanje', -9.53332, 16.20185, 'A', '{"room": 100, "main_lines": 95, "drip": 70, "sprinklers": 65, "electrical": 45, "generator": 25, "testing": 10}', '[{"item": "Pump room (civil works)", "unit": "m²", "qty": 24}, {"item": "Main line HDPE Ø110", "unit": "m", "qty": 1850}, {"item": "Sub-main HDPE Ø63", "unit": "m", "qty": 2400}, {"item": "Drip line 16 mm", "unit": "m", "qty": 38000}, {"item": "Sprinklers", "unit": "pcs", "qty": 120}, {"item": "Filtration station", "unit": "set", "qty": 1}, {"item": "Pump 15 kW", "unit": "pcs", "qty": 1}, {"item": "Generator 30 kVA", "unit": "pcs", "qty": 1}, {"item": "Electrical panel", "unit": "pcs", "qty": 1}, {"item": "Cable 4×16 mm²", "unit": "m", "qty": 160}]'),
  ('ML10', 'Malanje', -9.38306, 16.07565, 'B', '{"room": 100, "main_lines": 100, "drip": 100, "sprinklers": 100, "electrical": 100, "generator": 100, "testing": 100}', '[{"item": "Pump room (civil works)", "unit": "m²", "qty": 24}, {"item": "Main line HDPE Ø110", "unit": "m", "qty": 1850}, {"item": "Sub-main HDPE Ø63", "unit": "m", "qty": 2400}, {"item": "Drip line 16 mm", "unit": "m", "qty": 38000}, {"item": "Sprinklers", "unit": "pcs", "qty": 120}, {"item": "Filtration station", "unit": "set", "qty": 1}, {"item": "Pump 15 kW", "unit": "pcs", "qty": 1}, {"item": "Generator 30 kVA", "unit": "pcs", "qty": 1}, {"item": "Electrical panel", "unit": "pcs", "qty": 1}, {"item": "Cable 4×16 mm²", "unit": "m", "qty": 160}]'),
  ('ML11', 'Malanje', -9.3372, 16.33315, 'C', '{"room": 0, "main_lines": 0, "drip": 0, "sprinklers": 0, "electrical": 0, "generator": 0, "testing": 0}', '[{"item": "Pump room (civil works)", "unit": "m²", "qty": 24}, {"item": "Main line HDPE Ø110", "unit": "m", "qty": 1850}, {"item": "Sub-main HDPE Ø63", "unit": "m", "qty": 2400}, {"item": "Drip line 16 mm", "unit": "m", "qty": 38000}, {"item": "Sprinklers", "unit": "pcs", "qty": 120}, {"item": "Filtration station", "unit": "set", "qty": 1}, {"item": "Pump 15 kW", "unit": "pcs", "qty": 1}, {"item": "Generator 30 kVA", "unit": "pcs", "qty": 1}, {"item": "Electrical panel", "unit": "pcs", "qty": 1}, {"item": "Cable 4×16 mm²", "unit": "m", "qty": 160}]'),
  ('ML12', 'Malanje', -9.72208, 16.23182, 'D', '{"room": 0, "main_lines": 0, "drip": 0, "sprinklers": 0, "electrical": 0, "generator": 0, "testing": 0}', '[{"item": "Pump room (civil works)", "unit": "m²", "qty": 24}, {"item": "Main line HDPE Ø110", "unit": "m", "qty": 1850}, {"item": "Sub-main HDPE Ø63", "unit": "m", "qty": 2400}, {"item": "Drip line 16 mm", "unit": "m", "qty": 38000}, {"item": "Sprinklers", "unit": "pcs", "qty": 120}, {"item": "Filtration station", "unit": "set", "qty": 1}, {"item": "Pump 15 kW", "unit": "pcs", "qty": 1}, {"item": "Generator 30 kVA", "unit": "pcs", "qty": 1}, {"item": "Electrical panel", "unit": "pcs", "qty": 1}, {"item": "Cable 4×16 mm²", "unit": "m", "qty": 160}]'),
  ('ML13', 'Malanje', -9.41072, 16.3553, 'E', '{"room": 0, "main_lines": 0, "drip": 0, "sprinklers": 0, "electrical": 0, "generator": 0, "testing": 0}', '[{"item": "Pump room (civil works)", "unit": "m²", "qty": 24}, {"item": "Main line HDPE Ø110", "unit": "m", "qty": 1850}, {"item": "Sub-main HDPE Ø63", "unit": "m", "qty": 2400}, {"item": "Drip line 16 mm", "unit": "m", "qty": 38000}, {"item": "Sprinklers", "unit": "pcs", "qty": 120}, {"item": "Filtration station", "unit": "set", "qty": 1}, {"item": "Pump 15 kW", "unit": "pcs", "qty": 1}, {"item": "Generator 30 kVA", "unit": "pcs", "qty": 1}, {"item": "Electrical panel", "unit": "pcs", "qty": 1}, {"item": "Cable 4×16 mm²", "unit": "m", "qty": 160}]'),
  ('ML14', 'Malanje', -9.77532, 16.12869, 'A', '{"room": 0, "main_lines": 0, "drip": 0, "sprinklers": 0, "electrical": 0, "generator": 0, "testing": 0}', '[{"item": "Pump room (civil works)", "unit": "m²", "qty": 24}, {"item": "Main line HDPE Ø110", "unit": "m", "qty": 1850}, {"item": "Sub-main HDPE Ø63", "unit": "m", "qty": 2400}, {"item": "Drip line 16 mm", "unit": "m", "qty": 38000}, {"item": "Sprinklers", "unit": "pcs", "qty": 120}, {"item": "Filtration station", "unit": "set", "qty": 1}, {"item": "Pump 15 kW", "unit": "pcs", "qty": 1}, {"item": "Generator 30 kVA", "unit": "pcs", "qty": 1}, {"item": "Electrical panel", "unit": "pcs", "qty": 1}, {"item": "Cable 4×16 mm²", "unit": "m", "qty": 160}]'),
  ('ML15', 'Malanje', -9.80221, 16.36115, 'B', '{"room": 0, "main_lines": 0, "drip": 0, "sprinklers": 0, "electrical": 0, "generator": 0, "testing": 0}', '[{"item": "Pump room (civil works)", "unit": "m²", "qty": 24}, {"item": "Main line HDPE Ø110", "unit": "m", "qty": 1850}, {"item": "Sub-main HDPE Ø63", "unit": "m", "qty": 2400}, {"item": "Drip line 16 mm", "unit": "m", "qty": 38000}, {"item": "Sprinklers", "unit": "pcs", "qty": 120}, {"item": "Filtration station", "unit": "set", "qty": 1}, {"item": "Pump 15 kW", "unit": "pcs", "qty": 1}, {"item": "Generator 30 kVA", "unit": "pcs", "qty": 1}, {"item": "Electrical panel", "unit": "pcs", "qty": 1}, {"item": "Cable 4×16 mm²", "unit": "m", "qty": 160}]'),
  ('ML16', 'Malanje', -9.43065, 16.10278, 'C', '{"room": 0, "main_lines": 0, "drip": 0, "sprinklers": 0, "electrical": 0, "generator": 0, "testing": 0}', '[{"item": "Pump room (civil works)", "unit": "m²", "qty": 24}, {"item": "Main line HDPE Ø110", "unit": "m", "qty": 1850}, {"item": "Sub-main HDPE Ø63", "unit": "m", "qty": 2400}, {"item": "Drip line 16 mm", "unit": "m", "qty": 38000}, {"item": "Sprinklers", "unit": "pcs", "qty": 120}, {"item": "Filtration station", "unit": "set", "qty": 1}, {"item": "Pump 15 kW", "unit": "pcs", "qty": 1}, {"item": "Generator 30 kVA", "unit": "pcs", "qty": 1}, {"item": "Electrical panel", "unit": "pcs", "qty": 1}, {"item": "Cable 4×16 mm²", "unit": "m", "qty": 160}]'),
  ('ML17', 'Malanje', -9.34171, 16.37463, 'D', '{"room": 100, "main_lines": 90, "drip": 90, "sprinklers": 55, "electrical": 55, "generator": 40, "testing": 10}', '[{"item": "Pump room (civil works)", "unit": "m²", "qty": 24}, {"item": "Main line HDPE Ø110", "unit": "m", "qty": 1850}, {"item": "Sub-main HDPE Ø63", "unit": "m", "qty": 2400}, {"item": "Drip line 16 mm", "unit": "m", "qty": 38000}, {"item": "Sprinklers", "unit": "pcs", "qty": 120}, {"item": "Filtration station", "unit": "set", "qty": 1}, {"item": "Pump 15 kW", "unit": "pcs", "qty": 1}, {"item": "Generator 30 kVA", "unit": "pcs", "qty": 1}, {"item": "Electrical panel", "unit": "pcs", "qty": 1}, {"item": "Cable 4×16 mm²", "unit": "m", "qty": 160}]'),
  ('ML18', 'Malanje', -9.34317, 16.18605, 'E', '{"room": 100, "main_lines": 100, "drip": 100, "sprinklers": 100, "electrical": 100, "generator": 100, "testing": 100}', '[{"item": "Pump room (civil works)", "unit": "m²", "qty": 24}, {"item": "Main line HDPE Ø110", "unit": "m", "qty": 1850}, {"item": "Sub-main HDPE Ø63", "unit": "m", "qty": 2400}, {"item": "Drip line 16 mm", "unit": "m", "qty": 38000}, {"item": "Sprinklers", "unit": "pcs", "qty": 120}, {"item": "Filtration station", "unit": "set", "qty": 1}, {"item": "Pump 15 kW", "unit": "pcs", "qty": 1}, {"item": "Generator 30 kVA", "unit": "pcs", "qty": 1}, {"item": "Electrical panel", "unit": "pcs", "qty": 1}, {"item": "Cable 4×16 mm²", "unit": "m", "qty": 160}]')
on conflict (id) do nothing;

update public.teams set today_farm_id = 'HM16' where id = 'A' and today_farm_id is null;
update public.teams set today_farm_id = 'BI07' where id = 'B' and today_farm_id is null;
update public.teams set today_farm_id = 'BI12' where id = 'C' and today_farm_id is null;
update public.teams set today_farm_id = 'ML04' where id = 'D' and today_farm_id is null;
update public.teams set today_farm_id = 'HM19' where id = 'E' and today_farm_id is null;
