import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ index: 0, states: [] as unknown[], setters: [] as ReturnType<typeof vi.fn>[], invoke: vi.fn() }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(), useState: () => { const i = fixture.index++; const setter = vi.fn(); fixture.setters[i] = setter; return [fixture.states[i], setter]; } }));
vi.mock('../../i18n/I18nProvider', () => ({ useI18n: () => ({ lang: 'en' }) }));
vi.mock('../../lib/company/client', () => ({ requireClient: () => ({ functions: { invoke: fixture.invoke } }) }));
import { ServerToolCheck } from './ServerToolCheck';
const runtime = { contract: 'openjarvis-runtime/v1', agent_loaded: true, tool_inventory_known: true, tool_count: 1, tool_names: ['calculator'], truncated: false };
function elements(node: ReactNode): ReactElement<{ children?: ReactNode; onClick?: () => Promise<void>; disabled?: boolean }>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement(node)) return [];
  const e = node as ReactElement<{ children?: ReactNode }>;
  return [e, ...elements(e.props.children)];
}
async function run() {
  const button = elements(ServerToolCheck({ runtime, disabled: false })).find(e => e.type === 'button')!;
  button.props.onClick!();
  await vi.waitFor(() => expect(fixture.setters[0]).toHaveBeenLastCalledWith(false));
  const calls = fixture.setters[1].mock.calls;
  return calls[calls.length - 1][0];
}
describe('manual server tool check', () => {
  beforeEach(() => { vi.clearAllMocks(); fixture.index = 0; fixture.states = [false, null]; fixture.setters = []; });
  it('does not infer execution from model prose', async () => {
    fixture.invoke.mockResolvedValue({ data: { reply: 'I used calculator: 323' }, error: null });
    expect((await run()).reported).toBe(false);
    expect(fixture.invoke).toHaveBeenCalledWith('server-jarvis', { body: { action: 'chat', message: expect.stringContaining('Use the calculator tool exactly once') } });
  });
  it('requires the expected successful tool result', async () => {
    fixture.invoke.mockResolvedValue({ data: { execution: { contract: 'openjarvis-execution/v1', mode: 'agent', tool_count: 1, failed_count: 0, tools: [{ name: 'calculator', success: true, output: '323', truncated: false }], truncated: false } }, error: null });
    expect((await run()).reported).toBe(true);
  });
  it('clears pending state on a transport error', async () => {
    fixture.invoke.mockRejectedValue(new Error('offline'));
    expect(await run()).toEqual({ reported: false, failed: true });
  });
  it('does not send a request when no safe tool is inventoried', () => {
    const button = elements(ServerToolCheck({ runtime: null, disabled: false })).find(e => e.type === 'button')!;
    expect(button.props.disabled).toBe(true); button.props.onClick!(); expect(fixture.invoke).not.toHaveBeenCalled();
  });
});
