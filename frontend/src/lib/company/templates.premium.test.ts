import { describe, expect, it } from 'vitest';
import { AGENT_TEMPLATES, isPremium, PREMIUM_SLUGS } from './templates';

describe('premium AI employees', () => {
  it('only lists real templates', () => {
    const slugs = AGENT_TEMPLATES.map((t) => t.slug);
    for (const p of PREMIUM_SLUGS) expect(slugs).toContain(p);
  });
  it('leaves a useful starter set for the Free plan', () => {
    const free = AGENT_TEMPLATES.filter((t) => !isPremium(t.slug));
    expect(free.length).toBeGreaterThanOrEqual(10);
  });
  it('treats hired copies like their template', () => {
    expect(isPremium('autonomous-coder-2')).toBe(true);
    expect(isPremium('customer-support-3')).toBe(false);
  });
});
