import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import { BarChart3, GitBranch, Layers, Mic, Minus, X } from 'lucide-react';
import { useCommand } from './CommandHost';
import { useI18n } from '../../i18n/I18nProvider';
import type { TKey } from '../../i18n/locales/en';
import { useCompanyAuth } from '../../lib/company/AuthProvider';
import { useOrgData } from '../../lib/company/useOrgData';
import { voiceLevel } from '../../lib/company/voice';
import type { TaskRow, TaskStatus } from '../../lib/company/types';
import '../../styles/firbo.css';

type WinId = 'voice' | 'flow' | 'analytics';
const IDS: WinId[] = ['voice', 'flow', 'analytics'];
const W = 288;
const KEY = 'firbo.hud';

interface Saved {
  open: Record<WinId, boolean>;
  min: Record<WinId, boolean>;
  pos: Partial<Record<WinId, { x: number; y: number }>>;
}

const clampPos = (p: { x: number; y: number }) => ({ x: Math.min(Math.max(8, p.x), Math.max(8, window.innerWidth - W - 8)), y: Math.min(Math.max(8, p.y), Math.max(8, window.innerHeight - 60)) });
const defaults = (id: WinId) => {
  const i = IDS.indexOf(id);
  return clampPos({ x: window.innerWidth - W - 24, y: 90 + i * 250 });
};

function load(): Saved {
  const empty: Saved = { open: { voice: false, flow: false, analytics: false }, min: { voice: false, flow: false, analytics: false }, pos: {} };
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...empty, ...(JSON.parse(raw) as Partial<Saved>) } : empty;
  } catch {
    return empty;
  }
}

const STATUS_COLOR: Record<TaskStatus, string> = {
  pending: '#7f9fc4', running: '#00d4ff', blocked: '#f87171', awaiting_approval: '#fbbf24', completed: '#34d399', failed: '#f87171', cancelled: '#475569',
};

