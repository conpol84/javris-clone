import { describe, it, expect } from 'vitest';
import { omniMcpCopy } from './omni-mcp-copy';

describe('single FIRBO + OmniRoute MCP integration in every FIRBO locale', () => {
  for (const lang of ['en','el','es','pt-BR','de','fr','zh-CN','ar']) {
    it('has an explicit consent/scope message in '+lang, () => {
      const copy = omniMcpCopy(lang);
      expect(copy.title.length).toBeGreaterThan(8);
      expect(copy.description.length).toBeGreaterThan(60);
      expect(copy.description).toContain('mcp:connect');
      expect(copy.existing.length).toBeGreaterThan(8);
      expect(copy.notReady.length).toBeGreaterThan(20);
    });
  }
  it('falls back only for unknown locales without losing the warnings', () => {
    expect(omniMcpCopy('xx')).toEqual(omniMcpCopy('en'));
  });
});
