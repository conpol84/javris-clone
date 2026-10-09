-- OpenJarvis parity for Firbo: company knowledge with hybrid search, skills, server-run workflows,
-- report feedback (learning/routing), two-way Telegram and a bucket for generated images.

-- 1. Company knowledge -------------------------------------------------------------------------
-- Embeddings come from the edge runtime's built-in gte-small model (384 dimensions, free, no key), kept in `vec`.
-- (The older 1536-dimension `embedding` column stays unused; dropping it hung on the live database.)
alter table public.knowledge_chunks add column if not exists title text not null default '';
alter table public.knowledge_chunks add column if not exists url text;
alter table public.knowledge_chunks add column if not exists vec vector(384);
alter table public.knowledge_chunks add column if not exists fts tsvector
  generated always as (to_tsvector('simple', coalesce(title, '') || ' ' || content)) stored;
create index if not exists knowledge_chunks_fts on public.knowledge_chunks using gin (fts);
create index if not exists knowledge_chunks_vec on public.knowledge_chunks using hnsw (vec vector_cosine_ops);

alter table public.knowledge_sources drop constraint if exists knowledge_sources_type_check;
alter table public.knowledge_sources add constraint knowledge_sources_type_check
  check (type in ('pdf', 'document', 'website', 'notion', 'github', 'manual', 'database', 'upload', 'text', 'url', 'integration'));
alter table public.knowledge_sources add column if not exists item_count int not null default 0;
alter table public.knowledge_sources add column if not exists last_synced_at timestamptz;
alter table public.knowledge_sources add column if not exists last_error text;
alter table public.knowledge_sources add column if not exists integration_id uuid references public.integrations(id) on delete set null;
alter table public.knowledge_sources add column if not exists created_by uuid references auth.users(id) on delete set null;

-- Hybrid search: vector similarity and keyword match, merged with reciprocal rank fusion.
-- Members may search their own company; the service role (agent runner) may search any company it was given.
create or replace function public.match_knowledge(p_org uuid, p_query text, p_embedding vector(384) default null, p_limit int default 6)
returns table (id uuid, source_id uuid, title text, url text, content text, score double precision)
language plpgsql stable security definer set search_path = public, extensions
as $$
declare q tsquery;
begin
  if coalesce(auth.role(), '') <> 'service_role' and not private.is_member(p_org) then
    raise exception 'forbidden';
  end if;
  select to_tsquery('simple', string_agg(quote_literal(w) || ':*', ' | '))
    into q
    from (select distinct w from regexp_split_to_table(lower(coalesce(p_query, '')), '[^[:alnum:]]+') w where length(w) > 2 limit 12) words;
  return query
  with v as (
    select c.id, row_number() over (order by c.vec <=> p_embedding) r
    from knowledge_chunks c
    where p_embedding is not null and c.organization_id = p_org and c.vec is not null
    order by c.vec <=> p_embedding limit 30
  ), t as (
    select c.id, row_number() over (order by ts_rank(c.fts, q) desc) r
    from knowledge_chunks c
    where q is not null and c.organization_id = p_org and c.fts @@ q
    order by ts_rank(c.fts, q) desc limit 30
  ), ids as (
    select v.id from v union select t.id from t
  )
  select c.id, c.source_id, c.title, c.url, c.content,
         (coalesce(1.0 / (60 + v.r), 0) + coalesce(1.0 / (60 + t.r), 0))::double precision as score
  from ids join knowledge_chunks c on c.id = ids.id
  left join v on v.id = ids.id left join t on t.id = ids.id
  order by score desc
  limit least(greatest(p_limit, 1), 20);
end $$;
revoke all on function public.match_knowledge(uuid, text, vector, int) from public;
grant execute on function public.match_knowledge(uuid, text, vector, int) to authenticated, service_role;

