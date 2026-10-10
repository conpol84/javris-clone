import { FunctionsHttpError } from '@supabase/supabase-js';
import { requireClient } from './client';

export type IntegrationKind =
  | 'slack' | 'discord' | 'telegram' | 'webhook' | 'teams' | 'googlechat' | 'mattermost' | 'ntfy' | 'pushover' | 'whatsapp'
  | 'twilio' | 'resend' | 'sendgrid' | 'notion' | 'airtable' | 'linear' | 'github' | 'mastodon'
  | 'hubspot' | 'pipedrive' | 'asana' | 'trello' | 'clickup' | 'jira' | 'zendesk' | 'zoom' | 'wordpress' | 'bluesky' | 'facebook' | 'x'
  | 'threads' | 'instagram' | 'devto' | 'matrix' | 'zulip' | 'rocketchat' | 'todoist' | 'monday' | 'homeassistant' | 'ifttt' | 'brevo' | 'mailchimp'
  | 'stripe' | 'shopify' | 'woocommerce' | 'lemonsqueezy' | 'gumroad' | 'calendly' | 'calcom' | 'intercom'
  | 'youtube' | 'tiktok' | 'salesforce' | 'quickbooks' | 'homeassistant_devices' | 'traccar'
  | 'mcp' | 'zapier' | 'make' | 'n8n' | 'gmail' | 'gcal' | 'gdrive' | 'sheets' | 'outlook' | 'linkedin' | 'dropbox'
  | 'gdrive_read' | 'gmail_read' | 'gcal_read' | 'outlook_read';

export type IntegrationCategory = 'messaging' | 'email' | 'work' | 'crm' | 'productivity' | 'social' | 'automation' | 'commerce';

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

export type OAuthGroup = 'GOOGLE' | 'MICROSOFT' | 'LINKEDIN' | 'DROPBOX' | 'TIKTOK' | 'SALESFORCE' | 'QUICKBOOKS';

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
  /** Data apps only look: they can show a summary, never post or change anything. */
  readOnly?: boolean;
}

const f = (key: string, placeholder: string, secret = false, label?: string, optional = false): FieldDef => ({ key, placeholder, secret, label, optional });

