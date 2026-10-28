-- Ejecutar una vez en Supabase SQL Editor para registrar la creación inicial de contraseñas.
create table if not exists public.account_setup_events (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

alter table public.account_setup_events enable row level security;
revoke all on public.account_setup_events from anon;
grant select, insert, update on public.account_setup_events to authenticated;

drop policy if exists "users can report their own password setup" on public.account_setup_events;
create policy "users can report their own password setup"
  on public.account_setup_events for insert to authenticated
  with check ((select auth.uid()) = user_id and lower(email) = lower((select auth.jwt()->>'email')));

drop policy if exists "board owner can read password setup notices" on public.account_setup_events;
create policy "board owner can read password setup notices"
  on public.account_setup_events for select to authenticated
  using (lower((select auth.jwt()->>'email')) = 'brando.cotufa@gmail.com');

drop policy if exists "board owner can mark password setup notices read" on public.account_setup_events;
create policy "board owner can mark password setup notices read"
  on public.account_setup_events for update to authenticated
  using (lower((select auth.jwt()->>'email')) = 'brando.cotufa@gmail.com')
  with check (lower((select auth.jwt()->>'email')) = 'brando.cotufa@gmail.com');

do $$ begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='account_setup_events') then
   execute 'alter publication supabase_realtime add table public.account_setup_events';
 end if;
end $$;
