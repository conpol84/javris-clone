alter table public.connector_jobs
  add column if not exists task_id uuid references public.tasks(id) on delete set null,
  add column if not exists approval_id uuid references public.approvals(id) on delete set null,
  add column if not exists report_sha256 text,
  add column if not exists receipt jsonb;
create index if not exists connector_jobs_task_idx on public.connector_jobs(task_id);
create index if not exists connector_jobs_approval_idx on public.connector_jobs(approval_id);
create unique index if not exists connector_jobs_one_per_approval_idx on public.connector_jobs(approval_id) where approval_id is not null;
