import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthGate } from './AuthGate';

const auth = vi.hoisted(() => ({
  value: {} as Record<string, unknown>,
}));

vi.mock('../../lib/company/AuthProvider', () => ({
  useCompanyAuth: () => auth.value,
}));

const base = {
  enabled: true,
  loading: false,
  session: { access_token: 't' },
  current: { role: 'owner', organization: { id: 'o', name: 'Acme', slug: 'acme', profile: { onboarded: true } } },
  loadError: '',
  retry: vi.fn(),
  signOut: vi.fn(),
  signIn: vi.fn(),
  signUp: vi.fn(),
  createOrg: vi.fn(),
};

const render = (over: Record<string, unknown>) => {
  auth.value = { ...base, ...over };
  return renderToStaticMarkup(
    <AuthGate>
      <div>APP</div>
    </AuthGate>,
  );
};

describe('AuthGate', () => {
  beforeEach(() => vi.clearAllMocks());

  it('is transparent when the company workspace is not configured', () => {
    const html = render({ enabled: false, session: null, current: null });
    expect(html).toContain('APP');
    expect(html).not.toContain('Sign in');
  });

  it('shows a loading state before auth resolves', () => {
    const html = render({ loading: true, session: null });
    expect(html).toContain('Loading');
    expect(html).not.toContain('APP');
  });

  it('shows the public landing page (not the app) when there is no session', () => {
    const html = render({ session: null, current: null });
    expect(html).toContain('Run your company with a');
    expect(html).toContain('Sign in');
    expect(html).toContain('Create your company');
    expect(html).not.toContain('APP');
  });

  it('asks a signed-in user without a company to create one', () => {
    const html = render({ current: null });
    expect(html).toContain('Create your company');
    expect(html).not.toContain('APP');
  });

  it('shows a retry instead of the create-company screen when loading memberships failed', () => {
    const html = render({ current: null, loadError: 'network down' });
    expect(html).toContain('network down');
    expect(html).toContain('Retry');
    expect(html).not.toContain('Create your company');
  });

  it('runs onboarding once for a new company owner, but never for plain members', () => {
    const fresh = { role: 'owner', organization: { id: 'o', name: 'Acme', slug: 'acme', profile: {} } };
    expect(render({ current: fresh })).toContain('What should your AI team help with first?');
    expect(render({ current: fresh })).not.toContain('APP');
    expect(render({ current: { ...fresh, role: 'member' } })).toContain('APP');
  });

  it('renders the app once signed in with a company', () => {
    expect(render({})).toContain('APP');
  });
});
