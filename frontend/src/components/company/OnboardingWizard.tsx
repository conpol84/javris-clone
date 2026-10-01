import { useState } from 'react';
import { toast } from 'sonner';
import { LogoMark } from '../brand/Logo';
import { useCompanyAuth } from '../../lib/company/AuthProvider';
import { hireAgent, saveOrgProfile, seedCompanyMemory, setAllAutonomy } from '../../lib/company/data';
import { AGENT_TEMPLATES, GOALS } from '../../lib/company/templates';
import type { Autonomy, OrgProfile } from '../../lib/company/types';
import '../../styles/firbo.css';

const FREEDOM: { id: Autonomy; title: string; text: string; badge?: string }[] = [
  { id: 'approval', title: 'Ask me first', text: 'Agents prepare the work; nothing external happens until you approve.', badge: 'Recommended' },
  { id: 'suggest', title: 'Suggest only', text: 'Agents propose ideas and drafts but never act.' },
  { id: 'notify', title: 'Act, then tell me', text: 'Agents act within their tool rules and report afterwards.' },
];

/** Goal-first onboarding: tells the agents about the company, hires specialists, sets the safety level. */
export function OnboardingWizard() {
  const { current, user, refresh, signOut } = useCompanyAuth();
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
  const extras = goal.extra.map((slug) => AGENT_TEMPLATES.find((t) => t.slug === slug)).filter((t): t is NonNullable<typeof t> => !!t);
  const selected = picked ?? new Set(extras.map((t) => t.slug));

  const finish = async (skip: boolean) => {
    if (!user) return;
    setBusy(true);
    try {
      const profile: OrgProfile = skip
        ? { onboarded: true }
        : { onboarded: true, goal: goal.label, summary: summary.trim(), industry: industry.trim(), website: website.trim() };
      if (!skip) {
        await seedCompanyMemory(org.id, user.id, profile, org.name);
        for (const slug of selected) {
          const tpl = AGENT_TEMPLATES.find((t) => t.slug === slug);
          if (tpl) await hireAgent(org.id, tpl);
        }
        await setAllAutonomy(org.id, freedom);
      }
      await saveOrgProfile(org.id, profile);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong. Your progress is saved — try again.');
      setBusy(false);
    }
  };

  const steps = ['Your goal', 'Your team', 'Your rules'];

  return (
    <div className="fb-root flex h-full w-full items-center justify-center overflow-y-auto px-4 py-8">
      <div className="fb-glass fb-fade-up w-full max-w-xl p-6 md:p-8" style={{ borderColor: 'var(--fb-border-strong)' }}>
        <div className="mb-5 flex items-center justify-between">
          <LogoMark size={36} />
          <button onClick={() => void finish(true)} disabled={busy} className="fb-link fb-muted cursor-pointer text-xs underline">
            Skip for now
          </button>
        </div>
        <ol className="mb-5 flex gap-2" aria-label="Progress">
          {steps.map((s, i) => (
            <li key={s} className="h-1.5 flex-1 rounded-full" aria-current={i === step ? 'step' : undefined} style={{ background: i <= step ? 'var(--fb-accent)' : 'rgba(255,255,255,0.08)' }} title={s} />
          ))}
        </ol>

        {step === 0 && (
          <section>
            <h1 className="text-xl font-semibold">What should your AI team help with first?</h1>
            <p className="fb-muted mb-4 mt-1 text-sm">Welcome to {org.name}. Pick a goal and tell us about the business — your agents will remember it.</p>
            <div role="radiogroup" aria-label="Goal" className="grid gap-2">
              {GOALS.map((g) => (
                <button
                  key={g.id}
                  role="radio"
                  aria-checked={goalId === g.id}
                  onClick={() => {
                    setGoalId(g.id);
                    setPicked(null);
                  }}
                  className="fb-row cursor-pointer text-left"
                  style={goalId === g.id ? { borderColor: 'var(--fb-accent)', background: 'rgba(34,211,238,.08)' } : undefined}
                >
                  <span className="fb-dot" style={goalId === g.id ? { background: 'var(--fb-accent)', boxShadow: '0 0 10px var(--fb-accent)' } : undefined} />
                  <span className="text-sm font-medium">{g.label}</span>
                </button>
              ))}
            </div>
            <label className="fb-eyebrow mb-1 mt-4 block" htmlFor="ob-summary">What does your company do?</label>
            <textarea id="ob-summary" className="fb-input" style={{ height: 76, padding: 12 }} maxLength={400} placeholder="e.g. We sell B2B logistics software to mid-size retailers." value={summary} onChange={(e) => setSummary(e.target.value)} />
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <input className="fb-input" placeholder="Industry (optional)" aria-label="Industry" maxLength={80} value={industry} onChange={(e) => setIndustry(e.target.value)} />
              <input className="fb-input" placeholder="Website (optional)" aria-label="Website" maxLength={120} value={website} onChange={(e) => setWebsite(e.target.value)} />
            </div>
          </section>
        )}

        {step === 1 && (
          <section>
            <h1 className="text-xl font-semibold">Your team is ready</h1>
            <p className="fb-muted mb-4 mt-1 text-sm">The CEO, Research, Sales, Marketing, Operations, Finance and Developer agents are already set up. For “{goal.label.toLowerCase()}” we also suggest:</p>
            {extras.length === 0 ? (
              <p className="fb-dim text-sm">The core team covers this goal. You can hire more specialists any time from AI Team.</p>
            ) : (
              <ul className="grid gap-2">
                {extras.map((t) => (
                  <li key={t.slug}>
                    <label className="fb-row cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selected.has(t.slug)}
                        onChange={(e) => {
                          const next = new Set(selected);
                          if (e.target.checked) next.add(t.slug);
                          else next.delete(t.slug);
                          setPicked(next);
                        }}
                      />
                      <span className="fb-dot" style={{ background: t.color, boxShadow: `0 0 10px ${t.color}` }} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium">{t.name}</span>
                        <span className="fb-dim block text-xs">{t.tagline}</span>
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
            <h1 className="text-xl font-semibold">How much freedom should they have?</h1>
            <p className="fb-muted mb-4 mt-1 text-sm">You can change this per agent, and per tool, whenever you like.</p>
            <div role="radiogroup" aria-label="Freedom" className="grid gap-2">
              {FREEDOM.map((f) => (
                <button
                  key={f.id}
                  role="radio"
                  aria-checked={freedom === f.id}
                  onClick={() => setFreedom(f.id)}
                  className="fb-row cursor-pointer text-left"
                  style={freedom === f.id ? { borderColor: 'var(--fb-accent)', background: 'rgba(34,211,238,.08)' } : undefined}
                >
                  <span className="fb-dot" style={freedom === f.id ? { background: 'var(--fb-accent)', boxShadow: '0 0 10px var(--fb-accent)' } : undefined} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">
                      {f.title} {f.badge && <span className="fb-chip ml-1">{f.badge}</span>}
                    </span>
                    <span className="fb-dim block text-xs">{f.text}</span>
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

        <div className="mt-6 flex items-center justify-between">
          {step > 0 ? (
            <button className="fb-btn fb-btn--ghost" onClick={() => setStep(step - 1)} disabled={busy}>
              Back
            </button>
          ) : (
            <button className="fb-link fb-muted cursor-pointer text-xs underline" onClick={() => void signOut()}>
              Sign out
            </button>
          )}
          {step < 2 ? (
            <button className="fb-btn fb-btn--primary" onClick={() => setStep(step + 1)}>
              Continue
            </button>
          ) : (
            <button className="fb-btn fb-btn--primary" onClick={() => void finish(false)} disabled={busy}>
              {busy ? 'Setting up…' : 'Open my command center'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
