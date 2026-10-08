-- GAZI FIELD v0.6.1 (migration 007): workers can add videos to a daily report or an urgent problem.
-- Videos live in the same "photos" storage as pictures, marked kind = 'video', linked to their report or problem.
-- Supabase → SQL Editor → New query → paste → Run. Safe to run again.
alter table public.photos drop constraint if exists photos_kind_check;
alter table public.photos add constraint photos_kind_check check (kind in ('progress', 'issue', 'drawing', 'video'));
alter table public.photos add column if not exists report_id uuid;
alter table public.photos add column if not exists issue_id uuid;
create index if not exists photos_report_idx on public.photos (report_id);
create index if not exists photos_issue_idx on public.photos (issue_id);
