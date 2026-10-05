import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WORKSPACE_COPY } from '../lib/company/workspaceCopy';
import { SKILLS_COPY } from '../lib/company/skillsCopy';
import { en } from '../i18n/locales/en';
import { EmptyState } from '../components/ui/kit';
import type { SkillRow } from '../lib/company/workspace';

const fixture = vi.hoisted(() => ({ states: [] as unknown[], index: 0, refIndex: 0, refs: [] as { current: unknown }[], effects: [] as (() => void | (() => void))[], role: 'owner', orgId: 'org-1', userId: 'self', setters: [] as ReturnType<typeof vi.fn>[] }));
const workspace = vi.hoisted(() => ({ addSkill: vi.fn(), listSkills: vi.fn(), updateSkill: vi.fn(), deleteSkill: vi.fn(), setSkillEnabled: vi.fn() }));
const notices = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
const agents = vi.hoisted(() => ({ listAgents: vi.fn() }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: () => { const index = fixture.index++; const setter = vi.fn(); fixture.setters[index] = setter; return [fixture.states[index], setter]; },
  useEffect: (callback: () => void | (() => void)) => { fixture.effects.push(callback); }, useCallback: (callback: unknown) => callback, useMemo: (callback: () => unknown) => callback(),
  useRef: (initial: unknown) => fixture.refs[fixture.refIndex++] ?? { current: initial },
}));
vi.mock('../lib/company/AuthProvider', () => ({ useCompanyAuth: () => ({ current: { role: fixture.role, organization: { id: fixture.orgId } }, user: { id: fixture.userId } }) }));
vi.mock('../lib/company/workspace', () => workspace);
vi.mock('../lib/company/data', () => agents);
vi.mock('sonner', () => ({ toast: notices }));
vi.mock('../i18n/I18nProvider', () => ({ useI18n: () => ({ lang: 'en', t: (key: keyof typeof en) => en[key] }) }));
vi.mock('../lib/company/limits', () => ({ notifyPlanLimit: () => false }));
import { SkillsPage, SkillsWorkspace } from './SkillsPage';

type Element = ReactElement<{ children?: ReactNode; disabled?: boolean; 'aria-label'?: string; onClick?: () => void; onSubmit?: (event: { preventDefault: () => void }) => void }>;
function elements(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement(node)) return [];
  const element = node as Element;
  return [element, ...elements(element.props.children)];
}
function text(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(text).join('');
  if (isValidElement(node)) return text((node as Element).props.children);
  return typeof node === 'string' ? node : '';
}
const skill: SkillRow = { id: 'skill-1', slug: 'deep-research', agent_id: null, name: 'Research', instructions: 'Read reliable evidence first.', description: '', source: 'library', enabled: true, created_at: '' };
function page(role = 'owner', values: { skills?: SkillRow[]; name?: string; instructions?: string; editing?: SkillRow | null; busy?: boolean } = {}) {
  fixture.role = role; fixture.index = 0;
  fixture.refIndex = 0; fixture.refs = [{ current: true }, { current: 0 }, { current: false }]; fixture.effects = [];
  fixture.states = [values.skills ?? [skill], [], '', values.name ?? '', values.instructions ?? '', values.busy ?? false, values.editing ?? null, false, false];
  return SkillsWorkspace();
}
const remove = (tree: ReactNode) => elements(tree).find(e => e.props['aria-label'] === 'Remove: Research')!;

