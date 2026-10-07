import { beforeEach, describe, expect, it, vi } from 'vitest';
const from = vi.hoisted(() => vi.fn());
vi.mock('./client', () => ({ requireClient: () => ({ from }) }));
import { addSkill, customSkillSlug, deleteSkill, setSkillEnabled, updateSkill } from './workspace';

function query(data: unknown = null, error: { code?: string; message?: string } | null = null) {
  return {
    select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), is: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(), update: vi.fn().mockReturnThis(), delete: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }), single: vi.fn().mockResolvedValue({ data, error }),
  };
}
const content = { name: ' My Skill ', instructions: ' Read the evidence first. ' };
const saved = { id: 'skill-1', name: 'My Skill', instructions: 'Read the evidence first.', agent_id: null };

describe('skill writes and confirmed outcomes', () => {
  beforeEach(() => vi.clearAllMocks());
  it('saves a custom skill with valid non-null slug and description, and returns the real row', async () => {
    const lookup = query(); const write = query(saved);
    from.mockReturnValueOnce(lookup).mockReturnValueOnce(write);
    await expect(addSkill('org-1', 'self', content)).resolves.toEqual(saved);
    expect(write.insert).toHaveBeenCalledWith({ organization_id: 'org-1', created_by: 'self', name: 'My Skill', instructions: 'Read the evidence first.', description: '', slug: 'custom-my-skill', agent_id: null, source: 'custom', enabled: true });
    expect(lookup.eq.mock.calls).toEqual([['organization_id', 'org-1'], ['slug', 'custom-my-skill']]);
    expect(lookup.is).toHaveBeenCalledWith('agent_id', null);
  });
  it('checks library duplicates for the selected employee without preventing another scope', async () => {
    const lookup = query({ id: 'existing' }); from.mockReturnValue(lookup);
    await expect(addSkill('org-1', 'self', { ...content, slug: 'deep-research', source: 'library', agentId: 'employee-1' })).rejects.toThrow('skill_already_installed');
    expect(lookup.eq.mock.calls).toEqual([['organization_id', 'org-1'], ['slug', 'deep-research'], ['agent_id', 'employee-1']]);
    expect(lookup.insert).not.toHaveBeenCalled();
  });
  it('turns a concurrent unique conflict into duplicate feedback', async () => {
    from.mockReturnValueOnce(query()).mockReturnValueOnce(query(null, { code: '23505', message: 'duplicate key' }));
    await expect(addSkill('org-1', 'self', content)).rejects.toThrow('skill_already_installed');
  });
  it('rejects invalid content or missing identity before any request', async () => {
    await expect(addSkill('org-1', 'self', { name: ' ', instructions: 'long enough text' })).rejects.toThrow('skill_invalid');
    await expect(addSkill('org-1', 'self', { name: 'name', instructions: 'short' })).rejects.toThrow('skill_invalid');
    await expect(addSkill('', 'self', content)).rejects.toThrow('skill_not_changed');
    expect(from).not.toHaveBeenCalled();
  });
  it('preserves database authorization errors from insert', async () => {
    from.mockReturnValueOnce(query()).mockReturnValueOnce(query(null, { code: '42501', message: 'permission denied' }));
    await expect(addSkill('org-1', 'self', content)).rejects.toThrow('permission denied');
  });
  it('never reports an insert as saved without a returned id', async () => {
    from.mockReturnValueOnce(query()).mockReturnValueOnce(query(null));
    await expect(addSkill('org-1', 'self', content)).rejects.toThrow('skill_not_changed');
  });
  it('edits content in the requested company and verifies the returned values', async () => {
    const write = query(saved); from.mockReturnValue(write);
    await expect(updateSkill('org-1', 'skill-1', content)).resolves.toEqual(saved);
    expect(write.eq.mock.calls).toEqual([['organization_id', 'org-1'], ['id', 'skill-1']]);
    expect(write.update).toHaveBeenCalledWith({ name: 'My Skill', instructions: 'Read the evidence first.', description: '', agent_id: null });
  });
  it('verifies the returned employee when reassigning a skill', async () => {
    const reassigned = { ...saved, agent_id: 'employee-2' };
    const write = query(reassigned); from.mockReturnValue(write);
    await expect(updateSkill('org-1', 'skill-1', { ...content, agentId: 'employee-2' })).resolves.toEqual(reassigned);
    expect(write.update).toHaveBeenCalledWith({ name: 'My Skill', instructions: 'Read the evidence first.', description: '', agent_id: 'employee-2' });
    from.mockReturnValue(query({ ...saved, agent_id: 'employee-1' }));
    await expect(updateSkill('org-1', 'skill-1', { ...content, agentId: 'employee-2' })).rejects.toThrow('skill_not_changed');
  });
  it('rejects RLS-filtered edits and stale returned content', async () => {
    from.mockReturnValue(query(null));
    await expect(updateSkill('org-1', 'skill-1', content)).rejects.toThrow('skill_not_changed');
    from.mockReturnValue(query({ ...saved, instructions: 'Old content' }));
    await expect(updateSkill('org-1', 'skill-1', content)).rejects.toThrow('skill_not_changed');
  });
  it('confirms toggling and rejects a mismatched enabled state', async () => {
    const write = query({ id: 'skill-1', enabled: false }); from.mockReturnValue(write);
    await expect(setSkillEnabled('org-1', 'skill-1', false)).resolves.toBeUndefined();
    expect(write.eq.mock.calls).toEqual([['organization_id', 'org-1'], ['id', 'skill-1']]);
    await expect(setSkillEnabled('org-1', 'skill-1', true)).rejects.toThrow('skill_not_changed');
  });
  it('does not report success when RLS hides the row from a toggle or delete', async () => {
    from.mockReturnValue(query(null));
    await expect(setSkillEnabled('org-1', 'skill-1', false)).rejects.toThrow('skill_not_changed');
    await expect(deleteSkill('org-1', 'skill-1')).rejects.toThrow('skill_not_changed');
  });
  it('scopes deletion to the company and confirms the exact deleted row', async () => {
    const write = query({ id: 'skill-1' }); from.mockReturnValue(write);
    await expect(deleteSkill('org-1', 'skill-1')).resolves.toBeUndefined();
    expect(write.eq.mock.calls).toEqual([['organization_id', 'org-1'], ['id', 'skill-1']]);
    expect(write.delete).toHaveBeenCalledOnce();
    from.mockReturnValue(query({ id: 'different' }));
    await expect(deleteSkill('org-1', 'skill-1')).rejects.toThrow('skill_not_changed');
  });
  it('makes stable custom keys for Unicode names and normalized separators', () => {
    expect(customSkillSlug(' Μια Δεξιότητα ')).toBe(customSkillSlug('μια δεξιότητα'));
    expect(customSkillSlug('Daily   Brief')).toBe('custom-daily-brief');
    expect(customSkillSlug('每日简报')).toBe('custom-每日简报');
  });
});
