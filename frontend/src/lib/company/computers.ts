import { FunctionsHttpError } from '@supabase/supabase-js';
import { requireClient } from './client';
import { devicePresence } from './computer-state';

/** What AI employees may do on a computer (same shape as the server's computer-policy.ts). */
export interface ComputerPolicy {
  enabled: boolean;
  control: 'guarded' | 'full';
  apps: string[];
  shortcuts: string[];
  writes: 'auto' | 'ask' | 'off';
  commands: 'safe' | 'ask' | 'off';
  hours: { from: number; to: number; tz: string } | null;
}
export const DEFAULT_APPS = ['Safari', 'Google Chrome', 'Finder', 'Notes', 'Mail', 'Calendar', 'Preview', 'TextEdit', 'Numbers', 'Pages', 'Keynote', 'Microsoft Excel', 'Microsoft Word', 'Visual Studio Code'];
export function policyOf(d: DeviceRow): ComputerPolicy {
  const p = (d.agent_policy ?? {}) as Partial<ComputerPolicy>;
  return { enabled: p.enabled === true, control: p.control === 'full' ? 'full' : 'guarded', apps: Array.isArray(p.apps) ? p.apps : DEFAULT_APPS, shortcuts: Array.isArray(p.shortcuts) ? p.shortcuts : [],
    writes: p.writes ?? 'auto', commands: p.commands ?? 'safe', hours: p.hours ?? null };
}

export interface DeviceRow {
  id: string;
  name: string;
  platform: string | null;
  paired: boolean;
  last_seen_at: string | null;
  capabilities: { job_kinds?: string[]; roots?: string[]; full_control?: boolean } | null;
  agent_policy?: Record<string, unknown> | null;
  revoked_at: string | null;
  created_at: string;
}

export interface JobRow {
  id: string;
  device_id: string;
  kind: 'list' | 'read' | 'write' | 'exec' | 'browser_open' | 'browser_task' | 'open_app' | 'shortcut' | 'desktop_task';
  params: Record<string, unknown>;
  status: 'queued' | 'running' | 'done' | 'error' | 'cancelled';
  result: Record<string, unknown> | null;
  error: string | null;
  created_at: string;
  finished_at: string | null;
  cancel_requested_at?: string | null;
  task_id?: string | null;
  approval_id?: string | null;
  report_sha256?: string | null;
  receipt?: Record<string, unknown> | null;
  origin?: 'owner' | 'approval' | 'agent';
  agent_id?: string | null;
}

export type ComputerErrorCode = 'forbidden' | 'too_many' | 'confirm_required' | 'bad_request' | 'not_found' | 'state_conflict' | 'save_failed' | 'device_required' | 'device_not_ready' | 'action_not_executable' | 'business_plan_required' | 'desktop_setup_required' | 'unknown';
export class ComputerError extends Error {
  constructor(public code: ComputerErrorCode) {
    super(code);
  }
}

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await requireClient().functions.invoke('connector', { body });
  if (error) {
    let code: ComputerErrorCode = 'unknown';
    if (error instanceof FunctionsHttpError) {
      try {
        const b = await error.context.json();
        if (['forbidden', 'too_many', 'confirm_required', 'bad_request', 'not_found', 'state_conflict', 'save_failed', 'device_required', 'device_not_ready', 'action_not_executable','business_plan_required','desktop_setup_required'].includes(b?.error)) code = b.error;
      } catch {
        /* keep unknown */
      }
    }
    throw new ComputerError(code);
  }
  const action = body.action;
  const valid = data && typeof data === 'object' && (
    action === 'create_device' ? typeof data.device_id === 'string' && /^[A-Z2-9]{8}$/.test(data.code) :
    action === 'new_code' ? /^[A-Z2-9]{8}$/.test(data.code) :
    action === 'create_job' ? typeof data.job_id === 'string' && data.job_id.length > 0 :
    action === 'decide_execution' ? ['approved','rejected'].includes(data.decision) : data.ok === true);
  if (!valid) throw new ComputerError('unknown');
  return data as T;
}

export async function listDevices(orgId: string): Promise<DeviceRow[]> {
  const { data, error } = await requireClient()
    .from('connector_devices')
    .select('id, name, platform, paired, last_seen_at, capabilities, agent_policy, revoked_at, created_at')
    .eq('organization_id', orgId)
    .is('revoked_at', null)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as DeviceRow[];
}

