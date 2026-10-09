-- An organization cannot lose its final owner through People or a direct API
-- mutation. RLS still determines who may edit memberships; this private trigger
-- adds the invariant even for privileged writes. No owner-recovery API is exposed.
create or replace function private.preserve_last_owner()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if new.organization_id is distinct from old.organization_id
       or new.user_id is distinct from old.user_id then
      raise exception 'membership_identity_immutable' using errcode = '23514';
    end if;
    if old.role <> 'owner' or new.role = 'owner' then
      return new;
    end if;
  elsif old.role <> 'owner' then
    return old;
  end if;

  -- Write-lock the parent to serialize competing removals. An actual row version
  -- change also forces stale REPEATABLE READ / SERIALIZABLE transactions to fail
  -- rather than allowing both owners to leave from the same old snapshot.
  update public.organizations set id = id where id = old.organization_id;
  if not found then
    -- Authorized organization deletion has already removed the parent when its
    -- FK cascade reaches this trigger; that complete deletion stays supported.
    if tg_op = 'DELETE' then return old; end if;
    raise exception 'organization_not_found' using errcode = '23503';
  end if;

  if not exists (
    select 1 from public.organization_members m
    where m.organization_id = old.organization_id
      and m.user_id <> old.user_id and m.role = 'owner'
  ) then
    raise exception 'last_owner' using errcode = '23514';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

revoke all on function private.preserve_last_owner() from public, anon, authenticated;
create trigger members_preserve_last_owner
  before update or delete on public.organization_members
  for each row execute function private.preserve_last_owner();
