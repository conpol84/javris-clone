-- Agents, tool permissions, model routing, conversations, memory, knowledge.
create table public.agents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  slug text not null check (slug ~ '^[a-z0-9][a-z0-9_-]{0,62}$'),
  description text,
  type text not null default 'custom'
    check (type in ('ceo','sales','marketing','research','finance','operations','developer','custom')),
  system_prompt text not null default '',
  model text not null default 'auto',          -- OmniRoute model / combo name
  temperature numeric(3,2) not null default 0.7 check (temperature between 0 and 2),
  enabled boolean not null default true,
  autonomous boolean not null default false,   -- external actions need approval unless true
  max_steps integer not null default 10 check (max_steps between 1 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, slug),
  unique (organization_id, id)
);

create table public.agent_tools (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  agent_id uuid not null,
  tool_name text not null,
  enabled boolean not null default true,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (agent_id, tool_name),
  foreign key (organization_id, agent_id) references public.agents (organization_id, id) on delete cascade
);
create index agent_tools_org_idx on public.agent_tools (organization_id);

create table public.model_routes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  agent_id uuid,
  purpose text not null,                        -- reasoning | research | coding | cheap | ...
  model text not null,
  priority integer not null default 100,
  enabled boolean not null default true,
  max_cost_usd numeric(10,4),
  created_at timestamptz not null default now(),
  foreign key (organization_id, agent_id) references public.agents (organization_id, id) on delete cascade
);
create index model_routes_org_idx on public.model_routes (organization_id, purpose, priority);
create index model_routes_agent_idx on public.model_routes (agent_id);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  agent_id uuid,
  title text,
  status text not null default 'active' check (status in ('active','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, agent_id) references public.agents (organization_id, id) on delete set null (agent_id)
);
create index conversations_org_user_idx on public.conversations (organization_id, user_id, updated_at desc);
create index conversations_user_idx on public.conversations (user_id);
create index conversations_agent_idx on public.conversations (agent_id);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  conversation_id uuid not null,
  role text not null check (role in ('system','user','assistant','tool')),
  content text not null default '',
  model text,
  input_tokens integer,
  output_tokens integer,
  latency_ms integer,
  tool_calls jsonb,
  created_at timestamptz not null default now(),
  foreign key (organization_id, conversation_id) references public.conversations (organization_id, id) on delete cascade
);
create index messages_conversation_idx on public.messages (conversation_id, created_at);
create index messages_org_idx on public.messages (organization_id);

create table public.memories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  agent_id uuid,
  content text not null,
  memory_type text not null default 'fact'
    check (memory_type in ('user_preference','fact','conversation','company','project','instruction','decision')),
  importance real not null default 0.5 check (importance between 0 and 1),
  metadata jsonb not null default '{}'::jsonb,
  embedding extensions.vector(1536),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, agent_id) references public.agents (organization_id, id) on delete set null (agent_id)
);
create index memories_org_idx on public.memories (organization_id, memory_type);
create index memories_user_idx on public.memories (user_id);
create index memories_agent_idx on public.memories (agent_id);
create index memories_embedding_idx on public.memories using hnsw (embedding extensions.vector_cosine_ops);

create table public.knowledge_sources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  type text not null check (type in ('pdf','document','website','notion','github','manual','database')),
  url text,
  file_path text,
  status text not null default 'pending' check (status in ('pending','indexing','ready','failed')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id)
);
create index knowledge_sources_org_idx on public.knowledge_sources (organization_id);

create table public.knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  source_id uuid not null,
  content text not null,
  embedding extensions.vector(1536),
  metadata jsonb not null default '{}'::jsonb,
  chunk_index integer not null default 0,
  created_at timestamptz not null default now(),
  foreign key (organization_id, source_id) references public.knowledge_sources (organization_id, id) on delete cascade
);
create index knowledge_chunks_source_idx on public.knowledge_chunks (source_id, chunk_index);
create index knowledge_chunks_org_idx on public.knowledge_chunks (organization_id);
create index knowledge_chunks_embedding_idx on public.knowledge_chunks using hnsw (embedding extensions.vector_cosine_ops);

-- updated_at triggers
create trigger agents_updated_at before update on public.agents for each row execute function private.set_updated_at();
create trigger conversations_updated_at before update on public.conversations for each row execute function private.set_updated_at();
create trigger memories_updated_at before update on public.memories for each row execute function private.set_updated_at();
create trigger knowledge_sources_updated_at before update on public.knowledge_sources for each row execute function private.set_updated_at();

