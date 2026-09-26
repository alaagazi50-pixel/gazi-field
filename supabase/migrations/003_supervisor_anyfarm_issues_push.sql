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
