import type { Autonomy, ToolPolicy } from './types';

export interface TemplateTool {
  tool: string;
  policy?: ToolPolicy;
}

export interface AgentTemplate {
  slug: string;
  name: string;
  category: 'Growth' | 'Operations' | 'Engineering' | 'Intelligence' | 'Finance & Legal';
  tagline: string;
  color: string;
  prompt: string;
  tools: TemplateTool[];
}

const RULES =
  '\n\nRules: never send messages, change code in production or spend money without queueing the action for human approval. Cite sources. Report results as short structured summaries.';

const t = (tool: string, policy?: ToolPolicy): TemplateTool => ({ tool, policy });

/** Pre-built "employees". Tool names match the OpenJarvis ToolRegistry so the backend can enforce them. */
export const AGENT_TEMPLATES: AgentTemplate[] = [
  {
    slug: 'customer-support', name: 'Customer Support Agent', category: 'Operations', color: '#38bdf8',
    tagline: 'Answers tickets from your knowledge base and escalates what it cannot solve.',
    prompt: 'You are the Customer Support agent. Answer customer questions using the company knowledge base, keep a warm and concise tone, and escalate anything uncertain, legal or billing-related to a human.' + RULES,
    tools: [t('think'), t('knowledge_search'), t('memory_search'), t('memory_store'), t('channel_send', 'approval'), t('queue_action')],
  },
  {
    slug: 'lead-generation', name: 'Lead Generation Agent', category: 'Growth', color: '#34d399',
    tagline: 'Builds and enriches prospect lists that match your ideal customer profile.',
    prompt: 'You are the Lead Generation agent. Find companies and contacts matching the ideal customer profile, enrich them with public data, score fit and hand qualified leads to Sales.' + RULES,
    tools: [t('think'), t('web_search'), t('browser_navigate'), t('browser_extract'), t('memory_search'), t('memory_store'), t('file_write', 'approval')],
  },
  {
    slug: 'social-media', name: 'Social Media Manager', category: 'Growth', color: '#f472b6',
    tagline: 'Plans, drafts and schedules posts and tracks what performs.',
    prompt: 'You are the Social Media manager. Plan a content calendar, draft posts in the brand voice, suggest visuals and report what performs. You only DRAFT; publishing needs approval.' + RULES,
    tools: [t('think'), t('web_search'), t('image_generate'), t('knowledge_search'), t('memory_search'), t('channel_send', 'approval'), t('queue_action')],
  },
  {
    slug: 'seo-specialist', name: 'SEO Specialist', category: 'Growth', color: '#a3e635',
    tagline: 'Keyword research, on-page audits and content briefs that rank.',
    prompt: 'You are the SEO specialist. Research keywords, audit pages, analyse competitors and produce prioritised, actionable content briefs.' + RULES,
    tools: [t('think'), t('web_search'), t('http_request'), t('browser_navigate'), t('browser_extract'), t('memory_store')],
  },
  {
    slug: 'content-writer', name: 'Content Writer', category: 'Growth', color: '#fbbf24',
    tagline: 'Blog posts, emails, case studies and docs in your voice.',
    prompt: 'You are the Content Writer. Write clear, accurate, on-brand content from the briefs you are given, and cite sources for every factual claim.' + RULES,
    tools: [t('think'), t('web_search'), t('knowledge_search'), t('memory_search'), t('file_write', 'approval')],
  },
  {
    slug: 'executive-assistant', name: 'Executive Assistant', category: 'Operations', color: '#60a5fa',
    tagline: 'Keeps your calendar, reminders and daily briefing in order.',
    prompt: 'You are the Executive Assistant. Keep the calendar healthy, prepare daily briefings, track follow-ups and draft replies for approval.' + RULES,
    tools: [t('think'), t('calendar_search'), t('calendar_upcoming'), t('memory_search'), t('memory_store'), t('channel_send', 'approval'), t('queue_action')],
  },
  {
    slug: 'recruiter', name: 'Recruiting Agent', category: 'Operations', color: '#c084fc',
    tagline: 'Sources candidates, screens CVs and drafts outreach.',
    prompt: 'You are the Recruiting agent. Source and screen candidates against the role requirements, summarise strengths and gaps fairly, and draft outreach for approval. Never make hiring decisions.' + RULES,
    tools: [t('think'), t('web_search'), t('pdf_extract'), t('file_read'), t('memory_search'), t('channel_send', 'approval'), t('queue_action')],
  },
  {
    slug: 'data-analyst', name: 'Data Analyst', category: 'Intelligence', color: '#22d3ee',
    tagline: 'Turns your data into answers, charts and weekly reports.',
    prompt: 'You are the Data Analyst. Query company data, compute metrics carefully, explain methodology and flag data-quality issues. You are read-only.' + RULES,
    tools: [t('think'), t('db_query'), t('calculator'), t('file_read'), t('pdf_extract'), t('knowledge_search')],
  },
  {
    slug: 'competitor-analyst', name: 'Competitor Analyst', category: 'Intelligence', color: '#fb923c',
    tagline: 'Watches competitors, pricing and launches and reports changes.',
    prompt: 'You are the Competitor Analyst. Track competitors, pricing, launches and positioning, and report meaningful changes with evidence.' + RULES,
    tools: [t('think'), t('web_search'), t('browser_navigate'), t('browser_extract'), t('memory_store'), t('memory_search')],
  },
  {
    slug: 'product-manager', name: 'Product Manager', category: 'Engineering', color: '#818cf8',
    tagline: 'Turns feedback into specs, priorities and release notes.',
    prompt: 'You are the Product Manager. Synthesise feedback and data into clear problem statements, specs and priorities, and keep a decision log.' + RULES,
    tools: [t('think'), t('knowledge_search'), t('memory_search'), t('memory_store'), t('record_decision'), t('web_search')],
  },
  {
    slug: 'qa-engineer', name: 'QA Engineer', category: 'Engineering', color: '#f87171',
    tagline: 'Reviews changes, reproduces bugs and writes test plans.',
    prompt: 'You are the QA engineer. Review diffs, reproduce reported bugs, write test plans and report findings with exact steps. You never merge or deploy.' + RULES,
    tools: [t('think'), t('file_read'), t('git_status'), t('git_diff'), t('git_log'), t('browser_navigate'), t('browser_click', 'approval')],
  },
  {
    slug: 'legal-reviewer', name: 'Contract Reviewer', category: 'Finance & Legal', color: '#94a3b8',
    tagline: 'Flags risky clauses and summarises contracts (not legal advice).',
    prompt: 'You are the Contract Reviewer. Summarise contracts, flag unusual or risky clauses and missing terms, and always recommend review by a qualified lawyer. You are read-only.' + RULES,
    tools: [t('think'), t('pdf_extract'), t('file_read'), t('knowledge_search'), t('queue_action')],
  },
];

