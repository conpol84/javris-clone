-- Complete the minimal connector fixture just enough to load and execute the
-- actual decision/receipt RPCs. This is disposable CI schema, never live DDL.
alter table public.connector_devices add column revoked_at timestamptz;
alter table public.connector_jobs add column error text;
