import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MemoryRow } from '../lib/company/memory';

const fixture = vi.hoisted(() => ({ states: [] as unknown[], index: 0, refIndex: 0,
  refs: [] as { current: unknown }[], effects: [] as (() => void | (() => void))[],
  setters: [] as ReturnType<typeof vi.fn>[], orgId: 'org-a', userId: 'owner-a', role: 'owner' }));
const api = vi.hoisted(() => ({ listMemories: vi.fn(), addMemory: vi.fn(), deleteMemory: vi.fn(), listAgents: vi.fn() }));
const notices = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), message: vi.fn() }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: () => { const i = fixture.index++; const setter = vi.fn(); fixture.setters[i] = setter; return [fixture.states[i], setter]; },
  useRef: (initial: unknown) => fixture.refs[fixture.refIndex++] ?? { current: initial },
  useEffect: (effect: () => void | (() => void)) => { fixture.effects.push(effect); },
  useCallback: (callback: unknown) => callback, useMemo: (callback: () => unknown) => callback(),
}));
vi.mock('../lib/company/AuthProvider', () => ({ useCompanyAuth: () => ({ current: { role: fixture.role, organization: { id: fixture.orgId } }, user: { id: fixture.userId } }) }));
vi.mock('../lib/company/memory', async original => ({ ...await original<typeof import('../lib/company/memory')>(), ...api }));
vi.mock('../lib/company/data', () => ({ listAgents: api.listAgents }));
vi.mock('../components/scenes/MemoryScene', () => ({ MemoryScene: () => null }));
vi.mock('../components/ui/kit', () => ({ PageHeader: () => null }));
vi.mock('../lib/company/labels', () => ({ agentLabel: (a: { name: string }) => ({ name: a.name }) }));
vi.mock('../lib/company/status', () => ({ agentColor: () => '#fff' }));
vi.mock('../lib/company/limits', () => ({ notifyPlanLimit: () => false }));
vi.mock('../i18n/I18nProvider', () => ({ useI18n: () => ({ t: (key: string) => key, fmt: { date: () => '' } }) }));
vi.mock('sonner', () => ({ toast: notices }));
import { MemoryPage, MemoryWorkspace } from './MemoryPage';

type Element = ReactElement<{ children?: ReactNode; disabled?: boolean; role?: string; type?: string;
  onClick?: () => void; onSubmit?: (event: { preventDefault: () => void }) => Promise<void>;
  onChange?: (event: { target: { files: File[]; value: string } }) => void }>;
function elements(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement(node)) return [];
  const el = node as Element; return [el, ...elements(el.props.children)];
}
function text(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(text).join('');
  if (isValidElement(node)) return text((node as Element).props.children);
  return typeof node === 'string' ? node : '';
}
const memory: MemoryRow = { id: 'memory-a', content: 'Owner company note', agent_id: null, importance: 0.7, memory_type: 'fact', created_at: '' };
function page(options: { loaded?: boolean; error?: boolean; busy?: boolean; textAgent?: string; fileAgent?: string } = {}) {
  fixture.index = 0; fixture.refIndex = 0; fixture.effects = []; fixture.setters = [];
  fixture.refs = [{ current: true }, { current: 0 }, { current: false }];
  fixture.states = [[memory], memory.id, 'Keep this owner note', options.textAgent ?? '', 'fact', 0.7, options.busy ?? false,
    options.loaded ?? true, [{ id: 'employee-a', enabled: true, name: 'Research Agent' }], null, options.fileAgent ?? '', false, options.error ?? false];
  return MemoryWorkspace();
}
const submit = (tree: ReactNode) => elements(tree).find(e => e.type === 'form')!.props.onSubmit!({ preventDefault: vi.fn() });
const remove = (tree: ReactNode) => elements(tree).find(e => e.type === 'button' && text(e).includes('mem.delete'))!;
const upload = (tree: ReactNode, file: File) => elements(tree).find(e => e.type === 'input' && e.props.type === 'file')!.props.onChange!({ target: { files: [file], value: '' } });
const file = (read: () => Promise<string>) => ({ size: 100, name: 'notes.txt', text: read }) as File;
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

