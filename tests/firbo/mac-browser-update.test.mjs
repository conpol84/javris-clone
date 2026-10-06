import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

test('downloadable Mac updater matches reviewed source and pins served runtime bytes', () => {
  const asset = readFileSync(new URL('../../frontend/public/FIRBO-Mac-Browser-Update.command', import.meta.url), 'utf8');
  assert.equal(asset, readFileSync(new URL('../../tools/mac/FIRBO-Mac-Browser-Update.command', import.meta.url), 'utf8'));
  for (const file of ['firbo-connector.mjs', 'firbo-browser.mjs']) {
    const bytes = readFileSync(new URL(`../../frontend/public/${file}`, import.meta.url));
    assert.ok(asset.includes(`${createHash('sha256').update(bytes).digest('hex')}  ${file}`));
  }
});
