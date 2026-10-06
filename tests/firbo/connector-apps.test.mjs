import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { runJob, launchMac, executeJobForReport, localCapabilities, validateJob } from '../../frontend/public/firbo-connector.mjs';

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

// A Shortcut that never ends: the child records whether it was killed.
const hangingSpawn = (killed) => () => { const c = new EventEmitter(); c.kill = sig => { killed.push(sig); setTimeout(() => c.emit('close', null), 1); }; return c; };

test('a Shortcut that runs too long is ended, not left running', async () => {
  const killed = [];
  await assert.rejects(launchMac('shortcut', 'Slow job', { spawnImpl: hangingSpawn(killed), platform: 'darwin', timeoutMs: 20 }), /shortcut_timeout/);
  assert.deepEqual(killed, ['SIGTERM']);
});

test('Stop on the computer ends a running Shortcut at once', async () => {
  const killed = [];
  const stop = new AbortController();
  const running = launchMac('shortcut', 'Slow job', { spawnImpl: hangingSpawn(killed), platform: 'darwin', timeoutMs: 60_000, signal: stop.signal });
  setTimeout(() => stop.abort(), 10);
  await assert.rejects(running, /operation_stopped/);
  assert.deepEqual(killed, ['SIGTERM']);
  await assert.rejects(launchMac('shortcut', 'Slow job', { spawnImpl: hangingSpawn([]), platform: 'darwin', signal: stop.signal }), /operation_stopped/);
});

test('Shortcut Stop waits for close and a late zero exit never becomes success', async () => {
  const stop = new AbortController();
  const child = new EventEmitter(); const kills = [];
  child.kill = sig => { kills.push(sig); return true; };
  let done = false;
  const pending = executeJobForReport({ kind: 'shortcut', params: { name: 'Synthetic task' } },
    { roots: [], allowApps: true, auto: true }, { signal: stop.signal,
      macLauncher: (kind, name, options) => launchMac(kind, name, { ...options, platform: 'darwin', spawnImpl: () => child })
    }).then(result => { done = true; return result; });
  await new Promise(resolve => setTimeout(resolve, 1));
  stop.abort();
  await new Promise(resolve => setTimeout(resolve, 1));
  assert.equal(done, false);
  child.emit('close', 0);
  assert.deepEqual(await pending, { ok: false, error: 'operation_stopped' });
  assert.deepEqual(kills, ['SIGTERM']);
});

test('unconfirmed Shortcut termination escalates then requires review', async () => {
  const child = new EventEmitter(); const kills = [];
  child.kill = sig => { kills.push(sig); return true; };
  const result = await executeJobForReport({ kind: 'shortcut', params: { name: 'Synthetic task' } },
    { roots: [], allowApps: true, auto: true }, {
      macLauncher: (kind, name, options) => launchMac(kind, name, { ...options, platform: 'darwin',
        spawnImpl: () => child, timeoutMs: 5, stopGraceMs: 5 })
    });
  assert.deepEqual(kills, ['SIGTERM', 'SIGKILL']);
  assert.deepEqual(result, { ok: false, error: 'stop_unconfirmed_needs_review' });
  child.emit('close', 0);
});

test('confirmed Shortcut timeout keeps its useful error code in the receipt', async () => {
  const result = await executeJobForReport({ kind: 'shortcut', params: { name: 'Synthetic task' } },
    { roots: [], allowApps: true, auto: true }, {
      macLauncher: (kind, name, options) => launchMac(kind, name, { ...options, platform: 'darwin',
        spawnImpl: hangingSpawn([]), timeoutMs: 5 })
    });
  assert.deepEqual(result, { ok: false, error: 'shortcut_timeout' });
});
