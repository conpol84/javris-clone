-- Agent Studio lists only the powers an employee has a row for. Give every employee the "computer_use" power,
-- switched off: the owner turns it on per employee. Turned on from the Studio it starts on approval (every computer
-- step waits in the Inbox) until the owner allows more. New employees get the same switched-off row.
insert into public.agent_tools (organization_id, agent_id, tool_name, enabled, policy)
select a.organization_id, a.id, 'computer_use', false, 'approval' from public.agents a
on conflict (agent_id, tool_name) do nothing;

create or replace function private.add_computer_use_power() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.agent_tools (organization_id, agent_id, tool_name, enabled, policy)
    values (new.organization_id, new.id, 'computer_use', false, 'approval')
    on conflict (agent_id, tool_name) do nothing;
  return null;
end $$;
revoke all on function private.add_computer_use_power() from public, anon, authenticated;
create or replace trigger agents_add_computer_use_power after insert on public.agents
  for each row execute function private.add_computer_use_power();
