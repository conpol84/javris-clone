#!/usr/bin/env node
// Firbo Connector: lets your Firbo AI team work on THIS computer, only as far as you allow.
//
//   node firbo-connector.mjs pair ABCD2345 --allow ~/Projects            (read-only: list and read files)
//   node firbo-connector.mjs pair ABCD2345 --allow ~/Projects --allow-write --allow-exec
//   node firbo-connector.mjs run                                         (keep this window open)
//   node firbo-connector.mjs status | forget
//
// Safety rules enforced HERE, on your computer, whatever the server asks:
//   - only folders you pass with --allow are ever touched (symlinks and ../ tricks are resolved first)
//   - writing files needs --allow-write, running commands needs --allow-exec; without them those jobs are refused
//   - unless you pass --auto, every write and command waits for your y/n in this window
//   - nothing is installed, nothing listens on your network: this program only calls Firbo and asks for jobs
// Needs Node.js 18 or newer. No other packages.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const API = process.env.FIRBO_CONNECTOR_URL || 'https://bfeinnsorgjycivozcau.supabase.co/functions/v1/connector';
const ANON = process.env.FIRBO_CONNECTOR_KEY || 'sb_publishable_tKMs6ANU1ywiwomvd-7wUg_hln8qSeu';
const CONFIG = process.env.FIRBO_CONNECTOR_CONFIG || path.join(os.homedir(), '.firbo-connector.json');
const MAX_READ = 200_000;
const MAX_LIST = 200;
const MAX_OUT = 20_000;

const expand = (p) => (p === '~' ? os.homedir() : p.startsWith('~/') || p.startsWith('~\\') ? path.join(os.homedir(), p.slice(2)) : p);
const fold = (p) => (process.platform === 'win32' || process.platform === 'darwin' ? p.toLowerCase() : p);

/** Resolve `target` and make sure it is inside one of `roots`. Existing parts are resolved through symlinks. */
export async function resolveAllowed(target, roots) {
  if (!roots.length) throw new Error('no_folder_allowed');
  const real = [];
  for (const r of roots) {
    try {
      real.push(await fs.realpath(path.resolve(expand(r))));
    } catch {
      /* a root that does not exist can never match */
    }
  }
  let abs = path.resolve(real[0] ?? '.', expand(target || '.'));
  if (path.isAbsolute(expand(target || ''))) abs = path.resolve(expand(target));
  // Resolve symlinks of the longest existing prefix, then re-attach the rest.
  let head = abs;
  const tail = [];
  for (;;) {
    try {
      head = await fs.realpath(head);
      break;
    } catch {
      const parent = path.dirname(head);
      if (parent === head) break;
      tail.unshift(path.basename(head));
      head = parent;
    }
  }
  const finalPath = path.join(head, ...tail);
  const ok = real.some((r) => fold(finalPath) === fold(r) || fold(finalPath).startsWith(fold(r.endsWith(path.sep) ? r : r + path.sep)));
  if (!ok) throw new Error('outside_allowed_folders');
  return finalPath;
}

async function confirmLocally(cfg, question) {
  if (cfg.auto) return true;
  if (!process.stdin.isTTY) return false;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve('n'), 60_000);
    rl.question(`${question} [y/N] `, (a) => {
      clearTimeout(timer);
      resolve(a);
    });
  });
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

export async function runJob(job, cfg) {
  const roots = cfg.roots ?? [];
  const p = job.params ?? {};
  if (job.kind === 'list') {
    const dir = await resolveAllowed(p.path || roots[0], roots);
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const out = [];
    for (const e of entries.slice(0, MAX_LIST)) {
      let size = null;
      if (e.isFile()) size = (await fs.stat(path.join(dir, e.name)).catch(() => null))?.size ?? null;
      out.push({ name: e.name, type: e.isDirectory() ? 'dir' : e.isFile() ? 'file' : 'other', size });
    }
    return { path: dir, entries: out, truncated: entries.length > MAX_LIST };
  }
  if (job.kind === 'read') {
    const file = await resolveAllowed(p.path, roots);
    const st = await fs.stat(file);
    if (!st.isFile()) throw new Error('not_a_file');
    if (st.size > MAX_READ) throw new Error('file_too_large');
    const buf = await fs.readFile(file);
    if (buf.includes(0)) throw new Error('binary_file');
    return { path: file, content: buf.toString('utf8').slice(0, 100_000), bytes: st.size };
  }
  if (job.kind === 'write') {
    if (!cfg.allowWrite) throw new Error('writing_disabled');
    const file = await resolveAllowed(p.path, roots);
    const exists = await fs.stat(file).then(() => true, () => false);
    if (exists && !p.overwrite) throw new Error('file_exists');
    if (!(await confirmLocally(cfg, `Firbo wants to ${exists ? 'OVERWRITE' : 'create'} ${file} (${String(p.content ?? '').length} characters). Allow?`))) throw new Error('declined_on_this_computer');
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, String(p.content ?? ''), 'utf8');
    return { path: file, written: String(p.content ?? '').length };
  }
  if (job.kind === 'exec') {
    if (!cfg.allowExec) throw new Error('commands_disabled');
    const cwd = await resolveAllowed(p.cwd || roots[0], roots);
    const command = String(p.command ?? '');
    if (!(await confirmLocally(cfg, `Firbo wants to run in ${cwd}:\n    ${command}\n  Allow?`))) throw new Error('declined_on_this_computer');
    return await new Promise((resolve) => {
      const child = spawn(command, { shell: true, cwd, timeout: 60_000 });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => (stdout = (stdout + d).slice(-MAX_OUT)));
      child.stderr.on('data', (d) => (stderr = (stderr + d).slice(-MAX_OUT)));
      child.on('error', (e) => resolve({ code: -1, stdout, stderr: `${stderr}${e.message}` }));
      child.on('close', (code) => resolve({ code, stdout, stderr }));
    });
  }
  throw new Error('unknown_job');
}

