// Firbo AI own API keys: an owner or admin of a Pro / Business / Enterprise company saves or removes its own provider key.
// The key is checked with the provider first (a read-only "list models" call), then stored encrypted in Supabase Vault.
// It is never returned to the browser and never logged; the browser only ever sees the last 4 characters.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { OWN_KEY_PROVIDERS, verifyProviderKey } from '../_shared/own-keys.ts';

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } });
const MANAGERS = ['owner', 'admin'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const userClient = createClient(url, anon, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
  const { data: who } = await userClient.auth.getUser();
  const user = who?.user;
  if (!user) return json(401, { error: 'unauthorized' });

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return json(400, { error: 'bad_request' }); }
  const orgId = String(body.organization_id ?? '');
  const provider = String(body.provider ?? '').toLowerCase();
  if (!/^[0-9a-f-]{36}$/.test(orgId) || !OWN_KEY_PROVIDERS.includes(provider)) return json(400, { error: 'bad_request' });

  const admin = createClient(url, service);
  const { data: member } = await admin.from('organization_members').select('role').eq('organization_id', orgId).eq('user_id', user.id).maybeSingle();
  if (!member || !MANAGERS.includes(member.role)) return json(403, { error: 'forbidden' });

  if (body.action === 'remove') {
    const { error } = await admin.rpc('provider_key_remove', { p_org: orgId, p_provider: provider, p_user: user.id });
    if (error) return json(500, { error: 'save_failed' });
    return json(200, { ok: true });
  }
  if (body.action !== 'save') return json(400, { error: 'bad_request' });

  const { data: org } = await admin.from('organizations').select('plan').eq('id', orgId).maybeSingle();
  const { data: plan } = await admin.from('plans').select('features').eq('id', org?.plan ?? '').maybeSingle();
  const features: string[] = Array.isArray(plan?.features) ? plan.features : [];
  if (!features.includes('byo_keys') && !features.includes('everything')) return json(402, { error: 'plan_limit', reason: 'byo_keys' });

  const key = String(body.key ?? '').trim();
  if (key.length < 20 || key.length > 400 || !/^[\x21-\x7e]+$/.test(key)) return json(400, { error: 'invalid_key' });

  const check = await verifyProviderKey(provider, key);
  if (!check.ok) return json(check.reason === 'invalid_key' ? 422 : 502, { error: check.reason });

  const hint = `…${key.slice(-4)}`;
  const { error } = await admin.rpc('provider_key_store', { p_org: orgId, p_provider: provider, p_key: key, p_hint: hint, p_models: check.models, p_user: user.id });
  if (error) {
    console.error(JSON.stringify({ event: 'firbo_provider_key_save_failed', organization_id: orgId, provider }));
    return json(500, { error: 'save_failed' });
  }
  return json(200, { ok: true, provider, key_hint: hint, models: check.models });
});
