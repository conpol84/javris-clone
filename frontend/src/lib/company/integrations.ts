import { FunctionsHttpError } from '@supabase/supabase-js';
import { requireClient } from './client';

export type IntegrationKind =
  | 'slack' | 'discord' | 'telegram' | 'webhook' | 'teams' | 'googlechat' | 'mattermost' | 'ntfy' | 'pushover' | 'whatsapp'
  | 'twilio' | 'resend' | 'sendgrid' | 'notion' | 'airtable' | 'linear' | 'github' | 'mastodon'
  | 'hubspot' | 'pipedrive' | 'asana' | 'trello' | 'clickup' | 'jira' | 'zendesk' | 'zoom' | 'wordpress' | 'bluesky' | 'facebook' | 'x'
  | 'zapier' | 'make' | 'n8n' | 'gmail' | 'gcal' | 'gdrive' | 'sheets' | 'outlook' | 'linkedin' | 'dropbox';

export type IntegrationCategory = 'messaging' | 'email' | 'work' | 'crm' | 'productivity' | 'social' | 'automation';

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
  /** English label for apps added without a translation key. */
  label?: string;
  optional?: boolean;
}

export type OAuthGroup = 'GOOGLE' | 'MICROSOFT' | 'LINKEDIN' | 'DROPBOX';

export interface LiveApp {
  kind: IntegrationKind;
  name: string;
  color: string;
  cat: IntegrationCategory;
  fields: FieldDef[];
  /** One-click sign-in instead of pasting a key. Needs the platform's OAuth app (see the setup note on the page). */
  oauth?: OAuthGroup;
  /** English text for apps added without translation keys. */
  about?: string;
  help?: string;
}

