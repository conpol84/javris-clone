import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { computerExecutionOf } from '../../lib/company/runner';
import { ComputerExecutionView } from './ComputerExecutionView';

const JOB = '11111111-1111-4111-8111-111111111111';
const DEVICE = '22222222-2222-4222-8222-222222222222';
const pending = (status = 'queued') => ({ computer_execution: { contract: 'firbo-worker-execution/v1', status: 'pending', verified_success: false,
  jobs: [{ job_id: JOB, request_id: JOB, device_id: DEVICE, device_name: 'Selected Mac', kind: 'desktop_task', status }] } });

describe('correlated worker progress', () => {
  it.each(['queued', 'running', 'unknown'])('shows the exact worker/job %s without suggesting completed work', status => {
    const html = renderToStaticMarkup(<ComputerExecutionView execution={computerExecutionOf(pending(status))} />);
    expect(html).toContain('Selected Mac');
    expect(html).toContain(JOB);
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('Work is still running');
    expect(html).not.toContain('Confirmed receipt');
    expect(html).not.toContain('Completed');
  });

  it('keeps an uncertain dispatch visibly pending and warns against repeating it', () => {
    const result = pending('unknown'); result.computer_execution.status = 'unknown';
    const html = renderToStaticMarkup(<ComputerExecutionView execution={computerExecutionOf(result)} />);
    expect(html).toContain('Do not repeat this job');
    expect(html).toContain(JOB);
  });

  it('shows a correlated terminal receipt and actual observation separately from pending prose', () => {
    const result = { computer_execution: { contract: 'firbo-worker-execution/v1', status: 'completed', verified_success: true,
      jobs: [{ ...pending().computer_execution.jobs[0], status: 'done', result: { completed: true, summary: 'Observed the requested app.' }, receipt: {
        contract: 'firbo-execution-receipt/v1', job_id: JOB, device_id: DEVICE, kind: 'desktop_task', ok: true, report_sha256: 'a'.repeat(64),
      } }] } };
    const html = renderToStaticMarkup(<ComputerExecutionView execution={computerExecutionOf(result)} />);
    expect(html).toContain('Completed');
    expect(html).toContain('Confirmed receipt');
    expect(html).toContain('Observed the requested app.');
    expect(html).toContain('aaaaaaaaaaaa');
  });

  it('does not fabricate a progress or receipt panel from absent evidence', () => {
    expect(renderToStaticMarkup(<ComputerExecutionView execution={null} />)).toBe('');
  });
});