-- 2. Skills ------------------------------------------------------------------------------------
-- A skill is a named way of working (steps and rules) that an AI employee follows. agent_id null = the whole team.
create table if not exists public.skills (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  agent_id uuid references public.agents(id) on delete cascade,
  slug text not null,
  name text not null,
  description text not null default '',
  instructions text not null,
  source text not null default 'library',
  enabled boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint skills_instructions_len check (char_length(instructions) <= 4000),
  constraint skills_name_len check (char_length(name) between 1 and 80)
);
create index if not exists skills_org on public.skills (organization_id);
alter table public.skills enable row level security;
create policy "members read" on public.skills for select using (private.is_member(organization_id));
create policy "managers insert" on public.skills for insert with check (private.has_role(organization_id, array['owner','admin','manager']));
create policy "managers update" on public.skills for update using (private.has_role(organization_id, array['owner','admin','manager'])) with check (private.has_role(organization_id, array['owner','admin','manager']));
create policy "managers delete" on public.skills for delete using (private.has_role(organization_id, array['owner','admin','manager']));

-- 3. Workflows run on the server ---------------------------------------------------------------
alter table public.workflows add column if not exists created_by uuid references auth.users(id) on delete set null;
alter table public.workflows add column if not exists next_run_at timestamptz;
alter table public.workflows add column if not exists hook_hash text;

create table if not exists public.workflow_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  workflow_id uuid not null references public.workflows(id) on delete cascade,
  status text not null default 'running' check (status in ('running', 'completed', 'failed')),
  step int not null default 0,
  task_id uuid references public.tasks(id) on delete set null,
  input text,
  trigger text not null default 'manual',
  started_by uuid references auth.users(id) on delete set null,
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists workflow_runs_active on public.workflow_runs (status, updated_at);
create index if not exists workflow_runs_org on public.workflow_runs (organization_id, created_at desc);
alter table public.workflow_runs enable row level security;
create policy "members read" on public.workflow_runs for select using (private.is_member(organization_id));

-- Claims scheduled workflows that are due and moves their next run forward (same idea as shifts).
create or replace function public.claim_due_workflows(max_rows int default 10)
returns setof public.workflows
language plpgsql security definer set search_path = public
as $$
begin
  return query
  with due as (
    select w.id from workflows w
    where w.enabled and w.trigger_type = 'schedule' and w.next_run_at is not null and w.next_run_at <= now()
    order by w.next_run_at limit max_rows for update skip locked
  )
  update workflows w set next_run_at = case coalesce(w.trigger_config->>'cadence', 'daily')
      when 'hourly' then w.next_run_at + interval '1 hour' * greatest(1, ceil(extract(epoch from (now() - w.next_run_at)) / 3600))
      when 'weekly' then w.next_run_at + interval '7 days' * greatest(1, ceil(extract(epoch from (now() - w.next_run_at)) / 604800))
      else w.next_run_at + interval '1 day' * greatest(1, ceil(extract(epoch from (now() - w.next_run_at)) / 86400)) end,
    updated_at = now()
  from due where w.id = due.id
  returning w.*;
end $$;
revoke all on function public.claim_due_workflows(int) from public, anon, authenticated;
grant execute on function public.claim_due_workflows(int) to service_role;

-- 4. Feedback on reports (learning and model routing) ------------------------------------------
create table if not exists public.report_feedback (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  agent_id uuid references public.agents(id) on delete set null,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  rating smallint not null check (rating in (-1, 1)),
  note text check (char_length(note) <= 500),
  model text,
  created_at timestamptz not null default now(),
  unique (task_id, user_id)
);
create index if not exists report_feedback_agent on public.report_feedback (agent_id, created_at desc);
alter table public.report_feedback enable row level security;
create policy "members read" on public.report_feedback for select using (private.is_member(organization_id));
create policy "writers insert own" on public.report_feedback for insert
  with check (user_id = auth.uid() and private.has_role(organization_id, array['owner','admin','manager','member']));
create policy "writers update own" on public.report_feedback for update
  using (user_id = auth.uid()) with check (user_id = auth.uid() and private.has_role(organization_id, array['owner','admin','manager','member']));
create policy "writers delete own" on public.report_feedback for delete using (user_id = auth.uid());

-- 5. Generated images --------------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('media', 'media', true) on conflict (id) do nothing;

