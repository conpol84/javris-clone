import type { TKey } from '../../i18n/locales/en';

export interface PowerMeta {
  color: string;
  /** True only when the agent runner really executes this power through the gateway. */
  live: boolean;
  desc: TKey;
}

/** What each tool permission means, and whether Firbo really runs it. Unknown tools still show, as permission only. */
export const POWER_META: Record<string, PowerMeta> = {
  web_search: { color: '#00d4ff', live: true, desc: 'studio.power.web_search' },
  browser_extract: { color: '#60a5fa', live: true, desc: 'studio.power.browser_extract' },
  http_request: { color: '#38bdf8', live: false, desc: 'studio.power.http_request' },
  browser_navigate: { color: '#818cf8', live: false, desc: 'studio.power.browser_navigate' },
  pdf_extract: { color: '#f472b6', live: false, desc: 'studio.power.pdf_extract' },
  memory_search: { color: '#a78bfa', live: false, desc: 'studio.power.memory_search' },
  memory_store: { color: '#c084fc', live: false, desc: 'studio.power.memory_store' },
  knowledge_search: { color: '#fbbf24', live: false, desc: 'studio.power.knowledge_search' },
  file_write: { color: '#fb923c', live: false, desc: 'studio.power.file_write' },
  think: { color: '#a3e635', live: false, desc: 'studio.power.think' },
};

export const FALLBACK_POWER: PowerMeta = { color: '#94a3b8', live: false, desc: 'studio.power.other' };

export const powerMeta = (tool: string): PowerMeta => POWER_META[tool] ?? FALLBACK_POWER;

export const powerLabel = (tool: string) => tool.replace(/_/g, ' ');
