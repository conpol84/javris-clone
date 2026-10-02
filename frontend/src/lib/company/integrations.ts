import { FunctionsHttpError } from '@supabase/supabase-js';
import { requireClient } from './client';

export type IntegrationKind =
  | 'slack' | 'discord' | 'telegram' | 'webhook' | 'teams' | 'googlechat' | 'mattermost' | 'ntfy' | 'pushover' | 'whatsapp'
  | 'twilio' | 'resend' | 'sendgrid' | 'notion' | 'airtable' | 'linear' | 'github' | 'mastodon';

export type IntegrationCategory = 'messaging' | 'email' | 'work' | 'social' | 'automation';

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

export interface LiveApp {
  kind: IntegrationKind;
  name: string;
  color: string;
  cat: IntegrationCategory;
  fields: FieldDef[];
}

const f = (key: string, placeholder: string, secret = false): FieldDef => ({ key, placeholder, secret });

/** Apps that can be connected today with a link or key (no developer account needed beyond the app itself). */
export const LIVE_APPS: LiveApp[] = [
  { kind: 'slack', name: 'Slack', color: '#e01e5a', cat: 'messaging', fields: [f('webhook_url', 'https://hooks.slack.com/services/…', true)] },
  { kind: 'discord', name: 'Discord', color: '#5865f2', cat: 'messaging', fields: [f('webhook_url', 'https://discord.com/api/webhooks/…', true)] },
  { kind: 'teams', name: 'Microsoft Teams', color: '#6264a7', cat: 'messaging', fields: [f('webhook_url', 'https://…webhook.office.com/…', true)] },
  { kind: 'googlechat', name: 'Google Chat', color: '#00ac47', cat: 'messaging', fields: [f('webhook_url', 'https://chat.googleapis.com/v1/spaces/…', true)] },
  { kind: 'mattermost', name: 'Mattermost', color: '#0058cc', cat: 'messaging', fields: [f('webhook_url', 'https://chat.example.com/hooks/…', true)] },
  { kind: 'telegram', name: 'Telegram', color: '#26a5e4', cat: 'messaging', fields: [f('bot_token', '123456789:AA…', true), f('chat_id', '-1001234567890')] },
  { kind: 'whatsapp', name: 'WhatsApp', color: '#25d366', cat: 'messaging', fields: [f('access_token', 'EAAG…', true), f('phone_number_id', '1055…'), f('to', '3069…')] },
  { kind: 'twilio', name: 'SMS (Twilio)', color: '#f22f46', cat: 'messaging', fields: [f('account_sid', 'AC…'), f('auth_token', '…', true), f('from', '+1555…'), f('to', '+3069…')] },
  { kind: 'ntfy', name: 'ntfy', color: '#57a773', cat: 'messaging', fields: [f('topic_url', 'https://ntfy.sh/my-topic', true)] },
  { kind: 'pushover', name: 'Pushover', color: '#249df1', cat: 'messaging', fields: [f('api_token', 'azGDORePK8gMaC0QOYAMyEEuzJnyUi', true), f('user_key', 'uQiRzpo4DXghDmr9QzzfQu27cmVRsG', true)] },
  { kind: 'resend', name: 'Email (Resend)', color: '#e5e7eb', cat: 'email', fields: [f('api_key', 're_…', true), f('from', 'Firbo <hello@yourdomain.com>'), f('to', 'you@example.com')] },
  { kind: 'sendgrid', name: 'Email (SendGrid)', color: '#1a82e2', cat: 'email', fields: [f('api_key', 'SG.…', true), f('from', 'hello@yourdomain.com'), f('to', 'you@example.com')] },
  { kind: 'notion', name: 'Notion', color: '#e5e7eb', cat: 'work', fields: [f('token', 'ntn_… / secret_…', true), f('parent_id', 'Page ID')] },
  { kind: 'airtable', name: 'Airtable', color: '#fcb400', cat: 'work', fields: [f('token', 'pat…', true), f('base_id', 'app…'), f('table', 'Tasks')] },
  { kind: 'linear', name: 'Linear', color: '#5e6ad2', cat: 'work', fields: [f('api_key', 'lin_api_…', true), f('team_id', 'Team UUID')] },
  { kind: 'github', name: 'GitHub', color: '#e5e7eb', cat: 'work', fields: [f('token', 'ghp_… / github_pat_…', true), f('repo', 'owner/repository')] },
  { kind: 'mastodon', name: 'Mastodon', color: '#6364ff', cat: 'social', fields: [f('instance_url', 'https://mastodon.social'), f('access_token', '…', true)] },
  { kind: 'webhook', name: 'Webhook', color: '#34d399', cat: 'automation', fields: [f('url', 'https://hooks.example.com/…', true)] },
];

export const CATEGORIES: IntegrationCategory[] = ['messaging', 'email', 'work', 'social', 'automation'];

/** One-click sign-in apps (they need a registered OAuth app per provider) — shown honestly as planned. */
export const PLANNED_APPS: { id: string; name: string; color: string }[] = [
  ['gmail', 'Gmail', '#ea4335'], ['gcal', 'Google Calendar', '#4285f4'], ['gdrive', 'Google Drive', '#fbbc04'], ['sheets', 'Google Sheets', '#0f9d58'],
  ['outlook', 'Outlook', '#0078d4'], ['m365', 'Microsoft 365', '#d83b01'], ['linkedin', 'LinkedIn', '#0a66c2'], ['x', 'X (Twitter)', '#e5e7eb'],
  ['instagram', 'Instagram', '#e1306c'], ['facebook', 'Facebook Pages', '#1877f2'], ['youtube', 'YouTube', '#ff0000'], ['tiktok', 'TikTok', '#25f4ee'],
  ['hubspot', 'HubSpot', '#ff7a59'], ['salesforce', 'Salesforce', '#00a1e0'], ['pipedrive', 'Pipedrive', '#bdf26d'], ['shopify', 'Shopify', '#95bf47'],
  ['stripe', 'Stripe', '#635bff'], ['woocommerce', 'WooCommerce', '#96588a'], ['zoom', 'Zoom', '#2d8cff'], ['jira', 'Jira', '#0052cc'],
  ['asana', 'Asana', '#f06a6a'], ['trello', 'Trello', '#0079bf'], ['clickup', 'ClickUp', '#7b68ee'], ['zendesk', 'Zendesk', '#03363d'],
  ['intercom', 'Intercom', '#286efa'], ['dropbox', 'Dropbox', '#0061ff'], ['calendly', 'Calendly', '#006bff'], ['mailchimp', 'Mailchimp', '#ffe01b'],
  ['quickbooks', 'QuickBooks', '#2ca01c'], ['zapier', 'Zapier', '#ff4f00'],
].map(([id, name, color]) => ({ id, name, color }));

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
