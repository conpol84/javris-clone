import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();

vi.mock('./client', () => ({
  requireClient: () => ({ functions: { invoke } }),
}));

import { FunctionsHttpError } from '@supabase/supabase-js';
import { integrationManifest, LEGACY_OAUTH_KINDS, LIVE_APPS, mcpCall, startOAuth } from './integrations';
import { connectionSetupReason, integrationDiagnostic, integrationMessages } from './integration-readiness';

describe('MCP company client', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends an explicit confirmation and preserves the durable receipts', async () => {
    const receipt = {
      request_id: 'request-receipt',
      result_id: 'result-receipt',
      arguments_sha256: 'a'.repeat(64),
      result_sha256: 'b'.repeat(64),
    };
    invoke.mockResolvedValue({ data: { text: 'Synthetic result', is_error: false, receipt }, error: null });

    await expect(mcpCall('integration-1', 'weather.read', { city: 'Larnaca' }, true)).resolves.toEqual({
      text: 'Synthetic result',
      is_error: false,
      receipt,
    });
    expect(invoke).toHaveBeenCalledWith('mcp', {
      body: {
        action: 'call',
        id: 'integration-1',
        tool: 'weather.read',
        arguments: { city: 'Larnaca' },
        confirm: true,
      },
    });
  });

  it('does not invoke the Edge Function without a caller-confirmed action', async () => {
    await expect(mcpCall('integration-1', 'weather.read', {}, false)).rejects.toThrow('confirm_required');
    expect(invoke).not.toHaveBeenCalled();
  });
});

const manifest = () => ({ contract: 'firbo-integrations/v1', redirect_uri: 'https://database.invalid/functions/v1/integrations',
  oauth: LEGACY_OAUTH_KINDS.map(kind => ({ kind, provider: LIVE_APPS.find(a => a.kind === kind)!.oauth, configured: false })) });

describe('App connection readiness and diagnostics', () => {
  beforeEach(() => vi.clearAllMocks());
  it('validates the complete OAuth manifest and keeps setup separate from a connected account', async () => {
    invoke.mockResolvedValue({ data: manifest(), error: null });
    const result = await integrationManifest('org-1');
    expect(result.oauth).toHaveLength(11);
    expect(result.oauth.every(p => !p.configured)).toBe(true);
    expect(invoke).toHaveBeenCalledWith('integrations', { body: { action: 'integration_manifest', organization_id: 'org-1' } });
  });
  it.each([
    null, {}, { ...manifest(), contract: 'old-contract' },
    { ...manifest(), oauth: manifest().oauth.slice(1) },
    { ...manifest(), oauth: [manifest().oauth[0], ...manifest().oauth.slice(0, -1)] },
    { ...manifest(), oauth: manifest().oauth.map(p => ({ ...p, configured: 'true' })) },
    { ...manifest(), oauth: manifest().oauth.map(p => ({ ...p, provider: 'OTHER' })) },
  ])('rejects an unsupported readiness response (%j)', async data => {
    invoke.mockResolvedValue({ data, error: null });
    await expect(integrationManifest('org-1')).rejects.toMatchObject({ code: 'invalid_response' });
  });
  it.each(['save_failed', 'reauth', 'credentials_rejected', 'rate_limited', 'provider_failed'])('preserves actionable server error %s', async error => {
    invoke.mockResolvedValue({ data: null, error: new FunctionsHttpError(Response.json({ error }, { status: 502 })) });
    await expect(startOAuth('org-1', 'gmail', 'Gmail', {})).rejects.toMatchObject({ code: error });
    expect(integrationDiagnostic(error)).not.toBeNull();
  });
  it.each([
    ['gmail', 'accounts.google.com'], ['outlook', 'login.microsoftonline.com'],
    ['linkedin', 'www.linkedin.com'], ['dropbox', 'www.dropbox.com'],
  ] as const)('accepts the expected %s provider origin', async (kind, host) => {
    const url = `https://${host}/oauth?state=synthetic`;
    invoke.mockResolvedValue({ data: { url }, error: null });
    await expect(startOAuth('org-1', kind, kind, {})).resolves.toEqual({ url });
  });
  it.each([
    'http://accounts.google.com/oauth', 'https://accounts.google.com.attacker.invalid/oauth',
    'https://www.dropbox.com/oauth', 'https://user@accounts.google.com/oauth',
    'https://accounts.google.com:8080/oauth', 'javascript:alert(1)', '',
  ])('rejects an unsafe or mismatched OAuth redirect (%s)', async url => {
    invoke.mockResolvedValue({ data: { url }, error: null });
    await expect(startOAuth('org-1', 'gmail', 'Gmail', {})).rejects.toMatchObject({ code: 'invalid_response' });
  });
  it('explains schema, runtime, credentials and approved origins separately', () => {
    const base = { contract: 'firbo-connections/v1' as const, enabled: true, server_error: null,
      redirect_uri: '', providers: [{ kind: 'youtube', configured: true, enabled: true, read_only: true, environment: 'production', secret_names: [] }],
      bridges: [{ kind: 'traccar', configured: false, enabled: true, read_only: true }] };
    expect(connectionSetupReason(null, 'youtube')).toBeNull();
    expect(connectionSetupReason(base, 'youtube')).toBeNull();
    expect(connectionSetupReason({ ...base, enabled: false }, 'youtube')).toBe('disabled');
    expect(connectionSetupReason({ ...base, enabled: false, server_error: 'schema_required' }, 'youtube')).toBe('schema');
    expect(connectionSetupReason({ ...base, providers: [{ ...base.providers[0], configured: false }] }, 'youtube')).toBe('credentials');
    expect(connectionSetupReason(base, 'traccar')).toBe('origin');
    expect(connectionSetupReason(base, 'missing')).toBe('response');
    expect(integrationMessages('el').disabled).toContain('απενεργοποιημένες');
    expect(integrationDiagnostic('private untrusted provider text')).toBeNull();
  });
});
