import { describe, expect, it } from 'vitest';
import { AGENT_TEMPLATES, AUTONOMY_LEVELS, GOALS, TEMPLATE_CATEGORIES } from './templates';
import { agentColor } from './status';

describe('agent templates', () => {
  it('have unique slugs that satisfy the database slug check', () => {
    const slugs = AGENT_TEMPLATES.map((t) => t.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const s of slugs) expect(s).toMatch(/^[a-z0-9][a-z0-9_-]{0,62}$/);
  });

  it('only use valid categories, policies and non-empty tool lists with no duplicates', () => {
    for (const t of AGENT_TEMPLATES) {
      expect(TEMPLATE_CATEGORIES).toContain(t.category);
      expect(t.tools.length).toBeGreaterThan(0);
      expect(new Set(t.tools.map((x) => x.tool)).size).toBe(t.tools.length);
      for (const tool of t.tools) {
        expect(tool.tool).toMatch(/^[a-z_]+$/);
        expect([undefined, 'allow', 'approval', 'block']).toContain(tool.policy);
      }
      expect(t.prompt).toContain('human approval'); // every agent carries the safety rule
      expect(t.color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('gate risky tools behind approval by default', () => {
    const risky = ['channel_send', 'file_write', 'apply_patch', 'git_commit', 'shell_exec'];
    for (const t of AGENT_TEMPLATES) {
      for (const tool of t.tools.filter((x) => risky.includes(x.tool))) expect(tool.policy).toBe('approval');
    }
  });

  it('are referenced correctly by onboarding goals', () => {
    for (const g of GOALS) for (const slug of g.extra) expect(AGENT_TEMPLATES.some((t) => t.slug === slug)).toBe(true);
  });

  it('offers the four autonomy levels the database accepts', () => {
    expect(AUTONOMY_LEVELS.map((l) => l.id)).toEqual(['suggest', 'approval', 'notify', 'auto']);
  });
});

describe('agentColor', () => {
  it('keeps department colours, uses template colours for hires and is stable otherwise', () => {
    expect(agentColor('ceo', 'ceo')).toBe('#f59e0b');
    const tpl = AGENT_TEMPLATES[0];
    expect(agentColor('custom', tpl.slug)).toBe(tpl.color);
    expect(agentColor('custom', `${tpl.slug}-2`)).toBe(tpl.color); // de-duplicated slug keeps its colour
    expect(agentColor('custom', 'my-own-agent')).toBe(agentColor('custom', 'my-own-agent'));
  });
});