describe('actual Skills page controls', () => {
  beforeEach(() => { vi.clearAllMocks(); fixture.orgId = 'org-1'; fixture.userId = 'self'; workspace.listSkills.mockResolvedValue([skill]); agents.listAgents.mockResolvedValue([]); });
  it('permits managers to remove and confirms success only after the write', async () => {
    workspace.deleteSkill.mockResolvedValue(undefined);
    remove(page('manager')).props.onClick?.();
    expect(workspace.deleteSkill).toHaveBeenCalledWith('org-1', 'skill-1');
    await vi.waitFor(() => expect(notices.success).toHaveBeenCalledWith(SKILLS_COPY.en.removed));
    expect(workspace.listSkills).toHaveBeenCalledWith('org-1');
  });
  it('explains read-only permissions and exposes no mutation controls to a member', () => {
    const tree = page('member');
    expect(text(tree)).toContain(SKILLS_COPY.en.denied);
    expect(elements(tree).filter(e => e.type === 'button')).toHaveLength(0);
    expect(elements(tree).some(e => e.type === 'form')).toBe(false);
  });
  it('shows a permissions failure without a removal success or reload', async () => {
    workspace.deleteSkill.mockRejectedValue(new Error('skill_not_changed'));
    remove(page()).props.onClick?.();
    await vi.waitFor(() => expect(notices.error).toHaveBeenCalledWith(SKILLS_COPY.en.unchanged));
    expect(notices.success).not.toHaveBeenCalled();
    expect(workspace.listSkills).not.toHaveBeenCalled();
  });
  it('adds valid custom instructions for the selected company', async () => {
    workspace.addSkill.mockResolvedValue(skill);
    const tree = page('owner', { name: 'My custom skill', instructions: 'Read our company rules before answering.' });
    elements(tree).find(e => e.type === 'form')!.props.onSubmit?.({ preventDefault: vi.fn() });
    expect(workspace.addSkill).toHaveBeenCalledWith('org-1', 'self', { name: 'My custom skill', instructions: 'Read our company rules before answering.', agentId: null });
    await vi.waitFor(() => expect(notices.success).toHaveBeenCalledWith(WORKSPACE_COPY.en.sDone));
  });
  it('saves edits to the installed skill rather than inserting a second one', async () => {
    workspace.updateSkill.mockResolvedValue(skill);
    const tree = page('owner', { name: 'New name', instructions: 'Updated precise instructions.', editing: skill });
    elements(tree).find(e => e.type === 'form')!.props.onSubmit?.({ preventDefault: vi.fn() });
    expect(workspace.updateSkill).toHaveBeenCalledWith('org-1', 'skill-1', { name: 'New name', instructions: 'Updated precise instructions.', description: '' });
    expect(workspace.addSkill).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(notices.success).toHaveBeenCalledWith(SKILLS_COPY.en.saved));
  });
  it('blocks a second install even if a disabled Installed button handler is forced', () => {
    const tree = page();
    const installed = elements(tree).find(e => e.type === 'button' && text(e) === 'Installed')!;
    expect(installed.props.disabled).toBe(true);
    installed.props.onClick?.();
    expect(workspace.addSkill).not.toHaveBeenCalled();
  });
  it('prevents another write while an existing operation is busy', () => {
    const tree = page('owner', { busy: true });
    expect(remove(tree).props.disabled).toBe(true);
    remove(tree).props.onClick?.();
    expect(workspace.deleteSkill).not.toHaveBeenCalled();
  });
  it('loads the actual selected content into the edit form', () => {
    const tree = page();
    elements(tree).find(e => e.type === 'button' && text(e).trim() === 'Edit')!.props.onClick?.();
    expect(fixture.setters[6]).toHaveBeenCalledWith(skill);
    expect(fixture.setters[3]).toHaveBeenCalledWith(skill.name);
    expect(fixture.setters[4]).toHaveBeenCalledWith(skill.instructions);
  });
  it('remounts the entire workspace for company, user and role changes', () => {
    const first = SkillsPage(); expect(first.type).toBe(SkillsWorkspace); const firstKey = first.key;
    fixture.orgId = 'org-2'; expect(SkillsPage().key).not.toBe(firstKey);
    fixture.orgId = 'org-1'; fixture.userId = 'other'; expect(SkillsPage().key).not.toBe(firstKey);
    fixture.userId = 'self'; fixture.role = 'viewer'; expect(SkillsPage().key).not.toBe(firstKey);
  });
  it('ignores late skill/employee reads after the old workspace unmounts', async () => {
    let finishSkills!: (rows: SkillRow[]) => void; let finishAgents!: (rows: unknown[]) => void;
    workspace.listSkills.mockReturnValue(new Promise(resolve => { finishSkills = resolve; }));
    agents.listAgents.mockReturnValue(new Promise(resolve => { finishAgents = resolve; }));
    page(); const unmount = fixture.effects[0]()!; fixture.effects[1]();
    expect(workspace.listSkills).toHaveBeenCalledWith('org-1'); expect(agents.listAgents).toHaveBeenCalledWith('org-1');
    unmount(); finishSkills([{ ...skill, name: 'Old company data' }]); finishAgents([]);
    await Promise.resolve(); await Promise.resolve();
    expect(fixture.setters[0]).not.toHaveBeenCalled(); expect(fixture.setters[1]).not.toHaveBeenCalled();
    expect(notices.error).not.toHaveBeenCalled();
  });
  it('suppresses obsolete save success and reload after the workspace unmounts', async () => {
    let finish!: () => void; workspace.deleteSkill.mockReturnValue(new Promise<void>(resolve => { finish = resolve; }));
    const tree = page(); const unmount = fixture.effects[0]()!;
    remove(tree).props.onClick?.(); expect(workspace.deleteSkill).toHaveBeenCalledOnce(); unmount(); finish();
    await Promise.resolve(); await Promise.resolve();
    expect(notices.success).not.toHaveBeenCalled(); expect(workspace.listSkills).not.toHaveBeenCalled();
  });
  it('suppresses an obsolete write failure after the workspace unmounts', async () => {
    let reject!: (error: Error) => void; workspace.deleteSkill.mockReturnValue(new Promise<void>((_resolve, fail) => { reject = fail; }));
    const tree = page(); const unmount = fixture.effects[0]()!; remove(tree).props.onClick?.(); unmount(); reject(new Error('skill_not_changed'));
    await Promise.resolve(); await Promise.resolve(); expect(notices.error).not.toHaveBeenCalled();
  });
  it('shows loading and retry instead of concluding that the workspace is empty', async () => {
    page('owner', { skills: [] }); fixture.states[8] = true; fixture.index = 0; fixture.refIndex = 0; fixture.effects = [];
    const pending = SkillsWorkspace(); expect(text(pending)).toContain(en['common.loading']);
    expect(elements(pending).some(e => e.type === EmptyState)).toBe(false);
    fixture.states[8] = false; fixture.states[7] = true; fixture.index = 0; fixture.refIndex = 0; fixture.effects = [];
    workspace.listSkills.mockResolvedValue([skill]); const failed = SkillsWorkspace();
    expect(elements(failed).some(e => e.type === EmptyState)).toBe(false);
    elements(failed).find(e => e.type === 'button' && text(e).trim() === en['common.retry'])!.props.onClick?.();
    await vi.waitFor(() => expect(fixture.setters[7]).toHaveBeenCalledWith(false));
    expect(fixture.setters[0]).toHaveBeenCalledWith([skill]);
  });
});
