#!/usr/bin/env node
// Firbo Connector: lets your Firbo AI team work on THIS computer, only as far as you allow.
//
//   node firbo-connector.mjs pair ABCD2345 --allow ~/Projects            (read-only: list and read files)
//   node firbo-connector.mjs pair ABCD2345 --allow-browser                (website/voice may open HTTPS pages)
//   node firbo-connector.mjs pair ABCD2345 --allow ~/Projects --allow-write --allow-exec --allow-browser
//   node firbo-connector.mjs allow-apps                                  (macOS: AI employees may open apps and run your Shortcuts)
//   node firbo-connector.mjs run                                         (keep this window open)
//   node firbo-connector.mjs status | forget
//
// Safety rules enforced HERE, on your computer, whatever the server asks:
//   - file operations check --allow roots; this is NOT an OS sandbox or a complete filesystem race defense
//   - --allow-exec is a general shell as your local user; its cwd does NOT confine what it can access
//   - writing files needs --allow-write, running commands needs --allow-exec; without them those jobs are refused
//   - opening HTTPS pages needs --allow-browser; it never grants file or shell access
//   - opening apps and running Shortcuts (macOS) needs --allow-apps; a Shortcut asks for your y/n unless --auto
//   - unless you pass --auto, every write and command waits for your y/n in this window
//   - nothing is installed, nothing listens on your network: this program only calls Firbo and asks for jobs
// Needs Node.js 22.13+ for durable execution (built-in SQLite). No npm packages.
// Pending results can contain private file content: the local journal is NOT encrypted.
// This CLI is a reviewed candidate, not a signed Desktop installer or an OS sandbox.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { constants as FS } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
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
  'operation_stopped', 'unsafe_file_type', 'write_verification_failed', 'process_spawn_failed', 'reserved_local_path',
  'browser_disabled', 'invalid_browser_url', 'browser_open_failed',
  'apps_disabled', 'apps_unsupported', 'invalid_app_name', 'app_open_failed', 'shortcut_failed',
  'shortcut_timeout', 'stop_unconfirmed_needs_review',
]);
const FILE_ERRORS = new Set(['ENOENT', 'EACCES', 'EPERM', 'EEXIST', 'ENOSPC', 'ENOTDIR', 'EISDIR', 'ELOOP']);

/** Validate independently of the server. A job cannot grant its own local powers. */
export function validateJob(job) {
  if (!job || typeof job !== 'object' || Array.isArray(job)) throw new Error('bad_job');
  if (!['list', 'read', 'write', 'exec', 'browser_open', 'browser_task', 'open_app', 'shortcut', 'desktop_task'].includes(job.kind)) throw new Error('unknown_job');
  const p = job.params ?? {};
  if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Error('bad_job_params');
  const validPath = value => value === undefined || (typeof value === 'string' && value.length <= 500 && !value.includes('\0'));
  if (!validPath(p.path) || !validPath(p.cwd)) throw new Error('bad_job_params');
  if (['read', 'write'].includes(job.kind) && (typeof p.path !== 'string' || !p.path.trim())) throw new Error('bad_job_params');
  if (job.kind === 'write' && (typeof p.content !== 'string' || p.content.length > MAX_CONTENT || (p.overwrite !== undefined && typeof p.overwrite !== 'boolean'))) throw new Error('bad_job_params');
  if (job.kind === 'exec' && (typeof p.command !== 'string' || !p.command.trim() || p.command.length > 4000 || p.command.includes('\0'))) throw new Error('bad_job_params');
  if (job.kind === 'browser_open' && (typeof p.url !== 'string' || !p.url.trim() || p.url.length > 2048 || /[\r\n\0]/.test(p.url))) throw new Error('bad_job_params');
  if (job.kind === 'open_app' && !APP_NAME.test(typeof p.app === 'string' ? p.app : '')) throw new Error('invalid_app_name');
  if (job.kind === 'shortcut' && !APP_NAME.test(typeof p.name === 'string' ? p.name : '')) throw new Error('invalid_app_name');
  return p;
}

// An app or Shortcut name: letters, digits, spaces and a few signs. Never a path, never options.
export const APP_NAME = /^[\p{L}\p{N}][\p{L}\p{N} ._&+'()-]{0,59}$/u;

/** macOS only: `open -a <App>` or `shortcuts run <Name>`, without a shell. Resolves when the launcher finishes. */
export async function launchMac(kind, name, { spawnImpl = spawn, platform = process.platform, timeoutMs = 60_000, stopGraceMs = 1000, signal } = {}) {
  if (platform !== 'darwin') throw new Error('apps_unsupported');
  if (!APP_NAME.test(name)) throw new Error('invalid_app_name');
  stopCheck(signal);
  const [cmd, args, failure] = kind === 'open_app' ? ['/usr/bin/open', ['-a', name], 'app_open_failed'] : ['/usr/bin/shortcuts', ['run', name], 'shortcut_failed'];
  return await new Promise((resolve, reject) => {
    let settled = false;
    let child, interrupted, escalation, confirmation;
    const kill = sig => { try { child?.kill(sig); } catch { /* exit still needs confirmation */ } };
    const finish = error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(escalation);
      clearTimeout(confirmation);
      signal?.removeEventListener('abort', onAbort);
      if (error) reject(error); else resolve(kind === 'open_app' ? { app: name, opened: true } : { name, ran: true });
    };
    // A kill request is not an exit receipt. Keep the original interruption even
    // if the child later exits zero, and never claim confirmed Stop without close.
    // macOS may delegate effects to another app: CLI exit is not an OS rollback.
    const interrupt = reason => {
      if (settled || interrupted) return;
      interrupted = reason;
      clearTimeout(timer);
      escalation = setTimeout(() => {
        confirmation = setTimeout(() => finish(new Error('stop_unconfirmed_needs_review')), stopGraceMs);
        kill('SIGKILL');
      }, stopGraceMs);
      kill('SIGTERM');
    };
    const onAbort = () => interrupt('operation_stopped');
    const timer = setTimeout(() => interrupt(kind === 'open_app' ? failure : 'shortcut_timeout'), kind === 'open_app' ? 15_000 : timeoutMs);
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      child = spawnImpl(cmd, args, { shell: false, stdio: 'ignore' });
      child.once('error', () => { if (!interrupted) finish(new Error(failure)); });
      child.once('close', code => finish(interrupted ? new Error(interrupted) : code === 0 ? undefined : new Error(failure)));
      // Covers cancellation during spawn, before listeners could be attached.
      if (signal?.aborted) {
        if (interrupted) kill('SIGTERM'); else onAbort();
      }
    } catch { finish(new Error(failure)); }
  });
}

