import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { runDurableConnector } from '../../frontend/public/firbo-connector.mjs';
import { makeHandler, TOKEN, ORG, DEVICE } from './helpers/connector-handler.mjs';

test('running owner job records Stop intent and only its paired device can observe it', async () => {
  const { state, invoke } = await makeHandler();
  const jobId = randomUUID();
  state.user = { id: 'synthetic-owner' };
  state.rows.organization_members = [{ organization_id: ORG, user_id: 'synthetic-owner', role: 'owner' }];
  state.rows.connector_jobs.push({
    id: jobId, organization_id: ORG, device_id: DEVICE, created_by: 'synthetic-owner',
    kind: 'browser_task', params: { steps: [] }, status: 'running',
    cancel_requested_at: null, created_at: new Date().toISOString(),
  });

  const requested = await invoke({ action: 'cancel_job', job_id: jobId });
  assert.equal(requested.status, 200);
  assert.deepEqual(await requested.json(), { ok: true, stop_requested: true, duplicate: false });
  assert.match(state.rows.connector_jobs[0].cancel_requested_at, /^\d{4}-\d\d-\d\dT/);
  assert.equal(state.rows.connector_jobs[0].status, 'running');

  const control = await invoke({ action: 'control', token: TOKEN, job_id: jobId });
  assert.equal(control.status, 200);
  const controlBody = await control.json();
  assert.equal(controlBody.stop, true);
  assert.equal(controlBody.terminal, false);
  assert.equal(controlBody.job_id, jobId);

  const duplicate = await invoke({ action: 'cancel_job', job_id: jobId });
  assert.equal(duplicate.status, 200);
  assert.deepEqual(await duplicate.json(), { ok: true, stop_requested: true, duplicate: true });

  state.rows.connector_jobs[0].status = 'done';
  const terminal = await invoke({ action: 'cancel_job', job_id: jobId });
  assert.equal(terminal.status, 409);
});

test('remote Stop aborts actual local work and delivers one durable interruption receipt', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'firbo-remote-stop-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const marker = path.join(root, 'started.txt');
  const worker = path.join(root, 'worker.mjs');
  await fs.writeFile(worker, `import fs from 'node:fs';fs.writeFileSync(${JSON.stringify(marker)},'started');setInterval(()=>{},1000);\n`);

  const jobId = randomUUID();
  const job = { id: jobId, kind: 'exec', params: { cwd: root, command: `"${process.execPath}" "${worker}"` } };
  const actions = [], events = [];
  let sentReport = null, polled = false;

  const callFn = async (action, body) => {
    actions.push(action);
    if (action === 'capabilities') {
      return {
        protocol: 'firbo-connector/v2', report_ack: 'sha256-v1',
        remote_stop: true, running_stop: 'cancel-request-v1',
      };
    }
    if (action === 'poll') {
      if (polled) return { job: null };
      polled = true;
      return { job };
    }
    if (action === 'control') {
      assert.equal(body.job_id, jobId);
      for (let i = 0; i < 100; i++) {
        try { await fs.access(marker); break; } catch { await new Promise(r => setTimeout(r, 10)); }
      }
      await fs.access(marker);
      return { ok: true, job_id: jobId, status: 'running', stop: true, terminal: false };
    }
    if (action === 'report') {
      sentReport = structuredClone(body);
      return { ok: true, job_id: body.job_id, report_sha256: body.report_sha256 };
    }
    throw new Error('unexpected action ' + action);
  };

  const result = await runDurableConnector(
    { token: TOKEN, roots: [root], allowWrite: false, allowExec: true, allowBrowser: false, auto: true },
    { directory: path.join(root, '.state'), callFn, maxJobs: 1, onEvent: event => events.push(event) },
  );

  assert.equal(result.processed, 1);
  assert.equal(sentReport?.ok, false);
  assert.equal(sentReport?.error, 'operation_stopped');
  assert.equal(sentReport?.job_id, jobId);
  assert.ok(actions.includes('control'));
  assert.ok(actions.includes('report'));
  assert.ok(events.includes('remote_stop_received'));
  assert.deepEqual(result.local_states, [{ phase: 'acked', count: 1 }]);
});
