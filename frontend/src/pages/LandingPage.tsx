import { lazy, Suspense } from 'react';
import { ArrowRight, BadgeCheck, Cable, Lock, ShieldCheck, Sparkles, Waypoints } from 'lucide-react';
import { LogoMark, Wordmark } from '../components/brand/Logo';
import { AGENT_COLORS } from '../lib/company/status';
import '../styles/firbo.css';

const CoreOrb = lazy(() => import('../components/scenes/CoreOrb'));

const SATELLITES = Object.entries(AGENT_COLORS)
  .filter(([k]) => k !== 'custom')
  .map(([id, color]) => ({ id, color, active: id === 'ceo' || id === 'research' }));

const TEAM = [
  { type: 'ceo', name: 'CEO Agent', text: 'Sees the whole company, turns goals into tasks and delegates to specialists.' },
  { type: 'research', name: 'Research Agent', text: 'Web research, competitor intelligence and market reports with sources.' },
  { type: 'sales', name: 'Sales Agent', text: 'Finds and qualifies leads, researches companies and drafts outreach.' },
  { type: 'marketing', name: 'Marketing Agent', text: 'Content, campaigns, calendars and competitor monitoring.' },
  { type: 'operations', name: 'Operations Agent', text: 'Tasks, deadlines, workflows and internal reports — kept on track.' },
  { type: 'finance', name: 'Finance Agent', text: 'Revenue, expenses and monthly reports. Read-only by design.' },
  { type: 'developer', name: 'Developer Agent', text: 'Issues, code analysis and pull-request review on your repositories.' },
];

const PILLARS = [
  {
    icon: Waypoints,
    title: 'One gateway, every model',
    text: 'Route across hundreds of models with automatic fallback, cost-aware routing and free-tier pooling — your agents never go down because one provider did.',
  },
  {
    icon: BadgeCheck,
    title: 'Humans approve, agents execute',
    text: 'Anything that leaves the building — emails, code changes, spend — is queued for a person to approve first. Every action lands in an audit trail.',
  },
  {
    icon: Lock,
    title: 'Private by design',
    text: 'Each company is isolated at the database level with role-based access. Provider keys stay on the server and never reach the browser.',
  },
];

