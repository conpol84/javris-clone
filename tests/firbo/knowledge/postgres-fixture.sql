-- Disposable stock PostgreSQL only. Knowledge columns/FK used by the real RPC;
-- vec is a text sentinel so these transaction tests do not require pgvector.
create role anon;
create role authenticated;
create role service_role bypassrls;
create table public.organization_members (organization_id uuid not null,user_id uuid not null,role text not null,primary key(organization_id,user_id));
create table public.knowledge_sources (
  id uuid primary key,
  organization_id uuid not null,
  status text not null check(status in ('pending','indexing','ready','failed')),
  item_count integer not null default 0,
  last_synced_at timestamptz,
  last_error text,
  updated_at timestamptz default now(),
  metadata jsonb not null default '{}'::jsonb,
  unique (organization_id,id)
);
create table public.knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  source_id uuid not null,
  title text not null default '',
  url text,
  content text not null,
  chunk_index integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  vec text,
  foreign key(organization_id,source_id) references public.knowledge_sources(organization_id,id) on delete cascade
);
alter table public.knowledge_sources enable row level security;
alter table public.knowledge_chunks enable row level security;
grant select,insert,update,delete on public.knowledge_sources,public.knowledge_chunks to service_role;
grant select,update on public.organization_members to service_role;