describe('actual Memory workspace asynchronous scope', () => {
  beforeEach(() => { vi.clearAllMocks(); fixture.orgId = 'org-a'; fixture.userId = 'owner-a'; fixture.role = 'owner';
    api.listMemories.mockResolvedValue([memory]); api.listAgents.mockResolvedValue([]); api.addMemory.mockResolvedValue(undefined); api.deleteMemory.mockResolvedValue(undefined); });
  it('remounts notes, selection and drafts for company, identity and role changes', () => {
    const first = MemoryPage(); expect(first.type).toBe(MemoryWorkspace);
    fixture.orgId = 'org-b'; expect(MemoryPage().key).not.toBe(first.key);
    fixture.orgId = 'org-a'; fixture.userId = 'owner-b'; expect(MemoryPage().key).not.toBe(first.key);
    fixture.userId = 'owner-a'; fixture.role = 'viewer'; expect(MemoryPage().key).not.toBe(first.key);
  });
  it('ignores both late memory and employee reads after unmount', async () => {
    let finish!: (value: MemoryRow[]) => void; api.listMemories.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    page(); const unmount = fixture.effects[0]()!; fixture.effects[1](); unmount(); finish([memory]); await flush();
    expect(fixture.setters[0]).not.toHaveBeenCalled(); expect(fixture.setters[8]).not.toHaveBeenCalled();
    expect(notices.error).not.toHaveBeenCalled();
  });
  it('ignores a failed obsolete read instead of showing an error in another company', async () => {
    let fail!: (error: Error) => void; api.listMemories.mockReturnValue(new Promise((_resolve, reject) => { fail = reject; }));
    page(); const unmount = fixture.effects[0]()!; fixture.effects[1](); unmount(); fail(new Error('old company')); await flush();
    expect(notices.error).not.toHaveBeenCalled(); expect(fixture.setters[12]).not.toHaveBeenCalled();
  });
  it('does not replace newer memory/employee data with an older refresh', async () => {
    const finishes: ((value: MemoryRow[]) => void)[] = [];
    api.listMemories.mockImplementation(() => new Promise(resolve => { finishes.push(resolve); }));
    const tree = page({ error: true }); fixture.effects[0](); fixture.effects[1]();
    elements(tree).find(e => e.type === 'button' && text(e) === 'common.retry')!.props.onClick!();
    finishes[1]([{ ...memory, content: 'new result' }]); await flush(); finishes[0]([memory]); await flush();
    expect(fixture.setters[0]).toHaveBeenCalledExactlyOnceWith([{ ...memory, content: 'new result' }]);
  });
  it('writes only the selected company, actor and employee on explicit submit', async () => {
    await submit(page({ textAgent: 'employee-a' }));
    expect(api.addMemory).toHaveBeenCalledExactlyOnceWith('org-a', 'owner-a', { content: 'Keep this owner note', type: 'fact', importance: 0.7, agentId: 'employee-a' });
    expect(notices.success).toHaveBeenCalledWith('mem.added');
  });
  it('rejects an employee selection absent from this workspace', async () => {
    await submit(page({ textAgent: 'foreign-employee' })); expect(api.addMemory).not.toHaveBeenCalled();
    upload(page({ fileAgent: 'foreign-employee' }), file(async () => 'foreign note')); await flush(); expect(api.addMemory).not.toHaveBeenCalled();
  });
  it('blocks immediate duplicate submissions before React rerenders', async () => {
    api.addMemory.mockReturnValue(new Promise(() => {})); const tree = page(); void submit(tree); void submit(tree);
    expect(api.addMemory).toHaveBeenCalledOnce();
  });
  it('ignores old write success, resets and reloads after a company switch', async () => {
    let finish!: () => void; api.addMemory.mockReturnValue(new Promise<void>(resolve => { finish = resolve; }));
    const tree = page(); const unmount = fixture.effects[0]()!; const pending = submit(tree); unmount(); finish(); await pending;
    expect(notices.success).not.toHaveBeenCalled(); expect(api.listMemories).not.toHaveBeenCalled(); expect(fixture.setters[2]).not.toHaveBeenCalled();
  });
  it('stops file ingestion if the workspace changes while reading the file', async () => {
    let finish!: (value: string) => void; const tree = page(); const unmount = fixture.effects[0]()!;
    upload(tree, file(() => new Promise(resolve => { finish = resolve; }))); unmount(); finish('A sufficiently long company note'); await flush();
    expect(api.addMemory).not.toHaveBeenCalled(); expect(api.listMemories).not.toHaveBeenCalled(); expect(notices.success).not.toHaveBeenCalled();
  });
  it('stops subsequent upload writes after a switch; the already sent write stays attributed to its original company', async () => {
    let finish!: () => void; api.addMemory.mockReturnValue(new Promise<void>(resolve => { finish = resolve; }));
    const tree = page(); const unmount = fixture.effects[0]()!; upload(tree, file(async () => 'a'.repeat(900) + '\n\n' + 'b'.repeat(900)));
    await flush(); expect(api.addMemory).toHaveBeenCalledOnce(); expect(api.addMemory.mock.calls[0][0]).toBe('org-a');
    unmount(); finish(); await flush(); expect(api.addMemory).toHaveBeenCalledOnce(); expect(notices.success).not.toHaveBeenCalled();
  });
  it('catches file read rejection without an unhandled promise or stuck upload', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    upload(page(), file(async () => { throw new Error('file unreadable'); }));
    await vi.waitFor(() => expect(notices.error).toHaveBeenCalledWith('mem.error'));
    expect(fixture.setters[11]).toHaveBeenLastCalledWith(false); expect(api.addMemory).not.toHaveBeenCalled(); errorLog.mockRestore();
  });
  it('serializes upload against another upload and submit before file.text resolves', async () => {
    const read = vi.fn(() => new Promise<string>(() => {})); const tree = page(); upload(tree, file(read)); upload(tree, file(read));
    await submit(tree); expect(read).toHaveBeenCalledOnce(); expect(api.addMemory).not.toHaveBeenCalled();
  });
  it('preserves scoped partial-upload reporting and reloads after a later row fails', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    api.addMemory.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('quota'));
    upload(page({ fileAgent: 'employee-a' }), file(async () => 'a'.repeat(900) + '\n\n' + 'b'.repeat(900)));
    await vi.waitFor(() => expect(notices.message).toHaveBeenCalledWith('mem.uploadPartial'));
    expect(api.addMemory).toHaveBeenCalledTimes(2);
    expect(api.addMemory.mock.calls.every(call => call[0] === 'org-a' && call[1] === 'owner-a' && call[2].agentId === 'employee-a')).toBe(true);
    expect(notices.success).not.toHaveBeenCalled(); expect(api.listMemories).toHaveBeenCalledWith('org-a'); errorLog.mockRestore();
  });
  it('suppresses a write rejection from the unmounted identity', async () => {
    let fail!: (error: Error) => void; api.addMemory.mockReturnValue(new Promise((_resolve, reject) => { fail = reject; }));
    const tree = page(); const unmount = fixture.effects[0]()!; const pending = submit(tree); unmount(); fail(new Error('revoked')); await pending;
    expect(notices.error).not.toHaveBeenCalled(); expect(api.listMemories).not.toHaveBeenCalled();
  });
  it('delete includes the selected company and suppresses obsolete completion', async () => {
    let finish!: () => void; api.deleteMemory.mockReturnValue(new Promise<void>(resolve => { finish = resolve; }));
    const tree = page(); const unmount = fixture.effects[0]()!; remove(tree).props.onClick!();
    expect(api.deleteMemory).toHaveBeenCalledExactlyOnceWith('org-a', 'memory-a'); unmount(); finish(); await flush();
    expect(api.listMemories).not.toHaveBeenCalled(); expect(fixture.setters[1]).not.toHaveBeenCalled();
  });
  it('guards stale hidden handlers after role change and prevents writes while loading or failed', async () => {
    const tree = page(); const unmount = fixture.effects[0]()!; unmount(); await submit(tree); remove(tree).props.onClick!(); upload(tree, file(async () => 'note'));
    await submit(page({ loaded: false })); await submit(page({ error: true }));
    expect(api.addMemory).not.toHaveBeenCalled(); expect(api.deleteMemory).not.toHaveBeenCalled();
  });
  it('retains member note writing but gives deletion only to manager roles', () => {
    fixture.role = 'member'; const member = page(); expect(elements(member).some(e => e.type === 'form')).toBe(true);
    expect(elements(member).some(e => e.type === 'button' && text(e).includes('mem.delete'))).toBe(false);
    fixture.role = 'viewer'; expect(elements(page()).some(e => e.type === 'form')).toBe(false);
  });
  it('distinguishes initial loading and failed reads from an empty successful library', () => {
    expect(text(page({ loaded: false }))).toContain('common.loading'); expect(text(page({ loaded: false }))).not.toContain('mem.empty');
    const tree = page({ error: true }); expect(elements(tree).some(e => e.props.role === 'alert')).toBe(true); expect(text(tree)).not.toContain('mem.empty');
  });
});
