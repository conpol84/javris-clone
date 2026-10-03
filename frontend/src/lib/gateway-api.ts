import { apiFetch as legacyFetch, getBase as legacyBase, isTauri } from './api';

/** These deployed frontends have fixed, non-caching Vercel API rewrites. */
export function hasFirboProxy(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === 'firboai.app' || host === 'www.firboai.app'
    || host === 'jarvis-command-center-nu.vercel.app'
    || host === 'jarvis-command-center-conpol84s-projects.vercel.app'
    || /^jarvis-command-center-[a-z0-9-]+-conpol84s-projects\.vercel\.app$/.test(host);
}

/** Empty base means same-origin, NOT missing configuration, on Firbo deployments. */
export function resolveGatewayBase(input: {
  hostname: string; desktop: boolean; configuredBase: string; legacyBase: string;
}): string {
  if (input.desktop) return input.legacyBase;
  const host = input.hostname.toLowerCase();
  if (hasFirboProxy(host)) return '';
  const configured = input.configuredBase.trim();
  if (configured) {
    try {
      const url = new URL(configured);
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error();
      return url.toString().replace(/\/+$/, '');
    } catch { throw new Error('gateway_api_url_invalid'); }
  }
  if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]') return input.legacyBase;
  return '';
}

export function getBase(): string {
  const desktop = isTauri();
  const hostname = typeof window === 'undefined' ? '' : window.location.hostname;
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
  return resolveGatewayBase({ hostname, desktop,
    configuredBase: String(import.meta.env.VITE_API_URL ?? ''),
    legacyBase: desktop || local ? legacyBase() : '',
  });
}

/** No cloud request falls back to a desktop/server management key. */
export function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  if (isTauri()) return legacyFetch(path, init);
  return Promise.reject(new Error('sign_in_required'));
}
