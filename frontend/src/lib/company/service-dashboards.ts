/** Public dashboard navigation only; credentials and private services stay out of links. */
export function dashboardUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
      || !url.hostname.includes('.') || /^(localhost|127\.|0\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(url.hostname)
      || url.hostname.endsWith('.localhost') || url.hostname.endsWith('.local')) return null;
    return url.href;
  } catch { return null; }
}

export const DEFAULT_JARVIS_DASHBOARD = 'https://jarvis.firboai.app/';

/** The hosted coding page embeds this panel; linking back there is not server management. */
export function jarvisDashboardUrl(value: unknown): string {
  const safe = dashboardUrl(value);
  if (!safe) return DEFAULT_JARVIS_DASHBOARD;
  const url = new URL(safe);
  if (['firboai.app', 'www.firboai.app', 'javris.firboai.app'].includes(url.hostname)
    || /^\/coding(?:\/|$)/i.test(url.pathname)) return DEFAULT_JARVIS_DASHBOARD;
  return safe;
}

export const JARVIS_DASHBOARD = jarvisDashboardUrl(import.meta.env.VITE_SERVER_AGENT_DASHBOARD);
