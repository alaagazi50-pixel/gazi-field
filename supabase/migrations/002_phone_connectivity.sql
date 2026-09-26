-- GAZI FIELD v0.3: worker phones send their internet checks to the server, so management can see
-- when each phone last had internet, even on days without a report.
-- Supabase → SQL Editor → New query → paste → Run. Safe to run again.

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
