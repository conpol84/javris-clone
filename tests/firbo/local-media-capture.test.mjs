import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import http from 'node:http';
import { captureController, startLocalCapture } from '../../frontend/public/firbo-media.mjs';

function harness(extra = {}) {
  const state = [], uploads = [], timers = [];
  let stopped = 0, permissionCalls = 0;
  const stream = { getTracks: () => [{ stop() { stopped++; } }] };
  const recorder = { state: 'inactive', mimeType: 'audio/webm',
    start() { this.state = 'recording'; },
    stop() { this.state = 'inactive'; this.onstop?.(); } };
  const controller = captureController({ getUserMedia: async () => { permissionCalls++; return stream; },
    createRecorder: () => recorder, upload: async blob => uploads.push(blob),
    onState: value => state.push(value), schedule: fn => { timers.push(fn); return timers.length; }, unschedule: () => {}, ...extra });
  return { controller, state, uploads, timers, recorder, stream, get stopped() { return stopped; }, get permissionCalls() { return permissionCalls; } };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
test('no access before explicit start; finite completion stops tracks and uploads once', async () => {
  const h = harness(); assert.equal(h.permissionCalls, 0);
  await h.controller.start({ microphone: true });
  assert.equal(h.permissionCalls, 1); assert.deepEqual(h.state, ['permission','recording']);
  h.recorder.ondataavailable({ data: new Blob(['audio']) }); h.timers[0](); await tick();
  assert.equal(h.stopped, 1); assert.equal(h.uploads.length, 1); assert.equal(h.state.at(-1), 'saved');
  await assert.rejects(h.controller.start({ camera: true }), /session_used/);
});
test('cancel pending permission stops a late-granted stream without recording', async () => {
  let grant; const h = harness({ getUserMedia: () => new Promise(resolve => { grant = resolve; }) });
  const pending = h.controller.start({ camera: true }); h.controller.cancel(); grant(h.stream); await pending;
  assert.equal(h.stopped, 1); assert.equal(h.recorder.state, 'inactive'); assert.equal(h.uploads.length, 0);
});
test('Stop discards buffered data; over-limit data also stops and never uploads', async () => {
  for (const oversized of [false,true]) {
    const h = harness({ maxBytes: 4 }); await h.controller.start({ microphone: true });
    h.recorder.ondataavailable({ data: new Blob([oversized ? '12345' : '123']) });
    if (!oversized) h.controller.cancel(); await tick();
    assert.equal(h.uploads.length, 0); assert.ok(h.stopped >= 1); assert.equal(h.state.at(-1), 'cancelled');
  }
});
test('permission denial and recorder constructor failure stop without upload', async () => {
  const denial = harness({ getUserMedia: async () => { throw new Error('NotAllowedError'); } });
  await assert.rejects(denial.controller.start({ camera: true })); assert.equal(denial.uploads.length, 0);
  const failure = harness({ createRecorder: () => { throw new Error('unsupported'); } });
  await assert.rejects(failure.controller.start({ microphone: true })); assert.equal(failure.stopped, 1);
});
test('invalid selection or limits cannot open hardware', async () => {
  const h = harness(); await assert.rejects(h.controller.start({}), /select_media/); assert.equal(h.permissionCalls, 0);
  assert.throws(() => harness({ durationMs: 15001 }), /invalid_limits/);
  assert.throws(() => harness({ maxBytes: 8388609 }), /invalid_limits/);
});

async function session(t, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'firbo-test-media-'));
  const s = await startLocalCapture({ directory: root, ...options });
  t.after(async () => { await s.close(); await fs.rm(root, { recursive: true, force: true }); });
  const token = s.url.split('/').at(-1);
  const headers = { Authorization: 'Bearer ' + token, Origin: s.origin, 'Content-Type': 'audio/webm' };
  return { ...s, headers, root };
}
const webm = Buffer.from('1a45dfa300000000000000000000', 'hex');
test('real loopback refuses remote origins and missing tokens; page has no automatic start', async t => {
  const s = await session(t);
  assert.equal((await fetch(s.origin + '/alive')).status, 401);
  assert.equal((await fetch(s.url, { headers: { Origin: 'https://evil.invalid' } })).status, 403);
  assert.equal((await fetch(s.origin + '/capture', { method: 'POST', headers: { ...s.headers, Origin: 'https://evil.invalid' }, body: webm })).status, 403);
  const page = await fetch(s.url); assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.match(await page.text(), /start.onclick/); assert.equal(s.getArtifact(), null);
});
test('real loopback saves bounded media once and independent bytes/hash match', async t => {
  const s = await session(t);
  const response = await fetch(s.origin + '/capture', { method: 'POST', headers: s.headers, body: webm });
  assert.equal(response.status, 200); const receipt = await response.json();
  const observed = await fs.readFile(receipt.path); assert.deepEqual(observed, webm);
  assert.equal(receipt.sha256, createHash('sha256').update(observed).digest('hex'));
  if (process.platform !== 'win32') assert.equal((await fs.stat(receipt.path)).mode & 0o777, 0o600);
  assert.equal((await fetch(s.origin + '/capture', { method: 'POST', headers: s.headers, body: webm })).status, 409);
});
test('explicit authenticated cancellation removes saved media and denies late uploads', async t => {
  const s = await session(t);
  const saved = await fetch(s.origin + '/capture', { method: 'POST', headers: s.headers, body: webm }); const receipt = await saved.json();
  assert.equal((await fetch(s.origin + '/cancel', { method: 'POST', headers: s.headers })).status, 200);
  await assert.rejects(fs.stat(receipt.path), { code: 'ENOENT' }); assert.equal(s.getArtifact(), null);
  assert.equal((await fetch(s.origin + '/capture', { method: 'POST', headers: s.headers, body: webm })).status, 410);
});
test('invalid media/container never creates an artifact', async t => {
  const s = await session(t);
  assert.equal((await fetch(s.origin + '/capture', { method: 'POST', headers: s.headers, body: Buffer.alloc(16) })).status, 400);
  assert.equal(s.getArtifact(), null);
});
test('missing Origin and unauthorized cancellation do not admit capture or stop session', async t => {
  const s = await session(t);
  assert.equal((await fetch(s.origin + '/cancel', { method: 'POST', headers: { Origin: s.origin } })).status, 401);
  const { Origin, ...withoutOrigin } = s.headers;
  assert.equal((await fetch(s.origin + '/capture', { method: 'POST', headers: withoutOrigin, body: webm })).status, 403);
  assert.equal((await fetch(s.origin + '/alive', { headers: s.headers })).status, 200);
});
test('cancellation while actual HTTP upload is pending cannot publish late bytes', async t => {
  const s = await session(t);
  const request = http.request(s.origin + '/capture', { method: 'POST', headers: { ...s.headers, 'Content-Length': webm.length } });
  request.on('error', () => {});
  request.write(webm.subarray(0,4));
  await tick();
  assert.equal((await fetch(s.origin + '/cancel', { method: 'POST', headers: s.headers })).status, 200);
  const result = new Promise(resolve => request.on('response', response => { response.resume(); response.on('end', () => resolve(response.statusCode)); }));
  request.end(webm.subarray(4));
  assert.equal(await result, 400); assert.equal(s.getArtifact(), null);
});
test('symlink folder rejected and close before upload leaves no session directory', async t => {
  const s = await session(t); await s.close(); assert.deepEqual(await fs.readdir(s.root), []);
  if (process.platform === 'win32') return;
  const link = s.root + '-link'; await fs.symlink(s.root, link); t.after(() => fs.unlink(link));
  await assert.rejects(startLocalCapture({ directory: link }), /unsafe_directory/);
});
