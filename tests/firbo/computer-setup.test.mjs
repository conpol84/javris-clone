import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { connectorCommands, suggestedComputerPlatform } from '../../frontend/src/lib/company/computer-setup.ts';
import { computerSetupLabels } from '../../frontend/src/lib/company/computer-setup-labels.ts';
import { formatComputerResult } from '../../frontend/src/lib/company/computer-state.ts';

test('Mac download commands work from another folder and a home path with spaces', async () => {
  const home = await mkdtemp(join(tmpdir(), 'firbo setup '));
  try {
    await mkdir(join(home, 'Downloads'));
    await writeFile(join(home, 'Downloads', 'firbo-connector.mjs'), 'console.log(JSON.stringify(process.argv.slice(2)));');
    const command = connectorCommands('mac', 'browser', 'ABCD2345');
    for (const [line, expected] of [[command.pair, ['pair', 'ABCD2345', '--allow-browser']], [command.run, ['run']], [command.status, ['status']], [command.allowBrowser, ['allow-browser']]]) {
      const result = spawnSync('bash', ['-c', line], { cwd: tmpdir(), env: { ...process.env, HOME: home }, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout), expected);
    }
  } finally { await rm(home, { recursive: true, force: true }); }
});

test('read-only Documents option cannot enable file writing or shell execution', () => {
  const command = connectorCommands('mac', 'files', 'ABCD2345').pair;
  assert.equal(command, 'node "$HOME/Downloads/firbo-connector.mjs" pair ABCD2345 --allow "$HOME/Documents" --allow-browser');
  assert.ok(!command.includes('--allow-write'));
  assert.ok(!command.includes('--allow-exec'));
});

test('advanced permissions are explicit and Windows uses quoted PowerShell paths', () => {
  assert.equal(connectorCommands('windows', 'advanced', 'ABCD2345').pair,
    'node "$env:USERPROFILE\\Downloads\\firbo-connector.mjs" pair ABCD2345 --allow "$env:USERPROFILE\\Documents" --allow-browser --allow-write --allow-exec');
});

test('untrusted pairing text cannot turn the copyable command into a shell command', () => {
  for (const code of ['ABCD2345;id', '$(id)', 'ABCD\n2345', 'ABCD2345`id`', 'abcd2345']) {
    assert.throws(() => connectorCommands('mac', 'browser', code), /invalid_pairing_code/);
  }
  assert.equal(connectorCommands('linux', 'browser').pair, null);
});

test('website platform is a suggestion and phone defaults can be changed to a target computer', () => {
  assert.equal(suggestedComputerPlatform('MacIntel'), 'mac');
  assert.equal(suggestedComputerPlatform('Win32'), 'windows');
  assert.equal(suggestedComputerPlatform('Linux x86_64'), 'linux');
  assert.equal(suggestedComputerPlatform('iPhone'), 'mac');
  assert.equal(suggestedComputerPlatform('Android'), 'mac');
});

test('setup instructions are complete in all eight existing languages', () => {
  const keys = Object.keys(computerSetupLabels.en).sort();
  assert.equal(Object.keys(computerSetupLabels).length, 8);
  for (const labels of Object.values(computerSetupLabels)) {
    assert.deepEqual(Object.keys(labels).sort(), keys);
    assert.ok(Object.values(labels).every(v => typeof v === 'string' && v.trim()));
  }
});

test('browser result exposes the returned launch evidence rather than an empty shell result', () => {
  const result = { launched: true, url: 'https://example.com/', platform: 'darwin' };
  assert.deepEqual(JSON.parse(formatComputerResult({ kind: 'browser_open', result })), result);
});