export function normalizeBrowserUrl(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 2048 || /[\r\n\0]/.test(value)) throw new Error('invalid_browser_url');
  let url;
  try { url = new URL(value.trim()); } catch { throw new Error('invalid_browser_url'); }
  if (url.protocol !== 'https:' || url.username || url.password || !url.hostname || url.hostname === 'localhost'
      || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(url.hostname) || url.hostname.includes(':')) throw new Error('invalid_browser_url');
  return url.href;
}

export async function openBrowser(value, { spawnImpl = spawn, platform = process.platform } = {}) {
  const url = normalizeBrowserUrl(value);
  const launch = platform === 'win32' ? ['explorer.exe', [url]]
    : platform === 'darwin' ? ['/usr/bin/open', [url]] : ['xdg-open', [url]];
  return await new Promise((resolve, reject) => {
    let settled = false;
    const finish = error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error); else resolve({ url, launched: true, launcher: launch[0] });
    };
    const timer = setTimeout(() => finish(new Error('browser_open_failed')), 8000);
    try {
      const child = spawnImpl(launch[0], launch[1], { shell: false, windowsHide: true, stdio: 'ignore' });
      child.once('error', () => finish(new Error('browser_open_failed')));
      child.once('close', code => finish(code === 0 ? undefined : new Error('browser_open_failed')));
    } catch { finish(new Error('browser_open_failed')); }
  });
}

function safeLocalError(error) {
  if (LOCAL_ERRORS.has(error?.message)) return error.message;
  if (/^(?:browser_[a-z_]+|desktop_[a-z_]+|invalid_browser_plan)$/.test(error?.message ?? '')) return error.message;
  if (FILE_ERRORS.has(error?.code)) return `file_${error.code.toLowerCase()}`;
  return 'local_operation_failed';
}

/** Success means a completed operation, not merely a resolved Promise.
 * A zero process exit is NOT proof of the user's higher-level business goal.
 */