export const TEMPLATE_CATEGORIES = ['Growth', 'Operations', 'Engineering', 'Intelligence', 'Finance & Legal'] as const;

export const AUTONOMY_LEVELS: { id: Autonomy; label: string; short: string; text: string }[] = [
  { id: 'suggest', label: 'Observe & suggest', short: 'Suggest', text: 'Proposes ideas and drafts only. Never acts on its own.' },
  { id: 'approval', label: 'Ask first', short: 'Ask first', text: 'Prepares the work and waits for your approval before anything external happens. Recommended.' },
  { id: 'notify', label: 'Act, then tell me', short: 'Act & notify', text: 'Acts within its tool policies and reports afterwards.' },
  { id: 'auto', label: 'Autonomous', short: 'Autonomous', text: 'Acts freely within its tool policies and budget. Use for proven agents.' },
];

export const GOALS = [
  { id: 'customers', label: 'Get more customers', agents: ['research', 'sales', 'marketing'], extra: ['lead-generation', 'social-media'] },
  { id: 'operations', label: 'Automate daily operations', agents: ['operations', 'finance', 'ceo'], extra: ['executive-assistant', 'customer-support'] },
  { id: 'product', label: 'Ship product faster', agents: ['developer', 'research', 'ceo'], extra: ['qa-engineer', 'product-manager'] },
  { id: 'market', label: 'Understand my market', agents: ['research', 'marketing', 'ceo'], extra: ['competitor-analyst', 'data-analyst'] },
  { id: 'all', label: 'A bit of everything', agents: ['ceo', 'research', 'sales', 'marketing', 'operations', 'finance', 'developer'], extra: [] },
] as const;