-- Conversation access helper (owner of the conversation, or org owner/admin).
create or replace function private.can_access_conversation(conv uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.conversations c
    where c.id = conv
      and (c.user_id = (select auth.uid()) or private.has_role(c.organization_id, array['owner','admin']))
  )
$$;
revoke all on function private.can_access_conversation(uuid) from public, anon;
grant execute on function private.can_access_conversation(uuid) to authenticated;

-- RLS: tables managed by owner/admin/manager, readable by all members.
do $$
declare t text;
begin
  foreach t in array array['agents','agent_tools','model_routes','knowledge_sources'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "members read" on public.%I for select to authenticated using (private.is_member(organization_id))', t);
    execute format('create policy "managers insert" on public.%I for insert to authenticated with check (private.has_role(organization_id, array[''owner'',''admin'',''manager'']))', t);
    execute format('create policy "managers update" on public.%I for update to authenticated using (private.has_role(organization_id, array[''owner'',''admin'',''manager''])) with check (private.has_role(organization_id, array[''owner'',''admin'',''manager'']))', t);
    execute format('create policy "managers delete" on public.%I for delete to authenticated using (private.has_role(organization_id, array[''owner'',''admin'',''manager'']))', t);
  end loop;
  -- Org-shared content that any non-viewer member may write.
  foreach t in array array['memories','knowledge_chunks'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "members read" on public.%I for select to authenticated using (private.is_member(organization_id))', t);
    execute format('create policy "writers insert" on public.%I for insert to authenticated with check (private.has_role(organization_id, array[''owner'',''admin'',''manager'',''member'']))', t);
    execute format('create policy "writers update" on public.%I for update to authenticated using (private.has_role(organization_id, array[''owner'',''admin'',''manager'',''member''])) with check (private.has_role(organization_id, array[''owner'',''admin'',''manager'',''member'']))', t);
    execute format('create policy "managers delete" on public.%I for delete to authenticated using (private.has_role(organization_id, array[''owner'',''admin'',''manager'']))', t);
  end loop;
end $$;

alter table public.conversations enable row level security;
create policy "own or admin read" on public.conversations
  for select to authenticated
  using (user_id = (select auth.uid()) or private.has_role(organization_id, array['owner','admin']));
create policy "writers create own" on public.conversations
  for insert to authenticated
  with check (user_id = (select auth.uid()) and private.has_role(organization_id, array['owner','admin','manager','member']));
create policy "own or admin update" on public.conversations
  for update to authenticated
  using (user_id = (select auth.uid()) or private.has_role(organization_id, array['owner','admin']))
  with check (user_id = (select auth.uid()) or private.has_role(organization_id, array['owner','admin']));
create policy "own or admin delete" on public.conversations
  for delete to authenticated
  using (user_id = (select auth.uid()) or private.has_role(organization_id, array['owner','admin']));

-- Messages are append-only for clients (no update/delete policy).
alter table public.messages enable row level security;
create policy "read via conversation" on public.messages
  for select to authenticated using (private.can_access_conversation(conversation_id));
create policy "append via conversation" on public.messages
  for insert to authenticated
  with check (
    private.can_access_conversation(conversation_id)
    and private.has_role(organization_id, array['owner','admin','manager','member'])
  );

-- Semantic search (SECURITY INVOKER: RLS applies to the calling user).
create or replace function public.match_memories(p_org uuid, query_embedding extensions.vector(1536), match_count integer default 8)
returns table (id uuid, content text, memory_type text, importance real, similarity double precision)
language sql stable set search_path = public, extensions as $$
  select m.id, m.content, m.memory_type, m.importance, 1 - (m.embedding <=> query_embedding) as similarity
  from public.memories m
  where m.organization_id = p_org and m.embedding is not null
    and (m.expires_at is null or m.expires_at > now())
  order by m.embedding <=> query_embedding
  limit least(match_count, 50)
$$;

create or replace function public.match_knowledge(p_org uuid, query_embedding extensions.vector(1536), match_count integer default 8)
returns table (id uuid, source_id uuid, content text, similarity double precision)
language sql stable set search_path = public, extensions as $$
  select k.id, k.source_id, k.content, 1 - (k.embedding <=> query_embedding) as similarity
  from public.knowledge_chunks k
  where k.organization_id = p_org and k.embedding is not null
  order by k.embedding <=> query_embedding
  limit least(match_count, 50)
$$;
revoke all on function public.match_memories(uuid, extensions.vector, integer), public.match_knowledge(uuid, extensions.vector, integer) from public, anon;
grant execute on function public.match_memories(uuid, extensions.vector, integer), public.match_knowledge(uuid, extensions.vector, integer) to authenticated;