const f = (key: string, placeholder: string, secret = false, label?: string, optional = false): FieldDef => ({ key, placeholder, secret, label, optional });

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

  // ---- more apps: paste a key or sign in
  { kind: 'hubspot', name: 'HubSpot', color: '#ff7a59', cat: 'crm', fields: [f('token', 'pat-na1-…', true, 'Private app token')], about: 'Adds a note to HubSpot when you approve an action.', help: 'In HubSpot open Settings → Integrations → Private Apps, create an app with CRM read and notes write access, and copy its access token (it starts with pat-).' },
  { kind: 'pipedrive', name: 'Pipedrive', color: '#bdf26d', cat: 'crm', fields: [f('domain', 'mycompany', false, 'Company subdomain'), f('api_token', '…', true, 'Personal API token')], about: 'Creates an activity in Pipedrive when you approve an action.', help: 'Your subdomain is the first part of mycompany.pipedrive.com. The API token is under your profile → Personal preferences → API.' },
  { kind: 'zendesk', name: 'Zendesk', color: '#03363d', cat: 'crm', fields: [f('subdomain', 'mycompany', false, 'Subdomain'), f('email', 'you@company.com', false, 'Agent email'), f('api_token', '…', true, 'API token')], about: 'Opens a support ticket when you approve an action.', help: 'In Zendesk Admin Center → Apps and integrations → APIs → Zendesk API, enable token access and create a token.' },
  { kind: 'asana', name: 'Asana', color: '#f06a6a', cat: 'work', fields: [f('token', '2/…', true, 'Personal access token'), f('project_gid', '1200000000000', false, 'Project ID')], about: 'Creates a task in an Asana project.', help: 'Create a personal access token in the Asana developer console. The project ID is the long number in the project’s web address.' },
  { kind: 'trello', name: 'Trello', color: '#0079bf', cat: 'work', fields: [f('api_key', '32 characters', false, 'API key'), f('token', '…', true, 'Token'), f('list_id', '24 characters', false, 'List ID')], about: 'Creates a card in a Trello list.', help: 'At trello.com/power-ups/admin create a Power-Up to get an API key and generate a token. To find a list ID, add .json to your board address and look for the list’s id.' },
  { kind: 'clickup', name: 'ClickUp', color: '#7b68ee', cat: 'work', fields: [f('token', 'pk_…', true, 'API token'), f('list_id', '901100000000', false, 'List ID')], about: 'Creates a task in a ClickUp list.', help: 'Your token is under Settings → Apps. The list ID is the number in the list’s web address.' },
  { kind: 'jira', name: 'Jira', color: '#0052cc', cat: 'work', fields: [f('domain', 'yourcompany.atlassian.net', false, 'Jira site'), f('email', 'you@company.com', false, 'Account email'), f('api_token', '…', true, 'API token'), f('project_key', 'KAN', false, 'Project key')], about: 'Creates a Jira task in a project.', help: 'Create an API token at id.atlassian.com → Security → API tokens. The project key is the short code in front of issue numbers.' },
  { kind: 'zoom', name: 'Zoom', color: '#2d8cff', cat: 'productivity', fields: [f('account_id', '…', false, 'Account ID'), f('client_id', '…', false, 'Client ID'), f('client_secret', '…', true, 'Client secret'), f('user_email', 'you@company.com', false, 'Meeting host email')], about: 'Schedules a Zoom meeting when you approve an action.', help: 'In the Zoom App Marketplace build a Server-to-Server OAuth app with the meeting:write scope and copy its three credentials.' },
  { kind: 'wordpress', name: 'WordPress', color: '#21759b', cat: 'social', fields: [f('site_url', 'https://yoursite.com', false, 'Site address'), f('username', 'admin', false, 'Username'), f('app_password', 'xxxx xxxx xxxx xxxx', true, 'Application password')], about: 'Saves a draft post on your WordPress site. A person publishes it.', help: 'In WordPress open Users → Profile → Application Passwords, create one and copy it. Posts are always saved as drafts.' },
  { kind: 'bluesky', name: 'Bluesky', color: '#1185fe', cat: 'social', fields: [f('handle', 'name.bsky.social', false, 'Handle'), f('app_password', 'xxxx-xxxx-xxxx-xxxx', true, 'App password')], about: 'Posts to Bluesky.', help: 'In Bluesky open Settings → Privacy and security → App passwords and create one. Never use your main password.' },
  { kind: 'x', name: 'X (Twitter)', color: '#e5e7eb', cat: 'social', fields: [f('api_key', '…', false, 'API key'), f('api_secret', '…', true, 'API key secret'), f('access_token', '…', false, 'Access token'), f('access_token_secret', '…', true, 'Access token secret')], about: 'Posts to X.', help: 'Create a project and app at developer.x.com, set its permissions to Read and write, then generate the four keys. Posting needs an X API plan that allows writing; check your plan there.' },
  { kind: 'facebook', name: 'Facebook Pages', color: '#1877f2', cat: 'social', fields: [f('page_id', '1234567890', false, 'Page ID'), f('page_token', 'EAAG…', true, 'Page access token')], about: 'Posts to a Facebook Page.', help: 'In Meta for Developers create an app, get a long-lived Page access token with the pages_manage_posts permission, and enter the Page ID.' },
  { kind: 'zapier', name: 'Zapier', color: '#ff4f00', cat: 'automation', fields: [f('webhook_url', 'https://hooks.zapier.com/hooks/catch/…', true, 'Catch Hook URL')], about: 'Starts a Zap with a message from your AI team.', help: 'In Zapier start a Zap with the Webhooks trigger “Catch Hook” and paste its URL here.' },
  { kind: 'make', name: 'Make', color: '#6d00cc', cat: 'automation', fields: [f('webhook_url', 'https://hook.eu1.make.com/…', true, 'Webhook URL')], about: 'Starts a Make scenario with a message from your AI team.', help: 'In Make add a Custom webhook module to a scenario and paste its address here.' },
  { kind: 'n8n', name: 'n8n', color: '#ea4b71', cat: 'automation', fields: [f('webhook_url', 'https://n8n.example.com/webhook/…', true, 'Webhook URL')], about: 'Starts an n8n workflow with a message from your AI team.', help: 'Add a Webhook node (POST) to a workflow and paste its production URL here.' },
  { kind: 'gmail', name: 'Gmail', color: '#ea4335', cat: 'email', oauth: 'GOOGLE', fields: [f('to', 'Leave empty to send to yourself', false, 'Send to', true)], about: 'Sends email from your Gmail account when you approve an action.', help: 'Sign in with Google. Firbo only gets permission to send email, never to read your inbox.' },
  { kind: 'outlook', name: 'Outlook / Microsoft 365', color: '#0078d4', cat: 'email', oauth: 'MICROSOFT', fields: [f('to', 'Leave empty to send to yourself', false, 'Send to', true)], about: 'Sends email from Outlook or Microsoft 365 when you approve an action.', help: 'Sign in with Microsoft. Firbo only gets permission to send email, never to read your mailbox.' },
  { kind: 'gcal', name: 'Google Calendar', color: '#4285f4', cat: 'productivity', oauth: 'GOOGLE', fields: [], about: 'Adds an event to your calendar when you approve an action.', help: 'Sign in with Google. Firbo can only add events.' },
  { kind: 'gdrive', name: 'Google Drive', color: '#fbbc04', cat: 'productivity', oauth: 'GOOGLE', fields: [], about: 'Saves a text file in your Drive when you approve an action.', help: 'Sign in with Google. Firbo can only create and edit files it creates itself.' },
  { kind: 'sheets', name: 'Google Sheets', color: '#0f9d58', cat: 'productivity', oauth: 'GOOGLE', fields: [f('spreadsheet_id', 'ID from the sheet address', false, 'Spreadsheet ID'), f('range', 'Sheet1!A:B', false, 'Range', true)], about: 'Adds a row to a spreadsheet when you approve an action.', help: 'Sign in with Google and give the spreadsheet ID: the long code between /d/ and /edit in the sheet’s address.' },
  { kind: 'linkedin', name: 'LinkedIn', color: '#0a66c2', cat: 'social', oauth: 'LINKEDIN', fields: [], about: 'Posts to your LinkedIn profile when you approve an action.', help: 'Sign in with LinkedIn. Access lasts about 60 days, then you sign in again.' },
  { kind: 'dropbox', name: 'Dropbox', color: '#0061ff', cat: 'productivity', oauth: 'DROPBOX', fields: [], about: 'Saves a text file in your Dropbox when you approve an action.', help: 'Sign in with Dropbox. Files go to a Firbo folder.' },
  { kind: 'webhook', name: 'Webhook', color: '#34d399', cat: 'automation', fields: [f('url', 'https://hooks.example.com/…', true)] },
];

