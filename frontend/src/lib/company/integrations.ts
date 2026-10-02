import { FunctionsHttpError } from '@supabase/supabase-js';
import { requireClient } from './client';

export type IntegrationKind = 'slack' | 'discord' | 'telegram' | 'webhook';

export interface IntegrationRow {
  id: string;
  kind: IntegrationKind;
  name: string;
  config: Record<string, unknown>;
  status: 'active' | 'error';
  last_error: string | null;
  last_used_at: string | null;
  created_at: string;
}

export interface FieldDef {
  key: string;
  secret?: boolean;
  placeholder: string;
}

/** Apps that can be connected today (live) and apps planned next (not clickable yet). */
export const LIVE_APPS: { kind: IntegrationKind; color: string; fields: FieldDef[] }[] = [
  { kind: 'slack', color: '#e01e5a', fields: [{ key: 'webhook_url', secret: true, placeholder: 'https://hooks.slack.com/services/…' }] },
  { kind: 'discord', color: '#5865f2', fields: [{ key: 'webhook_url', secret: true, placeholder: 'https://discord.com/api/webhooks/…' }] },
  {
    kind: 'telegram',
    color: '#26a5e4',
    fields: [
      { key: 'bot_token', secret: true, placeholder: '123456789:AA…' },
      { key: 'chat_id', placeholder: '-1001234567890' },
    ],
  },
  { kind: 'webhook', color: '#34d399', fields: [{ key: 'url', secret: true, placeholder: 'https://hooks.example.com/…' }] },
];

export const PLANNED_APPS: { id: string; name: string; color: string }[] = [
  { id: 'gmail', name: 'Gmail', color: '#ea4335' },
  { id: 'gcal', name: 'Google Calendar', color: '#4285f4' },
  { id: 'gdrive', name: 'Google Drive', color: '#fbbc04' },
  { id: 'whatsapp', name: 'WhatsApp', color: '#25d366' },
  { id: 'teams', name: 'Microsoft Teams', color: '#6264a7' },
  { id: 'outlook', name: 'Outlook', color: '#0078d4' },
  { id: 'notion', name: 'Notion', color: '#e5e7eb' },
  { id: 'hubspot', name: 'HubSpot', color: '#ff7a59' },
  { id: 'stripe', name: 'Stripe', color: '#635bff' },
  { id: 'shopify', name: 'Shopify', color: '#95bf47' },
  { id: 'x', name: 'X (Twitter)', color: '#e5e7eb' },
  { id: 'linkedin', name: 'LinkedIn', color: '#0a66c2' },
  { id: 'instagram', name: 'Instagram', color: '#e1306c' },
  { id: 'github', name: 'GitHub', color: '#e5e7eb' },
  { id: 'zapier', name: 'Zapier', color: '#ff4f00' },
  { id: 'sheets', name: 'Google Sheets', color: '#0f9d58' },
];

export type IntegrationErrorCode = 'invalid_fields' | 'test_failed' | 'send_failed' | 'forbidden' | 'too_many' | 'unknown';

export class IntegrationError extends Error {
  constructor(public code: IntegrationErrorCode) {
    super(code);
  }
}

const KNOWN: IntegrationErrorCode[] = ['invalid_fields', 'test_failed', 'send_failed', 'forbidden', 'too_many'];

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await requireClient().functions.invoke('integrations', { body });
  if (error) {
    let code: IntegrationErrorCode = 'unknown';
    if (error instanceof FunctionsHttpError) {
      try {
        const b = await error.context.json();
        if (KNOWN.includes(b?.error)) code = b.error;
      } catch {
        /* keep unknown */
      }
    }
    throw new IntegrationError(code);
  }
  return data as T;
}

export async function listIntegrations(orgId: string): Promise<IntegrationRow[]> {
  const { data, error } = await requireClient()
    .from('integrations')
    .select('id, kind, name, config, status, last_error, last_used_at, created_at')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as IntegrationRow[];
}

export const connectIntegration = (organization_id: string, kind: IntegrationKind, name: string, fields: Record<string, string>) =>
  call<{ integration: IntegrationRow }>({ action: 'connect', organization_id, kind, name, fields });
export const testIntegration = (id: string) => call<{ ok: true }>({ action: 'test', id });
export const sendIntegration = (id: string, text: string) => call<{ ok: true }>({ action: 'send', id, text });
export const disconnectIntegration = (id: string) => call<{ ok: true }>({ action: 'disconnect', id });
