import { describe, expect, it } from 'vitest';
import { layoutAgents } from '../scenes/OfficeScene';
import { buildNodes } from './ProviderTopology';
import type { GatewayOverview } from '../../lib/gateway';
import type { AgentRow } from '../../lib/company/types';

const overview = (over: Partial<GatewayOverview> = {}): GatewayOverview => ({
  connected: true,
  host: 'h',
  has_key: true,
  models: { total: 0, providers: [], combo_ids: [] },
  connections: [],
  combos: [],
  stats: [],
  errors: {},
  ...over,
});

describe('buildNodes', () => {
  it('colours connected providers by health and appends unconnected ones faded', () => {
    const nodes = buildNodes(
      overview({
        models: { total: 30, providers: [{ provider: 'openai', models: 10 }, { provider: 'groq', models: 5 }, { provider: 'mistral', models: 15 }], combo_ids: [] },
        connections: [
          { provider: 'openai', connections: 1, active: 1, healthy: 1, limited: 0 },
          { provider: 'groq', connections: 1, active: 1, healthy: 1, limited: 1 },
          { provider: 'dead', connections: 1, active: 0, healthy: 0, limited: 0 },
        ],
      }),
    );
    const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
    expect(byId.openai.tone).toBe('ok');
    expect(byId.groq.tone).toBe('warn'); // rate limited beats healthy
    expect(byId.dead.tone).toBe('off');
    expect(byId.mistral).toMatchObject({ connected: false, tone: 'off', models: 15 });
  });

  it('caps the number of nodes', () => {
    const providers = Array.from({ length: 40 }, (_, i) => ({ provider: `p${i}`, models: 1 }));
    expect(buildNodes(overview({ models: { total: 40, providers, combo_ids: [] } }), 10)).toHaveLength(10);
  });
});

const agent = (id: string, type: string): AgentRow => ({
  id, name: id, slug: id, type, description: null, model: 'auto', enabled: true, autonomous: false, agent_tools: [],
});

describe('layoutAgents', () => {
  it('places known departments in fixed rooms and custom agents in spare ones', () => {
    const placed = layoutAgents([agent('c', 'ceo'), agent('x', 'custom'), agent('y', 'custom')]);
    expect(placed.map((p) => p.agent.id)).toEqual(['c', 'x', 'y']);
    const positions = new Set(placed.map((p) => p.pos.join(',')));
    expect(positions.size).toBe(3); // no two rooms overlap
  });

  it('puts a duplicate department in a spare room instead of stacking it', () => {
    const placed = layoutAgents([agent('a', 'sales'), agent('b', 'sales')]);
    expect(new Set(placed.map((p) => p.pos.join(','))).size).toBe(2);
  });

  it('drops extras beyond the available rooms rather than overlapping', () => {
    const many = Array.from({ length: 20 }, (_, i) => agent(`a${i}`, 'custom'));
    const placed = layoutAgents(many);
    expect(placed.length).toBeLessThanOrEqual(4);
    expect(new Set(placed.map((p) => p.pos.join(','))).size).toBe(placed.length);
  });
});
