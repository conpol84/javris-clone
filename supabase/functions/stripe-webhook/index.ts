// Firbo AI Stripe webhook: the only way a paid plan is granted or removed automatically.
// Not called by browsers: it proves itself with Stripe's signature (STRIPE_WEBHOOK_SECRET), so JWT checking is off.
import { createClient } from 'npm:@supabase/supabase-js@2';

const enc = new TextEncoder();

async function validSignature(payload: string, header: string, secret: string): Promise<boolean> {
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=') as [string, string]));
  const t = parts['t'];
  const v1 = header.split(',').filter((p) => p.startsWith('v1=')).map((p) => p.slice(3));
  if (!t || v1.length === 0 || Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(`${t}.${payload}`)));
  const hex = Array.from(mac, (b) => b.toString(16).padStart(2, '0')).join('');
  return v1.some((s) => s.length === hex.length && [...s].reduce((d, c, i) => d | (c.charCodeAt(0) ^ hex.charCodeAt(i)), 0) === 0);
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });
  const secret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  if (!secret) return new Response('not configured', { status: 503 });
  const payload = await req.text();
  if (!(await validSignature(payload, req.headers.get('stripe-signature') ?? '', secret))) return new Response('bad signature', { status: 400 });

  const event = JSON.parse(payload);
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const obj = event?.data?.object ?? {};

  const apply = async (orgId: string | undefined, patch: Record<string, unknown>) => {
    if (!orgId) return;
    await admin.from('organizations').update(patch).eq('id', orgId);
  };
  const statusOf = (s: string) => (s === 'trialing' ? 'trialing' : s === 'past_due' || s === 'unpaid' ? 'past_due' : s === 'canceled' ? 'canceled' : 'active');

  if (event.type === 'checkout.session.completed' && obj.mode === 'subscription') {
    // The subscription carries our metadata; its own events then keep the plan in sync.
    await apply(obj.client_reference_id, { stripe_customer_id: obj.customer, stripe_subscription_id: obj.subscription });
  } else if (event.type === 'customer.subscription.created' || event.type === 'customer.subscription.updated') {
    const orgId = obj.metadata?.org_id as string | undefined;
    const plan = obj.metadata?.plan as string | undefined;
    const alive = ['active', 'trialing', 'past_due'].includes(obj.status);
    const end = obj.current_period_end ?? obj.items?.data?.[0]?.current_period_end;
    await apply(orgId, {
      ...(alive && plan ? { plan } : {}),
      ...(!alive ? { plan: 'free' } : {}),
      plan_status: statusOf(obj.status),
      stripe_subscription_id: obj.id,
      stripe_customer_id: obj.customer,
      plan_renews_at: end ? new Date(end * 1000).toISOString() : null,
    });
  } else if (event.type === 'customer.subscription.deleted') {
    await apply(obj.metadata?.org_id, { plan: 'free', plan_status: 'canceled', stripe_subscription_id: null, plan_renews_at: null });
  }
  return new Response(JSON.stringify({ received: true }), { headers: { 'content-type': 'application/json' } });
});