export async function executeJobForReport(job, cfg, options = {}) {
  try {
    const result = await runJob(job, cfg, options);
    if (job.kind === 'exec') {
      if (result.interrupted) return { ok: false, error: result.interrupted === 'timeout' ? 'command_timed_out' : result.interrupted === 'unconfirmed' ? 'stop_unconfirmed_needs_review' : 'operation_stopped' };
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

async function confirmLocally(cfg, question, signal) {
  stopCheck(signal);
  if (cfg.auto === true) return true;
  if (!process.stdin.isTTY) return false;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise(resolve => {
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      resolve(value);
    };
    const abort = () => finish('n');
    const timer = setTimeout(() => finish('n'), 60_000);
    signal?.addEventListener('abort', abort, { once: true });
    rl.once('close', () => finish('n'));
    rl.question(`${question} [y/N] `, finish);
  });
  rl.close();
  return /^y(es)?$/i.test(String(answer).trim());
}

export async function runJob(job, cfg, { signal, commandTimeoutMs = 60_000, browserLauncher = openBrowser, macLauncher = launchMac } = {}) {
  stopCheck(signal);
  const p = validateJob(job);
  if (!cfg || !Array.isArray(cfg.roots) || cfg.roots.some(root => typeof root !== 'string' || !root)) throw new Error('no_folder_allowed');
  const roots = cfg.roots;
  if (job.kind === 'desktop_task') {
    const { executeDesktopTask } = await import('./firbo-desktop.mjs');
    return executeDesktopTask(job,cfg,{signal,call:connectorCall,shell:(command,stop)=>runJob({kind:'exec',params:{command}},cfg,{signal:stop})});
  }
  if (job.kind === 'browser_task') {
    if (cfg.allowBrowser !== true || cfg.allowBrowserControl !== true) throw new Error('browser_control_disabled');
    const { executeBrowserPlan } = await import('./firbo-browser.mjs');
    return executeBrowserPlan(p, cfg, {signal,
      // Full Control may skip duplicate local prompts for the reviewed browser plan,
      // actions and captures. Actual non-GET/HEAD network mutations still require
      // a local confirmation and sensitive credential fields remain blocked.
      confirm:(kind, detail, stop)=>confirmLocally(
        {...cfg,auto:cfg.fullControl===true && kind!=='browser_request'},
        `${kind}: ${JSON.stringify(detail)}`, stop
      ),
      onProgress:progress=>console.log(`Firbo browser: ${JSON.stringify(progress)}`),
      readFile:async(target,limit)=>{
        const handle=await openRegular(await jobPath(target,roots,cfg),false,false);
        try {
          const bytes=Buffer.alloc(limit+1); let count=0;
          while(count<bytes.length){stopCheck(signal);const r=await handle.read(bytes,count,bytes.length-count,count);if(!r.bytesRead)break;count+=r.bytesRead;}
          if(count>limit)throw new Error('browser_transfer_too_large');
          return {bytes:bytes.subarray(0,count)};
        } finally {await handle.close();}
      },
      writeFile:async(target,bytes)=>{
        if(cfg.allowWrite!==true)throw new Error('writing_disabled');
        const file=await jobPath(target,roots,cfg),handle=await openRegular(file,true,false);
        try {
          stopCheck(signal);await handle.writeFile(bytes);await handle.sync();
          const verify=Buffer.alloc(bytes.length);let count=0;
          while(count<verify.length){const r=await handle.read(verify,count,verify.length-count,count);if(!r.bytesRead)break;count+=r.bytesRead;}
          if(count!==bytes.length||hashBytes(verify)!==hashBytes(bytes))throw new Error('write_verification_failed');
          return {path:file,bytes:bytes.length,sha256:hashBytes(verify),verified:true};
        } finally {await handle.close();}
      },
    });
  }
  if (job.kind === 'browser_open') {
    if (cfg.allowBrowser !== true) throw new Error('browser_disabled');
    stopCheck(signal);
    return await browserLauncher(normalizeBrowserUrl(p.url));
  }
  if (job.kind === 'open_app' || job.kind === 'shortcut') {
    if (cfg.allowApps !== true) throw new Error('apps_disabled');
    // A Shortcut can do anything you built into it: ask here unless you chose --auto. Opening an app does not ask.
    if (job.kind === 'shortcut' && !(await confirmLocally(cfg, `Firbo wants to run your Shortcut "${p.name}". Allow?`, signal))) {
      stopCheck(signal); throw new Error('declined_on_this_computer');
    }
    stopCheck(signal);
    return await macLauncher(job.kind, job.kind === 'open_app' ? p.app : p.name, { signal });
  }
  if (!roots.length) throw new Error('no_folder_allowed');
  if (job.kind === 'list') {
    const dir = await jobPath(p.path || roots[0], roots, cfg);
    const out = [];
    let truncated = false;
    // opendir bounds the retained entries instead of materializing an entire directory.
    for await (const e of await fs.opendir(dir)) {
      stopCheck(signal);
      if (out.length === MAX_LIST) { truncated = true; break; }
      let size = null;
      if (e.isFile()) size = (await fs.stat(path.join(dir, e.name)).catch(() => null))?.size ?? null;
      out.push({ name: e.name, type: e.isDirectory() ? 'dir' : e.isFile() ? 'file' : 'other', size });
    }
    return { path: dir, entries: out, truncated };
  }
  if (job.kind === 'read') {
    const file = await jobPath(p.path, roots, cfg);
    const handle = await openRegular(file, false, false);
    try {
      const st = await handle.stat();
      if (!st.isFile()) throw new Error('not_a_file');
      if (st.size > MAX_READ) throw new Error('file_too_large');
      // Enforce the byte cap during reading, including a file that grows after stat.
      const buf = Buffer.alloc(MAX_READ + 1);
      let count = 0;
      while (count < buf.length) {
        stopCheck(signal);
        const read = await handle.read(buf, count, buf.length - count, count);
        if (!read.bytesRead) break;
        count += read.bytesRead;
      }
      if (count > MAX_READ) throw new Error('file_too_large');
      const bytes = buf.subarray(0, count);
      if (bytes.includes(0)) throw new Error('binary_file');
      const text = bytes.toString('utf8');
      return { path: file, content: text.slice(0, MAX_CONTENT), bytes: count, sha256: hashBytes(bytes), truncated: text.length > MAX_CONTENT };
    } finally { await handle.close(); }
  }
  if (job.kind === 'write') {
    if (cfg.allowWrite !== true) throw new Error('writing_disabled');
    const file = await jobPath(p.path, roots, cfg);
    const exists = await fs.stat(file).then(() => true, () => false);
    if (exists && !p.overwrite) throw new Error('file_exists');
    if (!(await confirmLocally(cfg, `Firbo wants to ${exists ? 'OVERWRITE' : 'create'} ${file} (${p.content.length} characters). Allow?`, signal))) {
      stopCheck(signal); throw new Error('declined_on_this_computer');
    }
    stopCheck(signal);
    // Revalidate after interactive consent. Still not a full parent-directory race sandbox.
    if (await resolveAllowed(file, roots) !== file) throw new Error('outside_allowed_folders');
    await fs.mkdir(path.dirname(file), { recursive: true });
    const handle = await openRegular(file, true, p.overwrite === true);
    const expected = Buffer.from(p.content, 'utf8');
    try {
      stopCheck(signal);
      if (p.overwrite === true) await handle.truncate(0);
      await handle.writeFile(expected);
      await handle.sync();
    } finally { await handle.close(); }
    stopCheck(signal);
    const reader = await openRegular(file, false, false);
    try {
      const actual = Buffer.alloc(expected.length + 1);
      let count = 0;
      while (count < actual.length) {
        stopCheck(signal);
        const part = await reader.read(actual, count, actual.length - count, count);
        if (!part.bytesRead) break;
        count += part.bytesRead;
      }
      if (count !== expected.length || hashBytes(actual.subarray(0, count)) !== hashBytes(expected)) throw new Error('write_verification_failed');
    } finally { await reader.close(); }
    return { path: file, written: p.content.length, bytes: expected.length,
      verification: { method: 'sha256-readback', sha256: hashBytes(expected), bytes: expected.length } };
  }
  if (job.kind === 'exec') {
    if (cfg.allowExec !== true) throw new Error('commands_disabled');
    const cwd = await jobPath(p.cwd || roots[0], roots, cfg);
    const command = String(p.command ?? '');
    if (!(await confirmLocally(cfg, `Firbo wants to run in ${cwd}:\n    ${command}\n  Allow?`, signal))) {
      stopCheck(signal); throw new Error('declined_on_this_computer');
    }
    stopCheck(signal);
    return runCommand(command, cwd, { signal, timeoutMs: commandTimeoutMs });
  }
  throw new Error('unknown_job');
}

/** One bounded request; failed report delivery is NOT retried by rerunning work.
 * fetchImpl/timeoutMs are local test seams, never accepted from a remote job.
 */
/** Only trusted, bounded machine-readable desktop errors cross the Connector boundary.
 * Never reproduce raw provider messages, page text, server HTML, or tokens.
 * The outer request AbortSignal/deadline still owns this read. */
async function boundedDesktopErrorCode(res) {
  if (!res.body || !res.headers.get('content-type')?.toLowerCase().includes('application/json')) return null;
  const reader=res.body.getReader();
  let size=0; const chunks=[];
  try {
    while (true) {
      const item=await reader.read();
      if (item.done) break;
      size+=item.value.byteLength;
      if (size>2048) return null;
      chunks.push(Buffer.from(item.value));
    }
    const payload=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const code=payload?.error;
    return typeof code==='string' && /^desktop_[a-z_]{3,58}$/.test(code)?code:null;
  } catch { return null; }
  finally { await reader.cancel().catch(()=>{}); }
}
export async function connectorCall(action, body, { fetchImpl = fetch, timeoutMs, signal } = {}) {
  validateConnectorURL(API);
  if (signal?.aborted) throw new Error('connector_stopped');
  const limit = action === 'desktop_plan' ? 90_000 : action === 'poll' ? 35_000 : 15_000;
  const timeout = timeoutMs ?? limit;
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > limit) throw new Error('invalid_timeout');
  const payload = JSON.stringify({ ...body, action });
  if (Buffer.byteLength(payload) > MAX_REQUEST) throw new Error('connector_request_too_large');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  let reader;
  const cancel = () => { if (reader) void reader.cancel().catch(() => {}); };
  controller.signal.addEventListener('abort', cancel, { once: true });
  try {
    const res = await fetchImpl(API, {
      method: 'POST', redirect: 'error', signal: controller.signal,
      headers: { 'content-type': 'application/json', apikey: ANON }, body: payload,
    });
    if (!res.ok) {
      // Desktop planner failures are typed and safe. An opaque 503 hides the
      // diagnosis as "local_operation_failed" for every model/network error.
      // Read at most 2KiB only for desktop_plan, never raw exception bodies.
      const code=action==='desktop_plan'?await boundedDesktopErrorCode(res):null;
      void res.body?.cancel().catch(() => {});
      throw Object.assign(new Error(code??`connector_http_${res.status}`), { status: res.status });
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
      if (controller.signal.aborted) throw new Error(signal?.aborted ? 'connector_stopped' : 'connector_timeout');
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
    if (controller.signal.aborted) throw new Error(signal?.aborted ? 'connector_stopped' : 'connector_timeout');
    if (['connector_invalid_response', 'connector_response_too_large'].includes(error?.message) || Number.isInteger(error?.status)) throw error;
    throw new Error('connector_unreachable');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    controller.signal.removeEventListener('abort', cancel);
    if (reader) { void reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
}
/** Local recovery guidance never reflects server bodies, device tokens or OS errors. */
export function connectorDiagnostic(error, command) {
  if (command === 'pair' && [400, 404].includes(error?.status)) return 'Pairing code is invalid, expired or already used. In Firbo → Computers choose New code, then pair within 10 minutes.';
  if ([401, 403].includes(error?.status)) return 'This computer is no longer authorized. In Firbo → Computers remove/recreate its entry and pair with a fresh code. Pending local results remain preserved.';
  const messages = {
    connector_unreachable: 'Cannot reach Firbo over HTTPS. Check this computer’s internet connection, then run the same command again. Do not disable your firewall.',
    connector_timeout: 'Firbo did not respond in time. Check this computer’s internet connection and retry; a pairing code may need to be regenerated.',
    invalid_pairing_code: 'Copy the complete pairing code from Firbo → Computers. Codes expire after 10 minutes and can only be used once.',
    pairing_config_unwritable: 'Cannot save the private Connector settings for this user. Run in your own Terminal account without sudo, and check that your home folder is writable. The pairing code was not used.',
    pairing_config_save_failed: 'Firbo accepted pairing, but this computer could not save its private settings. Correct the local file permissions, then remove/recreate the computer entry in Firbo and pair with a new code.',
    connector_already_running: 'A Connector is already running for this computer. Keep that Terminal open, or stop it with Ctrl+C before starting another.',
    matching_connector_backend_required: 'This Connector does not match the Firbo service. Download the current firbo-connector.mjs from Firbo → Computers and run it again.',
  };
  if (messages[error?.message]) return messages[error.message];
  if (FILE_ERRORS.has(error?.code)) return `Local file error (${error.code}). Check the allowed folder and permissions in your own Terminal account.`;
  return error?.message ?? 'connector_failed';
}

// ---- E1: verified local effects and durable result delivery. No public listener. ----
export function validateConnectorURL(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('invalid_connector_url'); }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.hash || url.search) throw new Error('invalid_connector_url');
  return url.href;
}
function requireDurableNode() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 13)) {
    throw new Error(`node_22_13_required: this program needs Node.js 22.13 or newer (you have ${process.versions.node}). Install the LTS version from https://nodejs.org, close and reopen the terminal, check with "node --version", then try again.`);
  }
}
const hashBytes = bytes => createHash('sha256').update(bytes).digest('hex');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_REPORT_BYTES = 140_000;
function stopCheck(signal) { if (signal?.aborted) throw new Error('operation_stopped'); }

