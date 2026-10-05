import { beforeEach, describe, expect, it, vi } from 'vitest';

// A small deterministic React hook driver: state/effect cleanup are real hook
// boundaries, while Supabase responses are controlled promises, never HTTP.
const driver = vi.hoisted(() => ({ index: 0, slots: [] as any[], effects: [] as (() => void)[] }));
vi.mock('react', () => ({
  useState(initial: unknown) {
    const index = driver.index++;
    if (!(index in driver.slots)) driver.slots[index] = typeof initial === 'function' ? initial() : initial;
    return [driver.slots[index], (next: unknown) => { driver.slots[index] = typeof next === 'function' ? next(driver.slots[index]) : next; }];
  },
  useCallback(callback: unknown, deps: unknown[]) {
    const index = driver.index++; const previous = driver.slots[index];
    if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) driver.slots[index] = { callback, deps };
    return driver.slots[index].callback;
  },
  useEffect(effect: () => void | (() => void), deps: unknown[]) {
    const index = driver.index++; const previous = driver.slots[index];
    if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) {
      driver.effects.push(() => { previous?.cleanup?.(); driver.slots[index] = { deps, cleanup: effect() }; });
    }
  },
}));
const sdk = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock('./client', () => ({ requireClient: () => sdk }));
import { useOwnKeys, usePlanUsage, usePlanUsageState } from './usePlan';
import type { OwnKeyRow } from './ownKeys';
import type { PlanUsage } from './billing';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function render<T>(read: () => T, effects = true): T {
  driver.index = 0; const value = read();
  if (effects) driver.effects.splice(0).forEach(effect => effect());
  return value;
}
const key = (hint: string): OwnKeyRow => ({ provider: 'openai', key_hint: hint, models: ['model-1'], updated_at: '' });
const plan = (id: 'free' | 'pro'): PlanUsage => ({ plan: { id, name: id, features: id === 'pro' ? ['byo_keys'] : [], limits: {} as PlanUsage['plan']['limits'], sort: 0, price_month_usd: null, price_year_usd: null, purchasable: true }, status: 'active', renews_at: null, has_subscription: false, usage: {} as PlanUsage['usage'] });
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

