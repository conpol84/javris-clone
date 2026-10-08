import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { startLocalCapture } from '../../frontend/public/firbo-media.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require(require.resolve('playwright', { paths: [process.env.FIRBO_BROWSER_RUNTIME || path.resolve('tools/firbo-browser-runtime')] }));

async function browserSession(t, durationMs) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'firbo-media-page-'));
  const session = await startLocalCapture({ directory: root, durationMs });
  const browser = await chromium.launch({ channel: 'chromium', headless: true, args: ['--use-fake-device-for-media-stream'] });
  const context = await browser.newContext();
  await context.grantPermissions(['camera', 'microphone'], { origin: session.origin });
  await context.route('**/*', route => route.request().url().startsWith(session.origin + '/') ? route.continue() : route.abort());
  const page = await context.newPage(); const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(session.url);
  t.after(async () => { await browser.close(); await session.close(); await fs.rm(root, { recursive: true, force: true }); });
  return { session, page, errors };
}
test('real Chromium synthetic camera/mic records only after Start and local bytes/hash verify', async t => {
  const { session, page, errors } = await browserSession(t, 2000);
  assert.equal(session.getArtifact(), null);
  await page.getByLabel('Camera', { exact: true }).check(); await page.getByLabel('Microphone', { exact: true }).check();
  await page.getByRole('button', { name: 'Start recording', exact: true }).click();
  try { await page.waitForFunction(() => ['recording','failed','cancelled'].includes(document.getElementById('state').textContent), { timeout: 10000 }); }
  catch (error) { throw new Error('Capture did not start: ' + await page.locator('#state').textContent() + '; ' + JSON.stringify(errors), { cause: error }); }
  assert.equal(await page.locator('#state').textContent(), 'recording', JSON.stringify(errors) + ' ' + await page.locator('#state').getAttribute('data-failure'));
  await page.locator('#preview').evaluate(video => { window.testTracks = video.srcObject.getTracks(); });
  await page.getByRole('status').filter({ hasText: 'Saved locally:' }).waitFor({ timeout: 15000 });
  const artifact = session.getArtifact(); assert.ok(artifact.bytes > 12);
  const bytes = await fs.readFile(artifact.path); assert.equal(createHash('sha256').update(bytes).digest('hex'), artifact.sha256);
  assert.equal(await page.locator('#preview').evaluate(video => video.srcObject), null);
  assert.equal(await page.evaluate(() => window.testTracks.every(track => track.readyState === 'ended')), true);
  assert.deepEqual(errors, []);
});
test('real Chromium synthetic Stop discards capture and closes tracks', async t => {
  const { session, page, errors } = await browserSession(t, 15000);
  await page.getByLabel('Microphone', { exact: true }).check();
  await page.getByRole('button', { name: 'Start recording', exact: true }).click();
  try { await page.waitForFunction(() => ['recording','failed','cancelled'].includes(document.getElementById('state').textContent), { timeout: 10000 }); }
  catch (error) { throw new Error('Capture did not start: ' + await page.locator('#state').textContent() + '; ' + JSON.stringify(errors), { cause: error }); }
  assert.equal(await page.locator('#state').textContent(), 'recording', JSON.stringify(errors) + ' ' + await page.locator('#state').getAttribute('data-failure'));
  await page.locator('#preview').evaluate(video => { window.testTracks = video.srcObject.getTracks(); });
  await page.getByRole('button', { name: 'Stop and discard', exact: true }).click();
  await page.waitForFunction(() => document.getElementById('state').textContent === 'cancelled');
  assert.equal(session.getArtifact(), null); assert.deepEqual(errors, []);
  assert.equal(await page.evaluate(() => window.testTracks.every(track => track.readyState === 'ended')), true);
});