async function jobPath(target, roots, cfg) {
  const resolved = await resolveAllowed(target, roots);
  const protectedPaths = [CONFIG, CONFIG + '.state', ...(cfg.internalProtectedPaths ?? [])];
  for (const candidate of protectedPaths) {
    if (typeof candidate !== 'string' || !candidate) continue;
    const absolute = await fs.realpath(path.resolve(candidate)).catch(() => path.resolve(candidate));
    if (fold(resolved) === fold(absolute) || fold(resolved).startsWith(fold(absolute + path.sep))) throw new Error('reserved_local_path');
  }
  return resolved;
}

/** Reject static special files/links and check the opened inode before truncating.
 * Parent-directory swaps by a hostile local process still need OS isolation.
 */
async function openRegular(file, write, overwrite) {
  const before = await fs.lstat(file).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (before && (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1)) throw new Error('unsafe_file_type');
  if (write && before && !overwrite) throw new Error('file_exists');
  const flags = (write ? FS.O_RDWR : FS.O_RDONLY) | (FS.O_NOFOLLOW || 0) | (FS.O_NONBLOCK || 0)
    | (write && !before ? FS.O_CREAT | FS.O_EXCL : 0);
  const handle = await fs.open(file, flags, 0o600);
  try {
    const after = await handle.stat();
    if (!after.isFile() || after.nlink !== 1 || (before && (before.dev !== after.dev || before.ino !== after.ino))) throw new Error('unsafe_file_type');
    return handle;
  } catch (error) { await handle.close(); throw error; }
}

/** Best-effort ordinary process-tree interruption, NOT protection from hostile
 * programs that detach/reparent/escape the process group. Such work needs a sandbox.
 */
export function runCommand(command, cwd, { signal, timeoutMs = 60_000 } = {}) {
  stopCheck(signal);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) throw new Error('bad_job_params');
  return new Promise((resolve, reject) => {
    let child;
    try { child = spawn(command, { shell: true, cwd, detached: process.platform !== 'win32', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch { reject(new Error('process_spawn_failed')); return; }
    let stdout = '', stderr = '', interrupted = null, settled = false, escalation, stopDeadline, killer;
    let stopCompleted = false, observedExit = null;
    const finish = (code, terminatedSignal, spawnError = false) => {
      if (settled) return;
      // Closing the shell's pipes must not cancel termination of its remaining children.
      if (interrupted && !stopCompleted) { observedExit = [code, terminatedSignal, spawnError]; return; }
      settled = true;
      clearTimeout(timer); clearTimeout(escalation); clearTimeout(stopDeadline);
      signal?.removeEventListener('abort', onAbort);
      if (spawnError && !interrupted) return reject(new Error('process_spawn_failed'));
      resolve({ code, signal: terminatedSignal, stdout, stderr, interrupted });
    };
    const groupKill = sig => {
      if (!Number.isInteger(child.pid) || child.pid <= 1) return;
      try { process.kill(-child.pid, sig); }
      catch (error) { if (error.code !== 'ESRCH') { try { child.kill(sig); } catch {} } }
    };
    const stop = reason => {
      if (settled || interrupted) return;
      interrupted = reason;
      if (process.platform === 'win32' && Number.isInteger(child.pid) && child.pid > 1) {
        const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe');
        killer = spawn(executable, ['/PID', String(child.pid), '/T', '/F'], { shell: false, windowsHide: true, stdio: 'ignore' });
        killer.on('error', () => { interrupted = 'unconfirmed'; try { child.kill(); } catch {} });
        killer.on('close', code => {
          if (code !== 0) interrupted = 'unconfirmed';
          stopCompleted = true;
          if (observedExit) finish(...observedExit);
        });
      } else {
        groupKill('SIGTERM');
        escalation = setTimeout(() => {
          groupKill('SIGKILL'); stopCompleted = true;
          if (observedExit) finish(...observedExit);
        }, 350);
      }
      // Never claim a stopped process just because a signal was sent.
      stopDeadline = setTimeout(() => {
        if (settled) return;
        child.stdout?.destroy(); child.stderr?.destroy(); child.unref();
        if (killer) { try { killer.kill(); } catch {} }
        interrupted = 'unconfirmed'; stopCompleted = true;
        finish(null, null);
      }, 3500);
    };
    const onAbort = () => stop('local_stop');
    const timer = setTimeout(() => stop('timeout'), timeoutMs);
    signal?.addEventListener('abort', onAbort, { once: true });
    child.stdout?.on('data', chunk => { stdout = (stdout + chunk.toString()).slice(-MAX_OUT); });
    child.stderr?.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-MAX_OUT); });
    child.on('error', () => finish(-1, null, true));
    child.on('close', (code, terminatedSignal) => finish(code, terminatedSignal));
    if (signal?.aborted) stop('local_stop');
  });
}

