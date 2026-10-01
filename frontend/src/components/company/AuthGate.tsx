import { useState, type FormEvent, type ReactNode } from 'react';
import { useCompanyAuth } from '../../lib/company/AuthProvider';

const card = {
  background: 'var(--color-bg-secondary)',
  border: '1px solid var(--color-border)',
  color: 'var(--color-text)',
} as const;

const field = {
  background: 'var(--color-input-bg)',
  border: '1px solid var(--color-input-border)',
  color: 'var(--color-text)',
} as const;

function Shell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="flex h-full w-full items-center justify-center px-4" style={{ background: 'var(--color-bg)' }}>
      <div className="w-full max-w-sm rounded-xl p-6" style={card}>
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="mt-1 mb-5 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
          {subtitle}
        </p>
        {children}
      </div>
    </div>
  );
}

export function LoginScreen() {
  const { signIn, signUp } = useCompanyAuth();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (mode === 'signin') {
        await signIn(email, password);
      } else {
        const { needsConfirmation } = await signUp(email, password);
        if (needsConfirmation) setNotice('Check your email to confirm your account, then sign in.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell title="JARVIS Command Center" subtitle={mode === 'signin' ? 'Sign in to your workspace' : 'Create your account'}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <input
          type="email"
          required
          autoComplete="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="h-9 rounded-lg px-3 text-sm outline-none"
          style={field}
        />
        <input
          type="password"
          required
          minLength={8}
          autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
          placeholder="Password (min 8 characters)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="h-9 rounded-lg px-3 text-sm outline-none"
          style={field}
        />
        {error && (
          <p role="alert" className="text-xs" style={{ color: 'var(--color-error)' }}>
            {error}
          </p>
        )}
        {notice && (
          <p className="text-xs" style={{ color: 'var(--color-success)' }}>
            {notice}
          </p>
        )}
        <button
          type="submit"
          disabled={busy}
          className="h-9 rounded-lg text-sm font-medium cursor-pointer disabled:opacity-50"
          style={{ background: 'var(--color-accent)', color: 'var(--color-on-accent)' }}
        >
          {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}
        </button>
      </form>
      <button
        type="button"
        onClick={() => {
          setMode(mode === 'signin' ? 'signup' : 'signin');
          setError('');
          setNotice('');
        }}
        className="mt-4 text-xs underline cursor-pointer"
        style={{ color: 'var(--color-text-secondary)' }}
      >
        {mode === 'signin' ? 'No account? Create one' : 'Already have an account? Sign in'}
      </button>
    </Shell>
  );
}

export function CreateOrgScreen() {
  const { createOrg, signOut } = useCompanyAuth();
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await createOrg(name);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the company');
      setBusy(false);
    }
  };

  return (
    <Shell title="Create your company" subtitle="Your AI team (CEO, Research, Sales, Marketing, Operations, Finance, Developer) is set up automatically.">
      <form onSubmit={submit} className="flex flex-col gap-3">
        <input
          required
          maxLength={120}
          placeholder="Company name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-9 rounded-lg px-3 text-sm outline-none"
          style={field}
        />
        {error && (
          <p role="alert" className="text-xs" style={{ color: 'var(--color-error)' }}>
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={busy || name.trim().length === 0}
          className="h-9 rounded-lg text-sm font-medium cursor-pointer disabled:opacity-50"
          style={{ background: 'var(--color-accent)', color: 'var(--color-on-accent)' }}
        >
          {busy ? 'Creating…' : 'Create company'}
        </button>
      </form>
      <button
        type="button"
        onClick={() => void signOut()}
        className="mt-4 text-xs underline cursor-pointer"
        style={{ color: 'var(--color-text-secondary)' }}
      >
        Sign out
      </button>
    </Shell>
  );
}

/** Renders children untouched unless the company workspace is configured. */
export function AuthGate({ children }: { children: ReactNode }) {
  const { enabled, loading, session, current, loadError, retry, signOut } = useCompanyAuth();
  if (!enabled) return <>{children}</>;
  if (loading) {
    return (
      <div className="flex h-full w-full items-center justify-center text-sm" style={{ color: 'var(--color-text-secondary)' }}>
        Loading…
      </div>
    );
  }
  if (!session) return <LoginScreen />;
  if (loadError) {
    return (
      <Shell title="Can't load your workspace" subtitle={loadError}>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={retry}
            className="h-9 flex-1 rounded-lg text-sm font-medium cursor-pointer"
            style={{ background: 'var(--color-accent)', color: 'var(--color-on-accent)' }}
          >
            Retry
          </button>
          <button
            type="button"
            onClick={() => void signOut()}
            className="h-9 rounded-lg px-3 text-sm cursor-pointer"
            style={field}
          >
            Sign out
          </button>
        </div>
      </Shell>
    );
  }
  if (!current) return <CreateOrgScreen />;
  return <>{children}</>;
}
