-- A remote Stop request must never pretend that a running local effect has
-- already stopped. Queued work may still be cancelled immediately; running
-- work records an intent that only the paired Connector can observe and turn
-- into a durable final execution receipt.
begin;

alter table public.connector_jobs
  add column if not exists cancel_requested_at timestamptz;

alter table public.connector_jobs
  drop constraint if exists connector_jobs_cancel_request_state_check;
alter table public.connector_jobs
  add constraint connector_jobs_cancel_request_state_check check (
    cancel_requested_at is null
    or status in ('running','done','error','cancelled')
  );

create index if not exists connector_jobs_running_stop_idx
  on public.connector_jobs(device_id, id)
  where status = 'running' and cancel_requested_at is not null;

commit;
