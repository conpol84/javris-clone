import { describe, expect, it } from 'vitest';
import { WORKSPACE_COPY } from './workspaceCopy';
import { SKILL_LIBRARY } from './skillLibrary';
import { SKILLS_COPY } from './skillsCopy';
import { nextRunAt } from './workspace';

describe('workspace copy', () => {
  it('has every key in all 8 languages and never says Jarvis', () => {
    const keys = Object.keys(WORKSPACE_COPY.en).sort();
    expect(Object.keys(WORKSPACE_COPY).sort()).toEqual(['ar', 'de', 'el', 'en', 'es', 'fr', 'pt-BR', 'zh-CN']);
    for (const [lang, copy] of Object.entries(WORKSPACE_COPY)) {
      expect(Object.keys(copy).sort(), lang).toEqual(keys);
      for (const v of Object.values(copy)) expect(v, lang).not.toMatch(/jarvis/i);
    }
    for (const s of SKILL_LIBRARY) expect(Object.keys(s.names).length, s.slug).toBe(8);
  });
});

describe('practical skill catalogue', () => {
  it('keeps every skill localized and declares only tools implemented by the company loop', () => {
    const tools = new Set(['web_search', 'read_page', 'memory_search', 'knowledge_search', 'server_task', 'calculator', 'weather', 'exchange_rate', 'analyze_image', 'generate_image']);
    expect(SKILL_LIBRARY.length).toBe(28);
    expect(new Set(SKILL_LIBRARY.map(s => s.slug)).size).toBe(SKILL_LIBRARY.length);
    for (const skill of SKILL_LIBRARY) {
      expect(Object.keys(skill.names).sort()).toEqual(Object.keys(SKILLS_COPY).sort());
      expect(skill.instructions.length).toBeLessThanOrEqual(4000);
      expect(skill.instructions).toContain('Installation does not grant new permissions.');
      expect(skill.instructions).toContain('never report execution without a real result');
      for (const tool of skill.requiredTools ?? []) expect(tools.has(tool), `${skill.slug}: ${tool}`).toBe(true);
    }
  });
  it('provides the new editing, permission and confirmation messages in all eight languages', () => {
    for (const copy of Object.values(SKILLS_COPY)) {
      expect(Object.keys(copy).sort()).toEqual(Object.keys(SKILLS_COPY.en).sort());
      for (const value of Object.values(copy)) expect(value.length).toBeGreaterThan(0);
    }
  });
});

describe('nextRunAt', () => {
  const now = new Date('2026-10-05T10:30:00Z'); // a Monday
  it('daily: later today when the hour has not passed, else tomorrow', () => {
    expect(nextRunAt({ cadence: 'daily', hour: 12, minute: 0, tz: 'UTC' }, now)).toBe('2026-10-05T12:00:00.000Z');
    expect(nextRunAt({ cadence: 'daily', hour: 9, minute: 0, tz: 'UTC' }, now)).toBe('2026-10-06T09:00:00.000Z');
  });
  it('respects the time zone and the weekday', () => {
    expect(nextRunAt({ cadence: 'daily', hour: 9, minute: 0, tz: 'Europe/Athens' }, now)).toBe('2026-10-06T06:00:00.000Z');
    expect(nextRunAt({ cadence: 'weekly', weekday: 3, hour: 8, minute: 15, tz: 'UTC' }, now)).toBe('2026-10-07T08:15:00.000Z');
  });
  it('hourly: the next :minute', () => {
    expect(nextRunAt({ cadence: 'hourly', minute: 45 }, now)).toBe('2026-10-05T10:45:00.000Z');
    expect(nextRunAt({ cadence: 'hourly', minute: 15 }, now)).toBe('2026-10-05T11:15:00.000Z');
  });
});
