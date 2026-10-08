import { mkdtemp, mkdir, rm, symlink, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM program served from /public
import { parseArgs, resolveAllowed, runJob } from '../../../public/firbo-connector.mjs';

let root = '';
let outside = '';
const cfg = (extra = {}) => ({ roots: [root], allowWrite: false, allowExec: false, auto: true, ...extra });

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'fb-allowed-'));
  outside = await mkdtemp(path.join(tmpdir(), 'fb-outside-'));
  await writeFile(path.join(root, 'a.txt'), 'hello');
  await writeFile(path.join(outside, 'secret.txt'), 'nope');
  await mkdir(path.join(root, 'sub'));
  await symlink(outside, path.join(root, 'link')).catch(() => undefined);
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

describe('firbo connector safety (runs on the user’s computer)', () => {
  it('lists and reads inside the allowed folder', async () => {
    const list = await runJob({ kind: 'list', params: { path: root } }, cfg());
    expect(list.entries.map((e: { name: string }) => e.name)).toContain('a.txt');
    const read = await runJob({ kind: 'read', params: { path: path.join(root, 'a.txt') } }, cfg());
    expect(read.content).toBe('hello');
  });

  it('refuses ../ tricks and symlinks that leave the allowed folder', async () => {
    await expect(resolveAllowed(path.join(root, '..', path.basename(outside), 'secret.txt'), [root])).rejects.toThrow('outside_allowed_folders');
    await expect(runJob({ kind: 'read', params: { path: path.join(root, 'link', 'secret.txt') } }, cfg())).rejects.toThrow('outside_allowed_folders');
  });

  it('refuses everything when no folder was allowed', async () => {
    await expect(runJob({ kind: 'list', params: { path: root } }, { roots: [] })).rejects.toThrow('no_folder_allowed');
  });

  it('refuses writes and commands unless the owner enabled them locally', async () => {
    await expect(runJob({ kind: 'write', params: { path: path.join(root, 'x.txt'), content: 'x' } }, cfg())).rejects.toThrow('writing_disabled');
    await expect(runJob({ kind: 'exec', params: { command: 'echo hi' } }, cfg())).rejects.toThrow('commands_disabled');
  });

  it('writes only inside allowed folders and never overwrites by accident', async () => {
    const file = path.join(root, 'sub', 'new.txt');
    await runJob({ kind: 'write', params: { path: file, content: 'data' } }, cfg({ allowWrite: true }));
    expect(await readFile(file, 'utf8')).toBe('data');
    await expect(runJob({ kind: 'write', params: { path: file, content: 'again' } }, cfg({ allowWrite: true }))).rejects.toThrow('file_exists');
    await expect(runJob({ kind: 'write', params: { path: path.join(outside, 'hack.txt'), content: 'x' } }, cfg({ allowWrite: true }))).rejects.toThrow('outside_allowed_folders');
  });

  it('declines a write or command when the person at the computer says no', async () => {
    await expect(runJob({ kind: 'write', params: { path: path.join(root, 'ask.txt'), content: 'x' } }, cfg({ allowWrite: true, auto: false }))).rejects.toThrow('declined_on_this_computer');
  });

  it('runs an allowed command inside an allowed folder', async () => {
    const res = await runJob({ kind: 'exec', params: { command: 'echo firbo', cwd: root } }, cfg({ allowExec: true }));
    expect(res.code).toBe(0);
    expect(res.stdout).toContain('firbo');
    await expect(runJob({ kind: 'exec', params: { command: 'echo hi', cwd: outside } }, cfg({ allowExec: true }))).rejects.toThrow('outside_allowed_folders');
  });

  it('parses the pairing flags', () => {
    expect(parseArgs(['pair', 'CODE', '--allow', '~/a', '--allow', '/b', '--allow-write'])).toMatchObject({ _: ['pair', 'CODE'], allow: ['~/a', '/b'], allowWrite: true });
  });
});
