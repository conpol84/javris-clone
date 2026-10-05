import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { runJob, launchMac, localCapabilities, validateJob } from '../../frontend/public/firbo-connector.mjs';

const fakeSpawn = (calls, code = 0) => (cmd, args) => { calls.push([cmd, ...args]); const c = new EventEmitter(); setTimeout(() => c.emit('close', code), 1); return c; };

test('opening an app needs the local allow-apps permission', async () => {
  await assert.rejects(runJob({ kind: 'open_app', params: { app: 'Safari' } }, { roots: [] }), /apps_disabled/);
  const calls = [];
  const out = await runJob({ kind: 'open_app', params: { app: 'Safari' } }, { roots: [], allowApps: true },
    { macLauncher: (kind, name) => launchMac(kind, name, { spawnImpl: fakeSpawn(calls), platform: 'darwin' }) });
  assert.deepEqual(out, { app: 'Safari', opened: true });
  assert.deepEqual(calls, [['/usr/bin/open', '-a', 'Safari']]);
});

test('a Shortcut asks locally unless auto is on, and runs without a shell', async () => {
  const calls = [];
  const out = await runJob({ kind: 'shortcut', params: { name: 'Daily backup' } }, { roots: [], allowApps: true, auto: true },
    { macLauncher: (kind, name) => launchMac(kind, name, { spawnImpl: fakeSpawn(calls), platform: 'darwin' }) });
  assert.deepEqual(out, { name: 'Daily backup', ran: true });
  assert.deepEqual(calls, [['/usr/bin/shortcuts', 'run', 'Daily backup']]);
});

test('names that look like paths or options are refused before anything runs', async () => {
  for (const app of ['../../bin/sh', '-a Terminal', '/Applications/Terminal.app', 'x;rm -rf ~']) assert.throws(() => validateJob({ kind: 'open_app', params: { app } }), /invalid_app_name/);
  await assert.rejects(launchMac('open_app', 'Safari', { platform: 'linux' }), /apps_unsupported/);
  await assert.rejects(launchMac('open_app', 'Safari', { spawnImpl: fakeSpawn([], 1), platform: 'darwin' }), /app_open_failed/);
});

test('the computer reports app support and its folders, nothing else', () => {
  const caps = localCapabilities({ roots: ['/Users/me/Documents'], allowApps: true, allowBrowser: true, token: 'secret' });
  assert.ok(caps.job_kinds.includes('browser_open'));
  assert.deepEqual(caps.roots, ['/Users/me/Documents']);
  assert.ok(!JSON.stringify(caps).includes('secret'));
});