export const CATEGORIES: IntegrationCategory[] = ['messaging', 'email', 'productivity', 'work', 'crm', 'social', 'automation'];

/** Still planned, and honest about why: each needs either a platform review or a different kind of connection. */
export const PLANNED_APPS: { id: string; name: string; color: string; reason: string }[] = [
  ['instagram', 'Instagram', '#e1306c', 'Posting needs a Meta business app review and an image for every post.'],
  ['tiktok', 'TikTok', '#25f4ee', 'Posting needs TikTok’s content API audit and a video for every post.'],
  ['youtube', 'YouTube', '#ff0000', 'Publishing needs a video file and Google’s API audit.'],
  ['salesforce', 'Salesforce', '#00a1e0', 'Needs a Salesforce connected app per customer org.'],
  ['quickbooks', 'QuickBooks', '#2ca01c', 'Needs an Intuit app review; it will be a read-only data app first.'],
  ['shopify', 'Shopify', '#95bf47', 'Data app: reading orders and products for your agents.'],
  ['stripe', 'Stripe', '#635bff', 'Data app: reading revenue and customers for your agents.'],
  ['woocommerce', 'WooCommerce', '#96588a', 'Data app: reading orders and products for your agents.'],
  ['calendly', 'Calendly', '#006bff', 'Data app: reading your bookings.'],
  ['mailchimp', 'Mailchimp', '#ffe01b', 'Needs audience and campaign mapping.'],
  ['intercom', 'Intercom', '#286efa', 'Needs contact mapping for conversations.'],
].map(([id, name, color, reason]) => ({ id, name, color, reason }));

export type IntegrationErrorCode = 'invalid_fields' | 'test_failed' | 'send_failed' | 'forbidden' | 'too_many' | 'plan_limit' | 'not_configured' | 'unknown';

export class IntegrationError extends Error {
  constructor(public code: IntegrationErrorCode, public detail?: { provider?: string; redirect_uri?: string }) {
    super(code);
  }
}

const KNOWN: IntegrationErrorCode[] = ['invalid_fields', 'test_failed', 'send_failed', 'forbidden', 'too_many', 'plan_limit', 'not_configured'];

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await requireClient().functions.invoke('integrations', { body });
  if (error) {
    let code: IntegrationErrorCode = 'unknown';
    let detail: { provider?: string; redirect_uri?: string } | undefined;
    if (error instanceof FunctionsHttpError) {
      try {
        const b = await error.context.json();
        if (KNOWN.includes(b?.error)) code = b.error;
        if (b?.redirect_uri) detail = { provider: String(b.provider ?? ''), redirect_uri: String(b.redirect_uri) };
      } catch {
        /* keep unknown */
      }
    }
    throw new IntegrationError(code, detail);
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

/** Starts the provider's sign-in; the browser is sent to the returned address and comes back to /integrations. */
export const startOAuth = (organization_id: string, kind: IntegrationKind, name: string, fields: Record<string, string>) =>
  call<{ url: string }>({ action: 'oauth_start', organization_id, kind, name, fields });

export const OAUTH_CONSOLE: Record<OAuthGroup, { label: string; url: string; secrets: string }> = {
  GOOGLE: { label: 'Google Cloud Console', url: 'https://console.cloud.google.com/apis/credentials', secrets: 'GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET' },
  MICROSOFT: { label: 'Microsoft Entra', url: 'https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade', secrets: 'MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET' },
  LINKEDIN: { label: 'LinkedIn Developers', url: 'https://www.linkedin.com/developers/apps', secrets: 'LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET' },
  DROPBOX: { label: 'Dropbox App Console', url: 'https://www.dropbox.com/developers/apps', secrets: 'DROPBOX_CLIENT_ID, DROPBOX_CLIENT_SECRET' },
};