describe('company plan and own-key request state', () => {
  beforeEach(() => { vi.clearAllMocks(); driver.index = 0; driver.slots = []; driver.effects = []; });
  function keysQueries(requests: Map<string, Promise<unknown>>) {
    sdk.from.mockImplementation(() => {
      let org = '';
      return { select: vi.fn().mockReturnThis(), eq: vi.fn((_field, id) => { org = id; return { order: () => requests.get(org) }; }) };
    });
  }
  it('marks a key lookup loading instead of concluding that no providers are connected', async () => {
    const request = deferred<unknown>(); keysQueries(new Map([['A', request.promise]]));
    const first = render(() => useOwnKeys('A'));
    expect(first[0]).toEqual([]); expect(first[2].status).toBe('loading');
    request.resolve({ data: [key('synthetic-A')], error: null }); await flush();
    const loaded = render(() => useOwnKeys('A'));
    expect(loaded[0][0].key_hint).toBe('synthetic-A'); expect(loaded[2].status).toBe('ready');
  });
  it('hides A keys immediately on an A→B switch and ignores the late A response', async () => {
    const A = deferred<unknown>(); const B = deferred<unknown>(); keysQueries(new Map([['A', A.promise], ['B', B.promise]]));
    render(() => useOwnKeys('A'));
    const switching = render(() => useOwnKeys('B'), false);
    expect(switching[0]).toEqual([]); expect(switching[2].status).toBe('loading');
    driver.effects.splice(0).forEach(effect => effect());
    B.resolve({ data: [key('synthetic-B')], error: null }); await flush();
    A.resolve({ data: [key('synthetic-A')], error: null }); await flush();
    const current = render(() => useOwnKeys('B'));
    expect(current[0].map(row => row.key_hint)).toEqual(['synthetic-B']); expect(current[2].status).toBe('ready');
  });
  it('does not expose already-loaded A rows before B effects execute', async () => {
    const A = deferred<unknown>(); const B = deferred<unknown>(); keysQueries(new Map([['A', A.promise], ['B', B.promise]]));
    render(() => useOwnKeys('A')); A.resolve({ data: [key('synthetic-A')], error: null }); await flush();
    expect(render(() => useOwnKeys('A'))[0]).toHaveLength(1);
    const firstB = render(() => useOwnKeys('B'), false);
    expect(firstB[0]).toEqual([]); expect(firstB[2].status).toBe('loading');
  });
  it('retains an explicit failure, retries the same company, and confirms an empty result only after success', async () => {
    const failed = deferred<unknown>(); const retried = deferred<unknown>();
    const requests = new Map([['A', failed.promise]]); keysQueries(requests);
    render(() => useOwnKeys('A')); failed.resolve({ data: null, error: { message: 'synthetic RLS failure' } }); await flush();
    const error = render(() => useOwnKeys('A'));
    expect(error[2].status).toBe('error'); expect(error[2].error?.message).toBe('synthetic RLS failure');
    requests.set('A', retried.promise); error[1](); render(() => useOwnKeys('A'));
    expect(render(() => useOwnKeys('A'))[2].status).toBe('loading');
    retried.resolve({ data: [], error: null }); await flush();
    const ready = render(() => useOwnKeys('A')); expect(ready[2].status).toBe('ready'); expect(ready[0]).toEqual([]);
    expect(sdk.from).toHaveBeenCalledTimes(2);
  });
  it('distinguishes plan loading/failure from a real Free entitlement and supports retry', async () => {
    const failed = deferred<unknown>(); const retried = deferred<unknown>();
    sdk.rpc.mockReturnValueOnce(failed.promise).mockReturnValueOnce(retried.promise);
    expect(render(() => usePlanUsageState('A')).status).toBe('loading');
    failed.resolve({ data: null, error: { message: 'synthetic plan failure' } }); await flush();
    const error = render(() => usePlanUsageState('A'));
    expect(error.status).toBe('error'); expect(error.plan).toBeNull();
    error.retry(); render(() => usePlanUsageState('A'));
    retried.resolve({ data: plan('free'), error: null }); await flush();
    const ready = render(() => usePlanUsageState('A')); expect(ready.status).toBe('ready'); expect(ready.plan?.plan.id).toBe('free');
    expect(sdk.rpc.mock.calls).toEqual([['get_plan_usage', { p_org: 'A' }], ['get_plan_usage', { p_org: 'A' }]]);
  });
  it('ignores late plan A success after B and preserves the plan-only API', async () => {
    const A = deferred<unknown>(); const B = deferred<unknown>();
    sdk.rpc.mockImplementation((_fn, args) => args.p_org === 'A' ? A.promise : B.promise);
    expect(render(() => usePlanUsage('A'))).toBeNull();
    expect(render(() => usePlanUsage('B'))).toBeNull();
    B.resolve({ data: plan('pro'), error: null }); await flush();
    A.resolve({ data: plan('free'), error: null }); await flush();
    expect(render(() => usePlanUsage('B'))?.plan.id).toBe('pro');
  });
  it('clears confirmed keys when no company is selected', async () => {
    const A = deferred<unknown>(); keysQueries(new Map([['A', A.promise]]));
    render(() => useOwnKeys('A')); A.resolve({ data: [key('synthetic-A')], error: null }); await flush();
    const clear = render(() => useOwnKeys(undefined)); expect(clear[0]).toEqual([]); expect(clear[2].status).toBe('idle');
  });
  it('treats a null successful plan response as unavailable instead of an upgrade entitlement', async () => {
    sdk.rpc.mockResolvedValue({ data: null, error: null });
    render(() => usePlanUsageState('A')); await flush();
    const result = render(() => usePlanUsageState('A'));
    expect(result.status).toBe('error'); expect(result.plan).toBeNull();
  });
});
