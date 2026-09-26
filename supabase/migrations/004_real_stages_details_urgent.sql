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
