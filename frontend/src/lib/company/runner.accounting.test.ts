import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();
vi.mock('./client', () => ({ requireClient: () => ({ functions: { invoke } }) }));

import { sendChat } from './runner';

describe('agent chat accounting request identity', () => {
  beforeEach(() => vi.clearAllMocks());

  it('gives every chat turn a bounded UUID before invoking the server', async () => {
    invoke.mockResolvedValue({
      data: {
        user_message: { id: 'u', role: 'user', content: 'hello', created_at: '2026-10-06T00:00:00Z' },
        message: { id: 'a', role: 'assistant', content: 'hi', created_at: '2026-10-06T00:00:01Z' },
      },
      error: null,
    });
    await sendChat('conversation-1', 'hello', 'en');
    expect(invoke).toHaveBeenCalledTimes(1);
    const [name, options] = invoke.mock.calls[0];
    expect(name).toBe('agent-chat');
    expect(options.body).toMatchObject({ conversation_id: 'conversation-1', message: 'hello', lang: 'en' });
    expect(options.body.request_id).toMatch(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i);
  });
});
