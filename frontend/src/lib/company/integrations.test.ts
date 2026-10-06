import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();

vi.mock('./client', () => ({
  requireClient: () => ({ functions: { invoke } }),
}));

import { mcpCall } from './integrations';

describe('MCP company client', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends an explicit confirmation and preserves the durable receipts', async () => {
    const receipt = {
      request_id: 'request-receipt',
      result_id: 'result-receipt',
      arguments_sha256: 'a'.repeat(64),
      result_sha256: 'b'.repeat(64),
    };
    invoke.mockResolvedValue({ data: { text: 'Synthetic result', is_error: false, receipt }, error: null });

    await expect(mcpCall('integration-1', 'weather.read', { city: 'Larnaca' }, true)).resolves.toEqual({
      text: 'Synthetic result',
      is_error: false,
      receipt,
    });
    expect(invoke).toHaveBeenCalledWith('mcp', {
      body: {
        action: 'call',
        id: 'integration-1',
        tool: 'weather.read',
        arguments: { city: 'Larnaca' },
        confirm: true,
      },
    });
  });

  it('does not invoke the Edge Function without a caller-confirmed action', async () => {
    await expect(mcpCall('integration-1', 'weather.read', {}, false)).rejects.toThrow('confirm_required');
    expect(invoke).not.toHaveBeenCalled();
  });
});