export async function listJobs(orgId: string, deviceId: string): Promise<JobRow[]> {
  const { data, error } = await requireClient()
    .from('connector_jobs')
    .select('id, device_id, kind, params, status, result, error, created_at, finished_at, cancel_requested_at, task_id, approval_id, report_sha256, receipt, origin, agent_id')
    .eq('organization_id', orgId)
    .eq('device_id', deviceId)
    .order('created_at', { ascending: false })
    .limit(15);
  if (error) throw new Error(error.message);
  return (data ?? []) as JobRow[];
}

export const addDevice = (organization_id: string, name: string) => call<{ device_id: string; code: string }>({ action: 'create_device', organization_id, name });
export const newPairCode = (device_id: string) => call<{ code: string }>({ action: 'new_code', device_id });
export const removeDevice = (device_id: string) => call<{ ok: true }>({ action: 'revoke_device', device_id });
export const giveJob = (device_id: string, kind: JobRow['kind'], params: Record<string, unknown>, confirm = false) =>
  call<{ job_id: string }>({ action: 'create_job', device_id, kind, params, confirm });
export const setAgentPolicy = (device_id: string, policy: ComputerPolicy) => call<{ ok: true; policy: ComputerPolicy }>({ action: 'set_policy', device_id, policy });
export const cancelJob = (job_id: string) => call<{ ok: true; stop_requested?: boolean; duplicate?: boolean }>({ action: 'cancel_job', job_id });
export const takeControl = (device_id: string) => call<{ ok: true; policy: ComputerPolicy; queued_cancelled: number; running_stop_requested: number }>({ action: 'take_control', device_id });

export const COMPUTER_APPROVAL_ACTIONS = new Set(['file_list','file_read','file_write','shell_exec','computer_list','computer_read','computer_write','computer_exec','browser_open','computer_browser_open','computer_open_app','computer_shortcut','computer_browser_task','computer_desktop_task','desktop_task']);
export const isComputerApprovalAction = (action: string) => COMPUTER_APPROVAL_ACTIONS.has(action.trim().toLowerCase());
export const isNativeComputerApprovalAction = (action: string) => ['computer_desktop_task','desktop_task'].includes(action.trim().toLowerCase());
/** Native task approval is bound to its original goal and worker. A removed
 * device never causes the Inbox to pick another computer automatically. */
export function computerApprovalDevice(approval: { action:string; payload?:unknown }, devices:DeviceRow[], selected?:string):string|undefined {
  const payload=approval.payload && typeof approval.payload==='object' && !Array.isArray(approval.payload)?approval.payload as Record<string,unknown>:{};
  const native=isNativeComputerApprovalAction(approval.action),pinned=typeof payload.device_id==='string'?payload.device_id:undefined;
  if(native&&(!pinned||typeof payload.goal!=='string'||!payload.goal.trim()||payload.goal.length>4000))return undefined;
  const choice=native?pinned:selected??pinned;
  const eligible=devices.filter(d=>d.paired&&!d.revoked_at);
  return choice!==undefined?eligible.find(d=>d.id===choice)?.id:native?undefined:eligible[0]?.id;
}
export const decideComputerApproval = (input: {
  approval_id: string; decision: 'approved'|'rejected'; device_id?: string; note?: string; payload?: Record<string, unknown>;
}) => call<{ decision:'approved'|'rejected'; job_id:string|null; duplicate:boolean }>({
  action:'decide_execution', approval_id:input.approval_id, decision:input.decision,
  ...(input.device_id?{device_id:input.device_id}:{}), ...(input.note?{note:input.note}:{}), ...(input.payload?{payload:input.payload}:{}),
});

/** A computer counts as online while its Connector has asked for work in the last minute. */
export function isOnline(d: DeviceRow, now = Date.now()): boolean {
  return devicePresence(d, now) === 'online';
}
export function canOpenBrowser(d: DeviceRow): boolean {
  return d.paired === true && !d.revoked_at && Array.isArray(d.capabilities?.job_kinds) && d.capabilities!.job_kinds!.includes('browser_open');
}
