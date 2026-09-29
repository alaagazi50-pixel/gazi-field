-- GAZI FIELD v0.5.3: managers can no longer see the people list or change accounts and teams.
-- Only supervisors manage people. Raid becomes a manager; Alaa becomes a supervisor (keeps control).
-- Supabase → SQL Editor → New query → paste → Run. Safe to run again.

-- The real role (my_role() treats supervisors as managers for everything else).
create or replace function public.my_real_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and active
$$;
revoke all on function public.my_real_role from public, anon;
grant execute on function public.my_real_role to authenticated;

-- Accounts: only supervisors may change them.
drop policy if exists profiles_mgr on public.profiles;
create policy profiles_mgr on public.profiles for update to authenticated
  using ((select public.my_real_role()) = 'supervisor') with check ((select public.my_real_role()) = 'supervisor');

-- Teams: everyone who works sees them (reading stays as before); only supervisors create or change them.
drop policy if exists teams_mgr on public.teams;
create policy teams_mgr on public.teams for all to authenticated
  using ((select public.my_real_role()) = 'supervisor') with check ((select public.my_real_role()) = 'supervisor');

-- People
update public.profiles set role = 'manager' where username = 'raid';
update public.profiles set role = 'supervisor' where username = 'alaa.gazi.50';
select username, role from public.profiles where username in ('raid', 'alaa.gazi.50', 'mohamad') order by 1;
