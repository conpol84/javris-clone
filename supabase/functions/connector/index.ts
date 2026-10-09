// Firbo Connector service: pairs a computer, hands it approved jobs and takes the results back.
//
// Two kinds of callers, two kinds of proof:
//  - people in the Firbo app send their Supabase session (JWT). Only owners and admins may add, revoke or give work.
//  - the Connector program on the computer sends its own device token (random, stored only as a SHA-256 hash).
// The computer's owner stays in control locally: the program enforces its own allowed folders and refuses anything
// it was not started with (no writing, no commands) no matter what this service sends.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { advancedComputerKind, desktopEntitled, desktopAuthorization, planDesktopStep } from '../_shared/desktop-planner.ts';
import { APP_NAME, browserTaskParams, cleanPolicy } from '../_shared/computer-policy.ts';
import { canonicalDispatch, validatedDispatchRecord } from '../_shared/worker-dispatch.ts';
import { finalizePendingComputerExecution } from '../_shared/worker-execution.ts';

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json', 'cache-control': 'no-store' } });

const OWNERS = ['owner', 'admin'];
const MAX_DEVICES = 5;
const MAX_QUEUED = 10;
const JOB_MAX_AGE_MS = 10 * 60_000;
const PAIR_TTL_MS = 10 * 60_000;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}
function randomCode(n: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}
function randomToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('');
}
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const DEVICE_JOB_KINDS = new Set(['list','read','write','exec','browser_open','browser_task','open_app','shortcut','desktop_task']);
function browserUrl(value: unknown): string | null {
  const raw = str(value, 2048).trim();
  if (!raw || /[\r\n\0]/.test(raw)) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || !url.hostname || url.hostname === 'localhost') return null;
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(url.hostname) || url.hostname.includes(':')) return null;
    return url.href;
  } catch { return null; }
}
function cleanClientCapabilities(value: unknown): { job_kinds: string[]; roots?: string[]; full_control?: boolean } {
  const record = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const kinds = Array.isArray(record.job_kinds) ? record.job_kinds.filter((x): x is string => typeof x === 'string' && DEVICE_JOB_KINDS.has(x)) : [];
  // The computer's allowed folders, so AI employees ask for paths that exist. Plain path strings only.
  const roots = Array.isArray(record.roots) ? record.roots.filter((x): x is string => typeof x === 'string' && x.length <= 300 && !/[\0\r\n]/.test(x)) : [];
  const base = { job_kinds: [...new Set(kinds)].slice(0, 9), ...(record.full_control === true ? { full_control: true } : {}) };
  return roots.length ? { ...base, roots: roots.slice(0, 8) } : base;
}

export const COMPUTER_APPROVAL_ACTIONS = new Set(['file_list','file_read','file_write','shell_exec','computer_list','computer_read','computer_write','computer_exec','browser_open','computer_browser_open','computer_open_app','computer_shortcut','computer_browser_task','computer_desktop_task']);
export function executionForApproval(action: string, payload: Record<string, unknown>): { kind: 'list'|'read'|'write'|'exec'|'browser_open'|'browser_task'|'open_app'|'shortcut'|'desktop_task'; params: Record<string, unknown> } | null {
  const name=action.trim().toLowerCase();
  const path=str(payload.path,500);
  if (name==='file_list'||name==='computer_list') return {kind:'list',params:{path}};
  if (name==='file_read'||name==='computer_read') return path?{kind:'read',params:{path}}:null;
  if (name==='file_write'||name==='computer_write') return path?{kind:'write',params:{path,content:str(payload.content,100_000),overwrite:payload.overwrite===true}}:null;
  if (name==='shell_exec'||name==='computer_exec') {
    const command=str(payload.command,4000); return command?{kind:'exec',params:{command,cwd:str(payload.cwd,500)}}:null;
  }
  if (name==='browser_open'||name==='computer_browser_open') {
    const url=browserUrl(payload.url); return url?{kind:'browser_open',params:{url}}:null;
  }
  if (name==='computer_open_app') { const app=str(payload.app,60).trim(); return APP_NAME.test(app)?{kind:'open_app',params:{app}}:null; }
  if (name==='computer_shortcut') { const shortcut=str(payload.name,60).trim(); return APP_NAME.test(shortcut)?{kind:'shortcut',params:{name:shortcut}}:null; }
  // An employee's browser plan: only its steps and time limit go to the computer, which shows the plan to its owner again.
  if (name==='computer_browser_task') { const plan=browserTaskParams({steps:payload.steps,...(payload.timeout_ms===undefined?{}:{timeout_ms:payload.timeout_ms})}); return plan?{kind:'browser_task',params:plan}:null; }
  if(name==='computer_desktop_task'){const goal=typeof payload.goal==='string'?payload.goal.trim():'';return goal&&goal.length<=4000?{kind:'desktop_task',params:{goal}}:null;}
  return null;
}



