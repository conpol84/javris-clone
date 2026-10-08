import { beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), invoke: vi.fn(), filters: [] as unknown[][], previous: { data: { revision: 3, organization_id: 'org-a' }, error: null } as { data: Record<string, unknown> | null; error: null | { message: string } } }));
vi.mock('./client', () => ({ requireClient: () => ({ rpc: fixture.rpc, from: fixture.from, functions: { invoke: fixture.invoke } }) }));
import { deleteWorkflow, saveWorkflow, startWorkflow, workflowHook } from './workspace';
import { WORKFLOW_MESSAGES, workflowFailure } from './workflowCopy';

const draft = { name: 'Review', description: '', trigger_type: 'manual' as const, trigger_config: {}, enabled: true,
  steps: [{ position: 0, agent_id: 'agent-a', action: 'Report' }] };
const saved = { id: 'flow-a', organization_id: 'org-a', revision: 4, ...draft, workflow_steps: draft.steps };

describe('atomic workflow actions', () => {
  beforeEach(() => {
    vi.clearAllMocks(); fixture.filters = []; fixture.previous = { data: { revision: 3, organization_id: 'org-a' }, error: null };
    fixture.rpc.mockResolvedValue({ data: saved, error: null });
    fixture.from.mockImplementation(() => {
      const q = { select: vi.fn(() => q), eq: vi.fn((...args: unknown[]) => { fixture.filters.push(args); return q; }), maybeSingle: vi.fn(async () => fixture.previous) };
      return q;
    });
  });
  it('saves the parent and steps using one authenticated RPC and verifies its receipt', async () => {
    expect(await saveWorkflow('org-a', 'user-a', { ...draft, id: 'flow-a', expectedRevision: 3 })).toBe('flow-a');
    expect(fixture.from).not.toHaveBeenCalled();
    expect(fixture.rpc).toHaveBeenCalledOnce();
    expect(fixture.rpc).toHaveBeenCalledWith('save_workflow', expect.objectContaining({ p_org: 'org-a', p_id: 'flow-a', p_expected_revision: 3 }));
    expect(fixture.rpc.mock.calls[0][1].p_workflow).not.toHaveProperty('created_by');
  });
  it('propagates transactional failure and never performs fallback delete/insert writes', async () => {
    fixture.rpc.mockResolvedValue({ data: null, error: { message: 'synthetic_insert_failure' } });
    await expect(saveWorkflow('org-a', 'user-a', { ...draft, id: 'flow-a', expectedRevision: 3 })).rejects.toThrow('synthetic_insert_failure');
    expect(fixture.from).not.toHaveBeenCalled(); expect(fixture.rpc).toHaveBeenCalledOnce();
  });
  it('rejects incomplete or mismatched save confirmations', async () => {
    for (const data of [null, { ...saved, organization_id: 'org-b' }, { ...saved, workflow_steps: [] }, { ...saved, workflow_steps: [{ ...draft.steps[0], action: 'different' }] }]) {
      fixture.rpc.mockResolvedValue({ data, error: null });
      await expect(saveWorkflow('org-a', 'user-a', draft)).rejects.toThrow('workflow_not_changed');
    }
  });
  it('preserves the old call signature by reading an org-scoped revision before editing', async () => {
    await saveWorkflow('org-a', 'user-a', { ...draft, id: 'flow-a' });
    expect(fixture.filters).toEqual([['organization_id', 'org-a'], ['id', 'flow-a']]);
    expect(fixture.rpc).toHaveBeenCalledWith('save_workflow', expect.objectContaining({ p_expected_revision: 3 }));
  });
  it('surfaces stale edits and active-run protection without retrying writes', async () => {
    for (const message of ['workflow_conflict', 'workflow_running']) {
      fixture.rpc.mockResolvedValue({ data: null, error: { message } });
      await expect(saveWorkflow('org-a', 'user-a', { ...draft, id: 'flow-a', expectedRevision: 3 })).rejects.toThrow(message);
    }
    expect(fixture.from).not.toHaveBeenCalled();
  });
  it('rejects invalid or incomplete steps before RPC submission', async () => {
    await expect(saveWorkflow('org-a', 'user-a', { ...draft, steps: [{ position: 0, agent_id: null, action: 'Report' }] })).rejects.toThrow('workflow_invalid');
    expect(fixture.rpc).not.toHaveBeenCalled();
  });
  it('deletes only a verified org-scoped affected row, preserving active-run errors', async () => {
    fixture.rpc.mockResolvedValue({ data: 'flow-a', error: null });
    await deleteWorkflow('flow-a', 'org-a', 3);
    expect(fixture.rpc).toHaveBeenCalledWith('delete_workflow', { p_org: 'org-a', p_id: 'flow-a', p_expected_revision: 3 });
    fixture.rpc.mockResolvedValue({ data: null, error: null });
    await expect(deleteWorkflow('flow-a', 'org-a', 3)).rejects.toThrow('workflow_not_changed');
    fixture.rpc.mockResolvedValue({ data: null, error: { message: 'workflow_running' } });
    await expect(deleteWorkflow('flow-a', 'org-a', 3)).rejects.toThrow('workflow_running');
  });
  it('does not claim a launch or hook succeeded without its response receipt', async () => {
    fixture.invoke.mockResolvedValue({ data: null, error: null });
    await expect(startWorkflow('flow-a')).rejects.toThrow('workflow_not_changed');
    await expect(workflowHook('flow-a', 3)).rejects.toThrow('workflow_not_changed');
    fixture.invoke.mockResolvedValue({ data: { url: 'https://db.example.test/hook' }, error: null });
    expect(await workflowHook('flow-a', 3)).toEqual({ url: 'https://db.example.test/hook' });
    expect(fixture.invoke).toHaveBeenLastCalledWith('workflow-runner', { body: { action: 'set_hook', workflow_id: 'flow-a', expected_revision: 3 } });
  });
  it('provides actionable lifecycle errors in every supported language', () => {
    for (const lang of Object.keys(WORKFLOW_MESSAGES) as (keyof typeof WORKFLOW_MESSAGES)[]) {
      expect(workflowFailure(lang, new Error('workflow_conflict'))).toBe(WORKFLOW_MESSAGES[lang].conflict);
      expect(workflowFailure(lang, new Error('workflow_running'))).toBe(WORKFLOW_MESSAGES[lang].running);
      expect(workflowFailure(lang, new Error('workflow_invalid_schedule'))).toBe(WORKFLOW_MESSAGES[lang].invalid);
    }
  });
});
