import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('downloadable Mac updater matches reviewed source and pins served runtime bytes', () => {
  const asset = readFileSync(new URL('../../frontend/public/FIRBO-Mac-Browser-Update.command', import.meta.url), 'utf8');
  assert.equal(asset, readFileSync(new URL('../../tools/mac/FIRBO-Mac-Browser-Update.command', import.meta.url), 'utf8'));
  for (const file of ['firbo-connector.mjs', 'firbo-browser.mjs']) {
    const bytes = readFileSync(new URL(`../../frontend/public/${file}`, import.meta.url));
    assert.ok(asset.includes(`${createHash('sha256').update(bytes).digest('hex')}  ${file}`));
  }
});

function runUpdater(version, versionExit = 0) {
  const directory = mkdtempSync(join(tmpdir(), 'firbo-mac-preflight-'));
  const home = join(directory, 'home');
  const bin = join(directory, 'bin');
  mkdirSync(home);
  mkdirSync(bin);
  const log = join(directory, 'calls');
  const stub = (name, body) => writeFileSync(join(bin, name), `#!/bin/bash\n${body}\n`, { mode: 0o700 });
  stub('uname', 'echo Darwin');
  stub('sw_vers', 'printf "%s\\n" "$FIRBO_TEST_VERSION"; exit "$FIRBO_TEST_VERSION_EXIT"');
  for (const name of ['node', 'npm', 'curl', 'install', 'mkdir', 'mktemp', 'cp', 'shasum']) {
    stub(name, `echo ${name} >> "$FIRBO_TEST_LOG"; ${name === 'node' ? 'exit 0' : 'exit 91'}`);
  }
  writeFileSync(join(home, '.firbo-connector.json'), 'existing pairing sentinel');
  try {
    const result = spawnSync('/bin/bash', [fileURLToPath(new URL('../../frontend/public/FIRBO-Mac-Browser-Update.command', import.meta.url))], {
      input: 'n\n', encoding: 'utf8', timeout: 5000,
      env: { ...process.env, HOME: home, PATH: `${bin}:/usr/bin:/bin`, FIRBO_TEST_VERSION: version,
        FIRBO_TEST_VERSION_EXIT: String(versionExit), FIRBO_TEST_LOG: log },
    });
    assert.equal(result.error, undefined);
    assert.equal(readFileSync(join(home, '.firbo-connector.json'), 'utf8'), 'existing pairing sentinel');
    assert.deepEqual(readdirSync(home), ['.firbo-connector.json']);
    return { ...result, calls: readdirSync(directory).includes('calls') ? readFileSync(log, 'utf8').trim().split('\n') : [] };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

for (const version of ['10.15.7', '11.7.10', '12.7.6', '13.7']) {
  test(`macOS ${version} stops before any install, download or permission action`, () => {
    const result = runUpdater(version);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /outside the supported FIRBO browser baseline/);
    assert.equal(result.stdout, '');
    assert.deepEqual(result.calls, []);
  });
}

for (const version of ['', '14', '14.bad', '14.0\n10.15', '999.0', '14.0;echo x']) {
  test(`unreadable or malformed macOS version ${JSON.stringify(version)} fails closed`, () => {
    const result = runUpdater(version);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Cannot validate macOS version/);
    assert.deepEqual(result.calls, []);
  });
}

test('failed sw_vers stops before any install or prompt', () => {
  const result = runUpdater('14.0', 1);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Cannot read macOS version/);
  assert.equal(result.stdout, '');
  assert.deepEqual(result.calls, []);
});

for (const version of ['14.0', '14.7.2', '15.0', '26.0']) {
  test(`macOS ${version} reaches existing owner confirmation and respects decline`, () => {
    const result = runUpdater(version);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /Stop the old Connector/);
    assert.deepEqual(result.calls, ['node']);
  });
}
