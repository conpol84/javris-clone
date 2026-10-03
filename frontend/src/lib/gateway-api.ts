import { apiFetch as legacyFetch, getBase as legacyBase, isTauri } from './api';

/** The cloud gateway uses deployment-owned configuration, not editable desktop settings. */
export function resolveGatewayBase(input: {
  hostname: string; desktop: boolean; configuredBase: string; legacyBase: string;
}): string {
  if (input.desktop) return input.legacyBase;
  const host = input.hostname.toLowerCase();
  if (host === 'firboai.app' || host === 'www.firboai.app') return 'https://api.firboai.app';
  const configured = input.configuredBase.trim();
  if (configured) {
    try {
      const url = new URL(configured);
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error();
      return url.toString().replace(/\/+$/, '');
    } catch { throw new Error('gateway_api_url_invalid'); }
  }
  // Local development and the upstream same-origin server remain supported.
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

/** A missing cloud session must not send a saved desktop/API key to any server. */
export function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  if (isTauri()) return legacyFetch(path, init);
  return Promise.reject(new Error('sign_in_required'));
}
