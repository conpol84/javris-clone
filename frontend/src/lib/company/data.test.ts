import { beforeEach, describe, expect, it, vi } from 'vitest';
import { slugify } from './types';

const rpc = vi.fn();
const eq = vi.fn();
const from = vi.fn();

vi.mock('./client', () => ({
  requireClient: () => ({
    rpc,
    from,
  }),
}));

import { createOrganization, loadMemberships, removeMember, setMemberRole } from './data';

describe('slugify', () => {
  it('normalises names into valid slugs', () => {
    expect(slugify('  My Company, Inc.! ')).toBe('my-company-inc');
    expect(slugify('Ünïcode Café')).toBe('unicode-cafe');
  });

  it('falls back when nothing usable remains', () => {
    expect(slugify('!!!')).toBe('company');
    expect(slugify('Ω')).toBe('company');
  });

  it('caps the length so slug + suffix fits the database check (<= 50)', () => {
    expect(slugify('a'.repeat(200)).length).toBeLessThanOrEqual(40);
  });
});

describe('company data layer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    from.mockImplementation(() => ({ select: () => ({ eq }) }));
  });

  it('creates an organization through the RPC with a database-valid slug', async () => {
    rpc.mockResolvedValue({ data: 'org-1', error: null });
    await expect(createOrganization('My Company')).resolves.toBe('org-1');
    const [fn, args] = rpc.mock.calls[0];
    expect(fn).toBe('create_organization');
    expect(args.p_name).toBe('My Company');
    expect(args.p_slug).toMatch(/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/);
  });

  it('surfaces database errors', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'duplicate slug' } });
    await expect(createOrganization('X Co')).rejects.toThrow('duplicate slug');
  });

  it('flattens memberships whether the join returns an object or an array', async () => {
    eq.mockResolvedValue({
      data: [
        { role: 'owner', organizations: { id: '1', name: 'A', slug: 'a' } },
        { role: 'member', organizations: [{ id: '2', name: 'B', slug: 'b' }] },
        { role: 'viewer', organizations: null },
      ],
      error: null,
    });
    const result = await loadMemberships('u1');
    expect(result.map((m) => [m.role, m.organization.id])).toEqual([
      ['owner', '1'],
      ['member', '2'],
    ]);
  });

  function membershipQuery(data: unknown, error: { message: string } | null = null) {
    const query = {
      update: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data, error }),
    };
    from.mockReturnValue(query);
    return query;
  }

  it('requires a returned membership to confirm a role change in the requested company', async () => {
    const query = membershipQuery({ user_id: 'u2', role: 'admin' });
    await expect(setMemberRole('org-1', 'u2', 'admin')).resolves.toBeUndefined();
    expect(from).toHaveBeenCalledWith('organization_members');
    expect(query.update).toHaveBeenCalledWith({ role: 'admin' });
    expect(query.eq.mock.calls).toEqual([['organization_id', 'org-1'], ['user_id', 'u2']]);
    expect(query.select).toHaveBeenCalledWith('user_id, role');
  });

  it('rejects a role change filtered out by RLS instead of reporting success', async () => {
    membershipQuery(null);
    await expect(setMemberRole('org-1', 'u2', 'owner')).rejects.toThrow('membership_not_changed');
  });

  it('preserves the database final-owner error', async () => {
    membershipQuery(null, { message: 'last_owner' });
    await expect(setMemberRole('org-1', 'u2', 'manager')).rejects.toThrow('last_owner');
  });

  it('does not accept an unconfirmed or different role', async () => {
    membershipQuery({ user_id: 'u2', role: 'member' });
    await expect(setMemberRole('org-1', 'u2', 'admin')).rejects.toThrow('membership_not_changed');
  });

  it('confirms removal from the returned membership and scopes the delete', async () => {
    const query = membershipQuery({ user_id: 'u2' });
    await expect(removeMember('org-1', 'u2')).resolves.toBeUndefined();
    expect(query.delete).toHaveBeenCalledOnce();
    expect(query.eq.mock.calls).toEqual([['organization_id', 'org-1'], ['user_id', 'u2']]);
  });

  it('rejects a removal filtered out by RLS instead of reporting success', async () => {
    membershipQuery(null);
    await expect(removeMember('org-1', 'u2')).rejects.toThrow('membership_not_changed');
  });
});
