// What AI employees may do on a paired computer, decided on the server before any job is queued.
// Three outcomes: "auto" (runs now, the employee gets the result), "approve" (waits for the owner in the Inbox)
// and "deny" (never). The Connector program on the computer still enforces its own local limits on top of this.

export const COMPUTER_KINDS = ['list', 'read', 'write', 'exec', 'browser_open', 'browser_task', 'open_app', 'shortcut'] as const;
export type ComputerKind = typeof COMPUTER_KINDS[number];
export type Verdict = 'auto' | 'approve' | 'deny';

export interface ComputerPolicy {
  /** Master switch: AI employees may use this computer at all. Off until the owner turns it on. */
  enabled: boolean;
  /** Guarded keeps the generic employee approval gate. Full is an explicit owner override for this device. */
  control: 'guarded' | 'full';
  /** Apps opened without asking; any other app needs approval unless full control is on. */
  apps: string[];
  /** macOS Shortcuts run without asking; any other shortcut needs approval. */
  shortcuts: string[];
  /** New files inside the allowed folders: without asking, with approval, or never. Overwriting always asks. */
  writes: 'auto' | 'ask' | 'off';
  /** Terminal: a short list of read-only commands without asking (the rest asks), everything asks, or never. */
  commands: 'safe' | 'ask' | 'off';
  /** Working hours in the owner's time zone; outside them AI employees cannot use the computer. */
  hours: { from: number; to: number; tz: string } | null;
}

export const DEFAULT_APPS = ['Safari', 'Google Chrome', 'Finder', 'Notes', 'Mail', 'Calendar', 'Preview', 'TextEdit',
  'Numbers', 'Pages', 'Keynote', 'Microsoft Excel', 'Microsoft Word', 'Visual Studio Code'];
export const DEFAULT_POLICY: ComputerPolicy = { enabled: false, control: 'guarded', apps: DEFAULT_APPS, shortcuts: [], writes: 'auto', commands: 'safe', hours: null };

export const APP_NAME = /^[\p{L}\p{N}][\p{L}\p{N} ._&+'()-]{0,59}$/u;
const list = (v: unknown, max: number) => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string').map(x => x.trim()).filter(x => APP_NAME.test(x)))].slice(0, max) : null);

/** A stored or submitted policy, cleaned: unknown fields dropped, bad values replaced by the defaults. */
export function cleanPolicy(value: unknown): ComputerPolicy {
  const v = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const h = v.hours && typeof v.hours === 'object' ? v.hours as Record<string, unknown> : null;
  const hour = (x: unknown) => (Number.isInteger(x) && (x as number) >= 0 && (x as number) <= 24 ? x as number : null);
  let tz = typeof h?.tz === 'string' ? h.tz.slice(0, 64) : 'UTC';
  try { new Intl.DateTimeFormat('en', { timeZone: tz }); } catch { tz = 'UTC'; }
  const from = hour(h?.from), to = hour(h?.to);
  return {
    enabled: v.enabled === true,
    control: v.control === 'full' ? 'full' : 'guarded',
    apps: list(v.apps, 40) ?? DEFAULT_APPS,
    shortcuts: list(v.shortcuts, 40) ?? [],
    writes: ['auto', 'ask', 'off'].includes(v.writes as string) ? v.writes as ComputerPolicy['writes'] : 'auto',
    commands: ['safe', 'ask', 'off'].includes(v.commands as string) ? v.commands as ComputerPolicy['commands'] : 'safe',
    hours: h && from !== null && to !== null && from !== to ? { from, to, tz } : null,
  };
}

/** True when `now` falls inside the working hours (a window may cross midnight). No hours set: always. */
export function withinHours(policy: ComputerPolicy, now = new Date()): boolean {
  if (!policy.hours) return true;
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: policy.hours.tz, hour: '2-digit', hour12: false }).format(now)) % 24;
  const { from, to } = policy.hours;
  return from < to ? hour >= from && hour < to : hour >= from || hour < to;
}

