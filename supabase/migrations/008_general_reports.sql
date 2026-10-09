-- GAZI FIELD v0.6.2 (migration 008): general reports, not about one farm (text + optional photo / videos).
-- Workers, managers and supervisors write them; managers and supervisors see all of them and mark them handled.
-- Supabase → SQL Editor → New query → paste → Run. Safe to run again. Run migration 007 first.
create table if not exists public.general_reports (
  id uuid primary key,                         -- generated on the phone, so a retried upload is not duplicated
  user_id uuid references auth.users (id) on delete set null default auth.uid(),
  team_id text,
  at timestamptz not null default now(),
  note text not null check (length(trim(note)) > 0),
  lang text not null default 'en',
  photo_id uuid references public.photos (id) on delete set null,
  status text not null default 'open' check (status in ('open', 'resolved')),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists general_reports_at_idx on public.general_reports (at);
alter table public.general_reports enable row level security;
drop policy if exists general_read on public.general_reports;
create policy general_read on public.general_reports for select to authenticated
  using ((select public.my_role()) = 'manager' or user_id = auth.uid());
drop policy if exists general_insert on public.general_reports;
create policy general_insert on public.general_reports for insert to authenticated
  with check ((select public.my_role()) in ('worker', 'manager') and user_id = auth.uid());
drop policy if exists general_mgr on public.general_reports;
create policy general_mgr on public.general_reports for update to authenticated
  using ((select public.my_role()) = 'manager') with check ((select public.my_role()) = 'manager');
grant select, insert, update on public.general_reports to authenticated;

-- Photos and videos of a general report have no farm.
alter table public.photos alter column farm_id drop not null;
alter table public.photos add column if not exists general_id uuid;
