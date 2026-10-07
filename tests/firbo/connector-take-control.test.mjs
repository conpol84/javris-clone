import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { makeHandler, ORG, DEVICE } from './helpers/connector-handler.mjs';

test('owner Take Control disables AI, cancels queued work and requests durable Stop for running work', async () => {
  const { state, invoke } = await makeHandler();
  const owner = randomUUID();
  state.user = { id: owner };
  state.rows.organization_members = [{ organization_id: ORG, user_id: owner, role: 'owner' }];
  state.rows.connector_devices[0].agent_policy = {
    enabled: true, control: 'full', apps: ['Safari'], shortcuts: [], writes: 'auto', commands: 'safe', hours: null,
  };
  const queued = { id: randomUUID(), organization_id: ORG, device_id: DEVICE, kind: 'browser_task', params: {}, status: 'queued', cancel_requested_at: null };
  const running = { id: randomUUID(), organization_id: ORG, device_id: DEVICE, kind: 'browser_task', params: {}, status: 'running', cancel_requested_at: null };
  const done = { id: randomUUID(), organization_id: ORG, device_id: DEVICE, kind: 'read', params: {}, status: 'done', cancel_requested_at: null };
  state.rows.connector_jobs.push(queued, running, done);

  const response = await invoke({ action: 'take_control', device_id: DEVICE });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.policy.enabled, false);
  assert.equal(body.queued_cancelled, 1);
  assert.equal(body.running_stop_requested, 1);

  assert.equal(queued.status, 'cancelled');
  assert.ok(queued.finished_at);
  assert.equal(running.status, 'running');
  assert.match(running.cancel_requested_at, /^\d{4}-\d\d-\d\dT/);
  assert.equal(done.status, 'done');
  assert.equal(state.rows.connector_devices[0].agent_policy.enabled, false);
  assert.equal(state.rows.audit_log.at(-1)?.action, 'connector.take_control');
});

test('Take Control is owner/admin only and does not mutate on viewer request', async () => {
  const { state, invoke } = await makeHandler();
  const viewer = randomUUID();
  state.user = { id: viewer };
  state.rows.organization_members = [{ organization_id: ORG, user_id: viewer, role: 'viewer' }];
  state.rows.connector_devices[0].agent_policy = { enabled: true, control: 'full', apps: [], shortcuts: [], writes: 'auto', commands: 'safe', hours: null };
  const response = await invoke({ action: 'take_control', device_id: DEVICE });
  assert.equal(response.status, 403);
  assert.equal(state.rows.connector_devices[0].agent_policy.enabled, true);
  assert.equal(state.rows.audit_log.length, 0);
});
