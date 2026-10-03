// Firbo Connector service: pairs a computer, hands it approved jobs and takes the results back.
//
// Two kinds of callers, two kinds of proof:
//  - people in the Firbo app send their Supabase session (JWT). Only owners and admins may add, revoke or give work.
//  - the Connector program on the computer sends its own device token (random, stored only as a SHA-256 hash).
// The computer's owner stays in control locally: the program enforces its own allowed folders and refuses anything
// it was not started with (no writing, no commands) no matter what this service sends.
import { createClient } from 'npm:@supabase/supabase-js@2';

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

  if (action === 'poll' || action === 'report' || action === 'capabilities') {
    const token = str(body.token, 100);
    if (!/^[a-f0-9]{64}$/.test(token)) return json(401, { error: 'unauthorized' });
    const { data: sec, error: secretError } = await admin.from('connector_secrets').select('device_id').eq('token_hash', await sha256(token)).maybeSingle();
    if (secretError) return json(503, { error: 'device_auth_unavailable' });
    if (!sec) return json(401, { error: 'unauthorized' });
    const { data: dev, error: deviceError } = await admin.from('connector_devices').select('id, organization_id, paired, revoked_at').eq('id', sec.device_id).maybeSingle();
    if (deviceError) return json(503, { error: 'device_auth_unavailable' });
    if (!dev || dev.revoked_at || dev.paired !== true) return json(401, { error: 'revoked' });

    if (action === 'capabilities') return json(200, {
      protocol: 'firbo-connector/v2', report_ack: 'sha256-v1',
      result_max_bytes: 140_000, queued_cancel_only: true,
      remote_stop: false, automatic_interrupted_reexecution: false,
    });

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
      const ack = (duplicate: boolean) => json(200, { ok: true, job_id: jobId, report_sha256: digest, duplicate });
      const { data: done, error: saveError } = await admin
        .from('connector_jobs')
        .update({ status: ok ? 'done' : 'error', result, error: reportError, finished_at: new Date().toISOString() })
        .eq('id', jobId)
        .eq('device_id', dev.id)
        .eq('organization_id', dev.organization_id)
        .eq('status', 'running')
        .select('id')
        .maybeSingle();
      if (saveError) return json(503, { error: 'save_failed' });
      if (done) return ack(false);
      // The first receipt may have been lost AFTER the conditional write committed.
      // Re-acknowledge ONLY the same terminal result, never replace it or rerun work.
      const { data: prior, error: readError } = await admin.from('connector_jobs')
        .select('id,status,result,error').eq('id', jobId).eq('device_id', dev.id)
        .eq('organization_id', dev.organization_id).maybeSingle();
      if (readError) return json(503, { error: 'receipt_unavailable' });
      if (!prior) return json(404, { error: 'not_found' });
      if (prior.status !== (ok ? 'done' : 'error')) return json(409, { error: 'state_conflict' });
      try {
        const savedDigest = await sha256(canonicalReportValue({ job_id: jobId, ok, result: prior.result ?? null, error: prior.error ?? null }));
        if (savedDigest !== digest) return json(409, { error: 'report_conflict' });
      } catch { return json(409, { error: 'report_conflict' }); }
      return ack(true);
    }

    // poll: hold the request open for a while so jobs start almost instantly without hammering the service
    const until = Date.now() + 20_000;
    await admin.from('connector_devices').update({ last_seen_at: new Date().toISOString() }).eq('id', dev.id);
    while (Date.now() < until) {
      const { data: next } = await admin
        .from('connector_jobs')
        .select('id, kind, params')
        .eq('device_id', dev.id)
        .eq('status', 'queued')
        .gte('created_at', new Date(Date.now() - JOB_MAX_AGE_MS).toISOString())
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (next) {
        const { data: claimed } = await admin
          .from('connector_jobs')
          .update({ status: 'running', started_at: new Date().toISOString() })
          .eq('id', next.id)
          .eq('status', 'queued')
          .select('id')
          .maybeSingle();
        if (claimed) return json(200, { job: next });
      }
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

  if (action === 'create_job') {
    const { data: dev } = await admin.from('connector_devices').select('id, organization_id, paired, revoked_at, name').eq('id', str(body.device_id, 60)).maybeSingle();
    if (!dev || dev.revoked_at || !dev.paired) return json(404, { error: 'not_found' });
    if (!OWNERS.includes((await roleIn(dev.organization_id)) ?? '')) return json(403, { error: 'forbidden' });
    const kind = String(body.kind ?? '');
    const p = (body.params ?? {}) as Record<string, unknown>;
    let params: Record<string, unknown>;
    if (kind === 'list') {
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
      params = { command: str(p.command, 500), cwd: str(p.cwd, 500) };
      if (!params.command) return json(400, { error: 'bad_request' });
    } else {
      return json(400, { error: 'bad_request' });
    }
    const { count } = await admin.from('connector_jobs').select('id', { count: 'exact', head: true }).eq('device_id', dev.id).eq('status', 'queued');
    if ((count ?? 0) >= MAX_QUEUED) return json(429, { error: 'too_many' });
    const { data: job, error } = await admin.from('connector_jobs').insert({ organization_id: dev.organization_id, device_id: dev.id, created_by: user.id, kind, params }).select('id').single();
    if (error || !job) return json(500, { error: 'save_failed' });
    await audit(dev.organization_id, 'connector.job', job.id, { device: dev.name, kind, path: params.path ?? null, command: params.command ?? null });
    return json(200, { job_id: job.id });
  }

  if (action === 'cancel_job') {
    const { data: job } = await admin.from('connector_jobs').select('id, organization_id, status').eq('id', str(body.job_id, 60)).maybeSingle();
    if (!job) return json(404, { error: 'not_found' });
    if (!OWNERS.includes((await roleIn(job.organization_id)) ?? '')) return json(403, { error: 'forbidden' });
    // A queued job may be claimed between the read and the update. No matched row
    // means no cancellation; never return success for a running or changed job.
    const { data: cancelled, error: cancelError } = await admin.from('connector_jobs')
      .update({ status: 'cancelled', finished_at: new Date().toISOString() })
      .eq('id', job.id).eq('status', 'queued').select('id').maybeSingle();
    if (cancelError) return json(503, { error: 'save_failed' });
    if (!cancelled) return json(409, { error: 'state_conflict' });
    return json(200, { ok: true });
  }

  return json(400, { error: 'bad_request' });
});