export function LandingPage({ onSignIn, onSignUp }: { onSignIn: () => void; onSignUp: () => void }) {
  return (
    <div className="fb-root h-full w-full overflow-y-auto">
      <header className="relative z-20 mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <Wordmark size={30} />
        <nav className="hidden items-center gap-7 text-sm md:flex fb-muted">
          <a className="fb-link hover:text-white" href="#team">AI team</a>
          <a className="fb-link hover:text-white" href="#gateway">Gateway</a>
          <a className="fb-link hover:text-white" href="#control">Control</a>
        </nav>
        <div className="flex items-center gap-2">
          <button className="fb-btn fb-btn--ghost" onClick={onSignIn}>Sign in</button>
          <button className="fb-btn fb-btn--primary hidden sm:inline-flex" onClick={onSignUp}>Get started</button>
        </div>
      </header>

      <section className="relative mx-auto grid max-w-6xl items-center gap-4 px-5 pb-20 pt-6 md:grid-cols-[1.05fr_0.95fr] md:pt-14">
        <div className="relative z-10">
          <span className="fb-chip fb-fade-up"><Sparkles size={12} /> AI command center for your company</span>
          <h1 className="fb-h1 fb-fade-up fb-d1 mt-5">
            Run your company with a <span className="fb-grad-text">team of AI agents</span>.
          </h1>
          <p className="fb-muted fb-fade-up fb-d2 mt-5 max-w-xl text-base leading-relaxed md:text-lg">
            Firbo AI gives you a CEO, researchers, sales, marketing, operations, finance and developers — working
            together around the clock, with a human approving everything that matters.
          </p>
          <div className="fb-fade-up fb-d3 mt-8 flex flex-wrap gap-3">
            <button className="fb-btn fb-btn--primary" onClick={onSignUp}>
              Create your company <ArrowRight size={16} />
            </button>
            <button className="fb-btn fb-btn--ghost" onClick={onSignIn}>Sign in</button>
          </div>
          <ul className="fb-fade-up fb-d4 mt-8 flex flex-wrap gap-2 text-xs">
            {['Human approval on external actions', 'Any model, one endpoint', 'Isolated per company'].map((t) => (
              <li key={t} className="fb-chip"><span className="fb-dot fb-dot--ok" />{t}</li>
            ))}
          </ul>
        </div>

        <div className="relative h-[340px] md:h-[520px]">
          <div className="absolute inset-0 rounded-full" style={{ background: 'radial-gradient(closest-side, rgba(34,211,238,0.18), transparent)' }} />
          <Suspense fallback={null}>
            <CoreOrb satellites={SATELLITES} className="absolute inset-0" />
          </Suspense>
          <div className="pointer-events-none absolute inset-x-0 bottom-3 text-center">
            <div className="fb-eyebrow">Firbo AI core</div>
          </div>
        </div>
      </section>

      <section id="team" className="relative mx-auto max-w-6xl px-5 py-16">
        <div className="fb-eyebrow">Your AI employees</div>
        <h2 className="fb-h2 mt-2 max-w-2xl">A full team, ready the moment you create your company.</h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {TEAM.map((a) => (
            <article key={a.type} className="fb-glass fb-glass--hover p-5">
              <div className="flex items-center gap-2.5">
                <span className="grid h-9 w-9 place-items-center rounded-xl" style={{ background: `${AGENT_COLORS[a.type]}22`, border: `1px solid ${AGENT_COLORS[a.type]}55` }}>
                  <span className="fb-dot" style={{ background: AGENT_COLORS[a.type], boxShadow: `0 0 12px ${AGENT_COLORS[a.type]}` }} />
                </span>
                <h3 className="text-sm font-semibold">{a.name}</h3>
              </div>
              <p className="fb-muted mt-3 text-sm leading-relaxed">{a.text}</p>
            </article>
          ))}
          <article className="fb-glass flex flex-col justify-center p-5" style={{ borderStyle: 'dashed' }}>
            <Cable size={20} style={{ color: 'var(--fb-accent)' }} />
            <h3 className="mt-3 text-sm font-semibold">Plus your own</h3>
            <p className="fb-muted mt-1 text-sm">Add custom agents, tools and workflows as you grow.</p>
          </article>
        </div>
      </section>

      <section id="gateway" className="relative mx-auto max-w-6xl px-5 py-16">
        <div className="fb-eyebrow">Under the hood</div>
        <h2 className="fb-h2 mt-2 max-w-2xl">Built to be reliable, controlled and private.</h2>
        <div id="control" className="mt-8 grid gap-4 md:grid-cols-3">
          {PILLARS.map(({ icon: Icon, title, text }) => (
            <article key={title} className="fb-glass fb-glass--hover p-6">
              <Icon size={22} style={{ color: 'var(--fb-accent)' }} />
              <h3 className="mt-4 text-base font-semibold">{title}</h3>
              <p className="fb-muted mt-2 text-sm leading-relaxed">{text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="relative mx-auto max-w-4xl px-5 pb-24 pt-8">
        <div className="fb-glass p-8 text-center md:p-12" style={{ borderColor: 'var(--fb-border-strong)' }}>
          <ShieldCheck className="mx-auto" size={28} style={{ color: 'var(--fb-accent)' }} />
          <h2 className="fb-h2 mt-4">Sign in to open your command center.</h2>
          <p className="fb-muted mx-auto mt-3 max-w-lg text-sm md:text-base">
            Your agents, tasks, memory and approvals live behind your login. Nothing is visible without it.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <button className="fb-btn fb-btn--primary" onClick={onSignIn}>Sign in</button>
            <button className="fb-btn fb-btn--ghost" onClick={onSignUp}>Create account</button>
          </div>
        </div>
      </section>

      <footer className="relative mx-auto flex max-w-6xl items-center justify-between px-5 pb-10 text-xs fb-dim">
        <span className="inline-flex items-center gap-2"><LogoMark size={18} /> © {new Date().getFullYear()} Firbo AI</span>
        <span>AI command center for your company</span>
      </footer>
    </div>
  );
}
