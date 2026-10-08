-- The new kind is still opt-in on the actual device, with explicit local sites
-- and a visible, locally approved plan. Old browser_open grants are unchanged.
alter table public.connector_jobs drop constraint if exists connector_jobs_kind_check;
alter table public.connector_jobs add constraint connector_jobs_kind_check
  check (kind in ('list','read','write','exec','browser_open','browser_task'));
