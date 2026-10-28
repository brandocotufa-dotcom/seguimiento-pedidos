-- Ejecutar en el SQL Editor del proyecto Supabase.
-- El acceso de la app está limitado a usuarios autenticados (invitados por el administrador).
create extension if not exists pgcrypto;
create table if not exists public.requests (
 id text primary key, title text not null, type text not null default 'Pedido', status text not null default 'Pendiente', owner text not null default 'Equipo de Soporte', request_date date, due_date date, description text not null default '', next_step text, created_by uuid references auth.users(id) on delete set null default auth.uid(), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.request_updates (
 id text primary key default gen_random_uuid()::text, request_id text not null references public.requests(id) on delete cascade, text text not null, next_step text, by_name text, by_email text, created_by uuid references auth.users(id) on delete set null default auth.uid(), created_at timestamptz not null default now()
);
create table if not exists public.request_attachments (
 id text primary key default gen_random_uuid()::text, request_id text not null references public.requests(id) on delete cascade, name text not null, mime_type text not null, storage_path text not null unique, uploaded_by uuid references auth.users(id) on delete set null default auth.uid(), created_at timestamptz not null default now()
);
create or replace function public.touch_request_updated_at() returns trigger language plpgsql set search_path=public as $$ begin new.updated_at=now(); return new; end; $$;
drop trigger if exists requests_touch_updated_at on public.requests;
create trigger requests_touch_updated_at before update on public.requests for each row execute function public.touch_request_updated_at();
alter table public.requests enable row level security;
alter table public.request_updates enable row level security;
alter table public.request_attachments enable row level security;
revoke all on public.requests, public.request_updates, public.request_attachments from anon;
grant select, insert, update, delete on public.requests, public.request_updates, public.request_attachments to authenticated;
drop policy if exists "team can manage requests" on public.requests;
create policy "team can manage requests" on public.requests for all to authenticated using ((select auth.uid()) is not null) with check ((select auth.uid()) is not null);
drop policy if exists "team can manage request updates" on public.request_updates;
create policy "team can manage request updates" on public.request_updates for all to authenticated using ((select auth.uid()) is not null) with check ((select auth.uid()) is not null);
drop policy if exists "team can manage request attachments" on public.request_attachments;
create policy "team can manage request attachments" on public.request_attachments for all to authenticated using ((select auth.uid()) is not null) with check ((select auth.uid()) is not null);
insert into storage.buckets(id,name,public) values ('pedido-adjuntos','pedido-adjuntos',false) on conflict (id) do nothing;
drop policy if exists "team can read board files" on storage.objects;
create policy "team can read board files" on storage.objects for select to authenticated using (bucket_id='pedido-adjuntos');
drop policy if exists "team can upload board files" on storage.objects;
create policy "team can upload board files" on storage.objects for insert to authenticated with check (bucket_id='pedido-adjuntos');
drop policy if exists "team can update board files" on storage.objects;
create policy "team can update board files" on storage.objects for update to authenticated using (bucket_id='pedido-adjuntos') with check (bucket_id='pedido-adjuntos');
drop policy if exists "team can delete board files" on storage.objects;
create policy "team can delete board files" on storage.objects for delete to authenticated using (bucket_id='pedido-adjuntos');
do $$ begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='requests') then execute 'alter publication supabase_realtime add table public.requests'; end if;
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='request_updates') then execute 'alter publication supabase_realtime add table public.request_updates'; end if;
end $$;
insert into public.requests(id,title,type,status,owner,request_date,description,next_step) values
('ai-agent','Investigar cómo crear un agente de IA','Investigación','Pendiente','Equipo de Soporte',current_date,'Investigar opciones para crear un agente de IA y entender qué tareas podría ayudar a resolver para el equipo.','Definir casos de uso y comparar herramientas posibles.'),
('gauss-system','Investigar y probar el sistema de gestión Gauss','Investigación','Pendiente','Equipo de Soporte',current_date,'Conocer el sistema de gestión, identificar beneficios para soporte y detectar oportunidades de mejora o nuevas funcionalidades.','Armar un recorrido de prueba y registrar observaciones.') on conflict(id) do nothing;

-- Avisos al administrador cuando un invitado crea su contraseña por primera vez.
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
create policy "users can report their own password setup" on public.account_setup_events for insert to authenticated
 with check ((select auth.uid())=user_id and lower(email)=lower((select auth.jwt()->>'email')));
drop policy if exists "board owner can read password setup notices" on public.account_setup_events;
create policy "board owner can read password setup notices" on public.account_setup_events for select to authenticated
 using (lower((select auth.jwt()->>'email'))='brando.cotufa@gmail.com');
drop policy if exists "board owner can mark password setup notices read" on public.account_setup_events;
create policy "board owner can mark password setup notices read" on public.account_setup_events for update to authenticated
 using (lower((select auth.jwt()->>'email'))='brando.cotufa@gmail.com')
 with check (lower((select auth.jwt()->>'email'))='brando.cotufa@gmail.com');
do $$ begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='account_setup_events') then
  execute 'alter publication supabase_realtime add table public.account_setup_events';
 end if;
end $$;
