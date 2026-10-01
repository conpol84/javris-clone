import { beforeEach, describe, expect, it, vi } from 'vitest';
import { slugify } from './types';

const rpc = vi.fn();
const eq = vi.fn();

vi.mock('./client', () => ({
  requireClient: () => ({
    rpc,
    from: () => ({ select: () => ({ eq }) }),
  }),
}));

import { createOrganization, loadMemberships } from './data';

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
  beforeEach(() => vi.clearAllMocks());

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
});