// Never, whatever the settings: passwords and the keychain, admin rights, system settings, disks, power, piping downloads into a shell.
// AppleScript (osascript) is not on this list: it is how an employee works inside Excel, Mail or Keynote, and it always
// waits for the owner's approval (it is never a safe read-only command), unless it touches one of the words below.
const FORBIDDEN = /\bsudo\b|\bsu\s|\bsecurity\b|keychain|\bpasswd\b|\bcsrutil\b|\bspctl\b|\bnvram\b|\blaunchctl\b|\bdefaults\s+write\b|\bdiskutil\b|\bmkfs|\bdd\s+if=|\bshutdown\b|\breboot\b|\bhalt\b|\bkillall\b|rm\s+-[a-z]*r[a-z]*\s+(\/|~\/?)(\s|$)|:\(\)\s*\{|\|\s*(ba|z|da)?sh\b|\bchmod\s+-r|\bchown\b|\.ssh\b|\.aws\b|\.gnupg\b|id_rsa|\.env\b/i;
// Read-only commands that run without asking. No shell features at all: one plain command, its options and simple words.
const SAFE_COMMANDS: Record<string, RegExp> = {
  ls: /^ls(\s+-[a-zA-Z]+)*(\s+[\w./~-]+)?$/,
  pwd: /^pwd$/, date: /^date$/, uptime: /^uptime$/, whoami: /^whoami$/,
  df: /^df(\s+-h)?$/, sw_vers: /^sw_vers$/, uname: /^uname(\s+-[a-z]+)?$/,
  git: /^git\s+(status|log(\s+--oneline)?(\s+-n\s*\d+|\s+-\d+)?|branch|diff(\s+--stat)?|remote\s+-v)$/,
  node: /^node\s+(--version|-v)$/, python3: /^python3\s+--version$/, npm: /^npm\s+(--version|-v|ls)$/,
};
export function isSafeCommand(command: string): boolean {
  const c = command.trim().replace(/\s+/g, ' ');
  if (!c || c.length > 200 || /[;&|`$<>(){}\\*?!\n'"]/.test(c)) return false;
  const rule = SAFE_COMMANDS[c.split(' ')[0]];
  return !!rule && rule.test(c);
}

/** The decision for one action. Reasons are short codes the employee and the owner both see. */
export function decideComputer(kind: ComputerKind, params: Record<string, unknown>, policy: ComputerPolicy, now = new Date()): { verdict: Verdict; reason: string } {
  if (!policy.enabled) return { verdict: 'deny', reason: 'computer_off_for_ai' };
  if (!withinHours(policy, now)) return { verdict: 'deny', reason: 'outside_working_hours' };
  const has = (names: string[], name: unknown) => typeof name === 'string' && names.some(n => n.toLowerCase() === name.trim().toLowerCase());
  switch (kind) {
    case 'list': case 'read': case 'browser_open':
      return { verdict: 'auto', reason: 'read_only' };
    case 'browser_task':
      // The computer shows the plan and asks its owner before it runs; clicks, typing and uploads ask again.
      return { verdict: 'auto', reason: 'reviewed_on_the_computer' };
    case 'open_app':
      if (policy.control === 'full') return { verdict: 'auto', reason: 'owner_full_control' };
      return has(policy.apps, params.app) ? { verdict: 'auto', reason: 'allowed_app' } : { verdict: 'approve', reason: 'app_not_on_list' };
    case 'shortcut':
      return has(policy.shortcuts, params.name) ? { verdict: 'auto', reason: 'allowed_shortcut' } : { verdict: 'approve', reason: 'shortcut_not_on_list' };
    case 'write':
      if (policy.writes === 'off') return { verdict: 'deny', reason: 'writing_off' };
      if (params.overwrite === true && policy.control !== 'full') return { verdict: 'approve', reason: 'overwrites_a_file' };
      return policy.writes === 'auto' ? { verdict: 'auto', reason: 'new_file_in_allowed_folder' } : { verdict: 'approve', reason: 'writing_needs_approval' };
    case 'exec': {
      const command = String(params.command ?? '');
      if (policy.commands === 'off') return { verdict: 'deny', reason: 'commands_off' };
      if (FORBIDDEN.test(command)) return { verdict: 'deny', reason: 'forbidden_command' };
      return policy.commands === 'safe' && isSafeCommand(command) ? { verdict: 'auto', reason: 'safe_read_only_command' } : { verdict: 'approve', reason: 'command_needs_approval' };
    }
  }
}

/**
 * The decision for one employee's step: the owner's rules first, then the employee's own limits.
 * An employee set to "ask first" (power on approval) never runs anything by itself; a suggest-only employee may
 * only look (list, read) and every other step becomes a suggestion in its report.
 */
export function decideForEmployee(kind: ComputerKind, params: Record<string, unknown>, policy: ComputerPolicy,
  employee: { askFirst?: boolean; suggestOnly?: boolean }, now = new Date()): { verdict: Verdict | 'suggest'; reason: string } {
  const owner = decideComputer(kind, params, policy, now);
  if (owner.verdict === 'deny') return owner;
  if (employee.suggestOnly && !(owner.verdict === 'auto' && (kind === 'list' || kind === 'read'))) return { verdict: 'suggest', reason: 'employee_may_only_suggest' };
  if (owner.verdict === 'auto' && employee.askFirst && policy.control !== 'full') return { verdict: 'approve', reason: 'employee_must_ask' };
  return owner;
}

const httpsUrl = (raw: string) => {
  try {
    const u = new URL(raw.trim());
    return u.protocol === 'https:' && !u.username && !u.password && u.hostname && u.hostname !== 'localhost' && !/^\d{1,3}(\.\d{1,3}){3}$/.test(u.hostname) && !u.hostname.includes(':') ? u.href : null;
  } catch { return null; }
};

/** A scoped browser plan (open, read, snapshot, screenshot, click, fill, scroll, upload, download); null when anything is off. The computer reviews it again locally. */
export function browserTaskParams(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const p=raw as Record<string, unknown>;
  if(Object.keys(p).some(k=>!['steps','timeout_ms'].includes(k)))return null;
  const timeout=p.timeout_ms??120_000;
  if(!Number.isInteger(timeout)||Number(timeout)<1000||Number(timeout)>300_000||!Array.isArray(p.steps)||!p.steps.length||p.steps.length>20)return null;
  const fields:Record<string,string[]>={open:['url'],read:[],snapshot:[],screenshot:['path'],click:['selector'],fill:['selector','text'],scroll:['pixels'],upload:['selector','path'],download:['url','path']};
  for(const s of p.steps){
    if(!s||typeof s!=='object'||Array.isArray(s)||!Object.hasOwn(fields,s.action))return null;
    const keys=fields[s.action];
    if(Object.keys(s).some(k=>k!=='action'&&!keys.includes(k))||keys.some(k=>!Object.hasOwn(s,k)))return null;
    if(keys.includes('url')&&(typeof s.url!=='string'||s.url.length>2048||!httpsUrl(s.url)))return null;
    if(keys.includes('selector')&&(typeof s.selector!=='string'||!s.selector||s.selector.length>200||/[\u0000-\u001f\u007f]/.test(s.selector)||/>>|(?:^|\s)(?:text|xpath|id|data-testid)=/i.test(s.selector)))return null;
    if(keys.includes('path')&&(typeof s.path!=='string'||!s.path||s.path.length>500||/[\u0000-\u001f\u007f]/.test(s.path)))return null;
    if(s.action==='screenshot'&&!/\.png$/i.test(s.path))return null;
    if(s.action==='fill'&&(typeof s.text!=='string'||s.text.length>4000||/[\u0000-\u0008\u000b-\u001f\u007f]/.test(s.text)))return null;
    if(s.action==='scroll'&&(!Number.isInteger(s.pixels)||Math.abs(s.pixels)>4000))return null;
  }
  if(p.steps[0].action!=='open')return null;
  return {steps:p.steps,timeout_ms:timeout};
}

/**
 * What the employee asked for, in plain words: "open_app Safari", "open_url https://…", "list Documents", "read notes.txt",
 * "write report.md :: text", "run git status", "shortcut Daily backup". A JSON {"kind": …, …} object works too.
 */
export function parseComputerRequest(input: string): { kind: ComputerKind; params: Record<string, unknown> } | { error: string } {
  const text = input.trim();
  if (text.startsWith('{')) {
    try {
      const o = JSON.parse(text) as Record<string, unknown>;
      const verb = String(o.kind ?? o.action ?? '');
      const arg = String(o.app ?? o.url ?? o.path ?? o.command ?? o.name ?? '');
      return parseComputerRequest(`${verb} ${arg}${typeof o.content === 'string' ? ` :: ${o.content}` : ''}`);
    } catch { return { error: 'bad_request' }; }
  }
  const m = /^([a-z_]+)\s*([\s\S]*)$/i.exec(text);
  if (!m) return { error: 'bad_request' };
  const verb = m[1].toLowerCase();
  const rest = m[2].trim();
  if (['open_app', 'app', 'open'].includes(verb)) {
    if (/^https?:\/\//i.test(rest)) return parseComputerRequest(`open_url ${rest}`);
    return APP_NAME.test(rest) ? { kind: 'open_app', params: { app: rest } } : { error: 'bad_app_name' };
  }
  if (['open_url', 'url', 'browser_open'].includes(verb)) {
    const url = httpsUrl(rest);
    return url ? { kind: 'browser_open', params: { url } } : { error: 'https_link_required' };
  }
  if (['list', 'ls'].includes(verb)) return { kind: 'list', params: { path: rest.slice(0, 500) } };
  if (['read', 'cat'].includes(verb)) return rest ? { kind: 'read', params: { path: rest.slice(0, 500) } } : { error: 'path_required' };
  if (['write', 'save'].includes(verb)) {
    const at = rest.indexOf('::');
    const path = (at < 0 ? rest : rest.slice(0, at)).trim().slice(0, 500);
    const content = at < 0 ? '' : rest.slice(at + 2).trim();
    return path && content ? { kind: 'write', params: { path, content: content.slice(0, 100_000), overwrite: false } } : { error: 'write_needs_path_and_content' };
  }
  // Room for a whole AppleScript job (open Excel, fill a sheet, save it, draft the email) in one approval.
  if (['run', 'exec', 'command', 'shell'].includes(verb)) return rest ? { kind: 'exec', params: { command: rest.slice(0, 4000) } } : { error: 'command_required' };
  if (['browse', 'browser_task'].includes(verb)) {
    let plan: unknown = null;
    try { plan = JSON.parse(rest); } catch { /* not JSON */ }
    const steps = Array.isArray(plan) ? { steps: plan } : plan;
    const ok = browserTaskParams(steps);
    return ok ? { kind: 'browser_task', params: ok } : { error: 'browse_needs_a_plan' };
  }
  if (['shortcut', 'shortcuts'].includes(verb)) return APP_NAME.test(rest) ? { kind: 'shortcut', params: { name: rest } } : { error: 'bad_shortcut_name' };
  return { error: 'unknown_action' };
}

/** A computer's result as short text for the employee (never more than `max` characters). */
export function describeComputerResult(kind: ComputerKind, result: unknown, max = 3000): string {
  const r = result && typeof result === 'object' ? result as Record<string, unknown> : {};
  if (kind === 'list' && Array.isArray(r.entries)) {
    return (r.entries as Record<string, unknown>[]).slice(0, 100).map(e => `${e.type === 'dir' || e.dir === true ? '[folder] ' : ''}${String(e.name ?? '')}`).join('\n').slice(0, max) || 'The folder is empty.';
  }
  if (kind === 'read' && typeof r.content === 'string') return r.content.slice(0, max);
  if (kind === 'exec') return `${typeof r.stdout === 'string' ? r.stdout : ''}${typeof r.stderr === 'string' && r.stderr ? `\n[stderr] ${r.stderr}` : ''}`.trim().slice(0, max) || 'The command finished without output.';
  if (kind === 'write') return `Saved ${String(r.path ?? 'the file')} (${String(r.bytes ?? '?')} bytes).`;
  if (kind === 'open_app') return `Opened ${String(r.app ?? 'the app')}.`;
  if (kind === 'shortcut') return `Ran the shortcut ${String(r.name ?? '')}.`;
  if (kind === 'browser_open') return `Opened ${String(r.url ?? 'the page')} in the browser.`;
  if (kind === 'browser_task' && Array.isArray(r.steps)) {
    return (r.steps as Record<string, unknown>[]).map(st => `${String(st.step ?? '')}. ${String(st.action ?? '')}${st.url ? ` ${String(st.url)}` : ''}${typeof st.text === 'string' ? `\n${st.text}` : ''}${typeof st.accessibility === 'string' ? `\n${st.accessibility}` : ''}${st.path ? ` ${String(st.path)}${st.sha256 ? ` sha256:${String(st.sha256)}` : ''}` : ''}`).join('\n').slice(0, max);
  }
  return JSON.stringify(r).slice(0, max);
}
