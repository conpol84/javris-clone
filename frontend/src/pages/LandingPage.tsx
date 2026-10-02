import { lazy, Suspense } from 'react';
import { ArrowRight, BadgeCheck, Cable, Lock, ShieldCheck, Sparkles, Waypoints } from 'lucide-react';
import { LogoMark, Wordmark } from '../components/brand/Logo';
import { LanguageSwitcher } from '../components/brand/LanguageSwitcher';
import { useI18n } from '../i18n/I18nProvider';
import type { TKey } from '../i18n/locales/en';
import { AGENT_COLORS } from '../lib/company/status';
import '../styles/firbo.css';

const CoreOrb = lazy(() => import('../components/scenes/CoreOrb'));

const SATELLITES = Object.entries(AGENT_COLORS)
  .filter(([k]) => k !== 'custom')
  .map(([id, color]) => ({ id, color, active: id === 'ceo' || id === 'research' }));

const TEAM = ['ceo', 'research', 'sales', 'marketing', 'operations', 'finance', 'developer'] as const;

const PILLARS = [
  { icon: Waypoints, id: 'gateway' },
  { icon: BadgeCheck, id: 'approve' },
  { icon: Lock, id: 'private' },
] as const;

export function LandingPage({ onSignIn, onSignUp }: { onSignIn: () => void; onSignUp: () => void }) {
  const { t, rich } = useI18n();
  return (
    <div className="fb-root h-full w-full overflow-y-auto">
      <header className="relative z-20 mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <Wordmark size={30} />
        <nav className="hidden items-center gap-7 text-sm md:flex fb-muted">
          <a className="fb-link hover:text-white" href="#team">{t('landing.nav.team')}</a>
          <a className="fb-link hover:text-white" href="#gateway">{t('landing.nav.gateway')}</a>
          <a className="fb-link hover:text-white" href="#control">{t('landing.nav.control')}</a>
        </nav>
        <div className="flex items-center gap-2">
          <LanguageSwitcher />
          <button className="fb-btn fb-btn--ghost" onClick={onSignIn}>{t('auth.signIn')}</button>
          <button className="fb-btn fb-btn--primary hidden sm:inline-flex" onClick={onSignUp}>{t('landing.getStarted')}</button>
        </div>
      </header>

      <section className="relative mx-auto grid max-w-6xl items-center gap-4 px-5 pb-20 pt-6 md:grid-cols-[1.05fr_0.95fr] md:pt-14">
        <div className="relative z-10">
          <span className="fb-chip fb-fade-up"><Sparkles size={12} /> {t('landing.badge')}</span>
          <h1 className="fb-h1 fb-fade-up fb-d1 mt-5">
            {rich('landing.h1', { highlight: <span className="fb-grad-text">{t('landing.h1.highlight')}</span> })}
          </h1>
          <p className="fb-muted fb-fade-up fb-d2 mt-5 max-w-xl text-base leading-relaxed md:text-lg">
            {t('landing.sub')}
          </p>
          <div className="fb-fade-up fb-d3 mt-8 flex flex-wrap gap-3">
            <button className="fb-btn fb-btn--primary" onClick={onSignUp}>
              {t('landing.cta.create')} <ArrowRight size={16} className="rtl:rotate-180" />
            </button>
            <button className="fb-btn fb-btn--ghost" onClick={onSignIn}>{t('auth.signIn')}</button>
          </div>
          <ul className="fb-fade-up fb-d4 mt-8 flex flex-wrap gap-2 text-xs">
            {(['landing.chip.approval', 'landing.chip.model', 'landing.chip.isolated'] as const).map((k) => (
              <li key={k} className="fb-chip"><span className="fb-dot fb-dot--ok" />{t(k)}</li>
            ))}
          </ul>
        </div>

        <div className="relative h-[340px] md:h-[520px]">
          <div className="absolute inset-0 rounded-full" style={{ background: 'radial-gradient(closest-side, rgba(74, 222, 128,0.18), transparent)' }} />
          <Suspense fallback={null}>
            <CoreOrb satellites={SATELLITES} className="absolute inset-0" />
          </Suspense>
          <div className="pointer-events-none absolute inset-x-0 bottom-3 text-center">
            <div className="fb-eyebrow">{t('landing.orbLabel')}</div>
          </div>
        </div>
      </section>

      <section id="team" className="relative mx-auto max-w-6xl px-5 py-16">
        <div className="fb-eyebrow">{t('landing.team.eyebrow')}</div>
        <h2 className="fb-h2 mt-2 max-w-2xl">{t('landing.team.h2')}</h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {TEAM.map((type) => (
            <article key={type} className="fb-glass fb-glass--hover p-5">
              <div className="flex items-center gap-2.5">
                <span className="grid h-9 w-9 place-items-center rounded-xl" style={{ background: `${AGENT_COLORS[type]}22`, border: `1px solid ${AGENT_COLORS[type]}55` }}>
                  <span className="fb-dot" style={{ background: AGENT_COLORS[type], boxShadow: `0 0 12px ${AGENT_COLORS[type]}` }} />
                </span>
                <h3 className="text-sm font-semibold">{t(`agent.${type}.name` as TKey)}</h3>
              </div>
              <p className="fb-muted mt-3 text-sm leading-relaxed">{t(`landing.agent.${type}` as TKey)}</p>
            </article>
          ))}
          <article className="fb-glass flex flex-col justify-center p-5" style={{ borderStyle: 'dashed' }}>
            <Cable size={20} style={{ color: 'var(--fb-accent)' }} />
            <h3 className="mt-3 text-sm font-semibold">{t('landing.plus.title')}</h3>
            <p className="fb-muted mt-1 text-sm">{t('landing.plus.text')}</p>
          </article>
        </div>
      </section>

      <section id="gateway" className="relative mx-auto max-w-6xl px-5 py-16">
        <div className="fb-eyebrow">{t('landing.under.eyebrow')}</div>
        <h2 className="fb-h2 mt-2 max-w-2xl">{t('landing.under.h2')}</h2>
        <div id="control" className="mt-8 grid gap-4 md:grid-cols-3">
          {PILLARS.map(({ icon: Icon, id }) => (
            <article key={id} className="fb-glass fb-glass--hover p-6">
              <Icon size={22} style={{ color: 'var(--fb-accent)' }} />
              <h3 className="mt-4 text-base font-semibold">{t(`landing.pillar.${id}.title` as TKey)}</h3>
              <p className="fb-muted mt-2 text-sm leading-relaxed">{t(`landing.pillar.${id}.text` as TKey)}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="relative mx-auto max-w-4xl px-5 pb-24 pt-8">
        <div className="fb-glass p-8 text-center md:p-12" style={{ borderColor: 'var(--fb-border-strong)' }}>
          <ShieldCheck className="mx-auto" size={28} style={{ color: 'var(--fb-accent)' }} />
          <h2 className="fb-h2 mt-4">{t('landing.final.h2')}</h2>
          <p className="fb-muted mx-auto mt-3 max-w-lg text-sm md:text-base">
            {t('landing.final.text')}
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <button className="fb-btn fb-btn--primary" onClick={onSignIn}>{t('auth.signIn')}</button>
            <button className="fb-btn fb-btn--ghost" onClick={onSignUp}>{t('auth.createAccount')}</button>
          </div>
        </div>
      </section>

      <footer className="relative mx-auto flex max-w-6xl items-center justify-between px-5 pb-10 text-xs fb-dim">
        <span className="inline-flex items-center gap-2"><LogoMark size={18} /> © {new Date().getFullYear()} Firbo AI</span>
        <span>{t('landing.badge')}</span>
      </footer>
    </div>
  );
}
