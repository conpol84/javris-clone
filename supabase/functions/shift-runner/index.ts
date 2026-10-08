// Firbo AI shifts: called every minute by the database scheduler. Creates a task for each due shift and runs it
// through agent-runner, so AI employees work on a schedule. Approvals still wait for a human in the Inbox.
//
// Not callable with a browser login: the caller must send the x-cron-secret kept in public.cron_secrets.
import { createClient } from 'npm:@supabase/supabase-js@2';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const LANGS = ['en', 'el', 'es', 'pt-BR', 'de', 'fr', 'zh-CN', 'ar'];

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  const url = Deno.env.get('SUPABASE_URL')!;
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin = createClient(url, service);

  const cron = req.headers.get('x-cron-secret') ?? '';
  const { data: sec } = await admin.from('cron_secrets').select('value').eq('name', 'shifts').maybeSingle();
  if (!sec || !cron || sec.value !== cron) return json(401, { error: 'unauthorized' });

  const { data: due, error } = await admin.rpc('claim_due_shifts', { max_rows: 10 });
  if (error) return json(500, { error: 'claim_failed' });
  const shifts = (due ?? []) as { id: string; organization_id: string; agent_id: string; title: string; instruction: string; created_by: string | null }[];

  const work = Promise.allSettled(
    shifts.map(async (s) => {
      if (!s.created_by) return;
      const { data: task } = await admin
        .from('tasks')
        .insert({
          organization_id: s.organization_id,
          created_by: s.created_by,
          shift_id: s.id,
          title: s.title,
          description: s.instruction || null,
          assigned_agent_id: s.agent_id,
          priority: 'normal',
          status: 'pending',
        })
        .select('id')
        .single();
      if (!task) return;
      const { data: profile } = await admin.from('profiles').select('locale').eq('id', s.created_by).maybeSingle();
      const lang = LANGS.includes(String(profile?.locale)) ? String(profile?.locale) : 'en';
      await fetch(`${url}/functions/v1/agent-runner`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${service}`, 'x-cron-secret': cron },
        body: JSON.stringify({ task_id: task.id, lang, system_user_id: s.created_by }),
        signal: AbortSignal.timeout(140_000),
      });
    }),
  );
  // Answer the scheduler right away; the agents keep working in the background.
  (globalThis as any).EdgeRuntime?.waitUntil?.(work);
  if (!(globalThis as any).EdgeRuntime?.waitUntil) await work;
  return json(200, { started: shifts.length });
});
