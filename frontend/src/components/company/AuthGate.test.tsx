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
  current: { role: 'owner', organization: { id: 'o', name: 'Acme', slug: 'acme' } },
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

  it('requires sign in when there is no session', () => {
    const html = render({ session: null, current: null });
    expect(html).toContain('Sign in to your workspace');
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

  it('renders the app once signed in with a company', () => {
    expect(render({})).toContain('APP');
  });
});
