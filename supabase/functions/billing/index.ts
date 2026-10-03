// Firbo AI billing: Stripe Checkout / Customer Portal for a company's plan, plus a platform-admin manual override.
//
// Guarantees (enforced here, not in the browser):
//  - only owners and admins of the company may start a checkout or open the portal
//  - the plan is only ever written by this function or the Stripe webhook (database trigger blocks everyone else)
//  - Stripe keys live only in Edge Function secrets: STRIPE_SECRET_KEY and STRIPE_PRICE_<PLAN>_<MONTH|YEAR>
//  - without Stripe configured every payment action answers "not_configured" instead of pretending
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } });

const BILLERS = ['owner', 'admin'];
const APP_URL = (Deno.env.get('APP_URL') ?? 'https://firboai.app').replace(/\/+$/, '');

async function stripe(path: string, params: Record<string, string>): Promise<any> {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${Deno.env.get('STRIPE_SECRET_KEY')}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(20_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message ?? `stripe_${res.status}`);
  return data;
}

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

  let body: Record<string, any> = {};
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'bad_request' });
  }
  const orgId = String(body.organization_id ?? '');
  if (!orgId) return json(400, { error: 'bad_request' });
  const admin = createClient(url, service);

  if (body.action === 'set_plan') {
    const { data: pa } = await admin.from('platform_admins').select('user_id').eq('user_id', user.id).maybeSingle();
    if (!pa) return json(403, { error: 'forbidden' });
    const plan = String(body.plan ?? '');
    const { data: exists } = await admin.from('plans').select('id').eq('id', plan).maybeSingle();
    if (!exists) return json(400, { error: 'bad_request' });
    const { error } = await admin.from('organizations').update({ plan, plan_status: 'active' }).eq('id', orgId);
    if (error) return json(500, { error: 'save_failed' });
    return json(200, { ok: true });
  }

  const { data: member } = await admin.from('organization_members').select('role').eq('organization_id', orgId).eq('user_id', user.id).maybeSingle();
  if (!member || !BILLERS.includes(member.role)) return json(403, { error: 'forbidden' });
  if (!Deno.env.get('STRIPE_SECRET_KEY')) return json(503, { error: 'not_configured' });

  const { data: org } = await admin.from('organizations').select('id, name, plan, stripe_customer_id').eq('id', orgId).maybeSingle();
  if (!org) return json(404, { error: 'not_found' });

  try {
    if (body.action === 'checkout') {
      const plan = String(body.plan ?? '');
      const interval = body.interval === 'year' ? 'YEAR' : 'MONTH';
      const { data: p } = await admin.from('plans').select('id, purchasable').eq('id', plan).maybeSingle();
      if (!p || !p.purchasable) return json(400, { error: 'bad_request' });
      const price = Deno.env.get(`STRIPE_PRICE_${plan.toUpperCase()}_${interval}`);
      if (!price) return json(503, { error: 'not_configured' });
      let customer = org.stripe_customer_id as string | null;
      if (!customer) {
        const c = await stripe('customers', { name: org.name, ...(user.email ? { email: user.email } : {}), 'metadata[org_id]': org.id });
        customer = c.id as string;
        await admin.from('organizations').update({ stripe_customer_id: customer }).eq('id', org.id);
      }
      const s = await stripe('checkout/sessions', {
        mode: 'subscription',
        customer: customer!,
        'line_items[0][price]': price,
        'line_items[0][quantity]': '1',
        client_reference_id: org.id,
        'subscription_data[metadata][org_id]': org.id,
        'subscription_data[metadata][plan]': plan,
        allow_promotion_codes: 'true',
        success_url: `${APP_URL}/billing?status=success`,
        cancel_url: `${APP_URL}/billing?status=cancelled`,
      });
      return json(200, { url: s.url });
    }
    if (body.action === 'portal') {
      if (!org.stripe_customer_id) return json(409, { error: 'no_subscription' });
      const s = await stripe('billing_portal/sessions', { customer: org.stripe_customer_id, return_url: `${APP_URL}/billing` });
      return json(200, { url: s.url });
    }
  } catch (err) {
    console.error('billing error', err instanceof Error ? err.message : err);
    return json(502, { error: 'stripe_error' });
  }
  return json(400, { error: 'bad_request' });
});
