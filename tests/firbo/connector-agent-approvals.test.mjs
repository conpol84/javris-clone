// An employee's computer step that waited in the Inbox becomes a real job once the owner approves it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeHandler, ORG, DEVICE } from './helpers/connector-handler.mjs';

const OWNER = '44444444-4444-4444-8444-444444444444';
const APPROVAL = '55555555-5555-4555-8555-555555555555';
const plan = [{ action: 'open', url: 'https://example.com/' }, { action: 'read' }];

async function setup(action, payload, jobKinds = ['list', 'browser_task']) {
  const h = await makeHandler();
  h.state.user = { id: OWNER };
  h.state.rows.organization_members.push({ organization_id: ORG, user_id: OWNER, role: 'owner' });
  h.state.rows.connector_devices[0].capabilities = { job_kinds: jobKinds };
  h.state.rows.approvals = [{ id: APPROVAL, organization_id: ORG, task_id: null, action, status: 'pending',
    payload: { ...payload, device_id: DEVICE, device_name: 'Mac', reason: 'employee_must_ask', ai_generated: true, disclosure: 'AI' } }];
  return h;
}
const approve = h => h.invoke({ action: 'decide_execution', approval_id: APPROVAL, decision: 'approved', device_id: DEVICE });

test('an approved browser plan is sent with only its steps, never the bookkeeping fields', async () => {
  const h = await setup('computer_browser_task', { steps: plan });
  await approve(h);
  assert.equal(h.state.decisions.length, 1);
  assert.equal(h.state.decisions[0].p_kind, 'browser_task');
  assert.deepEqual(h.state.decisions[0].p_params, { steps: plan, timeout_ms: 120000 });
});

test('a browser plan is not approved onto a computer whose owner has not turned browser control on there', async () => {
  const h = await setup('computer_browser_task', { steps: plan }, ['list']);
  const res = await approve(h);
  assert.equal(res.status, 409);
  assert.equal(h.state.decisions, undefined);
});

test('a broken browser plan cannot be approved', async () => {
  const h = await setup('computer_browser_task', { steps: [{ action: 'click', selector: 'a' }] });
  const res = await approve(h);
  assert.equal(res.status, 422);
  assert.equal(h.state.decisions, undefined);
});

test('approved app and Shortcut steps keep only the name', async () => {
  const h = await setup('computer_open_app', { app: 'Numbers' });
  await approve(h);
  assert.deepEqual([h.state.decisions[0].p_kind, h.state.decisions[0].p_params], ['open_app', { app: 'Numbers' }]);
  const s = await setup('computer_shortcut', { name: 'Daily backup' });
  await approve(s);
  assert.deepEqual([s.state.decisions[0].p_kind, s.state.decisions[0].p_params], ['shortcut', { name: 'Daily backup' }]);
});
