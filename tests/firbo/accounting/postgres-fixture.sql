-- Stock PostgreSQL compatibility additions for the accounting migration.
-- The common tasks loader supplies the real tenancy, agents, usage and budget
-- columns.  The live schema already has own_key from the BYOK migration.
alter table public.usage_events add column if not exists own_key boolean not null default false;

insert into auth.users(id) values
  ('aaaaaaaa-0815-4815-8815-aaaaaaaaaaaa');
insert into public.organizations(id,name,slug) values
  ('11111111-0815-4815-8815-111111111111','Accounting fixture','accounting-fixture');
insert into public.organization_members(organization_id,user_id,role) values
  ('11111111-0815-4815-8815-111111111111','aaaaaaaa-0815-4815-8815-aaaaaaaaaaaa','owner');
insert into public.agents(id,organization_id,name,slug,monthly_budget_usd) values
  ('33333333-0815-4815-8815-333333333333','11111111-0815-4815-8815-111111111111','Budgeted chat','budgeted-chat',1.00),
  ('44444444-0815-4815-8815-444444444444','11111111-0815-4815-8815-111111111111','Unbounded chat','unbounded-chat',null);

