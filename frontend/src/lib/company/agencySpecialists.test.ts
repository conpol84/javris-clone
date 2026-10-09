import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AGENCY_SOURCE, AGENCY_SPECIALISTS, agencySourceUrl, agencySpecialist, withAgencySpecialist } from './agencySpecialists';
import { AGENCY_COPY, AGENCY_DELIVERABLE } from './agencyCopy';
import { AGENT_TEMPLATES, isPremium, type AgentTemplate } from './templates';

const sdk = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock('./client', () => ({ requireClient: () => sdk }));
import { hireAgent } from './data';

beforeEach(() => { vi.clearAllMocks(); sdk.rpc.mockResolvedValue({ data: 'hired-agent', error: null }); });

describe('Agency specialist hiring integration', () => {
  it.each(Object.keys(AGENCY_SPECIALISTS))('sends %s method, owner instructions and existing tool policies to the company hiring RPC', async slug => {
    const template = AGENT_TEMPLATES.find(t => t.slug === slug)!;
    const specialist = agencySpecialist(slug)!;
    await expect(hireAgent('company-a', template, { instructions: 'Use Greek and our existing project conventions.' })).resolves.toBe('hired-agent');
    const [rpc, args] = sdk.rpc.mock.calls[0];
    expect(rpc).toBe('hire_agent');
    expect(args).toMatchObject({ p_org: 'company-a', p_slug: slug, p_type: 'custom', p_name: template.name });
    expect(args.p_prompt).toContain(specialist.instructions);
    expect(args.p_prompt).toContain(agencySourceUrl(specialist));
    expect(args.p_prompt).toContain('Use Greek and our existing project conventions.');
    expect(args.p_prompt).toContain('existing human approval policy without adding duplicate approval steps');
    expect(args.p_tools).toEqual(template.tools.map(t => ({ tool: t.tool, policy: t.policy ?? 'allow' })));
    expect(sdk.from).not.toHaveBeenCalled(); // No mutation of existing employees or permissions.
    expect(args.p_prompt.length).toBeLessThan(5000);
  });

  it('preserves server plan/role failures rather than retrying a different slug', async () => {
    sdk.rpc.mockResolvedValue({ data: null, error: { message: 'premium_agent_required' } });
    await expect(hireAgent('company-a', AGENT_TEMPLATES.find(t => t.slug === 'deep-research')!)).rejects.toThrow('premium_agent_required');
    expect(sdk.rpc).toHaveBeenCalledOnce();
    expect(isPremium('deep-research-2')).toBe(true);
    expect(isPremium('content-writer')).toBe(false);
  });

  it('enriches a template without changing or mutating its identity, tools or policy', () => {
    const base: AgentTemplate = { slug: 'qa-engineer', name: 'QA', category: 'Engineering', color: '#f87171', tagline: 'Review', prompt: 'Original instructions', tools: [{ tool: 'file_write', policy: 'block' }] };
    Object.freeze(base.tools[0]); Object.freeze(base.tools); Object.freeze(base);
    const adapted = withAgencySpecialist(base);
    expect(adapted).not.toBe(base);
    expect({ ...adapted, prompt: base.prompt }).toEqual(base);
    expect(adapted.tools).toBe(base.tools);
    expect(adapted.prompt).toMatch(/^Original instructions\n/);
    expect(base.prompt).toBe('Original instructions');
  });

  it.each(['custom-agent', 'qa-engineer-2', 'constructor', '__proto__', 'toString'])('does not attach a playbook to unknown catalog key %s', slug => {
    expect(agencySpecialist(slug)).toBeUndefined();
    const base = { ...AGENT_TEMPLATES[0], slug };
    expect(withAgencySpecialist(base)).toBe(base);
  });

  it('keeps pinned provenance, all five catalog bindings and eight-language deliverables', () => {
    expect(AGENCY_SOURCE.commit).toMatch(/^[a-f0-9]{40}$/);
    expect(Object.keys(AGENCY_SPECIALISTS).sort()).toEqual(Object.keys(AGENCY_DELIVERABLE).sort());
    expect(AGENT_TEMPLATES.filter(t => agencySpecialist(t.slug))).toHaveLength(5);
    expect(Object.keys(AGENCY_COPY).sort()).toEqual(['ar', 'de', 'el', 'en', 'es', 'fr', 'pt-BR', 'zh-CN']);
    for (const copy of Object.values(AGENCY_COPY)) {
      expect(Object.keys(copy).sort()).toEqual(Object.keys(AGENCY_COPY.en).sort());
      for (const value of Object.values(copy)) expect(value.trim()).not.toBe('');
    }
  });
});
