import { useState } from 'react';
import { toast } from 'sonner';
import { LogoMark } from '../brand/Logo';
import { LanguageSwitcher } from '../brand/LanguageSwitcher';
import { useI18n } from '../../i18n/I18nProvider';
import type { TKey } from '../../i18n/locales/en';
import { useCompanyAuth } from '../../lib/company/AuthProvider';
import { hireAgent, listAgents, saveOrgProfile, seedCompanyMemory, setAllAutonomy } from '../../lib/company/data';
import { AGENT_TEMPLATES, GOALS } from '../../lib/company/templates';
import type { Autonomy, OrgProfile } from '../../lib/company/types';
import '../../styles/firbo.css';

const FREEDOM: { id: 'approval' | 'suggest' | 'notify'; badge?: boolean }[] = [{ id: 'approval', badge: true }, { id: 'suggest' }, { id: 'notify' }];

/** Goal-first onboarding: tells the agents about the company, hires specialists, sets the safety level. */
export function OnboardingWizard() {
  const { current, user, refresh, signOut } = useCompanyAuth();
  const { t } = useI18n();
  const org = current!.organization;
  const [step, setStep] = useState(0);
  const [goalId, setGoalId] = useState<string>(GOALS[0].id);
  const [summary, setSummary] = useState('');
  const [industry, setIndustry] = useState('');
  const [website, setWebsite] = useState('');
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [freedom, setFreedom] = useState<Autonomy>('approval');
  const [busy, setBusy] = useState(false);

  const goal = GOALS.find((g) => g.id === goalId) ?? GOALS[0];
  const extras = goal.extra.map((slug) => AGENT_TEMPLATES.find((x) => x.slug === slug)).filter((x): x is NonNullable<typeof x> => !!x);
  const selected = picked ?? new Set(extras.map((x) => x.slug));

  const finish = async (skip: boolean) => {
    if (!user) return;
    setBusy(true);
    try {
      const profile: OrgProfile = skip
        ? { onboarded: true }
        : { onboarded: true, goal: goal.label, summary: summary.trim(), industry: industry.trim(), website: website.trim() };
      if (!skip) {
        // Retry-safe: a second attempt must not hire the same specialist twice.
        const have = new Set((await listAgents(org.id)).map((a) => a.slug));
        for (const slug of selected) {
          const tpl = AGENT_TEMPLATES.find((x) => x.slug === slug);
          if (tpl && !have.has(tpl.slug)) await hireAgent(org.id, tpl);
        }
        await setAllAutonomy(org.id, freedom);
        await seedCompanyMemory(org.id, user.id, profile, org.name);
      }
      await saveOrgProfile(org.id, profile);
      await refresh();
    } catch (err) {
      console.error(err);
      toast.error(t('ob.error'));
      setBusy(false);
    }
  };

  const steps = [t('ob.step.goal'), t('ob.step.team'), t('ob.step.rules')];

  return (
    <div className="fb-root flex h-full w-full items-center justify-center overflow-y-auto px-4 py-8">
      <div className="fb-glass fb-fade-up w-full max-w-xl p-6 md:p-8" style={{ borderColor: 'var(--fb-border-strong)' }}>
        <div className="mb-5 flex items-center justify-between">
          <LogoMark size={36} />
          <span className="flex items-center gap-3">
            <LanguageSwitcher />
            <button onClick={() => void finish(true)} disabled={busy} className="fb-link fb-muted cursor-pointer text-xs underline">
              {t('ob.skip')}
            </button>
          </span>
        </div>
        <ol className="mb-5 flex gap-2" aria-label={t('ob.step.goal')}>
          {steps.map((s, i) => (
            <li key={s} className="h-1.5 flex-1 rounded-full" aria-current={i === step ? 'step' : undefined} style={{ background: i <= step ? 'var(--fb-accent)' : 'rgba(255,255,255,0.08)' }} title={s} />
          ))}
        </ol>

        {step === 0 && (
          <section>
            <h1 className="text-xl font-semibold">{t('ob.s1.title')}</h1>
            <p className="fb-muted mb-4 mt-1 text-sm">{t('ob.s1.sub', { company: org.name })}</p>
            <div role="radiogroup" aria-label={t('ob.step.goal')} className="grid gap-2">
              {GOALS.map((g) => (
                <button
                  key={g.id}
                  role="radio"
                  aria-checked={goalId === g.id}
                  onClick={() => {
                    setGoalId(g.id);
                    setPicked(null);
                  }}
                  className="fb-row cursor-pointer text-start"
                  style={goalId === g.id ? { borderColor: 'var(--fb-accent)', background: 'rgba(0, 245, 138,.08)' } : undefined}
                >
                  <span className="fb-dot" style={goalId === g.id ? { background: 'var(--fb-accent)', boxShadow: '0 0 10px var(--fb-accent)' } : undefined} />
                  <span className="text-sm font-medium">{t(`goal.${g.id}` as TKey)}</span>
                </button>
              ))}
            </div>
            <label className="fb-eyebrow mb-1 mt-4 block" htmlFor="ob-summary">{t('ob.summary.label')}</label>
            <textarea id="ob-summary" className="fb-input" style={{ height: 76, padding: 12 }} maxLength={400} placeholder={t('ob.summary.placeholder')} value={summary} onChange={(e) => setSummary(e.target.value)} />
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <input className="fb-input" placeholder={t('ob.industry')} aria-label={t('ob.industry')} maxLength={80} value={industry} onChange={(e) => setIndustry(e.target.value)} />
              <input className="fb-input" placeholder={t('ob.website')} aria-label={t('ob.website')} maxLength={120} value={website} onChange={(e) => setWebsite(e.target.value)} />
            </div>
          </section>
        )}

        {step === 1 && (
          <section>
            <h1 className="text-xl font-semibold">{t('ob.s2.title')}</h1>
            <p className="fb-muted mb-4 mt-1 text-sm">{t('ob.s2.sub', { goal: t(`goal.${goal.id}` as TKey) })}</p>
            {extras.length === 0 ? (
              <p className="fb-dim text-sm">{t('ob.s2.none')}</p>
            ) : (
              <ul className="grid gap-2">
                {extras.map((x) => (
                  <li key={x.slug}>
                    <label className="fb-row cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selected.has(x.slug)}
                        onChange={(e) => {
                          const next = new Set(selected);
                          if (e.target.checked) next.add(x.slug);
                          else next.delete(x.slug);
                          setPicked(next);
                        }}
                      />
                      <span className="fb-dot" style={{ background: x.color, boxShadow: `0 0 10px ${x.color}` }} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium">{t(`tpl.${x.slug}.name` as TKey)}</span>
                        <span className="fb-dim block text-xs">{t(`tpl.${x.slug}.tagline` as TKey)}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {step === 2 && (
          <section>
            <h1 className="text-xl font-semibold">{t('ob.s3.title')}</h1>
            <p className="fb-muted mb-4 mt-1 text-sm">{t('ob.s3.sub')}</p>
            <div role="radiogroup" aria-label={t('ob.s3.title')} className="grid gap-2">
              {FREEDOM.map((f) => (
                <button
                  key={f.id}
                  role="radio"
                  aria-checked={freedom === f.id}
                  onClick={() => setFreedom(f.id)}
                  className="fb-row cursor-pointer text-start"
                  style={freedom === f.id ? { borderColor: 'var(--fb-accent)', background: 'rgba(0, 245, 138,.08)' } : undefined}
                >
                  <span className="fb-dot" style={freedom === f.id ? { background: 'var(--fb-accent)', boxShadow: '0 0 10px var(--fb-accent)' } : undefined} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">
                      {t(`ob.free.${f.id}.title` as TKey)} {f.badge && <span className="fb-chip ms-1">{t('ob.free.badge')}</span>}
                    </span>
                    <span className="fb-dim block text-xs">{t(`ob.free.${f.id}.text` as TKey)}</span>
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

        <div className="mt-6 flex items-center justify-between">
          {step > 0 ? (
            <button className="fb-btn fb-btn--ghost" onClick={() => setStep(step - 1)} disabled={busy}>
              {t('common.back')}
            </button>
          ) : (
            <button className="fb-link fb-muted cursor-pointer text-xs underline" onClick={() => void signOut()}>
              {t('common.signOut')}
            </button>
          )}
          {step < 2 ? (
            <button className="fb-btn fb-btn--primary" onClick={() => setStep(step + 1)}>
              {t('common.continue')}
            </button>
          ) : (
            <button className="fb-btn fb-btn--primary" onClick={() => void finish(false)} disabled={busy}>
              {busy ? t('ob.finishing') : t('ob.finish')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
