import { FunctionsHttpError } from '@supabase/supabase-js';
import { requireClient } from './client';
import { devicePresence } from './computer-state';

export interface DeviceRow {
  id: string;
  name: string;
  platform: string | null;
  paired: boolean;
  last_seen_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export interface JobRow {
  id: string;
  device_id: string;
  kind: 'list' | 'read' | 'write' | 'exec';
  params: Record<string, unknown>;
  status: 'queued' | 'running' | 'done' | 'error' | 'cancelled';
  result: Record<string, unknown> | null;
  error: string | null;
  created_at: string;
  finished_at: string | null;
}

export type ComputerErrorCode = 'forbidden' | 'too_many' | 'confirm_required' | 'bad_request' | 'not_found' | 'state_conflict' | 'save_failed' | 'unknown';
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
        if (['forbidden', 'too_many', 'confirm_required', 'bad_request', 'not_found', 'state_conflict', 'save_failed'].includes(b?.error)) code = b.error;
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
    action === 'create_job' ? typeof data.job_id === 'string' && data.job_id.length > 0 : data.ok === true);
  if (!valid) throw new ComputerError('unknown');
  return data as T;
}

export async function listDevices(orgId: string): Promise<DeviceRow[]> {
  const { data, error } = await requireClient()
    .from('connector_devices')
    .select('id, name, platform, paired, last_seen_at, revoked_at, created_at')
    .eq('organization_id', orgId)
    .is('revoked_at', null)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as DeviceRow[];
}

export async function listJobs(orgId: string, deviceId: string): Promise<JobRow[]> {
  const { data, error } = await requireClient()
    .from('connector_jobs')
    .select('id, device_id, kind, params, status, result, error, created_at, finished_at')
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
export const cancelJob = (job_id: string) => call<{ ok: true }>({ action: 'cancel_job', job_id });

/** A computer counts as online while its Connector has asked for work in the last minute. */
export function isOnline(d: DeviceRow, now = Date.now()): boolean {
  return devicePresence(d, now) === 'online';
}