async function call(action, body) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: ANON },
    body: JSON.stringify({ action, ...body }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json.error || `http_${res.status}`), { status: res.status });
  return json;
}

async function loadConfig() {
  try {
    return JSON.parse(await fs.readFile(CONFIG, 'utf8'));
  } catch {
    return null;
  }
}

export function parseArgs(argv) {
  const out = { _: [], allow: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--allow') out.allow.push(argv[++i]);
    else if (a === '--allow-write') out.allowWrite = true;
    else if (a === '--allow-exec') out.allowExec = true;
    else if (a === '--auto') out.auto = true;
    else out._.push(a);
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [cmd, arg] = args._;
  if (cmd === 'pair') {
    if (!arg) throw new Error('Usage: node firbo-connector.mjs pair <CODE> --allow <folder> [--allow-write] [--allow-exec]');
    const res = await call('pair', { code: arg, platform: `${os.platform()} ${os.arch()}` });
    const roots = [];
    for (const r of args.allow) roots.push(await fs.realpath(path.resolve(expand(r))));
    const cfg = { token: res.token, roots, allowWrite: !!args.allowWrite, allowExec: !!args.allowExec, auto: !!args.auto };
    await fs.writeFile(CONFIG, JSON.stringify(cfg, null, 2), { mode: 0o600 });
    console.log(`Paired as "${res.device_name}".`);
    console.log(roots.length ? `Allowed folders: ${roots.join(', ')}` : 'No folder allowed yet: add --allow <folder> (run pair again with a new code).');
    console.log(`Writing files: ${cfg.allowWrite ? 'allowed' : 'off'}   Running commands: ${cfg.allowExec ? 'allowed' : 'off'}   Ask me each time: ${cfg.auto ? 'no' : 'yes'}`);
    console.log('Now run:  node firbo-connector.mjs run');
    return;
  }
  const cfg = await loadConfig();
  if (cmd === 'forget') {
    await fs.rm(CONFIG, { force: true });
    console.log('Forgotten. Also remove the computer in Firbo → Computers.');
    return;
  }
  if (!cfg) throw new Error('Not paired yet. Get a code in Firbo → Computers, then: node firbo-connector.mjs pair <CODE> --allow <folder>');
  if (cmd === 'status') {
    console.log(JSON.stringify({ ...cfg, token: '(hidden)' }, null, 2));
    return;
  }
  if (cmd !== 'run') throw new Error('Commands: pair <CODE> | run | status | forget');
  console.log(`Firbo Connector running. Folders: ${cfg.roots.join(', ') || '(none)'}. Press Ctrl+C to stop.`);
  let wait = 2000;
  for (;;) {
    try {
      const { job } = await call('poll', { token: cfg.token });
      wait = 2000;
      if (!job) continue;
      console.log(`[${new Date().toLocaleTimeString()}] job ${job.kind} ${job.params?.path || job.params?.command || ''}`);
      let report;
      try {
        report = { ok: true, result: await runJob(job, cfg) };
      } catch (e) {
        report = { ok: false, error: e instanceof Error ? e.message : 'failed' };
      }
      console.log(`   ${report.ok ? 'done' : `refused/failed: ${report.error}`}`);
      await call('report', { token: cfg.token, job_id: job.id, ...report });
    } catch (e) {
      if (e && e.status === 401) {
        console.error('This computer was removed in Firbo. Stopping.');
        process.exit(1);
      }
      console.error(`connection problem (${e.message}); retrying in ${Math.round(wait / 1000)}s`);
      await new Promise((r) => setTimeout(r, wait));
      wait = Math.min(wait * 2, 60_000);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