export function canonicalJSON(value, depth = 0) {
  if (depth > 32) throw new Error('invalid_report');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(item => canonicalJSON(item, depth + 1)).join(',') + ']';
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalJSON(value[key], depth + 1)).join(',') + '}';
  }
  throw new Error('invalid_report');
}
export function reportEnvelope(jobId, report) {
  if (!UUID.test(jobId) || !report || typeof report.ok !== 'boolean') throw new Error('invalid_report');
  const result = report.ok ? (report.result ?? null) : null;
  const error = report.ok ? null : report.error;
  if (error !== null && (typeof error !== 'string' || !error || error.length > 500)) throw new Error('invalid_report');
  if (result !== null && (!result || typeof result !== 'object' || Array.isArray(result))) throw new Error('invalid_report');
  const value = { job_id: jobId, ok: report.ok, result, error };
  const text = canonicalJSON(value);
  if (Buffer.byteLength(text) > MAX_REPORT_BYTES) throw new Error('result_too_large_for_delivery');
  return { ...value, report_sha256: hashBytes(text) };
}
function prepareReport(jobId, report) {
  try { return reportEnvelope(jobId, report); }
  catch { return reportEnvelope(jobId, { ok: false, error: 'result_unavailable_needs_review' }); }
}

function processExists(pid) {
  if (!Number.isInteger(pid) || pid < 1) return true;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code !== 'ESRCH'; }
}

/** Device-token/endpoint-bound private SQLite outbox. An interrupted STARTED
 * record is NEVER replayed automatically. It is reported as needing review.
 * Contents are UNENCRYPTED, may contain file data, and must not be uploaded/shared.
 */