-- 6. Scheduler: workflows advance every minute; knowledge embeddings are filled in the background.
select cron.unschedule('firbo-workflows') where exists (select 1 from cron.job where jobname = 'firbo-workflows');
select cron.schedule('firbo-workflows', '* * * * *', $$
  select net.http_post(
    url := 'https://bfeinnsorgjycivozcau.supabase.co/functions/v1/workflow-runner',
    headers := jsonb_build_object('content-type', 'application/json', 'x-cron-secret', (select value from public.cron_secrets where name = 'shifts')),
    body := '{"action":"tick"}'::jsonb,
    timeout_milliseconds := 150000);
$$);
select cron.unschedule('firbo-knowledge-embed') where exists (select 1 from cron.job where jobname = 'firbo-knowledge-embed');
select cron.schedule('firbo-knowledge-embed', '*/2 * * * *', $$
  select net.http_post(
    url := 'https://bfeinnsorgjycivozcau.supabase.co/functions/v1/knowledge',
    headers := jsonb_build_object('content-type', 'application/json', 'x-cron-secret', (select value from public.cron_secrets where name = 'shifts')),
    body := '{"action":"embed_pending"}'::jsonb,
    timeout_milliseconds := 150000)
  where exists (select 1 from public.knowledge_chunks where vec is null);
$$);

-- 7. Read-only sign-in apps that feed company knowledge (Drive, Gmail, Calendar, Outlook).
do $$ declare c text; begin
  select conname into c from pg_constraint where conrelid='public.integrations'::regclass and contype='c' and pg_get_constraintdef(oid) like '%youtube%';
  if c is not null then execute format('alter table public.integrations drop constraint %I', c); end if;
end $$;
alter table public.integrations add constraint integrations_kind_check check (kind = any (array['slack','discord','telegram','webhook','teams','googlechat','mattermost','ntfy','pushover','whatsapp','twilio','resend','sendgrid','notion','airtable','linear','github','mastodon','hubspot','pipedrive','asana','trello','clickup','jira','zendesk','zoom','wordpress','bluesky','facebook','x','zapier','make','n8n','gmail','gcal','gdrive','sheets','outlook','linkedin','dropbox','threads','instagram','devto','matrix','zulip','rocketchat','todoist','monday','homeassistant','ifttt','brevo','mailchimp','stripe','shopify','woocommerce','lemonsqueezy','gumroad','calendly','calcom','intercom','mcp','youtube','tiktok','salesforce','quickbooks','homeassistant_devices','traccar','gdrive_read','gmail_read','gcal_read','outlook_read']));

-- 8. Plan limits for the new features.
update public.plans set limits = limits || '{"knowledge_sources":3,"workflows":1,"skills":3}'::jsonb where id = 'free';
update public.plans set limits = limits || '{"knowledge_sources":25,"workflows":10,"skills":30}'::jsonb where id = 'pro';
update public.plans set limits = limits || '{"knowledge_sources":200,"workflows":100,"skills":200}'::jsonb where id = 'business';
update public.plans set limits = limits || '{"knowledge_sources":2000,"workflows":1000,"skills":2000}'::jsonb where id = 'enterprise';

-- 9. A new approval also reaches the owner's phone when two-way Telegram / WhatsApp / SMS is on.
create or replace function private.notify_approval_channels() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from integrations i where i.organization_id = new.organization_id and i.kind in ('telegram', 'whatsapp', 'twilio') and i.config->>'inbound' = 'true') then
    perform net.http_post(
      url := 'https://bfeinnsorgjycivozcau.supabase.co/functions/v1/channel-inbound',
      headers := jsonb_build_object('content-type', 'application/json', 'x-cron-secret', (select value from cron_secrets where name = 'shifts')),
      body := jsonb_build_object('action', 'notify_approval', 'approval_id', new.id),
      timeout_milliseconds := 30000);
  end if;
  return new;
end $$;
drop trigger if exists approvals_notify_channels on public.approvals;
create trigger approvals_notify_channels after insert on public.approvals for each row when (new.status = 'pending') execute function private.notify_approval_channels();
