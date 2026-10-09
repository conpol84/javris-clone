import { FunctionsHttpError } from '@supabase/supabase-js';
import { requireClient } from './client';

export type DispatchKind = 'browser_open' | 'browser_task' | 'open_app' | 'desktop_task';
export interface WorkerDispatchRequest {
  action: 'preview' | 'dispatch';
  organization_id: string;
  request_id: string;
  kind: DispatchKind;
  params: Record<string, unknown>;
  goal: string;
  target?: string;
  device_id?: string;
  confirm?: true;
  owner_full_control_required?: true;
}
export interface WorkerDispatchReceipt {
  contract: 'firbo-worker-dispatch/v1';
  request_id: string;
  organization_id: string;
  worker: { kind: 'computer'; id: string; name: string; platform: string | null };
  job: { kind: DispatchKind; params: Record<string, unknown> };
  reason: string;
  owner_full_control: boolean;
  job_id?: string;
}
export class WorkerDispatchError extends Error {
  constructor(public code: string) { super(code); }
}

/** Exact approval identity, including nested JSON. No dropped fields/accessors. */
export function dispatchJson(value: unknown): string {
  let nodes = 0;
  const visit = (v: unknown, depth: number): unknown => {
    if (++nodes > 2048 || depth > 12) throw new Error('Invalid action JSON');
    if (v === null || typeof v === 'boolean' || typeof v === 'string') return v;
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (Array.isArray(v)) {
      if (v.length > 2048 || Object.keys(v).length !== v.length || Object.getOwnPropertySymbols(v).length) throw new Error('Invalid action array');
      return Array.from({ length: v.length }, (_, i) => {
        const d = Object.getOwnPropertyDescriptor(v, String(i));
        if (!d || !('value' in d)) throw new Error('Invalid action array');
        return visit(d.value, depth + 1);
      });
    }
    if (typeof v !== 'object' || Object.getPrototypeOf(v) !== Object.prototype || Object.getOwnPropertySymbols(v).length || Object.getOwnPropertyNames(v).length !== Object.keys(v).length) throw new Error('Invalid action value');
    const result: Record<string, unknown> = Object.create(null);
    for (const k of Object.keys(v).sort()) {
      const descriptor = Object.getOwnPropertyDescriptor(v, k)!;
      if (!('value' in descriptor)) throw new Error('Invalid action accessor');
      result[k] = visit(descriptor.value, depth + 1);
    }
    return result;
  };
  const json = JSON.stringify(visit(value, 0));
  if (json.length > 65536) throw new Error('Action too large');
  return json;
}

const uuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
const kinds: DispatchKind[] = ['browser_open', 'browser_task', 'open_app', 'desktop_task'];
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const plain = (v:string) => v.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}\s-]+/gu,' ').replace(/\s+/g,' ').trim();
const targetMatches = (worker:WorkerDispatchReceipt['worker'],target:string) => {
  const name=plain(target),platform=worker.platform??'';
  if(['mac','mac mini','macbook'].includes(name))return /^(?:darwin|macos|mac)(?:\s|$)/i.test(platform);
  if(['linux','debian'].includes(name))return /^linux(?:\s|$)/i.test(platform);
  if(name==='windows')return /^(?:win32|windows)(?:\s|$)/i.test(platform);
  return plain(worker.name)===name;
};

/** A dispatcher may adapt a requested app to a native observed goal,
 * but may not change the target, goal, or an already approved native operation. */
export function workerDispatchReceipt(value: unknown, request: WorkerDispatchRequest): WorkerDispatchReceipt {
  if (!record(value) || value.contract !== 'firbo-worker-dispatch/v1'
    || value.request_id !== request.request_id || value.organization_id !== request.organization_id
    || !record(value.worker) || value.worker.kind !== 'computer' || !uuid(value.worker.id)
    || typeof value.worker.name !== 'string' || !value.worker.name || value.worker.name.length > 200
    || (value.worker.platform !== null && (typeof value.worker.platform !== 'string' || value.worker.platform.length > 200))
    || !record(value.job) || !kinds.includes(value.job.kind as DispatchKind) || !record(value.job.params)
    || typeof value.reason !== 'string' || value.reason.length > 500
    || (value.owner_full_control !== undefined && typeof value.owner_full_control !== 'boolean')
    || (request.device_id && value.worker.id !== request.device_id)
    || (request.action === 'dispatch' ? value.job_id !== request.request_id : value.job_id !== undefined)) {
    throw new WorkerDispatchError('dispatch_receipt_invalid');
  }
  const exact = value.job.kind === request.kind && dispatchJson(value.job.params) === dispatchJson(request.params);
  const native = request.kind === 'open_app' && value.job.kind === 'desktop_task'
    && dispatchJson(value.job.params) === dispatchJson({ goal: request.goal });
  if ((!exact && !native) || (request.target && !targetMatches(value.worker as unknown as WorkerDispatchReceipt['worker'],request.target))) throw new WorkerDispatchError('dispatch_receipt_invalid');
  // Only the current central authorization can enable hands-free execution.
  // Older responses without the marker stay in the guarded approval lane.
  return { ...JSON.parse(dispatchJson(value)), owner_full_control: value.owner_full_control === true } as WorkerDispatchReceipt;
}

/** One authenticated central call. Transport ambiguity is never retried locally
 * or replaced with a direct Connector job. */
export async function dispatchWorkerRequest(input: WorkerDispatchRequest, signal?: AbortSignal): Promise<WorkerDispatchReceipt> {
  const request = JSON.parse(dispatchJson(input)) as WorkerDispatchRequest;
  if (!uuid(request.request_id) || !uuid(request.organization_id) || !kinds.includes(request.kind)
    || !record(request.params) || typeof request.goal !== 'string' || !request.goal.trim() || request.goal.length > 4000
    || (request.device_id !== undefined && !uuid(request.device_id))
    || (request.target !== undefined && (typeof request.target !== 'string' || !request.target || request.target.length > 100))
    || (request.action !== 'preview' && request.action !== 'dispatch')
    || (request.owner_full_control_required !== undefined && (request.owner_full_control_required !== true || request.action !== 'dispatch'))
    || (request.action === 'dispatch' ? request.confirm !== true : request.confirm !== undefined)) {
    throw new WorkerDispatchError('bad_request');
  }
  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
  const { data, error } = await requireClient().functions.invoke('computer-dispatch', { body: JSON.parse(dispatchJson(request)), signal });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const body = await error.context.json().catch(() => null);
      const allowed = ['forbidden', 'business_plan_required', 'desktop_setup_required', 'device_required', 'device_not_ready', 'unsupported_app', 'no_eligible_worker', 'target_unavailable', 'target_ambiguous', 'dispatcher_not_configured', 'dispatch_unavailable', 'dispatch_enqueue_uncertain', 'request_conflict'];
      if (allowed.includes(body?.error)) throw new WorkerDispatchError(body.error);
    }
    throw new WorkerDispatchError('dispatch_unavailable');
  }
  return workerDispatchReceipt(data, request);
}