/** Stable canonical JSON shared with the device's receipt calculation. */
function canonicalReportValue(value: unknown, depth = 0): string {
  if (depth > 32) throw new Error('bad_report');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(item => canonicalReportValue(item, depth + 1)).join(',') + ']';
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return '{' + Object.keys(object).sort().map(key => JSON.stringify(key) + ':' + canonicalReportValue(object[key], depth + 1)).join(',') + '}';
  }
  throw new Error('bad_report');
}

/** Bound the actual body stream, not just an untrusted Content-Length. */
async function boundedBody(req: Request): Promise<Record<string, any>> {
  if (!req.body) throw new Error('bad_request');
  const reader = req.body.getReader();
  let stopped = false, size = 0;
  const parts: Uint8Array[] = [];
  const stop = () => { stopped = true; void reader.cancel().catch(() => {}); };
  const timer = setTimeout(stop, 10_000);
  req.signal.addEventListener('abort', stop, { once: true });
  try {
    if (req.signal.aborted) throw new Error('bad_request');
    for (;;) {
      const part = await reader.read();
      if (stopped) throw new Error('bad_request');
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 256_000) throw new Error('too_large');
      parts.push(part.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
    const data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('bad_request');
    return data;
  } finally {
    clearTimeout(timer); req.signal.removeEventListener('abort', stop);
    void reader.cancel().catch(() => {}); reader.releaseLock();
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  let body: Record<string, any> = {};
  try {
    body = await boundedBody(req);
  } catch (error) {
    return json(error instanceof Error && error.message === 'too_large' ? 413 : 400, { error: 'bad_request' });
  }
  const action = String(body.action ?? '');

  // ------------------------------------------------------------------ device side (no login, device token)
  if (action === 'pair') {
    const code = str(body.code, 20).toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length < 8) return json(400, { error: 'bad_code' });
    const { data: sec } = await admin.from('connector_secrets').select('device_id, pair_expires_at').eq('pair_code_hash', await sha256(code)).maybeSingle();
    if (!sec || !sec.pair_expires_at || new Date(sec.pair_expires_at).getTime() < Date.now()) return json(404, { error: 'bad_code' });
    const token = randomToken();
    await admin.from('connector_secrets').update({ token_hash: await sha256(token), pair_code_hash: null, pair_expires_at: null }).eq('device_id', sec.device_id);
    const { data: dev } = await admin
      .from('connector_devices')
      .update({ paired: true, platform: str(body.platform, 60) || null, last_seen_at: new Date().toISOString() })
      .eq('id', sec.device_id)
      .is('revoked_at', null)
      .select('name, organization_id')
      .single();
    if (!dev) return json(404, { error: 'bad_code' });
    return json(200, { token, device_name: dev.name });
  }

  if (action === 'poll' || action === 'report' || action === 'capabilities' || action === 'control' || action === 'desktop_plan') {
    const token = str(body.token, 100);
    if (!/^[a-f0-9]{64}$/.test(token)) return json(401, { error: 'unauthorized' });
    const { data: sec, error: secretError } = await admin.from('connector_secrets').select('device_id').eq('token_hash', await sha256(token)).maybeSingle();
    if (secretError) return json(503, { error: 'device_auth_unavailable' });
    if (!sec) return json(401, { error: 'unauthorized' });
    const { data: dev, error: deviceError } = await admin.from('connector_devices').select('id, organization_id, paired, revoked_at, capabilities, agent_policy').eq('id', sec.device_id).maybeSingle();
    if (deviceError) return json(503, { error: 'device_auth_unavailable' });
    if (!dev || dev.revoked_at || dev.paired !== true) return json(401, { error: 'revoked' });

    if (action === 'desktop_plan') {
      const {data:job,error}=await admin.from('connector_jobs').select('id,kind,params,organization_id,device_id,created_by,status,cancel_requested_at,origin,agent_task_id,agent_id,agent_run_claim')
        .eq('id',str(body.job_id,60)).eq('device_id',dev.id).eq('organization_id',dev.organization_id).maybeSingle();
      if(error||!job||job.kind!=='desktop_task'||!await desktopAuthorization(admin,dev,job))return json(403,{error:'desktop_not_authorized'});
      try {
        const next=await planDesktopStep(admin,dev,job,body,req.signal,name=>Deno.env.get(name));
        // Authorization can change while the provider is thinking. The client
        // also calls control before applying input.
        const [{data:fresh},{data:current}]=await Promise.all([
          admin.from('connector_devices').select('*').eq('id',dev.id).eq('organization_id',dev.organization_id).maybeSingle(),
          admin.from('connector_jobs').select('*').eq('id',job.id).eq('device_id',dev.id).eq('organization_id',dev.organization_id).maybeSingle(),
        ]);
        if(!current||!await desktopAuthorization(admin,fresh,current))return json(403,{error:'desktop_not_authorized'});
        return json(200,next);
      }catch(error){return json(503,{error:error instanceof Error&&/^desktop_[a-z_]+$/.test(error.message)?error.message:'desktop_planning_failed'});}
    }

    if (action === 'capabilities') {
      const capabilities = cleanClientCapabilities(body.client_capabilities);
      const { error: capabilityError } = await admin.from('connector_devices').update({ capabilities }).eq('id', dev.id);
      if (capabilityError) return json(503, { error: 'capability_save_failed' });
      return json(200, {
        protocol: 'firbo-connector/v2', report_ack: 'sha256-v1',
        result_max_bytes: 140_000, queued_cancel_only: false,
        remote_stop: true, running_stop: 'cancel-request-v1',
        automatic_interrupted_reexecution: false,
        accepted_job_kinds: [...DEVICE_JOB_KINDS],
      });
    }

    if (action === 'control') {
      const jobId = str(body.job_id, 60);
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(jobId)) return json(400, { error: 'bad_request' });
      const { data: job, error: controlError } = await admin.from('connector_jobs')
        .select('id,status,cancel_requested_at,kind,organization_id,device_id,created_by')
        .eq('id', jobId).eq('device_id', dev.id).eq('organization_id', dev.organization_id).maybeSingle();
      if (controlError) return json(503, { error: 'control_unavailable' });
      if (!job) return json(404, { error: 'not_found' });
      let entitlementLost=false;
      if(advancedComputerKind(job.kind)){
        const {data:org,error}=await admin.from('organizations').select('plan,plan_status,status').eq('id',dev.organization_id).maybeSingle();
        entitlementLost=!!error||!desktopEntitled(org);
      }
      await admin.from('connector_devices').update({ last_seen_at: new Date().toISOString() }).eq('id', dev.id);
      return json(200, {
        ok: true,
        job_id: job.id,
        status: job.status,
        stop: job.status === 'running' && (!!job.cancel_requested_at || entitlementLost || (job.kind==='desktop_task' && !await desktopAuthorization(admin,dev,job))),
        terminal: ['done','error','cancelled'].includes(job.status),
      });
    }

    if (action === 'report') {
      const jobId = str(body.job_id, 60);
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(jobId) || typeof body.ok !== 'boolean') return json(400, { error: 'bad_report' });
      const ok = body.ok;
      const result = ok ? (body.result ?? null) : null;
      if (result !== null && (typeof result !== 'object' || Array.isArray(result))) return json(400, { error: 'bad_report' });
      const reportError = ok ? null : str(body.error, 500) || 'failed';
      let canonical: string;
      try { canonical = canonicalReportValue({ job_id: jobId, ok, result, error: reportError }); }
      catch { return json(400, { error: 'bad_report' }); }
      if (new TextEncoder().encode(canonical).byteLength > 150_000) return json(413, { error: 'too_large' });
      const digest = await sha256(canonical);
      if (body.report_sha256 !== undefined && body.report_sha256 !== digest) return json(400, { error: 'report_hash_mismatch' });
      const { data: finished, error: finishError } = await admin.rpc('connector_finish_execution', {
        p_job: jobId, p_device: dev.id, p_org: dev.organization_id, p_ok: ok,
        p_result: result, p_error: reportError, p_digest: digest,
      });
      if (finishError) {
        const message=String(finishError.message??'');
        if (/job_not_found/.test(message)) return json(404,{error:'not_found'});
        if (/state_conflict|report_conflict/.test(message)) return json(409,{error:'state_conflict'});
        return json(503,{error:'save_failed'});
      }
      // Best effort report finalization is claim-bound and contains no new effect.
      // A repeated durable report can safely finish a delayed parent publication.
      try{
        const{data:reported}=await admin.from('connector_jobs').select('agent_task_id,agent_run_claim,origin').eq('id',jobId).eq('device_id',dev.id).eq('organization_id',dev.organization_id).maybeSingle();
        if(reported?.origin==='agent'&&reported.agent_task_id)await finalizePendingComputerExecution(admin,reported.agent_task_id,dev.organization_id,reported.agent_run_claim);
      }catch{/* The execution ACK is durable; parent readback remains resumable. */}
      return json(200,{ok:true,job_id:jobId,report_sha256:digest,duplicate:finished?.duplicate===true,receipt:finished?.receipt??null});
    }

    // poll: hold the request open for a while so jobs start almost instantly without hammering the service
    const until = Date.now() + 20_000;
    await admin.from('connector_devices').update({ last_seen_at: new Date().toISOString() }).eq('id', dev.id);
    while (Date.now() < until) {
      const { data: next, error: claimError } = await admin.rpc('connector_claim_next_job', {
        p_org: dev.organization_id, p_device: dev.id,
        p_min_created: new Date(Date.now() - JOB_MAX_AGE_MS).toISOString(),
      });
      if (claimError) return json(503, { error: 'job_claim_unavailable' });
      if (next) return json(200, { job: next });
      await sleep(1500);
    }
    return json(200, { job: null });
  }

  // ------------------------------------------------------------------ people side (Supabase session)
  const userClient = createClient(url, anon, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
  const { data: who } = await userClient.auth.getUser();
  const user = who?.user;
  if (!user) return json(401, { error: 'unauthorized' });
  const roleIn = async (orgId: string) => {
    const { data } = await admin.from('organization_members').select('role').eq('organization_id', orgId).eq('user_id', user.id).maybeSingle();
    return data?.role as string | undefined;
  };
  const audit = (orgId: string, act: string, entityId: string | null, meta: Record<string, unknown>) =>
    admin.from('audit_log').insert({ organization_id: orgId, actor_id: user.id, action: act, entity: 'connector', entity_id: entityId, metadata: meta });

  if (action === 'decide_execution') {
    const approvalId=str(body.approval_id,60);
    const decision=String(body.decision??'');
    if (!/^[0-9a-f-]{36}$/i.test(approvalId) || !['approved','rejected'].includes(decision)) return json(400,{error:'bad_request'});
    const { data: approval, error: approvalError } = await admin.from('approvals')
      .select('id,organization_id,task_id,action,payload,status').eq('id',approvalId).maybeSingle();
    if (approvalError) return json(503,{error:'save_failed'});
    if (!approval) return json(404,{error:'not_found'});
    if (!OWNERS.includes((await roleIn(approval.organization_id)) ?? '')) return json(403,{error:'forbidden'});
    const edited = body.payload && typeof body.payload==='object' && !Array.isArray(body.payload) ? body.payload as Record<string,unknown> : approval.payload as Record<string,unknown>;
    let deviceId: string | null=null, kind: string | null=null, params: Record<string,unknown>|null=null;
    if (decision==='approved') {
      const execution=executionForApproval(String(approval.action??''),edited??{});
      if (!execution) return json(422,{error:'action_not_executable'});
      deviceId=str(body.device_id,60);
      if (!/^[0-9a-f-]{36}$/i.test(deviceId)) return json(400,{error:'device_required'});
      const { data: dev }=await admin.from('connector_devices').select('id,organization_id,paired,revoked_at,capabilities,agent_policy,last_seen_at').eq('id',deviceId).maybeSingle();
      if (!dev || dev.organization_id!==approval.organization_id || !dev.paired || dev.revoked_at) return json(404,{error:'device_not_ready'});
      // Browser control runs only on a computer whose owner turned it on there.
      if (execution.kind==='browser_task' && !(Array.isArray(dev.capabilities?.job_kinds) && dev.capabilities.job_kinds.includes('browser_task'))) return json(409,{error:'device_not_ready'});
      if(execution.kind==='desktop_task'){
        if(approval.payload?.device_id!==deviceId||canonicalDispatch(edited)!==canonicalDispatch(approval.payload))return json(409,{error:'request_conflict'});
        const{data:org,error}=await admin.from('organizations').select('plan,plan_status,status').eq('id',approval.organization_id).maybeSingle();
        if(error)return json(503,{error:'entitlement_unavailable'});if(!desktopEntitled(org))return json(403,{error:'business_plan_required'});
        if(!Deno.env.get('FIRBO_DESKTOP_VISION_MODEL')||!Deno.env.get('FIRBO_DESKTOP_PRICE_IN_PER_M')||!Deno.env.get('FIRBO_DESKTOP_PRICE_OUT_PER_M'))return json(503,{error:'desktop_setup_required'});
        if(dev.agent_policy?.enabled!==true||dev.agent_policy?.control!=='full'||dev.capabilities?.full_control!==true||!dev.capabilities?.job_kinds?.includes('desktop_task')
          ||!dev.last_seen_at||!Number.isFinite(Date.parse(dev.last_seen_at))||Date.now()-Date.parse(dev.last_seen_at)>60000)return json(409,{error:'device_not_ready'});
      }
      kind=execution.kind;params=execution.params;
    }
    const { data: decided, error: decideError } = await admin.rpc('connector_decide_execution', {
      p_approval: approval.id, p_actor: user.id, p_device: deviceId, p_decision: decision,
      p_note: str(body.note,500)||null, p_payload: edited??{}, p_kind: kind, p_params: params,
    });
    if (decideError) {
      const message=String(decideError.message??'');
      if (/forbidden/.test(message)) return json(403,{error:'forbidden'});
      if (/not_found|device_not_ready/.test(message)) return json(404,{error:'not_found'});
      if (/too_many/.test(message)) return json(429,{error:'too_many'});
      if (/state_conflict/.test(message)) return json(409,{error:'state_conflict'});
      return json(503,{error:'save_failed'});
    }
    return json(200,{decision:decided?.decision,job_id:decided?.job_id??null,duplicate:decided?.duplicate===true});
  }

    if (action === 'create_device') {
    const orgId = str(body.organization_id, 60);
    const name = str(body.name, 60).trim();
    if (!orgId || !name) return json(400, { error: 'bad_request' });
    if (!OWNERS.includes((await roleIn(orgId)) ?? '')) return json(403, { error: 'forbidden' });
    const { count } = await admin.from('connector_devices').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).is('revoked_at', null);
    if ((count ?? 0) >= MAX_DEVICES) return json(429, { error: 'too_many' });
    const { data: dev, error } = await admin.from('connector_devices').insert({ organization_id: orgId, created_by: user.id, name }).select('id').single();
    if (error || !dev) return json(500, { error: 'save_failed' });
    const code = randomCode(8);
    await admin.from('connector_secrets').insert({ device_id: dev.id, pair_code_hash: await sha256(code), pair_expires_at: new Date(Date.now() + PAIR_TTL_MS).toISOString() });
    await audit(orgId, 'connector.device_added', dev.id, { name });
    return json(200, { device_id: dev.id, code });
  }

  if (action === 'new_code') {
    const { data: dev } = await admin.from('connector_devices').select('id, organization_id, paired, revoked_at').eq('id', str(body.device_id, 60)).maybeSingle();
    if (!dev || dev.revoked_at || dev.paired) return json(404, { error: 'not_found' });
    if (!OWNERS.includes((await roleIn(dev.organization_id)) ?? '')) return json(403, { error: 'forbidden' });
    const code = randomCode(8);
    await admin.from('connector_secrets').update({ pair_code_hash: await sha256(code), pair_expires_at: new Date(Date.now() + PAIR_TTL_MS).toISOString() }).eq('device_id', dev.id);
    return json(200, { code });
  }

  if (action === 'revoke_device') {
    const { data: dev } = await admin.from('connector_devices').select('id, organization_id, name').eq('id', str(body.device_id, 60)).maybeSingle();
    if (!dev) return json(404, { error: 'not_found' });
    if (!OWNERS.includes((await roleIn(dev.organization_id)) ?? '')) return json(403, { error: 'forbidden' });
    await admin.from('connector_devices').update({ revoked_at: new Date().toISOString() }).eq('id', dev.id);
    await admin.from('connector_secrets').update({ token_hash: null, pair_code_hash: null }).eq('device_id', dev.id);
    await admin.from('connector_jobs').update({ status: 'cancelled', finished_at: new Date().toISOString() }).eq('device_id', dev.id).in('status', ['queued', 'running']);
    await audit(dev.organization_id, 'connector.device_revoked', dev.id, { name: dev.name });
    return json(200, { ok: true });
  }

  if (action === 'take_control') {
    const { data: dev } = await admin.from('connector_devices')
      .select('id, organization_id, name, agent_policy, revoked_at')
      .eq('id', str(body.device_id, 60)).maybeSingle();
    if (!dev || dev.revoked_at) return json(404, { error: 'not_found' });
    if (!OWNERS.includes((await roleIn(dev.organization_id)) ?? '')) return json(403, { error: 'forbidden' });

    // Fail closed: disable future AI work before touching active jobs.
    const current = dev.agent_policy && typeof dev.agent_policy === 'object' && !Array.isArray(dev.agent_policy)
      ? dev.agent_policy as Record<string, unknown> : {};
    const policy = cleanPolicy({ ...current, enabled: false });
    const { error: policyError } = await admin.from('connector_devices').update({ agent_policy: policy }).eq('id', dev.id);
    if (policyError) return json(503, { error: 'save_failed' });

    const now = new Date().toISOString();
    const { data: queued, error: queuedError } = await admin.from('connector_jobs')
      .update({ status: 'cancelled', finished_at: now })
      .eq('device_id', dev.id).eq('organization_id', dev.organization_id).eq('status', 'queued')
      .select('id');
    if (queuedError) return json(503, { error: 'save_failed' });

    // A running effect is not called cancelled until the paired computer
    // actually interrupts it and returns the durable final receipt.
    const { data: running, error: runningError } = await admin.from('connector_jobs')
      .update({ cancel_requested_at: now })
      .eq('device_id', dev.id).eq('organization_id', dev.organization_id).eq('status', 'running')
      .is('cancel_requested_at', null).select('id');
    if (runningError) return json(503, { error: 'save_failed' });

    await audit(dev.organization_id, 'connector.take_control', dev.id, {
      name: dev.name,
      queued_cancelled: queued?.length ?? 0,
      running_stop_requested: running?.length ?? 0,
    });
    return json(200, {
      ok: true,
      policy,
      queued_cancelled: queued?.length ?? 0,
      running_stop_requested: running?.length ?? 0,
    });
  }

  if (action === 'create_job') {
    const requestId=body.request_id;
    if(requestId!==undefined&&(typeof requestId!=='string'||! /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(requestId)))return json(400,{error:'bad_request'});
    const { data: dev } = await admin.from('connector_devices').select('id, organization_id, paired, revoked_at, name, platform, capabilities, last_seen_at, agent_policy').eq('id', str(body.device_id, 60)).maybeSingle();
    if (!dev || dev.revoked_at || !dev.paired) return json(404, { error: 'not_found' });
    if (!OWNERS.includes((await roleIn(dev.organization_id)) ?? '')) return json(403, { error: 'forbidden' });
    const kind = String(body.kind ?? '');
    if(advancedComputerKind(kind)){
      const {data:org,error}=await admin.from('organizations').select('plan,plan_status,status').eq('id',dev.organization_id).maybeSingle();
      if(error)return json(503,{error:'entitlement_unavailable'});
      if(!desktopEntitled(org))return json(403,{error:'business_plan_required'});
    }
    const p = (body.params ?? {}) as Record<string, unknown>;
    let params: Record<string, unknown>;
    if(kind==='desktop_task'){
      if(!Deno.env.get('FIRBO_DESKTOP_VISION_MODEL')||!Deno.env.get('FIRBO_DESKTOP_PRICE_IN_PER_M')||!Deno.env.get('FIRBO_DESKTOP_PRICE_OUT_PER_M'))return json(503,{error:'desktop_setup_required'});
      if(body.confirm!==true)return json(400,{error:'confirm_required'});
      if(dev.agent_policy?.enabled!==true||dev.agent_policy?.control!=='full'||dev.capabilities?.full_control!==true||!dev.capabilities?.job_kinds?.includes(kind)||!dev.last_seen_at||!Number.isFinite(Date.parse(dev.last_seen_at))||Date.now()-Date.parse(dev.last_seen_at)>60000)return json(409,{error:'device_not_ready'});
      if(typeof p.goal!=='string'||!p.goal.trim()||p.goal.length>4000)return json(400,{error:'bad_request'});
      params={goal:p.goal.trim()};
    } else if (kind === 'list') {
      params = { path: str(p.path, 500) };
    } else if (kind === 'read') {
      params = { path: str(p.path, 500) };
      if (!params.path) return json(400, { error: 'bad_request' });
    } else if (kind === 'write') {
      if (body.confirm !== true) return json(400, { error: 'confirm_required' });
      params = { path: str(p.path, 500), content: str(p.content, 100_000), overwrite: p.overwrite === true };
      if (!params.path) return json(400, { error: 'bad_request' });
    } else if (kind === 'exec') {
      if (body.confirm !== true) return json(400, { error: 'confirm_required' });
      params = { command: str(p.command, 4000), cwd: str(p.cwd, 500) };
      if (!params.command) return json(400, { error: 'bad_request' });
    } else if (kind === 'browser_open') {
      const url = browserUrl(p.url);
      if (!url) return json(400, { error: 'bad_request' });
      params = { url };
    } else if (kind === 'open_app' || kind === 'shortcut') {
      const name = str(kind === 'open_app' ? p.app : p.name, 60).trim();
      if (!APP_NAME.test(name)) return json(400, { error: 'bad_request' });
      params = kind === 'open_app' ? { app: name } : { name };
    } else if (kind === 'browser_task') {
      if(body.confirm!==true)return json(400,{error:'confirm_required'});
      if(!Array.isArray(dev.capabilities?.job_kinds)||!dev.capabilities.job_kinds.includes('browser_task')||!dev.last_seen_at||Date.now()-Date.parse(dev.last_seen_at)>60_000||!Number.isFinite(Date.parse(dev.last_seen_at)))return json(409,{error:'device_not_ready'});
      const plan=browserTaskParams(p);if(!plan)return json(400,{error:'bad_request'});
      params=plan;
    } else {
      return json(400, { error: 'bad_request' });
    }
    let dispatchRecord:Record<string,unknown>|null=null;
    try{dispatchRecord=validatedDispatchRecord(body.dispatch_request,requestId,dev,kind,params);}catch{return json(409,{error:'request_conflict'});}
    const existing=async()=>admin.from('connector_jobs').select('id,organization_id,device_id,created_by,kind,params,dispatch_request,origin').eq('id',requestId).eq('organization_id',dev.organization_id).maybeSingle();
    const matches=(j:any)=>j&&j.created_by===user.id&&j.device_id===dev.id&&j.kind===kind&&j.origin!=='agent'
      &&canonicalDispatch(j.params)===canonicalDispatch(params)&&canonicalDispatch(j.dispatch_request??null)===canonicalDispatch(dispatchRecord);
    if(requestId){const{data:prior,error}=await existing();if(error)return json(503,{error:'save_failed'});if(prior)return matches(prior)?json(200,{job_id:prior.id,duplicate:true}):json(409,{error:'request_conflict'});}
    const { count } = await admin.from('connector_jobs').select('id', { count: 'exact', head: true }).eq('device_id', dev.id).eq('status', 'queued');
    if ((count ?? 0) >= MAX_QUEUED) return json(429, { error: 'too_many' });
    const { data: job, error } = await admin.from('connector_jobs').insert({...(requestId?{id:requestId}:{}),...(dispatchRecord?{dispatch_request:dispatchRecord}:{}), organization_id: dev.organization_id, device_id: dev.id, created_by: user.id, kind, params }).select('id').single();
    if(error?.code==='23505'&&requestId){const{data:prior,error:re}=await existing();if(re)return json(503,{error:'save_failed'});return matches(prior)?json(200,{job_id:prior.id,duplicate:true}):json(409,{error:'request_conflict'});}
    if (error || !job) return json(500, { error: 'save_failed' });
    await audit(dev.organization_id, 'connector.job', job.id, { device: dev.name, kind, path: params.path ?? null, command: params.command ?? null, browser_host: params.url ? new URL(String(params.url)).hostname : null });
    return json(200, { job_id: job.id });
  }

  // What AI employees may do on this computer (owners and admins). Stored cleaned; the agent runner reads it again before every job.
  if (action === 'set_policy') {
    const { data: dev } = await admin.from('connector_devices').select('id, organization_id, revoked_at, name').eq('id', str(body.device_id, 60)).maybeSingle();
    if (!dev || dev.revoked_at) return json(404, { error: 'not_found' });
    if (!OWNERS.includes((await roleIn(dev.organization_id)) ?? '')) return json(403, { error: 'forbidden' });
    const policy = cleanPolicy(body.policy);
    const { error } = await admin.from('connector_devices').update({ agent_policy: policy }).eq('id', dev.id);
    if (error) return json(503, { error: 'save_failed' });
    await audit(dev.organization_id, 'connector.agent_policy', dev.id, { name: dev.name, enabled: policy.enabled, writes: policy.writes, commands: policy.commands, apps: policy.apps.length, hours: policy.hours });
    return json(200, { ok: true, policy });
  }

  if (action === 'cancel_job') {
    const { data: job } = await admin.from('connector_jobs').select('id, organization_id, device_id, status, cancel_requested_at').eq('id', str(body.job_id, 60)).maybeSingle();
    if (!job) return json(404, { error: 'not_found' });
    if (!OWNERS.includes((await roleIn(job.organization_id)) ?? '')) return json(403, { error: 'forbidden' });

    if (job.status === 'queued') {
      // A queued job may be claimed between the read and the update. No matched row
      // means no cancellation; never claim success for work that already started.
      const { data: cancelled, error: cancelError } = await admin.from('connector_jobs')
        .update({ status: 'cancelled', finished_at: new Date().toISOString() })
        .eq('id', job.id).eq('status', 'queued').select('id').maybeSingle();
      if (cancelError) return json(503, { error: 'save_failed' });
      if (!cancelled) return json(409, { error: 'state_conflict' });
      return json(200, { ok: true, stop_requested: false });
    }

    if (job.status === 'running') {
      if (job.cancel_requested_at) return json(200, { ok: true, stop_requested: true, duplicate: true });
      const requestedAt = new Date().toISOString();
      const { data: requested, error: stopError } = await admin.from('connector_jobs')
        .update({ cancel_requested_at: requestedAt })
        .eq('id', job.id).eq('status', 'running').is('cancel_requested_at', null).select('id').maybeSingle();
      if (stopError) return json(503, { error: 'save_failed' });
      if (!requested) return json(409, { error: 'state_conflict' });
      return json(200, { ok: true, stop_requested: true, duplicate: false });
    }

    return json(409, { error: 'state_conflict' });
  }

  return json(400, { error: 'bad_request' });
});
