-- Connected apps per company (Slack, Discord, Telegram, generic webhook).
-- Secrets (webhook URLs, bot tokens) live in a separate table that no client can read:
-- only the `integrations` Edge Function (service role) touches it.

create table public.integrations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  kind text not null check (kind in ('slack', 'discord', 'telegram', 'webhook')),
  name text not null check (char_length(name) between 1 and 80),
  config jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in ('active', 'error')),
  last_error text,
  last_used_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index integrations_org_idx on public.integrations (organization_id);
create index integrations_created_by_idx on public.integrations (created_by);

create table public.integration_secrets (
  integration_id uuid primary key references public.integrations (id) on delete cascade,
  secret text not null
);

alter table public.integrations enable row level security;
alter table public.integration_secrets enable row level security;

-- Managers can see which apps are connected. Writes happen only through the Edge Function.
create policy "managers read" on public.integrations
  for select to authenticated
  using (private.has_role(organization_id, array['owner', 'admin', 'manager']));

-- No policies on integration_secrets: clients can never read or write it.
revoke all on public.integration_secrets from anon, authenticated;
revoke insert, update, delete on public.integrations from anon, authenticated;
revoke all on public.integrations from anon;