/** Apps that can be connected today with a link or key (no developer account needed beyond the app itself). */
export const LIVE_APPS: LiveApp[] = [
  {kind:'youtube',name:'YouTube',color:'#ff4b60',cat:'social',oauth:'GOOGLE',fields:[],readOnly:true,about:'Your channel and its reported statistics.',help:'Authorize the YouTube read-only scope. This version does not upload, publish or delete videos.'},
  {kind:'tiktok',name:'TikTok',color:'#45e8da',cat:'social',oauth:'TIKTOK',fields:[],readOnly:true,about:'Your creator profile and recent public videos.',help:'Authorize Login Kit and Display API access. Content publishing is a separate integration and is not enabled here.'},
  {kind:'salesforce',name:'Salesforce',color:'#43b9ff',cat:'crm',oauth:'SALESFORCE',fields:[],readOnly:true,about:'Read a limited sample of account records.',help:'Authorize a Salesforce external client app. Use a restricted Salesforce account; the API scope itself is broader than this read-only adapter.'},
  {kind:'quickbooks',name:'QuickBooks',color:'#5ed5a2',cat:'commerce',oauth:'QUICKBOOKS',fields:[],readOnly:true,about:'Verify your QuickBooks company identity.',help:'Authorize an Intuit app. Firbo only reads CompanyInfo in this release; the accounting OAuth scope is broader. No invoices, payments or accounting entries are changed.'},
  {kind:'homeassistant_devices',name:'Home Assistant · Devices',color:'#56cfff',cat:'automation',fields:[f('base_url','https://home.example.com',false,'Approved HTTPS origin'),f('token','',true,'Access token'),f('resource_ids','sensor.living_room_temperature,light.office',false,'Allowed entity IDs')],readOnly:true,about:'Selected sensors and device states, not home controls.',help:'The platform must approve the exact HTTPS origin. Give only specific sensor, binary_sensor, light, switch or climate IDs. No cameras, locks or security-panel actions.'},
  {kind:'traccar',name:'Traccar · Vehicles',color:'#d5ba7e',cat:'automation',fields:[f('base_url','https://tracking.example.com',false,'Approved HTTPS origin'),f('token','',true,'Access token'),f('resource_ids','12,15',false,'Allowed tracker IDs')],readOnly:true,about:'Selected tracker connection status, without vehicle commands.',help:'Connect a compatible Traccar server and explicitly selected tracker IDs. The server origin needs approval. GPS history, engine commands and remote unlocking are not enabled.'},

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
  // ---- new and trending
  { kind: 'mcp', name: 'MCP server', color: '#c084fc', cat: 'automation', fields: [f('server_url', 'https://mcp.example.com/mcp', false, 'Server address (https)'), f('token', 'Optional', true, 'Access token', true)], about: 'Connect any MCP server (GitHub, Notion, Linear, your own …) and use its tools from Firbo.', help: 'Paste the address of a remote MCP server that supports streamable HTTP, plus its access token if it needs one. Firbo checks the connection and lists the tools it offers; managers can then run them.' },
  { kind: 'threads', name: 'Threads', color: '#e5e7eb', cat: 'social', fields: [f('user_id', '1784…', false, 'Threads user ID'), f('access_token', 'THQW…', true, 'Access token')], about: 'Posts text to Threads.', help: 'In Meta for Developers create an app with the Threads API, add yourself as a tester, generate a long-lived token with threads_content_publish and copy your Threads user ID.' },
  { kind: 'instagram', name: 'Instagram', color: '#e1306c', cat: 'social', fields: [f('ig_user_id', '1784…', false, 'Instagram account ID'), f('access_token', 'EAAG…', true, 'Access token')], about: 'Posts a picture with a caption. Include an image link (https …jpg or png) in the text.', help: 'Needs an Instagram Business or Creator account linked to a Facebook Page and a Meta app token with instagram_content_publish. Every post must contain a public image link.' },
  { kind: 'devto', name: 'DEV Community', color: '#e5e7eb', cat: 'social', fields: [f('api_key', '…', true, 'API key')], about: 'Saves an article draft on DEV. A person publishes it.', help: 'On dev.to open Settings → Extensions → DEV Community API Keys and generate a key. Articles are always saved as drafts.' },
  { kind: 'matrix', name: 'Matrix', color: '#0dbd8b', cat: 'messaging', fields: [f('homeserver', 'https://matrix.org', false, 'Homeserver'), f('access_token', 'syt_…', true, 'Access token'), f('room_id', '!abc123:matrix.org', false, 'Room ID')], about: 'Sends messages to a Matrix room (Element and others).', help: 'In Element open Settings → Help & About → Advanced → Access Token. The room ID is under Room settings → Advanced.' },
  { kind: 'zulip', name: 'Zulip', color: '#52c2af', cat: 'messaging', fields: [f('site', 'https://yourorg.zulipchat.com', false, 'Zulip address'), f('email', 'bot@yourorg.zulipchat.com', false, 'Bot email'), f('api_key', '…', true, 'Bot API key'), f('stream', 'general', false, 'Stream'), f('topic', 'Firbo AI', false, 'Topic', true)], about: 'Posts to a Zulip stream.', help: 'In Zulip create a generic bot (Settings → Bots) and copy its email and API key.' },
  { kind: 'rocketchat', name: 'Rocket.Chat', color: '#f5455c', cat: 'messaging', fields: [f('webhook_url', 'https://chat.example.com/hooks/…', true, 'Incoming webhook URL')], about: 'Sends messages to a Rocket.Chat channel.', help: 'In Rocket.Chat administration create an Incoming Integration (webhook) and paste its URL.' },
  { kind: 'todoist', name: 'Todoist', color: '#e44332', cat: 'work', fields: [f('token', '40 characters', true, 'API token')], about: 'Creates a Todoist task.', help: 'In Todoist open Settings → Integrations → Developer and copy your API token.' },
  { kind: 'monday', name: 'monday.com', color: '#ff3d57', cat: 'work', fields: [f('token', 'eyJ…', true, 'API token'), f('board_id', '1234567890', false, 'Board ID')], about: 'Adds an item to a monday.com board.', help: 'Open your avatar → Developers → My access tokens. The board ID is the number in the board’s address.' },
  { kind: 'homeassistant', name: 'Home Assistant', color: '#18bcf2', cat: 'automation', fields: [f('base_url', 'https://home.example.com', false, 'Address (https)'), f('token', 'eyJ…', true, 'Long-lived token'), f('notify_service', 'mobile_app_my_phone', false, 'Notify service')], about: 'Sends a notification to your phone through your smart home.', help: 'Home Assistant must be reachable over public https (for example through Nabu Casa). Create a long-lived access token on your profile page; the notify service is shown under Developer tools → Actions.' },
  { kind: 'ifttt', name: 'IFTTT', color: '#e5e7eb', cat: 'automation', fields: [f('key', '…', true, 'Webhooks key'), f('event', 'firbo', false, 'Event name')], about: 'Triggers an IFTTT applet with a message from your AI team.', help: 'Enable the Webhooks service on ifttt.com, copy your key from its settings and use the event name of your applet.' },
  { kind: 'mailchimp', name: 'Mailchimp', color: '#ffe01b', cat: 'email', fields: [f('api_key', '…-us21', true, 'API key'), f('list_id', 'a1b2c3d4e5', false, 'Audience ID')], about: 'Adds an email address from an approved action to your audience (the person confirms by email).', help: 'Create an API key under Account → Extras → API keys. The audience ID is under Audience → Settings → Audience name and defaults.' },
  { kind: 'brevo', name: 'Email (Brevo)', color: '#0b996e', cat: 'email', fields: [f('api_key', 'xkeysib-…', true, 'API key'), f('from', 'hello@yourdomain.com', false, 'From (verified sender)'), f('to', 'you@example.com', false, 'Send to')], about: 'Sends email through Brevo when you approve an action.', help: 'Create an API key under SMTP & API, and verify your sender address in Brevo first.' },
  { kind: 'stripe', name: 'Stripe', color: '#635bff', cat: 'commerce', readOnly: true, fields: [f('key', 'rk_live_…', true, 'Restricted API key')], about: 'Shows revenue and balance to your agents. Read-only.', help: 'In Stripe open Developers → API keys → Create restricted key and give it Read access only to Balance and Charges. Never paste a full secret key.' },
  { kind: 'shopify', name: 'Shopify', color: '#95bf47', cat: 'commerce', readOnly: true, fields: [f('shop', 'my-shop.myshopify.com', false, 'Store address'), f('token', 'shpat_…', true, 'Admin API access token')], about: 'Shows orders and sales to your agents. Read-only.', help: 'In your Shopify admin open Settings → Apps and sales channels → Develop apps, create an app with read_orders access and install it to get the access token.' },
  { kind: 'woocommerce', name: 'WooCommerce', color: '#96588a', cat: 'commerce', readOnly: true, fields: [f('site_url', 'https://yourstore.com', false, 'Store address'), f('consumer_key', 'ck_…', false, 'Consumer key'), f('consumer_secret', 'cs_…', true, 'Consumer secret')], about: 'Shows orders and sales to your agents. Read-only.', help: 'In WordPress open WooCommerce → Settings → Advanced → REST API, add a key with Read permission.' },
  { kind: 'lemonsqueezy', name: 'Lemon Squeezy', color: '#ffc233', cat: 'commerce', readOnly: true, fields: [f('api_key', 'eyJ…', true, 'API key')], about: 'Shows latest orders to your agents. Read-only.', help: 'In Lemon Squeezy open Settings → API and create a key.' },
  { kind: 'gumroad', name: 'Gumroad', color: '#ff90e8', cat: 'commerce', readOnly: true, fields: [f('access_token', '…', true, 'Access token')], about: 'Shows latest sales to your agents. Read-only.', help: 'On gumroad.com open Settings → Advanced → Applications, create an application and generate an access token.' },
  { kind: 'calendly', name: 'Calendly', color: '#006bff', cat: 'productivity', readOnly: true, fields: [f('token', 'eyJ…', true, 'Personal access token')], about: 'Shows your upcoming meetings to your agents. Read-only.', help: 'In Calendly open Integrations → API & Webhooks and generate a personal access token.' },
  { kind: 'calcom', name: 'Cal.com', color: '#e5e7eb', cat: 'productivity', readOnly: true, fields: [f('api_key', 'cal_live_…', true, 'API key')], about: 'Shows your bookings to your agents. Read-only.', help: 'In Cal.com open Settings → Developer → API keys and create a key.' },
  { kind: 'intercom', name: 'Intercom', color: '#286efa', cat: 'crm', readOnly: true, fields: [f('token', '…', true, 'Access token')], about: 'Shows open customer conversations to your agents. Read-only.', help: 'In Intercom Developer Hub create an app and copy its access token (read access to conversations is enough). US region workspaces only.' },
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
  // Read-only sign-ins for the company knowledge base: the AI team can read and search them, never send or change anything.
  { kind: 'gdrive_read', name: 'Google Drive · read', color: '#fbbc04', cat: 'productivity', oauth: 'GOOGLE', fields: [], readOnly: true, about: 'Lets your AI team read your Drive documents in Knowledge.', help: 'Sign in with Google (read-only). Then add it as a source on the Knowledge page.' },
  { kind: 'gmail_read', name: 'Gmail · read', color: '#ea4335', cat: 'email', oauth: 'GOOGLE', fields: [], readOnly: true, about: 'Lets your AI team read recent emails in Knowledge.', help: 'Sign in with Google (read-only). Then add it as a source on the Knowledge page.' },
  { kind: 'gcal_read', name: 'Google Calendar · read', color: '#4285f4', cat: 'productivity', oauth: 'GOOGLE', fields: [], readOnly: true, about: 'Lets your AI team see your calendar in Knowledge.', help: 'Sign in with Google (read-only). Then add it as a source on the Knowledge page.' },
  { kind: 'outlook_read', name: 'Outlook · read', color: '#0078d4', cat: 'email', oauth: 'MICROSOFT', fields: [], readOnly: true, about: 'Lets your AI team read recent emails and files in Knowledge.', help: 'Sign in with Microsoft (read-only). Then add it as a source on the Knowledge page.' },
  { kind: 'webhook', name: 'Webhook', color: '#34d399', cat: 'automation', fields: [f('url', 'https://hooks.example.com/…', true)] },
];

