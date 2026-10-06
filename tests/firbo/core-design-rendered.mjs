// Actual CoreOrb/controls in Chromium; only localhost assets and synthetic voice.
// Start frontend Vite on port 5218 before running. Never calls providers or jobs.
import assert from 'node:assert/strict';
import { chromium } from '../../tools/firbo-browser-runtime/node_modules/playwright/index.mjs';
import { mkdir } from 'node:fs/promises';

const origin = 'http://127.0.0.1:5218';
const evidence = '/tmp/firbo-core-evidence';
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await page.goto(`${origin}/scene-test.html`);
    await page.evaluate(() => { document.getElementById('r').style.width = '100vw'; });
    const mode = page.locator('[data-core-mode]');
    await page.getByRole('button', { name: 'Pause animation', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[data-core-mode]')?.dataset.coreMode === 'static');
    assert.equal(await page.locator('canvas').count(), 0, 'paused graphics must release Canvas');
    assert.equal(await page.locator('.fb-ring-fallback span').first().evaluate(el => { const s = getComputedStyle(el); return s.animationName === 'none' || s.animationPlayState === 'paused'; }), true, 'manual pause must stop fallback motion');
    await page.evaluate(async () => {
      const { beginVoiceTurn } = await import('/src/lib/company/voiceActivity.ts');
      beginVoiceTurn().phase('listening', 'microphone');
    });
    await page.getByRole('status').filter({ hasText: 'Microphone on. Speak now.' }).waitFor();
    await page.screenshot({ path: `${evidence}/core-${viewport.width}-paused.png` });
    assert.equal(await mode.getAttribute('data-core-mode'), 'static');
    await page.getByRole('button', { name: 'Resume animation', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[data-core-mode]')?.dataset.coreMode !== 'static');
    const light = page.getByRole('button', { name: 'Lightweight graphics', exact: true });
    if (await light.getAttribute('aria-pressed') === 'false') await light.click();
    assert.equal(await light.getAttribute('aria-pressed'), 'true');
    assert.equal(await mode.getAttribute('data-core-mode'), 'lightweight');
    await page.locator('canvas').waitFor({ state: 'visible' });
    await page.waitForLoadState('networkidle');
    const canvasBox = await page.locator('canvas').boundingBox();
    assert.ok(canvasBox && canvasBox.height >= 600 && canvasBox.width >= viewport.width - 1, 'actual positioned core must have a full-size canvas');
    await page.screenshot({ path: `${evidence}/core-${viewport.width}-lightweight.png` });
    // Graphics-only changes must preserve the real in-memory microphone phase.
    assert.equal(await page.evaluate(async () => (await import('/src/lib/company/voiceActivity.ts')).getVoiceSnapshot().phase), 'listening');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForFunction(() => document.querySelector('[data-core-mode]')?.dataset.coreMode === 'static');
    assert.equal(await page.getByRole('button', { name: 'Pause animation', exact: true }).isDisabled(), true);
    assert.equal(await page.locator('canvas').count(), 0);
    assert.equal(await page.locator('.fb-ring-fallback span').first().evaluate(el => { const s = getComputedStyle(el); return s.animationName === 'none' || s.animationPlayState === 'paused'; }), true, 'reduced motion must stop fallback motion');
    const boxes = await page.getByRole('button').evaluateAll(elements => elements.map(el => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right }; }));
    assert.ok(boxes.every(box => box.left >= 0 && box.right <= viewport.width), 'controls must fit viewport');
    assert.deepEqual(errors, []);
    console.log(`PASS actual core controls ${viewport.width}px: pause/resume, lightweight, voice independence, reduced motion, bounds`);
    await context.close();
  }
} finally { await browser.close(); }
