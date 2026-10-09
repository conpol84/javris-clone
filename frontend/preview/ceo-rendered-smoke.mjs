// Rendered CEO acceptance with SYNTHETIC preview data only. No production auth.
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const origin = 'http://127.0.0.1:5200';
const sizes = [
  ['small-phone', 320, 720],
  ['phone', 390, 844],
  ['tablet', 768, 1024],
  ['desktop', 1280, 800],
];
const failUnless = (condition, message) => { if (!condition) throw Error(message); };
await mkdir('ceo-mobile-artifacts', { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  for (const [name, width, height] of sizes) {
    const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce', locale: 'en-US' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));
    try {
      const result = await page.goto(origin + '/ceo?mockplan=pro', { waitUntil: 'domcontentloaded', timeout: 30000 });
      failUnless(result?.ok(), name + ': HTTP response failure');
      await page.getByRole('heading', { name: 'Talk to your AI CEO' }).waitFor({ timeout: 25000 });
      await page.locator('[data-firbo-voice="ceo"]').waitFor();
      const history = page.locator('[data-ceo-session-history="true"]');
      await history.waitFor();
      const toggle = history.locator('button[aria-expanded]');
      const expected = width >= 1024 ? 'true' : 'false';
      failUnless(await toggle.getAttribute('aria-expanded') === expected, name + ': history default not responsive');
      if (width < 1024) {
        failUnless((await page.locator('#firbo-ceo-history-list').count()) === 0, name + ': mobile collapsed history still mounted');
        await toggle.click();
        failUnless(await page.locator('#firbo-ceo-history-list').isVisible(), name + ': history did not expand');
        await toggle.click();
        failUnless(await toggle.getAttribute('aria-expanded') === 'false', name + ': history did not collapse');
      }
      const composer = page.locator('input[aria-label="Or type to your CEO…"]');
      await composer.waitFor({ timeout: 15000 });
      failUnless(await composer.isEnabled(), name + ': composer unavailable');
      await composer.fill('Synthetic CEO readiness probe');
      failUnless(await composer.inputValue() === 'Synthetic CEO readiness probe', name + ': typing failed');
      failUnless(await page.getByRole('button', { name: 'Send', exact: true }).isEnabled(), name + ': Send disabled');
      const dimensions = await page.evaluate(() => {
        const field = document.querySelector('input[aria-label="Or type to your CEO…"]');
        const rect = field?.getBoundingClientRect();
        return {
          overflow: document.documentElement.scrollWidth - innerWidth,
          inputWidth: rect?.width ?? 0,
          inputLeft: rect?.left ?? -10,
          inputRight: rect?.right ?? 99999,
          transcript: !!document.querySelector('[data-ceo-transcript]'),
        };
      });
      failUnless(dimensions.overflow <= 3, name + ': horizontal overflow ' + JSON.stringify(dimensions));
      failUnless(dimensions.inputWidth >= 100 && dimensions.inputLeft >= -2 && dimensions.inputRight <= width + 3,
        name + ': input clipped ' + JSON.stringify(dimensions));
      failUnless(dimensions.transcript, name + ': transcript not present');
      failUnless(errors.length === 0, name + ': client errors ' + errors.slice(0, 4).join('; '));
      await page.screenshot({ path: 'ceo-mobile-artifacts/' + name + '.png', fullPage: true, animations: 'disabled' });
      console.log('PASS ' + name + ' ' + width + 'x' + height + ' history/composer/layout');
    } catch (err) {
      await page.screenshot({ path: 'ceo-mobile-artifacts/' + name + '-FAILED.png', fullPage: true }).catch(() => {});
      throw err;
    } finally { await context.close(); }
  }
  console.log('Rendered synthetic CEO acceptance complete. Live TTS and authenticated production are separate gates.');
} finally { await browser.close(); }