export const CATEGORIES: IntegrationCategory[] = ['messaging', 'email', 'productivity', 'work', 'crm', 'social', 'commerce', 'automation'];

/** Compatibility export: new providers now have explicit setup/read-only flows. */
export const PLANNED_APPS: {id:string;name:string;color:string;reason:string}[] = [];

export type IntegrationErrorCode = 'read_only' | 'invalid_fields' | 'test_failed' | 'send_failed' | 'forbidden' | 'too_many' | 'plan_limit' | 'not_configured' | 'save_failed' | 'not_found' | 'reauth' | 'unauthorized' | 'bad_request' | 'credentials_rejected' | 'rate_limited' | 'provider_failed' | 'invalid_response' | 'omni_pilot_disabled' | 'unknown';

export class IntegrationError extends Error {
  constructor(public code: IntegrationErrorCode, public detail?: { provider?: string; redirect_uri?: string }) {
    super(code);
  }
}

const KNOWN: IntegrationErrorCode[] = ['read_only', 'invalid_fields', 'test_failed', 'send_failed', 'forbidden', 'too_many', 'plan_limit', 'not_configured', 'save_failed', 'not_found', 'reauth', 'unauthorized', 'bad_request', 'credentials_rejected', 'rate_limited', 'provider_failed', 'invalid_response', 'omni_pilot_disabled'];