function HudWindow({ id, title, icon, pos, minimized, onMove, onMin, onClose, children }: { id: WinId; title: string; icon: ReactNode; pos: { x: number; y: number }; minimized: boolean; onMove: (p: { x: number; y: number }) => void; onMin: () => void; onClose: () => void; children: ReactNode }) {
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const down = (e: RPointerEvent) => {
    drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const move = (e: RPointerEvent) => drag.current && onMove(clampPos({ x: e.clientX - drag.current.dx, y: e.clientY - drag.current.dy }));
  return (
    <section className="fb-root fb-hudwin fb-glass" data-win={id} style={{ left: pos.x, top: pos.y, width: W }}>
      <header className="fb-hudwin__bar" onPointerDown={down} onPointerMove={move} onPointerUp={() => (drag.current = null)}>
        <span className="fb-hudwin__icon">{icon}</span>
        <h3 className="fb-eyebrow flex-1 truncate">{title}</h3>
        <button type="button" className="fb-iconbtn" onPointerDown={(e) => e.stopPropagation()} onClick={onMin} aria-label="–"><Minus size={13} /></button>
        <button type="button" className="fb-iconbtn" onPointerDown={(e) => e.stopPropagation()} onClick={onClose} aria-label="×"><X size={13} /></button>
      </header>
      {!minimized && <div className="fb-hudwin__body">{children}</div>}
    </section>
  );
}

function Voice() {
  const { t } = useI18n();
  const cmd = useCommand();
  const bars = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    const tick = (ts: number) => {
      const kids = bars.current?.children;
      if (kids) for (let i = 0; i < kids.length; i++) (kids[i] as HTMLElement).style.height = `${12 + (Math.sin(ts / 260 + i * 0.7) * 0.5 + 0.5) * (10 + voiceLevel.value * 70)}%`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  const asks = ['urgent', 'team', 'spend', 'next'] as const;
  return (
    <>
      <div ref={bars} className="fb-hudwave" aria-hidden>
        {Array.from({ length: 28 }, (_, i) => <i key={i} />)}
      </div>
      <ul className="fb-col mt-2 gap-1.5">
        {asks.map((k) => (
          <li key={k}>
            <button type="button" className="fb-row w-full cursor-pointer gap-2 py-1.5 text-start text-xs" onClick={() => cmd.open()}>
              <Mic size={12} style={{ color: 'var(--fb-accent)' }} /> {t(`ceo.q.${k}` as TKey)}
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

function Flow({ tasks }: { tasks: TaskRow[] }) {
  const { t } = useI18n();
  const items = tasks.filter((x) => x.status !== 'cancelled').slice(0, 4);
  if (!items.length) return <p className="fb-dim text-xs">{t('hud.empty')}</p>;
  return (
    <ol className="fb-col gap-0">
      {items.map((x, i) => (
        <li key={x.id} className="flex flex-col items-center">
          <div className="fb-row w-full gap-2 py-1.5 text-xs" style={{ borderColor: STATUS_COLOR[x.status] }}>
            <span className="fb-dot" style={{ background: STATUS_COLOR[x.status], boxShadow: `0 0 8px ${STATUS_COLOR[x.status]}` }} />
            <span className="min-w-0 flex-1 truncate">{x.title}</span>
          </div>
          {i < items.length - 1 && <span className="fb-hudarrow" aria-hidden />}
        </li>
      ))}
    </ol>
  );
}

function Analytics({ tasks }: { tasks: TaskRow[] }) {
  const { t } = useI18n();
  const days = useMemo(() => {
    const out = Array.from({ length: 7 }, (_, i) => ({ d: new Date(Date.now() - (6 - i) * 86_400_000).toDateString(), n: 0 }));
    for (const x of tasks) {
      const hit = out.find((o) => o.d === new Date(x.created_at).toDateString());
      if (hit) hit.n++;
    }
    return out;
  }, [tasks]);
  const max = Math.max(1, ...days.map((d) => d.n));
  const done = tasks.length ? Math.round((tasks.filter((x) => x.status === 'completed').length / tasks.length) * 100) : 0;
  const R = 26;
  const C = 2 * Math.PI * R;
  return (
    <div className="flex items-end gap-3">
      <div className="fb-hudbars" aria-hidden>
        {days.map((d, i) => <i key={i} style={{ height: `${10 + (d.n / max) * 90}%` }} />)}
      </div>
      <div className="relative grid shrink-0 place-items-center" style={{ width: 66, height: 66 }} role="img" aria-label={t('hud.completed', { pct: done })}>
        <svg width="66" height="66" viewBox="0 0 66 66" aria-hidden>
          <circle cx="33" cy="33" r={R} fill="none" stroke="rgba(0,212,255,.15)" strokeWidth="6" />
          <circle cx="33" cy="33" r={R} fill="none" stroke="#00d4ff" strokeWidth="6" strokeLinecap="round" strokeDasharray={`${(done / 100) * C} ${C}`} transform="rotate(-90 33 33)" style={{ filter: 'drop-shadow(0 0 6px #00d4ff)' }} />
        </svg>
        <span className="absolute text-sm font-semibold tabular-nums">{done}%</span>
      </div>
    </div>
  );
}

function Windows({ orgId, state, set }: { orgId: string; state: Saved; set: (s: Saved) => void }) {
  const { t } = useI18n();
  const org = useOrgData(orgId, false, 30_000);
  const posOf = (id: WinId) => state.pos[id] ?? defaults(id);
  const shown = IDS.filter((id) => state.open[id]);
  const meta: Record<WinId, { title: string; icon: ReactNode; body: ReactNode }> = {
    voice: { title: t('hud.voice'), icon: <Mic size={13} />, body: <Voice /> },
    flow: { title: t('hud.flow'), icon: <GitBranch size={13} />, body: <Flow tasks={org.tasks} /> },
    analytics: { title: t('hud.analytics'), icon: <BarChart3 size={13} />, body: <Analytics tasks={org.tasks} /> },
  };
  const centers = shown.map((id) => ({ x: posOf(id).x + W / 2, y: posOf(id).y + (state.min[id] ? 18 : 90) }));
  return (
    <>
      {centers.length > 1 && (
        <svg className="fb-hudlines" aria-hidden>
          {centers.slice(1).map((c, i) => (
            <line key={i} x1={centers[i].x} y1={centers[i].y} x2={c.x} y2={c.y} />
          ))}
        </svg>
      )}
      {shown.map((id) => (
        <HudWindow
          key={id}
          id={id}
          title={meta[id].title}
          icon={meta[id].icon}
          pos={posOf(id)}
          minimized={!!state.min[id]}
          onMove={(p) => set({ ...state, pos: { ...state.pos, [id]: p } })}
          onMin={() => set({ ...state, min: { ...state.min, [id]: !state.min[id] } })}
          onClose={() => set({ ...state, open: { ...state.open, [id]: false } })}
        >
          {meta[id].body}
        </HudWindow>
      ))}
    </>
  );
}

/** Floating, draggable HUD windows (voice, workflow, analytics) that stay on top of any page. Desktop only. */
export function HudDock() {
  const { t } = useI18n();
  const { current } = useCompanyAuth();
  const orgId = current?.organization.id ?? '';
  const [state, setState] = useState<Saved>(load);
  const [menu, setMenu] = useState(false);
  const set = (s: Saved) => {
    setState(s);
    try {
      localStorage.setItem(KEY, JSON.stringify(s));
    } catch {
      /* the layout just is not remembered */
    }
  };
  const anyOpen = IDS.some((id) => state.open[id]);
  return (
    <div className="hidden lg:block">
      {orgId && anyOpen && <Windows orgId={orgId} state={state} set={set} />}
      <div className="fb-root fb-hudmenu">
        {menu && (
          <ul className="fb-glass fb-col gap-1 p-2">
            {IDS.map((id) => (
              <li key={id}>
                <label className="fb-row cursor-pointer gap-2 py-1.5 text-xs">
                  <input type="checkbox" checked={state.open[id]} onChange={(e) => set({ ...state, open: { ...state.open, [id]: e.target.checked } })} />
                  {t(`hud.${id}` as TKey)}
                </label>
              </li>
            ))}
          </ul>
        )}
        <button type="button" className="fb-btn fb-btn--ghost" aria-expanded={menu} onClick={() => setMenu(!menu)}>
          <Layers size={14} /> {t('hud.toggle')}
        </button>
      </div>
    </div>
  );
}