export class LocalJobJournal {
  #db; #nonce = randomUUID(); #locked = false;
  static async open(directory, scope) {
    if (typeof directory !== 'string' || !directory || !/^[a-f0-9]{64}$/.test(scope)) throw new Error('invalid_journal_scope');
    requireDurableNode();
    const dir = path.resolve(directory, scope);
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    const ds = await fs.lstat(dir);
    if (!ds.isDirectory() || ds.isSymbolicLink() || (process.platform !== 'win32' && (ds.uid !== process.getuid() || (ds.mode & 0o077)))) throw new Error('unsafe_journal_directory');
    const file = path.join(dir, 'outbox.sqlite3');
    try { const h = await fs.open(file, 'wx', 0o600); await h.close(); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    const st = await fs.lstat(file);
    if (!st.isFile() || st.isSymbolicLink() || st.nlink !== 1 || st.size > 64 * 1024 * 1024
      || (process.platform !== 'win32' && (st.uid !== process.getuid() || (st.mode & 0o077)))) throw new Error('unsafe_journal_file');
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(file);
    try {
      db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA secure_delete=ON;');
      if (db.prepare('PRAGMA quick_check').get().quick_check !== 'ok') throw new Error('journal_corrupt');
      const version = db.prepare('PRAGMA user_version').get().user_version;
      if (version !== 0 && version !== 1) throw new Error('journal_version_unsupported');
      db.exec(`CREATE TABLE IF NOT EXISTS meta (scope TEXT PRIMARY KEY);
        CREATE TABLE IF NOT EXISTS owner_lock (id INTEGER PRIMARY KEY CHECK(id=1), pid INTEGER NOT NULL, nonce TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS jobs (
          id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL,
          phase TEXT NOT NULL CHECK(phase IN ('started','ready','acked','conflict')),
          report_json TEXT, report_sha256 TEXT, updated_at TEXT NOT NULL);
        PRAGMA user_version=1;`);
      db.prepare('INSERT INTO meta(scope) SELECT ? WHERE NOT EXISTS(SELECT 1 FROM meta)').run(scope);
      const scopes = db.prepare('SELECT scope FROM meta').all();
      if (scopes.length !== 1 || scopes[0].scope !== scope) throw new Error('journal_scope_mismatch');
      return new LocalJobJournal(db);
    } catch (error) { db.close(); throw error; }
  }
  constructor(db) { this.#db = db; }
  #tx(fn) {
    this.#db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.#db.exec('COMMIT'); return result; }
    catch (error) { this.#db.exec('ROLLBACK'); throw error; }
  }
  #owned() {
    if (!this.#locked || this.#db.prepare('SELECT nonce FROM owner_lock WHERE id=1').get()?.nonce !== this.#nonce) throw new Error('journal_not_owned');
  }
  acquire() {
    this.#tx(() => {
      const owner = this.#db.prepare('SELECT pid FROM owner_lock WHERE id=1').get();
      // Dead owner recovery is transactional. PID reuse fails closed rather than stealing a live lock.
      if (owner && processExists(owner.pid)) throw new Error('connector_already_running');
      this.#db.prepare('INSERT OR REPLACE INTO owner_lock(id,pid,nonce) VALUES(1,?,?)').run(process.pid, this.#nonce);
    });
    this.#locked = true;
  }
  begin(job) {
    this.#owned(); validateJob(job);
    if (!UUID.test(job.id)) throw new Error('bad_job');
    const fingerprint = hashBytes(canonicalJSON({ kind: job.kind, params: job.params ?? {} }));
    return this.#tx(() => {
      const existing = this.#db.prepare('SELECT * FROM jobs WHERE id=?').get(job.id);
      if (existing) {
        if (existing.fingerprint !== fingerprint) throw new Error('job_identity_changed');
        if (existing.phase === 'started') throw new Error('job_already_started');
        if (existing.phase === 'conflict') throw new Error('delivery_conflict_needs_review');
        return existing;
      }
      if (this.#db.prepare('SELECT count(*) AS n FROM jobs').get().n >= 10_000) throw new Error('journal_retention_review_required');
      this.#db.prepare("INSERT INTO jobs(id,fingerprint,phase,updated_at) VALUES(?,?,'started',?)").run(job.id, fingerprint, new Date().toISOString());
      return { id: job.id, phase: 'new' };
    });
  }
  finish(id, report) {
    this.#owned();
    const envelope = prepareReport(id, report);
    const saved = this.#db.prepare("UPDATE jobs SET phase='ready', report_json=?, report_sha256=?, updated_at=? WHERE id=? AND phase='started'")
      .run(canonicalJSON(envelope), envelope.report_sha256, new Date().toISOString(), id);
    if (saved.changes !== 1) throw new Error('journal_state_conflict');
    return envelope;
  }
  recoverInterrupted() {
    this.#owned();
    const rows = this.#db.prepare("SELECT id FROM jobs WHERE phase='started'").all();
    for (const row of rows) this.finish(row.id, { ok: false, error: 'execution_interrupted_needs_review' });
    return rows.length;
  }
  pending() {
    this.#owned();
    if (this.#db.prepare("SELECT id FROM jobs WHERE phase='conflict' LIMIT 1").get()) throw new Error('delivery_conflict_needs_review');
    return this.#db.prepare("SELECT report_json FROM jobs WHERE phase='ready' ORDER BY updated_at,id LIMIT 100").all().map(row => {
      const data = JSON.parse(row.report_json);
      if (reportEnvelope(data.job_id, data).report_sha256 !== data.report_sha256) throw new Error('journal_corrupt');
      return data;
    });
  }
  acknowledge(envelope) {
    this.#owned();
    const done = this.#db.prepare("UPDATE jobs SET phase='acked',report_json=NULL,updated_at=? WHERE id=? AND phase='ready' AND report_sha256=?")
      .run(new Date().toISOString(), envelope.job_id, envelope.report_sha256);
    if (done.changes !== 1) throw new Error('journal_state_conflict');
  }
  conflict(id) {
    this.#owned();
    this.#db.prepare("UPDATE jobs SET phase='conflict',updated_at=? WHERE id=? AND phase='ready'").run(new Date().toISOString(), id);
  }
  counts() { return this.#db.prepare('SELECT phase,count(*) AS count FROM jobs GROUP BY phase ORDER BY phase').all(); }
  close() {
    if (!this.#db) return;
    if (this.#locked) this.#db.prepare('DELETE FROM owner_lock WHERE id=1 AND nonce=?').run(this.#nonce);
    this.#db.close(); this.#db = null; this.#locked = false;
  }
}

export async function executeJournaled(job, cfg, journal, { signal, executor = executeJobForReport } = {}) {
  stopCheck(signal);
  const prior = journal.begin(job); // Commit intent BEFORE any local side effect.
  if (prior.phase !== 'new') return { executed: false, phase: prior.phase };
  let report;
  try { report = await executor(job, cfg, { signal }); }
  catch { report = { ok: false, error: 'execution_interrupted_needs_review' }; }
  journal.finish(job.id, report); // Failure here leaves a STARTED record; never rerun blindly.
  return { executed: true, phase: 'ready', ok: report.ok };
}

export async function flushPendingReports(cfg, journal, callFn = connectorCall, signal) {
  for (const envelope of journal.pending()) {
    if (signal?.aborted) return;
    let ack;
    try { ack = await callFn('report', { token: cfg.token, ...envelope }, { signal }); }
    catch (error) {
      if ([400, 404, 409, 413, 422].includes(error?.status)) {
        journal.conflict(envelope.job_id); throw new Error('delivery_conflict_needs_review');
      }
      throw error;
    }
    if (ack?.ok !== true || ack?.job_id !== envelope.job_id || ack?.report_sha256 !== envelope.report_sha256) throw new Error('report_ack_mismatch');
    journal.acknowledge(envelope); // Drop private payload only after the exact receipt is verified.
  }
}

function delay(ms, signal) {
  return new Promise(resolve => {
    if (signal?.aborted) return resolve();
    const finish = () => { clearTimeout(timer); signal?.removeEventListener('abort', finish); resolve(); };
    const timer = setTimeout(finish, ms);
    signal?.addEventListener('abort', finish, { once: true });
  });
}
export function localCapabilities(cfg) {
  const kinds = [];
  if (Array.isArray(cfg?.roots) && cfg.roots.length) kinds.push('list', 'read');
  if (cfg?.allowWrite === true && cfg?.roots?.length) kinds.push('write');
  if (cfg?.allowExec === true && cfg?.roots?.length) kinds.push('exec');
  if (cfg?.allowBrowser === true) kinds.push('browser_open');
  if (cfg?.allowBrowser === true && cfg?.allowBrowserControl === true && (cfg?.fullControl === true || cfg?.browserSites?.length)) kinds.push('browser_task');
  if (cfg?.allowApps === true && process.platform === 'darwin') kinds.push('open_app', 'shortcut');
  if (cfg?.allowDesktop === true && cfg?.fullControl === true && cfg?.desktopReady === true) kinds.push('desktop_task');
  // The allowed folder names help AI employees ask for the right paths; nothing else from the config leaves this computer.
  const base = { job_kinds: kinds, ...(cfg?.fullControl === true ? { full_control: true } : {}) };
  return Array.isArray(cfg?.roots) && cfg.roots.length ? { ...base, roots: cfg.roots.slice(0, 8) } : base;
}
const retryableConnection = error => error?.status === 429 || error?.status >= 500 || ['connector_unreachable', 'connector_timeout'].includes(error?.message);

/** While one job is running, ask Firbo only whether that exact device/job has
 * a Stop request. A transient network failure delays remote Stop but never
 * fabricates a cancellation. Revocation/terminal conflicts fail closed locally.
 */
export async function monitorRemoteStop(job, cfg, {
  callFn = connectorCall, signal, onStop = () => {}, intervalMs = 750,
} = {}) {
  if (!job || !UUID.test(job.id) || !cfg || !/^[a-f0-9]{64}$/.test(cfg.token)) throw new Error('bad_job');
  if (!Number.isInteger(intervalMs) || intervalMs < 100 || intervalMs > 5000) throw new Error('invalid_timeout');
  while (!signal?.aborted) {
    try {
      const out = await callFn('control', { token: cfg.token, job_id: job.id }, { signal });
      if (signal?.aborted) break;
      if (!out || out.ok !== true || out.job_id !== job.id || typeof out.stop !== 'boolean' || typeof out.terminal !== 'boolean') {
        throw new Error('connector_invalid_response');
      }
      if (out.stop === true || out.terminal === true) {
        onStop(out.stop === true ? 'remote_stop' : 'remote_terminal');
        return { stopped: true, reason: out.stop === true ? 'remote_stop' : 'remote_terminal' };
      }
    } catch (error) {
      if (signal?.aborted) break;
      if ([401, 403, 404, 409].includes(error?.status) || !retryableConnection(error)) {
        onStop('remote_control_failed');
        return { stopped: true, reason: 'remote_control_failed' };
      }
    }
    await delay(intervalMs, signal);
  }
  return { stopped: false, reason: null };
}

export async function runDurableConnector(cfg, { directory, signal, callFn = connectorCall, onEvent = () => {}, maxJobs = Infinity } = {}) {
  if (!cfg || !/^[a-f0-9]{64}$/.test(cfg.token) || !Array.isArray(cfg.roots) || (!cfg.roots.length && cfg.allowBrowser !== true && cfg.allowApps !== true)) throw new Error('invalid_local_config');
  cfg = { ...cfg, internalProtectedPaths: [directory, CONFIG] };
  if(cfg.allowDesktop === true && cfg.fullControl === true){
    const { desktopAction }=await import('./firbo-desktop.mjs');
    await desktopAction({action:'observe'},{signal});
    cfg.desktopReady=true;
  }
  const scope = hashBytes(API + '\n' + cfg.token);
  const journal = await LocalJobJournal.open(directory, scope);
  let completed = 0, backoff = 1000;
  const emit = event => { try { onEvent(event); } catch {} };
  try {
    journal.acquire();
    let protocol;
    while (!signal?.aborted) {
      try {
        protocol = await callFn('capabilities', { token: cfg.token, client_capabilities: localCapabilities(cfg) }, { signal });
        break;
      } catch (error) {
        if (signal?.aborted) return { processed: 0, local_states: journal.counts() };
        if (!retryableConnection(error)) throw error;
        emit('connection_retry_without_reexecution');
        await delay(backoff, signal); backoff = Math.min(backoff * 2, 30_000);
      }
    }
    if (signal?.aborted) return { processed: 0, local_states: journal.counts() };
    if (protocol?.protocol !== 'firbo-connector/v2' || protocol.report_ack !== 'sha256-v1') throw new Error('matching_connector_backend_required');
    const remoteStop = protocol.remote_stop === true && protocol.running_stop === 'cancel-request-v1';
    backoff = 1000;
    emit('connected_to_firbo');
    const recovered = journal.recoverInterrupted();
    if (recovered) emit('interrupted_work_preserved_for_review');
    while (!signal?.aborted) {
      try {
        await flushPendingReports(cfg, journal, callFn, signal);
        if (signal?.aborted || completed >= maxJobs) break;
        const out = await callFn('poll', { token: cfg.token }, { signal });
        if (signal?.aborted) break;
        if (!out || !Object.hasOwn(out, 'job')) throw new Error('connector_invalid_response');
        if (!out.job) { await delay(150, signal); continue; }
        const jobController = new AbortController();
        const monitorController = new AbortController();
        const stopJob = reason => {
          if (!jobController.signal.aborted) {
            emit(reason === 'remote_stop' ? 'remote_stop_received' : 'remote_execution_invalidated');
            jobController.abort();
          }
        };
        const stopAll = () => { jobController.abort(); monitorController.abort(); };
        signal?.addEventListener('abort', stopAll, { once: true });
        const watcher = remoteStop
          ? monitorRemoteStop(out.job, cfg, { callFn, signal: monitorController.signal, onStop: stopJob })
          : Promise.resolve({ stopped: false, reason: null });
        let result;
        try {
          result = await executeJournaled(out.job, cfg, journal, { signal: jobController.signal });
        } finally {
          monitorController.abort();
          await watcher.catch(() => {});
          signal?.removeEventListener('abort', stopAll);
        }
        if (!result.executed && result.phase === 'acked') throw new Error('server_reissued_acknowledged_job');
        completed++; backoff = 1000;
        emit('result_saved_locally');
      } catch (error) {
        if (signal?.aborted) break;
        if (!retryableConnection(error)) throw error;
        emit('connection_retry_without_reexecution');
        await delay(backoff, signal); backoff = Math.min(backoff * 2, 30_000);
      }
    }
    return { processed: completed, local_states: journal.counts() };
  } finally { journal.close(); }
}

/** Reserve private writable storage BEFORE consuming the one-use code. */
export async function pairConnector(code, args = {}, { configPath = CONFIG, callFn = connectorCall } = {}) {
  requireDurableNode();
  const normalized = typeof code === 'string' ? code.trim().toUpperCase().replace(/[\s-]/g, '') : '';
  if (!/^[A-Z0-9]{8,20}$/.test(normalized)) throw new Error('invalid_pairing_code');
  const roots = [];
  for (const root of args.allow ?? []) roots.push(await fs.realpath(path.resolve(expand(root))));
  if (!roots.length && args.fullControl === true) roots.push(await fs.realpath(path.join(os.homedir(), 'Documents')));
  if (!roots.length && args.allowBrowser !== true && args.allowApps !== true && args.fullControl !== true) throw new Error('no_folder_allowed');
  const pending = `${configPath}.${randomUUID()}.pending`;
  let handle;
  try {
    const existing = await fs.lstat(configPath).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (existing && (!existing.isFile() || existing.isSymbolicLink() || existing.nlink !== 1)) throw new Error('unsafe_config');
    handle = await fs.open(pending, 'wx', 0o600);
  } catch { throw new Error('pairing_config_unwritable'); }
  try {
    const res = await callFn('pair', { code: normalized, platform: `${os.platform()} ${os.arch()}` });
    if (typeof res?.token !== 'string' || !/^[a-f0-9]{64}$/.test(res.token)) throw new Error('connector_invalid_response');
    const cfg = { token: res.token, roots, allowWrite: args.fullControl === true || args.allowWrite === true, allowExec: args.allowExec === true, allowBrowser: args.fullControl === true || args.allowBrowser === true, auto: args.fullControl === true || args.auto === true, ...(args.fullControl === true ? { fullControl: true, allowBrowserControl: true, allowApps: true } : {}), ...(args.allowApps === true ? { allowApps: true } : {}) };
    try {
      await handle.writeFile(JSON.stringify(cfg, null, 2));
      await handle.sync();
      await handle.close(); handle = null;
      await fs.rename(pending, configPath);
    } catch { throw new Error('pairing_config_save_failed'); }
    return { cfg, deviceName: res.device_name };
  } finally {
    if (handle) await handle.close().catch(() => {});
    await fs.rm(pending, { force: true }).catch(() => {
      console.warn('Could not remove the private pairing staging file. Check your home folder permissions; do not share Connector settings files.');
    });
  }
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
    if (a === '--allow') {
      const root = argv[++i];
      if (!root || root.startsWith('--')) throw new Error('missing_allowed_folder');
      out.allow.push(root);
    }
    else if (a === '--allow-write') out.allowWrite = true;
    else if (a === '--allow-exec') out.allowExec = true;
    else if (a === '--allow-browser') out.allowBrowser = true;
    else if (a === '--allow-apps') out.allowApps = true;
    else if (a === '--full-control') out.fullControl = true;
    else if (a === '--browser-site') {
      const site=argv[++i]; if(!site||site.startsWith('--'))throw new Error('invalid_browser_plan');
      (out.browserSites ??= []).push(site);
    }
    else if (a === '--auto') out.auto = true;
    else out._.push(a);
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [cmd, arg] = args._;
  if (cmd === 'run' || cmd === 'pair') requireDurableNode();
  if (cmd === 'pair') {
    if (!arg) throw new Error('Usage: node firbo-connector.mjs pair <CODE> [--allow <folder>] [--allow-write] [--allow-exec] [--allow-browser] [--allow-apps] [--full-control]');
    const { cfg, deviceName } = await pairConnector(arg, args);
    const { roots } = cfg;
    console.log(`Paired as "${deviceName}".`);
    console.log(roots.length ? `Allowed folders: ${roots.join(', ')}` : 'Browser-only connection: file and shell access are off.');
    console.log(`Writing files: ${cfg.allowWrite ? 'allowed' : 'off'}   Running commands: ${cfg.allowExec ? 'allowed' : 'off'}   Browser opening: ${cfg.allowBrowser ? 'allowed' : 'off'}   Apps/Shortcuts: ${cfg.allowApps ? 'allowed' : 'off'}   Local Full Control: ${cfg.fullControl ? 'on' : 'off'}`);
    console.log('Now run:  node firbo-connector.mjs run');
    return;
  }
  const cfg = await loadConfig();
  if (cmd === 'forget') {
    await fs.rm(CONFIG, { force: true });
    console.log('Forgotten. Also remove the computer in Firbo → Computers.');
    console.log('Private local journals are retained; they may contain undelivered file data. Review before deleting.');
    return;
  }
  if (!cfg) throw new Error('Not paired yet. Get a code in Firbo → Computers, then pair with --allow <folder> and/or --allow-browser.');
  // Change one local permission without pairing again. Each one is your decision on this computer, not Firbo's.
  if (cmd === 'desktop-control') {
    cfg.allowDesktop=arg!=='off';
    if(cfg.allowDesktop){
      if(cfg.fullControl!==true)throw new Error('desktop_requires_full_control');
      const { desktopAction }=await import('./firbo-desktop.mjs');
      await desktopAction({action:'observe'});
      console.log('Desktop control enabled for this account: screenshots, mouse and keyboard across applications. This is not confined to allowed folders. Move the mouse to the top-left corner or use Take Control to stop AI input.');
    }
    await fs.writeFile(CONFIG,JSON.stringify(cfg,null,2),{mode:0o600});
    console.log('Restart the Connector to apply.');
    return;
  }
  if (cmd === 'full-control') {
    const enabled = arg !== 'off';
    cfg.fullControl = enabled;
    if (enabled) {
      cfg.allowBrowser = true;
      cfg.allowBrowserControl = true;
      cfg.allowApps = true;
      cfg.allowWrite = true;
      cfg.auto = true;
      if (!Array.isArray(cfg.roots) || cfg.roots.length === 0) {
        cfg.roots = [await fs.realpath(path.join(os.homedir(), 'Documents'))];
      }
      console.log('Firbo Full Control is ON for owner-approved file, app and browser work. Shell execution remains separately controlled.');
    } else {
      cfg.fullControl = false;
      cfg.auto = false;
      console.log('Firbo Full Control is OFF. Existing local capabilities remain, with local prompts restored.');
    }
    await fs.writeFile(CONFIG, JSON.stringify(cfg, null, 2), { mode: 0o600 });
    console.log('Restart with: node firbo-connector.mjs run');
    return;
  }
  const SETTINGS = {
    'allow-browser': ['allowBrowser', 'Website/voice browser opening is now allowed.'],
    'allow-apps': ['allowApps', 'AI employees may now open apps and run your Shortcuts (macOS). Shortcuts still ask unless "auto" is on.'],
    'allow-write': ['allowWrite', 'Writing files inside your allowed folders is now allowed.'],
    'allow-exec': ['allowExec', 'Running commands is now allowed (as your user, starting in an allowed folder).'],
    auto: ['auto', 'Writes, commands and Shortcuts no longer wait for your y/n here. Firbo still applies its own approval rules.'],
  };
  if (cmd in SETTINGS || cmd === 'add-folder') {
    if (cmd === 'add-folder') {
      if (!arg) throw new Error('Usage: node firbo-connector.mjs add-folder <folder>');
      const root = await fs.realpath(path.resolve(expand(arg)));
      cfg.roots = [...new Set([...(cfg.roots ?? []), root])];
      console.log(`Allowed folders: ${cfg.roots.join(', ')}`);
    } else {
      const [key, message] = SETTINGS[cmd];
      cfg[key] = arg !== 'off';
      console.log(arg === 'off' ? `${key} is now off.` : message);
    }
    await fs.writeFile(CONFIG, JSON.stringify(cfg, null, 2), { mode: 0o600 });
    console.log('Restart with: node firbo-connector.mjs run');
    return;
  }
  if (cmd === 'status') {
    console.log(JSON.stringify({ ...cfg, token: '(hidden)' }, null, 2));
    return;
  }
  if (cmd !== 'run') throw new Error('Commands: pair <CODE> | run | status | full-control [off] | allow-browser | allow-apps | allow-write | allow-exec | auto [off] | add-folder <folder> | forget');
  if(args.browserSites?.length){
    const { browserOrigin, verifyBrowserRuntime }=await import('./firbo-browser.mjs');
    if(!cfg.allowBrowser)throw new Error('browser_disabled');
    cfg.browserSites=args.browserSites.map(browserOrigin);
    cfg.allowBrowserControl=true;
    await verifyBrowserRuntime();
    console.log(cfg.fullControl ? `Browser task sites seeded for this run: ${cfg.browserSites.join(', ')}. Full Control accepts owner-approved public HTTPS plan sites; press Ctrl+C to Stop.` : `Browser task sites for this run: ${cfg.browserSites.join(', ')}. Local approval remains required; close the controlled window or press Ctrl+C to stop.`);
  }
  console.log('Firbo Connector: local consent and folder rules remain active. Ctrl+C requests Stop.');
  console.log('Pending results are stored privately on this computer, UNENCRYPTED, until acknowledged.');
  const controller = new AbortController();
  const stop = () => {
    if (!controller.signal.aborted) console.log('Stop requested. Finishing interruption and preserving any pending result.');
    controller.abort();
  };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  try {
    await runDurableConnector(cfg, { signal: controller.signal,
      directory: process.env.FIRBO_CONNECTOR_STATE_DIR || CONFIG + '.state',
      onEvent: event => console.log(`Firbo: ${event}`) });
  } finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); }

}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(connectorDiagnostic(e, process.argv[2]));
    process.exit(1);
  });
}
