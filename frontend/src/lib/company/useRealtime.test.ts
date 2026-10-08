import { describe, expect, it } from 'vitest';
import { channelName } from './useRealtime';

describe('realtime channel names', () => {
  it('never reuses a name, so a second subscriber cannot hit an already subscribed channel', () => {
    const names = Array.from({ length: 5 }, () => channelName('org1', 'agents,tasks'));
    expect(new Set(names).size).toBe(5);
  });
  it('still carries the company and tables for debugging', () => {
    expect(channelName('org1', 'agents')).toMatch(/^org-org1-agents-\d+$/);
  });
});
