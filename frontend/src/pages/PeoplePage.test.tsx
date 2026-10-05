import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { en } from '../i18n/locales/en';
import type { MemberRow, Role } from '../lib/company/types';

// Exercise the page's actual controls and event handlers with already-loaded,
// synthetic memberships; no browser session, Supabase request or DOM is needed.
const fixture = vi.hoisted(() => ({ states: [] as unknown[], index: 0, role: 'owner', refresh: vi.fn() }));
const data = vi.hoisted(() => ({
  addMemberByEmail: vi.fn(), listMembers: vi.fn(), removeMember: vi.fn(), setMemberRole: vi.fn(),
}));
const notices = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));

vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useState: () => [fixture.states[fixture.index++], vi.fn()],
  useCallback: (callback: unknown) => callback,
  useEffect: vi.fn(),
}));
vi.mock('../lib/company/AuthProvider', () => ({ useCompanyAuth: () => ({
  current: { role: fixture.role, organization: { id: 'org-1', name: 'Acme' } },
  user: { id: 'self' }, refresh: fixture.refresh,
}) }));
vi.mock('../lib/company/data', () => data);
vi.mock('sonner', () => ({ toast: notices }));
vi.mock('../i18n/I18nProvider', () => ({ useI18n: () => ({
  t: (key: keyof typeof en, values: Record<string, string> = {}) =>
    Object.entries(values).reduce((text, [name, value]) => text.replace(`{${name}}`, value), en[key] as string),
}) }));

import { PeoplePage } from './PeoplePage';

type Control = ReactElement<{
  children?: ReactNode; disabled?: boolean; value?: string; 'aria-label'?: string;
  onChange?: (event: { target: { value: string } }) => void;
}>;

function elements(node: ReactNode): Control[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement(node)) return [];
  const element = node as Control;
  return [element, ...elements(element.props.children)];
}

const member = (user_id: string, role: Role): MemberRow => ({
  user_id, role, joined_at: '2026-10-01T00:00:00Z', full_name: user_id, email: `${user_id}@example.test`,
});

function page(role: Role, members: MemberRow[]) {
  fixture.role = role;
  fixture.states = [members, false, '', 'member', false];
  fixture.index = 0;
  return PeoplePage();
}

function roleControl(tree: ReactNode, userId: string): Control {
  const control = elements(tree).find((element) => element.type === 'select'
    && element.props['aria-label'] === `Role of ${userId}@example.test`);
  if (!control) throw new Error('Expected role control');
  return control;
}

describe('People permissions and ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    data.setMemberRole.mockResolvedValue(undefined);
    data.listMembers.mockResolvedValue([]);
    fixture.refresh.mockResolvedValue(undefined);
  });

  it('locks the sole owner and rejects a forged self-demotion event', () => {
    const tree = page('owner', [member('self', 'owner'), member('colleague', 'manager')]);
    const self = roleControl(tree, 'self');
    expect(self.props.disabled).toBe(true);
    expect(roleControl(tree, 'colleague').props.disabled).toBe(false);
    self.props.onChange?.({ target: { value: 'manager' } });
    expect(data.setMemberRole).not.toHaveBeenCalled();
    expect(notices.error).toHaveBeenCalledWith(en['ppl.lastOwner']);
    expect(JSON.stringify(tree)).toContain(en['ppl.lastOwner']);
  });

  it('allows a self-demotion when another owner exists and refreshes auth after the write', async () => {
    const order: string[] = [];
    data.setMemberRole.mockImplementation(async () => { order.push('write'); });
    fixture.refresh.mockImplementation(async () => { order.push('refresh'); });
    data.listMembers.mockImplementation(async () => { order.push('members'); return []; });
    const tree = page('owner', [member('self', 'owner'), member('colleague', 'owner')]);
    const self = roleControl(tree, 'self');
    expect(self.props.disabled).toBe(false);
    self.props.onChange?.({ target: { value: 'manager' } });
    await vi.waitFor(() => expect(order).toEqual(['write', 'refresh', 'members']));
    expect(data.setMemberRole).toHaveBeenCalledWith('org-1', 'self', 'manager');
  });

  it('refreshes auth only after a successful self change', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    data.setMemberRole.mockRejectedValueOnce(new Error('membership_not_changed'));
    const tree = page('owner', [member('self', 'owner'), member('colleague', 'owner')]);
    roleControl(tree, 'self').props.onChange?.({ target: { value: 'admin' } });
    await vi.waitFor(() => expect(notices.error).toHaveBeenCalledWith(en['ppl.err.member_changed']));
    expect(fixture.refresh).not.toHaveBeenCalled();
    expect(data.listMembers).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('explains manager restrictions and rejects a forged promotion', () => {
    const tree = page('manager', [member('self', 'manager'), member('colleague', 'owner')]);
    const self = roleControl(tree, 'self');
    expect(self.props.disabled).toBe(true);
    self.props.onChange?.({ target: { value: 'owner' } });
    expect(data.setMemberRole).not.toHaveBeenCalled();
    expect(JSON.stringify(tree)).toContain('Your current role is manager.');
    expect(JSON.stringify(tree)).toContain(en['ppl.permissions']);
  });

  it('keeps owner controls locked for admins and offers no owner promotion', () => {
    const tree = page('admin', [member('self', 'admin'), member('colleague', 'owner')]);
    expect(roleControl(tree, 'colleague').props.disabled).toBe(true);
    const selfOptions = elements(roleControl(tree, 'self')).filter((element) => element.type === 'option');
    expect(selfOptions.map((option) => option.props.value)).not.toContain('owner');
  });

  it('maps a server-side ownership race to the same final-owner guidance', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    data.setMemberRole.mockRejectedValueOnce(new Error('last_owner_required'));
    const tree = page('owner', [member('self', 'owner'), member('colleague', 'owner')]);
    roleControl(tree, 'colleague').props.onChange?.({ target: { value: 'manager' } });
    await vi.waitFor(() => expect(notices.error).toHaveBeenCalledWith(en['ppl.lastOwner']));
    expect(fixture.refresh).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});
