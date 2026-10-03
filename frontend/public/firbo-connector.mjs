#!/usr/bin/env node
// Firbo Connector: lets your Firbo AI team work on THIS computer, only as far as you allow.
//
//   node firbo-connector.mjs pair ABCD2345 --allow ~/Projects            (read-only: list and read files)
//   node firbo-connector.mjs pair ABCD2345 --allow ~/Projects --allow-write --allow-exec
//   node firbo-connector.mjs run                                         (keep this window open)
//   node firbo-connector.mjs status | forget
//
// Safety rules enforced HERE, on your computer, whatever the server asks:
//   - file operations check --allow roots; this is NOT an OS sandbox or a complete filesystem race defense
//   - --allow-exec is a general shell as your local user; its cwd does NOT confine what it can access
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
const MAX_CONTENT = 100_000;
const MAX_RESPONSE = 512 * 1024;
const MAX_REQUEST = 1024 * 1024;
const LOCAL_ERRORS = new Set([
  'bad_job', 'bad_job_params', 'no_folder_allowed', 'outside_allowed_folders',
  'not_a_file', 'file_too_large', 'binary_file', 'writing_disabled', 'file_exists',
  'declined_on_this_computer', 'commands_disabled', 'unknown_job',
]);
const FILE_ERRORS = new Set(['ENOENT', 'EACCES', 'EPERM', 'EEXIST', 'ENOSPC', 'ENOTDIR', 'EISDIR', 'ELOOP']);

/** Validate independently of the server. A job cannot grant its own local powers. */
export function validateJob(job) {
  if (!job || typeof job !== 'object' || Array.isArray(job)) throw new Error('bad_job');
  if (!['list', 'read', 'write', 'exec'].includes(job.kind)) throw new Error('unknown_job');
  const p = job.params ?? {};
  if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Error('bad_job_params');
  const validPath = value => value === undefined || (typeof value === 'string' && value.length <= 500 && !value.includes('\0'));
  if (!validPath(p.path) || !validPath(p.cwd)) throw new Error('bad_job_params');
  if (['read', 'write'].includes(job.kind) && (typeof p.path !== 'string' || !p.path.trim())) throw new Error('bad_job_params');
  if (job.kind === 'write' && (typeof p.content !== 'string' || p.content.length > MAX_CONTENT || (p.overwrite !== undefined && typeof p.overwrite !== 'boolean'))) throw new Error('bad_job_params');
  if (job.kind === 'exec' && (typeof p.command !== 'string' || !p.command.trim() || p.command.length > 500 || p.command.includes('\0'))) throw new Error('bad_job_params');
  return p;
}

function safeLocalError(error) {
  if (LOCAL_ERRORS.has(error?.message)) return error.message;
  if (FILE_ERRORS.has(error?.code)) return `file_${error.code.toLowerCase()}`;
  return 'local_operation_failed';
}

/** Success means a completed operation, not merely a resolved Promise.
 * A zero process exit is NOT proof of the user's higher-level business goal.
 */
export async function executeJobForReport(job, cfg) {
  try {
    const result = await runJob(job, cfg);
    if (job.kind === 'exec') {
      if (result.signal) return { ok: false, error: 'command_interrupted' };
      if (!Number.isInteger(result.code) || result.code !== 0) {
        const exit = Number.isInteger(result.code) && result.code >= 0 && result.code <= 255 ? `_exit_${result.code}` : '';
        return { ok: false, error: `command_failed${exit}` };
      }
    }
    return { ok: true, result };
  } catch (error) {
    // Do not reflect raw OS paths, command output or arbitrary exception text.
    return { ok: false, error: safeLocalError(error) };
  }
}

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
  if (cfg.auto === true) return true;
  if (!process.stdin.isTTY) return false;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise(resolve => {
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish('n'), 60_000);
    rl.once('close', () => finish('n'));
    rl.question(`${question} [y/N] `, finish);
  });
  rl.close();
  return /^y(es)?$/i.test(String(answer).trim());
}

