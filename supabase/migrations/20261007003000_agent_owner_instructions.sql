-- Per-agent owner instructions are separate from the built-in system prompt so
-- changing working style never erases the employee's core role.
alter table public.agents
  add column if not exists owner_instructions text not null default ''
  check (char_length(owner_instructions) <= 4000);
