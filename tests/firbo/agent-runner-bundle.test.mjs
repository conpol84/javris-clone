import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const gate = join(root, 'tools/firbo-runner-bundle.mjs');
const run = (args = [], env = {}) => spawnSync(process.execPath, [gate, ...args], {
  cwd: root, encoding: 'utf8', env: { ...process.env, ...env },
});

test('manifest covers the exact complete 17-file runner import closure', () => {
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { ok: true, files: 17, manifest: 'deploy/firbo-agent-runner-bundle.json' });
});

test('actual entrypoint links every required named export without a provider call', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'firbo-runner-link-'));
  const source = await readFile(join(root, 'supabase/functions/agent-runner/index.ts'), 'utf8');
  const code = source
    .replace("import { createClient } from 'npm:@supabase/supabase-js@2';", 'const createClient = () => { throw new Error("not invoked"); };')
    .replace(/'\.\.\/_shared\/([a-z-]+\.ts)'/g, (_match, file) => JSON.stringify(pathToFileURL(join(root, 'supabase/functions/_shared', file)).href));
  let handler;
  globalThis.Deno = { env: { get: () => undefined }, serve: value => { handler = value; } };
  globalThis.fetch = () => { throw new Error('provider transport must not run while linking'); };
  try {
    const path = join(dir, 'index.ts');
    await writeFile(path, code);
    await import(`${pathToFileURL(path).href}?gate=${Date.now()}`);
    assert.equal(typeof handler, 'function');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('live read-back must match every byte and cannot omit a shared dependency', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'firbo-runner-live-'));
  try {
    const manifest = JSON.parse(await readFile(join(root, 'deploy/firbo-agent-runner-bundle.json'), 'utf8'));
    const files = await Promise.all(manifest.files.map(async item => ({
      name: item.path, content: await readFile(join(root, item.source_path), 'utf8'),
    })));
    const good = join(dir, 'good.json');
    await writeFile(good, JSON.stringify({ files }));
    assert.equal(run(['--live-bundle', good]).status, 0);

    for (const dependency of ['_shared/free-search.ts', '_shared/page-egress.ts']) {
      const missing = join(dir, `missing-${dependency.split('/').at(-1)}.json`);
      await writeFile(missing, JSON.stringify({ files: files.filter(item => item.name !== dependency) }));
      const result = run(['--live-bundle', missing]);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, new RegExp(`missing=${dependency.replace('.', '\\.')}`));
    }

    const duplicate = join(dir, 'duplicate.json');
    await writeFile(duplicate, JSON.stringify({ files: [...files, files[0]] }));
    const duplicateResult = run(['--live-bundle', duplicate]);
    assert.notEqual(duplicateResult.status, 0);
    assert.match(duplicateResult.stderr, /duplicate paths/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('release mode requires reviewed positive billed pricing equal to runtime configuration', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'firbo-runner-price-'));
  const config = join(dir, 'pricing.json');
  await writeFile(config, JSON.stringify({
    route: 'https://gateway.firboai.app/v1/chat/completions',
    model: 'synthetic-ci-model',
    price_in_per_m: 2,
    price_out_per_m: 4,
    max_output_tokens: 4096,
    evidence: 'synthetic CI contract fixture',
    verified_at: '2026-10-07T00:00:00Z',
  }));
  try {
    const missing = run(['--release-config', config]);
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /runtime pricing environment is incomplete/);
    const mismatch = run(['--release-config', config], {
      FIRBO_SERVER_PRICE_IN_PER_M: '0', FIRBO_SERVER_PRICE_OUT_PER_M: '4', FIRBO_SERVER_MAX_OUTPUT_TOKENS: '4096',
    });
    assert.notEqual(mismatch.status, 0);
    assert.match(mismatch.stderr, /does not match/);
    const accepted = run(['--release-config', config], {
      FIRBO_SERVER_PRICE_IN_PER_M: '2', FIRBO_SERVER_PRICE_OUT_PER_M: '4', FIRBO_SERVER_MAX_OUTPUT_TOKENS: '4096',
    });
    assert.equal(accepted.status, 0, accepted.stderr);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
