import { requireClient } from './client';

export type CatalogGroup = 'channels' | 'work' | 'data' | 'tools' | 'ai' | 'coding';
/** live: works in Firbo today. engine: built into our backend (OpenJarvis / OmniRoute), not yet switched on for customers. planned: on the roadmap. */
export type CatalogStatus = 'live' | 'engine' | 'planned';
export type CatalogSource = 'firbo' | 'openjarvis' | 'omniroute';

export interface CatalogItem {
  id: string;
  name: string;
  group: CatalogGroup;
  source: CatalogSource;
  status: CatalogStatus;
  /** Where "live" items are used in the product. */
  href?: string;
}

const item = (group: CatalogGroup, source: CatalogSource, status: CatalogStatus, name: string, href?: string): CatalogItem => ({
  id: `${group}:${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`,
  name,
  group,
  source,
  status,
  href,
});
const many = (group: CatalogGroup, source: CatalogSource, status: CatalogStatus, names: string[], href?: string) => names.map((n) => item(group, source, status, n, href));

export const CATALOG: CatalogItem[] = [
  // ---- channels: where agents talk to people
  ...many('channels', 'firbo', 'live', ['Slack', 'Discord', 'Microsoft Teams', 'Google Chat', 'Mattermost', 'Telegram', 'WhatsApp', 'SMS (Twilio)', 'ntfy', 'Pushover', 'Email (Resend)', 'Email (SendGrid)', 'Webhook (Zapier, Make, n8n)'], '/integrations'),
  ...many('channels', 'openjarvis', 'engine', [
    'Gmail (sign in with Google)', 'Email (SMTP / IMAP)', 'Signal', 'Matrix', 'iMessage (BlueBubbles)', 'Sendblue', 'LINE', 'Viber', 'Facebook Messenger', 'Feishu', 'IRC', 'XMPP',
    'Zulip', 'Rocket.Chat', 'Nostr', 'Twitch chat', 'Reddit', 'X (Twitter)', 'WhatsApp (personal, QR)', 'Website chat widget',
  ]),
  // ---- work apps: where agents create things
  ...many('work', 'firbo', 'live', ['Notion', 'Airtable', 'Linear', 'GitHub', 'Mastodon'], '/integrations'),
  ...many('work', 'firbo', 'planned', [
    'Google Calendar', 'Google Drive', 'Google Sheets', 'Outlook', 'Microsoft 365', 'HubSpot', 'Salesforce', 'Pipedrive', 'Shopify', 'Stripe', 'WooCommerce', 'Jira', 'Asana', 'Trello', 'ClickUp',
    'Zendesk', 'Intercom', 'Zoom', 'Calendly', 'Mailchimp', 'QuickBooks', 'Dropbox', 'LinkedIn', 'Instagram', 'Facebook Pages', 'YouTube', 'TikTok',
  ]),
  // ---- data sources agents can read and remember (OpenJarvis connectors)
  ...many('data', 'openjarvis', 'engine', [
    'Gmail', 'Gmail (IMAP)', 'Google Calendar', 'Google Contacts', 'Google Drive', 'Google Tasks', 'Outlook', 'Notion', 'Dropbox', 'Slack history', 'GitHub notifications', 'Hacker News', 'News feeds (RSS)',
    'Obsidian vault', 'Apple Calendar', 'Apple Contacts', 'Apple Notes', 'Apple Health', 'Apple Music', 'Oura', 'Strava', 'Spotify', 'Weather', 'Granola', 'iMessage', 'WhatsApp history', 'Any IMAP mailbox',
  ]),
  // ---- tools: what an AI employee can do
  ...many('tools', 'firbo', 'live', ['Reasoning', 'Company memory', 'Approval queue (human in the loop)', 'Task delegation (missions)', 'Speech (text to speech, audio)']),
  ...many('tools', 'openjarvis', 'engine', [
    'Web search', 'Browser (navigate, read pages)', 'HTTP requests', 'Read files', 'Write files', 'Shell commands', 'Sandboxed Docker shell', 'Code interpreter', 'Git (status, diff, log, commit)', 'Apply code patches',
    'Database queries', 'Knowledge search (documents)', 'PDF reading', 'Image tools', 'Calculator', 'Weather', 'MCP tools (any MCP server)', 'Skills library', 'Proactive monitoring',
  ]),
  // ---- the AI engine: OmniRoute + OpenJarvis
  ...many('ai', 'omniroute', 'live', ['One AI endpoint for any model', 'Usage and cost analytics', 'Provider quota tracking', 'API keys and spend per key', 'Free-model finder', 'Live request log'], '/gateway'),
  ...many('ai', 'omniroute', 'engine', [
    '357 AI providers (152 free)', 'Smart routing combos (19 strategies)', 'Automatic fallback when a model fails', 'Token compression (save 15 to 95%)', 'Response cache', 'Budgets and rate limits per key',
    'MCP server (agents control the gateway)', 'A2A agent skills (cost, health, routing, quota)', 'Cloud coding agents (Codex, Cursor, Devin, Jules)', 'Webhooks and tunnels', 'Model evals and arena ranking', 'Audit log and compliance export',
    'Provider radar (live status)', 'Per-company proxies', 'Backups and cloud sync',
  ]),
  ...many('ai', 'openjarvis', 'engine', ['Local private models (Ollama)', 'NVIDIA NIM', 'LiteLLM bridge', 'Apple on-device models', 'Multi-engine routing']),
  // ---- coding agents that can run through the gateway on your own computer
  ...many('coding', 'omniroute', 'live', [
    'Claude Code', 'Codex CLI', 'Gemini CLI', 'Cursor CLI', 'GitHub Copilot CLI', 'Cline', 'Aider', 'Goose', 'OpenCode', 'Continue', 'Kilo Code', 'Open Interpreter', 'Grok Build', 'Qwen CLI', 'Factory Droid', 'Warp AI', 'Windsurf', 'Kiro',
  ], '/coding'),
];

export const GROUPS: CatalogGroup[] = ['channels', 'work', 'data', 'tools', 'ai', 'coding'];

export function countBy(status: CatalogStatus, group?: CatalogGroup): number {
  return CATALOG.filter((c) => c.status === status && (!group || c.group === group)).length;
}

// ---- "I need this": per-person demand signal that tells us what to switch on first

export async function loadVotes(orgId: string, userId: string): Promise<Set<string>> {
  const { data, error } = await requireClient().from('integration_votes').select('item_id').eq('organization_id', orgId).eq('user_id', userId);
  if (error) throw new Error(error.message);
  return new Set((data ?? []).map((r) => r.item_id as string));
}

export async function setVote(orgId: string, userId: string, itemId: string, on: boolean): Promise<void> {
  const db = requireClient();
  const { error } = on
    ? await db.from('integration_votes').insert({ organization_id: orgId, user_id: userId, item_id: itemId })
    : await db.from('integration_votes').delete().eq('organization_id', orgId).eq('user_id', userId).eq('item_id', itemId);
  if (error && error.code !== '23505') throw new Error(error.message);
}
