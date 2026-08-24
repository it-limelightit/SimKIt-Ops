create table if not exists public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  actor_id uuid null,
  actor_name text not null default 'Unknown User',
  action text not null,
  entity_type text not null,
  entity_id text null,
  entity_name text null,
  site_id uuid null references public.sites(id) on delete set null,
  company_name text null,
  factory_name text null,
  from_value text null,
  to_value text null,
  details jsonb not null default '{}'::jsonb
);

alter table public.activity_logs enable row level security;

drop policy if exists "Authenticated users can read activity logs" on public.activity_logs;
create policy "Authenticated users can read activity logs"
  on public.activity_logs for select
  to authenticated
  using (true);

drop policy if exists "Authenticated users can insert activity logs" on public.activity_logs;
create policy "Authenticated users can insert activity logs"
  on public.activity_logs for insert
  to authenticated
  with check (auth.uid() = actor_id or actor_id is null);

create index if not exists activity_logs_created_at_idx on public.activity_logs(created_at desc);
create index if not exists activity_logs_site_id_idx on public.activity_logs(site_id);
create index if not exists activity_logs_actor_id_idx on public.activity_logs(actor_id);

alter publication supabase_realtime add table public.activity_logs;
