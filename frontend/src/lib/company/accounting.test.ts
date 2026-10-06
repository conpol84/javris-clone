import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ rpc: vi.fn(), abortSignal: vi.fn() }));
vi.mock('./client', () => ({ requireClient: () => ({ rpc: mock.rpc }) }));
import { AccountingError, loadAccountingSnapshot, parseAccountingSnapshot } from './accounting';

const org = '11111111-0815-4815-8815-111111111111';
const request = '22222222-0815-4815-8815-222222222222';
const value = {
  contract: 'firbo-accounting-snapshot/v1', organization_id: org, read_only: true,
  observed_at: '2026-10-06T00:00:00Z', month_start: '2026-10-01T00:00:00Z',
  open_count: 2, reserved_count: 1, reconcile_required_count: 1, potential_liability_usd: .75,
  stale_open_count: 2, stale_minutes: 60, settled_month_count: 3, platform_settled_month_usd: .2,
  unknown_settled_cost_count: 0, byok_settled_month_count: 1, zero_cost_settled_month_count: 1,
  overrun_month_count: 0, detail_limit: 20,
  details: [{ request_id: request, source: 'agent-chat', status: 'reserved', reserved_usd: .25, age_seconds: 50000 }],
};
describe('accounting RPC boundary', () => {
  beforeEach(() => { vi.clearAllMocks(); mock.rpc.mockReturnValue({ abortSignal: mock.abortSignal }); });
  it('calls only the bounded company RPC with the cancellation signal', async () => {
    const signal = new AbortController().signal;
    mock.abortSignal.mockResolvedValue({ data: value, error: null });
    expect(await loadAccountingSnapshot(org, signal)).toEqual(value);
    expect(mock.rpc).toHaveBeenCalledWith('firbo_accounting_snapshot', { p_org: org, p_limit: 20, p_stale_minutes: 60 });
    expect(mock.abortSignal).toHaveBeenCalledWith(signal);
  });
  it('distinguishes denied access and sanitizes all other server errors', async () => {
    for (const [code, expected] of [['42501', 'forbidden'], ['PGRST202', 'unavailable']]) {
      mock.abortSignal.mockResolvedValue({ data: null, error: { code, message: 'secret postgres detail' } });
      await expect(loadAccountingSnapshot(org, new AbortController().signal)).rejects.toEqual(new AccountingError(expected as 'forbidden' | 'unavailable'));
    }
    await expect(loadAccountingSnapshot('injected', new AbortController().signal)).rejects.toEqual(new AccountingError('unavailable'));
    expect(mock.rpc).toHaveBeenCalledTimes(2);
  });
  it('rejects wrong company, malformed totals, incomplete evidence and non-read-only receipts', () => {
    for (const bad of [null, {}, { ...value, organization_id: request }, { ...value, read_only: false },
      { ...value, observed_at: 'bad' }, { ...value, platform_settled_month_usd: NaN },
      { ...value, open_count: 2.5 }, { ...value, open_count: 1 }, { ...value, stale_open_count: 3 },
      { ...value, unknown_settled_cost_count: 4 }, { ...value, detail_limit: 0 },
      { ...value, stale_minutes: null }, { ...value, details: [value.details[0], value.details[0]] },
      { ...value, details: [{ ...value.details[0], status: 'released' }] },
      { ...value, details: [{ ...value.details[0], reserved_usd: -1 }] },
      { ...value, details: [{ ...value.details[0], request_id: '<script>' }] },
      { ...value, details: [{ ...value.details[0], age_seconds: 1.5 }] },
      { ...value, details: [{ ...value.details[0], source: '<script>' }] },
    ]) expect(() => parseAccountingSnapshot(bad, org)).toThrow('unavailable');
  });
  it('preserves pending totals beyond the detail cap, unknown costs and zero-cost/BYOK counts', () => {
    expect(parseAccountingSnapshot({ ...value, unknown_settled_cost_count: 1 }, org).unknown_settled_cost_count).toBe(1);
    expect(parseAccountingSnapshot(value, org).open_count).toBe(2);
    expect(parseAccountingSnapshot(value, org).details).toHaveLength(1);
    expect(parseAccountingSnapshot({ ...value, extra_secret: 'secret', details: [{ ...value.details[0], reconcile_reason: 'private prose' }] }, org)).toEqual(value);
  });
});
