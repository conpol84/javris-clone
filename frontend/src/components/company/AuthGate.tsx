import { useState, type FormEvent, type ReactNode } from 'react';
import { useCompanyAuth } from '../../lib/company/AuthProvider';
import { LogoMark } from '../brand/Logo';
import { LanguageSwitcher } from '../brand/LanguageSwitcher';
import { useI18n } from '../../i18n/I18nProvider';
import { LandingPage } from '../../pages/LandingPage';
import { OnboardingWizard } from './OnboardingWizard';
import '../../styles/firbo.css';

type Mode = 'signin' | 'signup';

function Shell({
  title,
  subtitle,
  children,
  onBack,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  onBack?: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="fb-root flex h-full w-full items-center justify-center px-4">
      <LanguageSwitcher className="absolute end-4 top-4" />
      <div className="fb-glass fb-fade-up w-full max-w-sm p-7" style={{ borderColor: 'var(--fb-border-strong)' }}>
        {onBack && (
          <button type="button" onClick={onBack} className="fb-link fb-muted mb-4 cursor-pointer text-xs hover:text-white">
            <span className="inline-block rtl:rotate-180">←</span> {t('common.back')}
          </button>
        )}
        <div className="mb-5">
          <LogoMark size={44} />
        </div>
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="fb-muted mb-5 mt-1 text-sm">{subtitle}</p>
        {children}
      </div>
    </div>
  );
}

export function LoginScreen({ initialMode = 'signin', onBack }: { initialMode?: Mode; onBack?: () => void }) {
  const { signIn, signUp } = useCompanyAuth();
  const { t } = useI18n();
  const [mode, setMode] = useState<Mode>(initialMode);
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
        if (needsConfirmation) setNotice(t('auth.confirmEmail'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.genericError'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell
      title="Firbo AI"
      subtitle={mode === 'signin' ? t('auth.subtitle.signin') : t('auth.subtitle.signup')}
      onBack={onBack}
    >
      <form onSubmit={submit} className="flex flex-col gap-3">
        <input
          type="email"
          required
          autoComplete="email"
          aria-label={t('auth.email')}
          placeholder={t('auth.email')}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="fb-input"
        />
        <input
          type="password"
          required
          minLength={8}
          autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
          aria-label={t('auth.password')}
          placeholder={t('auth.password')}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="fb-input"
        />
        {error && (
          <p role="alert" className="text-xs" style={{ color: 'var(--fb-err)' }}>
            {error}
          </p>
        )}
        {notice && (
          <p className="text-xs" style={{ color: 'var(--fb-ok)' }}>
            {notice}
          </p>
        )}
        <button type="submit" disabled={busy} className="fb-btn fb-btn--primary disabled:opacity-50">
          {busy ? t('auth.wait') : mode === 'signin' ? t('auth.signIn') : t('auth.createAccount')}
        </button>
      </form>
      <button
        type="button"
        onClick={() => {
          setMode(mode === 'signin' ? 'signup' : 'signin');
          setError('');
          setNotice('');
        }}
        className="fb-link fb-muted mt-4 cursor-pointer text-xs underline"
      >
        {mode === 'signin' ? t('auth.toSignup') : t('auth.toSignin')}
      </button>
    </Shell>
  );
}

export function CreateOrgScreen() {
  const { createOrg, signOut } = useCompanyAuth();
  const { t } = useI18n();
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
      setError(err instanceof Error ? err.message : t('org.create.error'));
      setBusy(false);
    }
  };

  return (
    <Shell
      title={t('org.create.title')}
      subtitle={t('org.create.subtitle')}
    >
      <form onSubmit={submit} className="flex flex-col gap-3">
        <input
          required
          maxLength={120}
          aria-label={t('org.create.name')}
          placeholder={t('org.create.name')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="fb-input"
        />
        {error && (
          <p role="alert" className="text-xs" style={{ color: 'var(--fb-err)' }}>
            {error}
          </p>
        )}
        <button type="submit" disabled={busy || name.trim().length === 0} className="fb-btn fb-btn--primary disabled:opacity-50">
          {busy ? t('org.create.busy') : t('org.create.submit')}
        </button>
      </form>
      <button type="button" onClick={() => void signOut()} className="fb-link fb-muted mt-4 cursor-pointer text-xs underline">
        {t('common.signOut')}
      </button>
    </Shell>
  );
}

/** Logged-out experience: public landing page, with sign-in / sign-up one click away. */
function PublicSite() {
  const path = typeof window !== 'undefined' ? window.location.pathname : '/';
  const initial: Mode | null = path === '/signup' ? 'signup' : path === '/login' ? 'signin' : null;
  const [view, setView] = useState<Mode | null>(initial);
  if (view) return <LoginScreen initialMode={view} onBack={() => setView(null)} />;
  return <LandingPage onSignIn={() => setView('signin')} onSignUp={() => setView('signup')} />;
}

/**
 * Renders children untouched unless the company workspace is configured.
 * When it is, the app only works after login; logged-out visitors see the public site.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const { enabled, loading, session, current, loadError, retry, signOut } = useCompanyAuth();
  const { t } = useI18n();
  if (!enabled) return <>{children}</>;
  if (loading) {
    return (
      <div className="fb-root flex h-full w-full items-center justify-center text-sm fb-muted">
        <span className="fb-dot fb-dot--live fb-dot--ok me-2" /> {t('common.loading')}
      </div>
    );
  }
  if (!session) return <PublicSite />;
  if (loadError) {
    return (
      <Shell title={t('auth.loadError.title')} subtitle={loadError}>
        <div className="flex gap-2">
          <button type="button" onClick={retry} className="fb-btn fb-btn--primary flex-1">
            {t('common.retry')}
          </button>
          <button type="button" onClick={() => void signOut()} className="fb-btn fb-btn--ghost">
            {t('common.signOut')}
          </button>
        </div>
      </Shell>
    );
  }
  if (!current) return <CreateOrgScreen />;
  const canOnboard = current.role === 'owner' || current.role === 'admin';
  if (canOnboard && !current.organization.profile?.onboarded) return <OnboardingWizard />;
  return <>{children}</>;
}