const call = <T,>(body: Record<string, unknown>): Promise<T> => callFn<T>('integrations', body);

async function callFn<T>(fn: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await requireClient().functions.invoke(fn, { body });
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
  kind === 'mcp'
    ? callFn<{ integration: IntegrationRow }>('mcp', { action: 'connect', organization_id, name, server_url: fields.server_url, token: fields.token ?? '' })
    : call<{ integration: IntegrationRow }>({ action: 'connect', organization_id, kind, name, fields });

export interface McpTool {
  name: string;
  description: string;
  inputSchema: { properties?: Record<string, { type?: string; description?: string }>; required?: string[] };
}
export const mcpTools = (id: string) => callFn<{ tools: McpTool[] }>('mcp', { action: 'tools', id });
export interface McpReceipt { request_id: string; result_id: string; arguments_sha256: string; result_sha256: string }
export const mcpCall = (id: string, tool: string, args: Record<string, unknown>, confirmed: boolean) =>
  confirmed === true
    ? callFn<{ text: string; is_error: boolean; receipt: McpReceipt }>('mcp', { action: 'call', id, tool, arguments: args, confirm: true })
    : Promise.reject(new Error('confirm_required'));
export const testIntegration = (id: string) => call<{ ok: true }>({ action: 'test', id });
export const sendIntegration = (id: string, text: string) => call<{ ok: true }>({ action: 'send', id, text });
export const snapshotIntegration = (id: string) => call<{ text: string }>({ action: 'snapshot', id });
export const disconnectIntegration = (id: string) => call<{ ok: true }>({ action: 'disconnect', id });

export const LEGACY_OAUTH_KINDS = ['gmail', 'gcal', 'gdrive', 'sheets', 'gdrive_read', 'gmail_read', 'gcal_read', 'outlook', 'outlook_read', 'linkedin', 'dropbox'] as const;
export interface IntegrationManifest {
  contract: 'firbo-integrations/v1';
  redirect_uri: string;
  oauth: { kind: typeof LEGACY_OAUTH_KINDS[number]; provider: OAuthGroup; configured: boolean }[];
}
export async function integrationManifest(organization_id: string): Promise<IntegrationManifest> {
  const data = await call<IntegrationManifest>({ action: 'integration_manifest', organization_id });
  if (!data || data.contract !== 'firbo-integrations/v1' || typeof data.redirect_uri !== 'string' || !Array.isArray(data.oauth)
    || data.oauth.length !== LEGACY_OAUTH_KINDS.length || new Set(data.oauth.map(p => p?.kind)).size !== LEGACY_OAUTH_KINDS.length
    || data.oauth.some(p => !p || !LEGACY_OAUTH_KINDS.includes(p.kind) || typeof p.configured !== 'boolean' || LIVE_APPS.find(a => a.kind === p.kind)?.oauth !== p.provider)) {
    throw new IntegrationError('invalid_response');
  }
  return data;
}

/** Starts sign-in only at the expected provider's HTTPS origin. */
export async function startOAuth(organization_id: string, kind: IntegrationKind, name: string, fields: Record<string, string>): Promise<{ url: string }> {
  const data = await call<{ url: string }>({ action: 'oauth_start', organization_id, kind, name, fields });
  const group = LIVE_APPS.find(a => a.kind === kind)?.oauth;
  const host = { GOOGLE: 'accounts.google.com', MICROSOFT: 'login.microsoftonline.com', LINKEDIN: 'www.linkedin.com', DROPBOX: 'www.dropbox.com' }[group as 'GOOGLE' | 'MICROSOFT' | 'LINKEDIN' | 'DROPBOX'];
  try {
    const url = new URL(data.url);
    if (!host || url.protocol !== 'https:' || url.hostname !== host || url.username || url.password || url.port) throw new Error();
  } catch { throw new IntegrationError('invalid_response'); }
  return data;
}

export const OAUTH_CONSOLE: Record<OAuthGroup, { label: string; url: string; secrets: string }> = {
  TIKTOK: {label:'TikTok Developers',url:'https://developers.tiktok.com/',secrets:'TIKTOK_CLIENT_ID, TIKTOK_CLIENT_SECRET'},
  SALESFORCE: {label:'Salesforce Setup',url:'https://login.salesforce.com/',secrets:'SALESFORCE_CLIENT_ID, SALESFORCE_CLIENT_SECRET, SALESFORCE_ENVIRONMENT'},
  QUICKBOOKS: {label:'Intuit Developer',url:'https://developer.intuit.com/',secrets:'QUICKBOOKS_CLIENT_ID, QUICKBOOKS_CLIENT_SECRET, QUICKBOOKS_ENVIRONMENT'},
  GOOGLE: { label: 'Google Cloud Console', url: 'https://console.cloud.google.com/apis/credentials', secrets: 'GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET' },
  MICROSOFT: { label: 'Microsoft Entra', url: 'https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade', secrets: 'MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET' },
  LINKEDIN: { label: 'LinkedIn Developers', url: 'https://www.linkedin.com/developers/apps', secrets: 'LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET' },
  DROPBOX: { label: 'Dropbox App Console', url: 'https://www.dropbox.com/developers/apps', secrets: 'DROPBOX_CLIENT_ID, DROPBOX_CLIENT_SECRET' },
};
