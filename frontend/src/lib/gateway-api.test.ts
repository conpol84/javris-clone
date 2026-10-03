import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('./api', () => ({ apiFetch: vi.fn(), getBase: vi.fn(() => 'http://old-desktop:8000'), isTauri: vi.fn(() => false) }));
import { apiFetch as desktopFetch, getBase as desktopBase, isTauri } from './api';
import { apiFetch, getBase, resolveGatewayBase, hasFirboProxy } from './gateway-api';

const input = { hostname: 'firboai.app', desktop: false, configuredBase: '', legacyBase: 'http://localhost:8000' };
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks(); vi.mocked(isTauri).mockReturnValue(false); });

describe('cloud gateway endpoint', () => {
  it('pins the production origin despite stale local settings', () => expect(resolveGatewayBase(input)).toBe(''));
  it('also pins www and rejects neither login nor networking merely due to an old build URL', () =>
    expect(resolveGatewayBase({ ...input, hostname: 'www.firboai.app', configuredBase: 'http://stale:8000' })).toBe(''));
  it('uses deployment configuration for previews, not desktop settings', () =>
    expect(resolveGatewayBase({ ...input, hostname: 'firbo-preview.vercel.app', configuredBase: 'https://candidate.example.test/' })).toBe('https://candidate.example.test'));
  it.each(['http://api.example.test', 'https://name:secret@api.example.test', 'https://api.example.test?secret=1', 'https://api.example.test#secret', 'not-a-url'])('rejects invalid configured cloud URL %s', configuredBase =>
    expect(() => resolveGatewayBase({ ...input, hostname: 'preview.vercel.app', configuredBase })).toThrow('gateway_api_url_invalid'));
  it('does not pin a misleading suffix', () => expect(resolveGatewayBase({ ...input, hostname: 'firboai.app.evil.test' })).toBe(''));
  it('preserves desktop routing', () => expect(resolveGatewayBase({ ...input, desktop: true })).toBe(input.legacyBase));
  it('preserves local development routing', () => expect(resolveGatewayBase({ ...input, hostname: 'localhost' })).toBe(input.legacyBase));
  it('does not read local API settings in the production browser', () => {
    vi.stubGlobal('window', { location: { hostname: 'firboai.app' } });
    expect(getBase()).toBe('');
    expect(desktopBase).not.toHaveBeenCalled();
  });
  it('does not forward a desktop key when cloud session is missing', async () => {
    await expect(apiFetch('/v1/gateway/overview')).rejects.toThrow('sign_in_required');
    expect(desktopFetch).not.toHaveBeenCalled();
  });
  it('keeps the existing desktop authenticated fetch', async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(desktopFetch).mockResolvedValue(new Response('{}'));
    await apiFetch('/v1/gateway/overview');
    expect(desktopFetch).toHaveBeenCalledWith('/v1/gateway/overview', {});
  });
});

describe('Firbo same-origin proxy ownership', () => {
  it.each(['firboai.app', 'www.firboai.app', 'FIRBOAI.APP', 'jarvis-command-center-nu.vercel.app',
    'jarvis-command-center-conpol84s-projects.vercel.app', 'jarvis-command-center-e0m6di29i-conpol84s-projects.vercel.app',
    'jarvis-command-center-git-hotfix-conpol84s-projects.vercel.app'])('uses proxy for %s', hostname => {
    expect(hasFirboProxy(hostname)).toBe(true);
    expect(resolveGatewayBase({ ...input, hostname, configuredBase: 'http://stale:8000' })).toBe('');
  });
  it.each(['firboai.app.evil.test', 'jarvis-command-center-evil.vercel.app', 'jarvis-command-center-a-conpol84s-projects.vercel.app.evil.test',
    'api.firboai.app', 'gateway.firboai.app', 'preview.vercel.app'])('does not infer Firbo proxy for %s', hostname => {
    expect(hasFirboProxy(hostname)).toBe(false);
  });
});
