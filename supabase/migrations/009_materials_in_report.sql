-- GAZI FIELD v0.6.9 (migration 009): team leaders report irrigation materials delivery in the daily report.
-- submit_report gets p_materials ('partial' | 'delivered'); the farm keeps it in details.materials, the report in reports.materials.
-- Supabase → SQL Editor → New query → paste → Run. Safe to run again. Run BEFORE publishing app v0.6.9.
alter table public.reports add column if not exists materials text;
drop function if exists public.submit_report(uuid, text, date, jsonb, jsonb, jsonb, timestamptz, jsonb, jsonb, text);
drop function if exists public.submit_report(uuid, text, date, jsonb, jsonb, jsonb, timestamptz, jsonb, jsonb);
create function public.submit_report(
  p_id uuid, p_farm text, p_date date, p_items jsonb,
  p_location jsonb, p_connectivity jsonb, p_submitted_at timestamptz,
  p_issue jsonb default null, p_issues jsonb default null, p_materials text default null
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
  v_mat text;
begin
  -- my_role() reports supervisors as 'manager', so this lets workers, managers and supervisors report.
  if v_role is null or v_role not in ('worker', 'manager') then raise exception 'Not allowed to submit daily reports'; end if;
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
  -- Irrigation materials: only forward (none -> partial -> delivered); remembered on the farm and on the report.
  if p_materials is not null and p_materials not in ('partial', 'delivered') then raise exception 'Invalid materials status %', p_materials; end if;
  v_mat := coalesce(v_farm.details->'materials'->>'status', 'none');
  if p_materials = 'delivered' and v_mat <> 'delivered' or p_materials = 'partial' and v_mat = 'none' then
    update public.farms set details = coalesce(details, '{}'::jsonb) || jsonb_build_object('materials',
      jsonb_build_object('status', p_materials, 'date', p_date, 'by', auth.uid(), 'at', now(), 'report_id', p_id)) where id = p_farm;
  else
    p_materials := null;   -- nothing new: keep the report clean
  end if;

  insert into public.reports (id, farm_id, team_id, user_id, date, submitted_at, items, location, connectivity, materials)
  values (p_id, p_farm, v_team, auth.uid(), p_date, v_at, v_items, p_location, p_connectivity, p_materials);

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
