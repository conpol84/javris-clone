-- WEBSITE-LAPTOP-1: record the connector's actual local capabilities and allow
-- the dedicated browser_open job. This does not grant any capability by itself.
alter table public.connector_devices
  add column if not exists capabilities jsonb not null default '{}'::jsonb;

alter table public.connector_devices
  drop constraint if exists connector_devices_capabilities_check;
alter table public.connector_devices
  add constraint connector_devices_capabilities_check
  check (jsonb_typeof(capabilities) = 'object' and pg_column_size(capabilities) < 4096);

alter table public.connector_jobs
  drop constraint if exists connector_jobs_kind_check;
alter table public.connector_jobs
  add constraint connector_jobs_kind_check
  check (kind = any (array['list'::text,'read'::text,'write'::text,'exec'::text,'browser_open'::text]));