export async function runJob(job, cfg) {
  const p = validateJob(job);
  if (!cfg || !Array.isArray(cfg.roots) || cfg.roots.some(root => typeof root !== 'string' || !root)) throw new Error('no_folder_allowed');
  const roots = cfg.roots;
  if (job.kind === 'list') {
    const dir = await resolveAllowed(p.path || roots[0], roots);
    const out = [];
    let truncated = false;
    // opendir bounds the retained entries instead of materializing an entire directory.
    for await (const e of await fs.opendir(dir)) {
      if (out.length === MAX_LIST) { truncated = true; break; }
      let size = null;
      if (e.isFile()) size = (await fs.stat(path.join(dir, e.name)).catch(() => null))?.size ?? null;
      out.push({ name: e.name, type: e.isDirectory() ? 'dir' : e.isFile() ? 'file' : 'other', size });
    }
    return { path: dir, entries: out, truncated };
  }
  if (job.kind === 'read') {
    const file = await resolveAllowed(p.path, roots);
    const handle = await fs.open(file, 'r');
    try {
      const st = await handle.stat();
      if (!st.isFile()) throw new Error('not_a_file');
      if (st.size > MAX_READ) throw new Error('file_too_large');
      // Enforce the byte cap during reading, including a file that grows after stat.
      const buf = Buffer.alloc(MAX_READ + 1);
      let count = 0;
      while (count < buf.length) {
        const read = await handle.read(buf, count, buf.length - count, count);
        if (!read.bytesRead) break;
        count += read.bytesRead;
      }
      if (count > MAX_READ) throw new Error('file_too_large');
      const bytes = buf.subarray(0, count);
      if (bytes.includes(0)) throw new Error('binary_file');
      const text = bytes.toString('utf8');
      return { path: file, content: text.slice(0, MAX_CONTENT), bytes: count, truncated: text.length > MAX_CONTENT };
    } finally { await handle.close(); }
  }
  if (job.kind === 'write') {
    if (cfg.allowWrite !== true) throw new Error('writing_disabled');
    const file = await resolveAllowed(p.path, roots);
    const exists = await fs.stat(file).then(() => true, () => false);
    if (exists && !p.overwrite) throw new Error('file_exists');
    if (!(await confirmLocally(cfg, `Firbo wants to ${exists ? 'OVERWRITE' : 'create'} ${file} (${String(p.content ?? '').length} characters). Allow?`))) throw new Error('declined_on_this_computer');
    await fs.mkdir(path.dirname(file), { recursive: true });
    // Exclusive create closes the check/create overwrite race for a non-overwrite job.
    await fs.writeFile(file, p.content, { encoding: 'utf8', flag: p.overwrite === true ? 'w' : 'wx', mode: 0o600 });
    return { path: file, written: p.content.length, bytes: Buffer.byteLength(p.content) };
  }
  if (job.kind === 'exec') {
    if (cfg.allowExec !== true) throw new Error('commands_disabled');
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
      child.on('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
    });
  }
  throw new Error('unknown_job');
}

/** One bounded request; failed report delivery is NOT retried by rerunning work.
 * fetchImpl/timeoutMs are local test seams, never accepted from a remote job.
 */
export async function connectorCall(action, body, { fetchImpl = fetch, timeoutMs } = {}) {
  const limit = action === 'poll' ? 35_000 : 15_000;
  const timeout = timeoutMs ?? limit;
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > limit) throw new Error('invalid_timeout');
  const payload = JSON.stringify({ ...body, action });
  if (Buffer.byteLength(payload) > MAX_REQUEST) throw new Error('connector_request_too_large');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  let reader;
  const cancel = () => { if (reader) void reader.cancel().catch(() => {}); };
  controller.signal.addEventListener('abort', cancel, { once: true });
  try {
    const res = await fetchImpl(API, {
      method: 'POST', redirect: 'error', signal: controller.signal,
      headers: { 'content-type': 'application/json', apikey: ANON }, body: payload,
    });
    if (!res.ok) {
      void res.body?.cancel().catch(() => {});
      throw Object.assign(new Error(`connector_http_${res.status}`), { status: res.status });
    }
    if (!res.headers.get('content-type')?.toLowerCase().includes('application/json') || !res.body) {
      void res.body?.cancel().catch(() => {});
      throw new Error('connector_invalid_response');
    }
    reader = res.body.getReader();
    const chunks = [];
    let size = 0;
    for (;;) {
      const next = await reader.read();
      if (controller.signal.aborted) throw new Error('connector_timeout');
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_RESPONSE) throw new Error('connector_response_too_large');
      chunks.push(Buffer.from(next.value));
    }
    let data;
    try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new Error('connector_invalid_response'); }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('connector_invalid_response');
    return data;
  } catch (error) {
    if (controller.signal.aborted) throw new Error('connector_timeout');
    if (['connector_invalid_response', 'connector_response_too_large'].includes(error?.message) || Number.isInteger(error?.status)) throw error;
    throw new Error('connector_unreachable');
  } finally {
    clearTimeout(timer);
    controller.signal.removeEventListener('abort', cancel);
    if (reader) { void reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
}
const call = connectorCall;

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
    if (a === '--allow') {
      const root = argv[++i];
      if (!root || root.startsWith('--')) throw new Error('missing_allowed_folder');
      out.allow.push(root);
    }
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
    const roots = [];
    for (const r of args.allow) roots.push(await fs.realpath(path.resolve(expand(r))));
    if (!roots.length) throw new Error('no_folder_allowed');
    // Validate local folders before consuming a one-use pairing code.
    const res = await call('pair', { code: arg, platform: `${os.platform()} ${os.arch()}` });
    if (typeof res.token !== 'string' || !/^[a-f0-9]{64}$/.test(res.token)) throw new Error('connector_invalid_response');
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
      const kind = ['list', 'read', 'write', 'exec'].includes(job.kind) ? job.kind : 'unsupported';
      console.log(`[${new Date().toLocaleTimeString()}] job ${kind}`);
      const report = await executeJobForReport(job, cfg);
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
