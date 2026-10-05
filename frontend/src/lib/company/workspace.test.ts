import { describe, expect, it } from 'vitest';
import { WORKSPACE_COPY } from './workspaceCopy';
import { SKILL_LIBRARY } from './skillLibrary';
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
