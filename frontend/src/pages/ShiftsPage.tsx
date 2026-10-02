import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Clock3, Play, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Panel, StatusDot } from '../components/command/Panel';
import { useI18n } from '../i18n/I18nProvider';
import type { TKey } from '../i18n/locales/en';
import { useCompanyAuth } from '../lib/company/AuthProvider';
import { createTask, listAgents } from '../lib/company/data';
import { agentLabel } from '../lib/company/labels';
import { RunError, runTask } from '../lib/company/runner';
import { createShift, deleteShift, listShifts, setShiftEnabled, type Cadence, type ShiftRow } from '../lib/company/shifts';
import { agentColor } from '../lib/company/status';
import { MANAGER_ROLES, type AgentRow } from '../lib/company/types';
import '../styles/firbo.css';

const ShiftScene = lazy(() => import('../components/scenes/ShiftScene'));
const CADENCES: Cadence[] = ['hourly', 'daily', 'weekdays', 'weekly'];

/** AI employees that work on a schedule: a daily briefing at 8:00, a weekly report on Friday, ... Approvals still wait for you. */
export function ShiftsPage() {
  const i18n = useI18n();
  const { t, fmt, lang } = i18n;
  const { current, user } = useCompanyAuth();
  const orgId = current?.organization.id ?? '';
  const canManage = MANAGER_ROLES.includes(current?.role ?? 'viewer');
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [shifts, setShifts] = useState<ShiftRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [agentId, setAgentId] = useState('');
  const [title, setTitle] = useState('');
  const [instruction, setInstruction] = useState('');
  const [cadence, setCadence] = useState<Cadence>('daily');
  const [hour, setHour] = useState(8);
  const [weekday, setWeekday] = useState(1);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

  const reload = useCallback(async () => {
    if (!orgId) return;
    try {
      const [a, s] = await Promise.all([listAgents(orgId), listShifts(orgId)]);
      setAgents(a);
      setShifts(s);
      setAgentId((prev) => prev || a.find((x) => x.enabled)?.id || '');
    } catch (err) {
      console.error(err);
      toast.error(t('shift.loadError'));
    } finally {
      setLoaded(true);
    }
  }, [orgId, t]);

  useEffect(() => {
    setLoaded(false);
    void reload();
  }, [reload]);

  const agentOf = (id: string) => agents.find((a) => a.id === id);
  const nameOf = (id: string) => {
    const a = agentOf(id);
    return a ? agentLabel(a, i18n).name : t('unassigned');
  };
  const weekdayName = (d: number) => new Intl.DateTimeFormat(lang, { weekday: 'long' }).format(new Date(2024, 0, 7 + d)); // 7 Jan 2024 was a Sunday
  const when = (s: ShiftRow) =>
    s.cadence === 'hourly'
      ? t('shift.cad.hourly')
      : `${t(`shift.cad.${s.cadence}` as TKey)} · ${String(s.hour).padStart(2, '0')}:00${s.cadence === 'weekly' && s.weekday != null ? ` · ${weekdayName(s.weekday)}` : ''}`;

  const dots = useMemo(
    () => shifts.map((s) => {
      const a = agents.find((x) => x.id === s.agent_id);
      return { id: s.id, hour: s.hour, cadence: s.cadence, enabled: s.enabled, color: a ? agentColor(a.type, a.slug) : '#64748b' };
    }),
    [shifts, agents],
  );

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!user || !agentId || !title.trim() || busy) return;
    setBusy('create');
    try {
      await createShift({ orgId, userId: user.id, agentId, title, instruction, cadence, hour, weekday });
      setTitle('');
      setInstruction('');
      toast.success(t('shift.created'));
      await reload();
    } catch (err) {
      console.error(err);
      toast.error(t('shift.createError'));
    } finally {
      setBusy(null);
    }
  };

  const toggle = async (s: ShiftRow) => {
    setBusy(s.id);
    try {
      await setShiftEnabled(s.id, !s.enabled);
      await reload();
    } catch (err) {
      console.error(err);
      toast.error(t('shift.createError'));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (s: ShiftRow) => {
    if (!window.confirm(t('shift.confirmDelete', { name: s.title }))) return;
    setBusy(s.id);
    try {
      await deleteShift(s.id);
      await reload();
    } finally {
      setBusy(null);
    }
  };

  const runNow = async (s: ShiftRow) => {
    if (!user) return;
    setBusy(s.id);
    try {
      const id = await createTask({ orgId, userId: user.id, title: s.title, description: s.instruction, priority: 'normal', agentId: s.agent_id });
      const out = await runTask(id, lang);
      toast.success(out.queued > 0 ? t('run.queued', { count: out.queued }) : t('run.completed'));
    } catch (err) {
      toast.error(t(`run.err.${err instanceof RunError ? err.code : 'unknown'}` as TKey));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="fb-root h-full overflow-y-auto">
      <div className="mx-auto max-w-[1200px] space-y-4 px-4 pb-8 pt-14 md:px-6 md:pt-6">
        <header>
          <div className="fb-eyebrow">{current?.organization.name}</div>
          <h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold"><Clock3 size={22} style={{ color: 'var(--fb-accent)' }} /> {t('shift.title')}</h1>
          <p className="fb-muted mt-1 text-sm">{t('shift.sub')}</p>
        </header>

        <section className="fb-glass relative h-[340px] overflow-hidden md:h-[400px]" style={{ padding: 0 }}>
          <div className="fb-scan" />
          <Suspense fallback={<div className="fb-muted grid h-full place-items-center text-sm">{t('office.loading')}</div>}>
            <ShiftScene shifts={dots} labels={{ noWebgl: t('office.noWebgl') }} />
          </Suspense>
        </section>
        <p className="fb-dim -mt-2 text-center text-xs">{t('shift.dialHint', { tz })}</p>

        {canManage && (
          <Panel title={t('shift.new')}>
            {enabledCount(agents) === 0 ? (
              <p className="fb-dim text-sm">{t('shift.noAgents')}</p>
            ) : (
              <form onSubmit={create} className="grid gap-3 md:grid-cols-2">
                <label className="block text-xs">
                  <span className="fb-dim">{t('shift.agent')}</span>
                  <select className="fb-input mt-1" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
                    {agents.filter((a) => a.enabled).map((a) => (
                      <option key={a.id} value={a.id}>{agentLabel(a, i18n).name}</option>
                    ))}
                  </select>
                </label>
                <label className="block text-xs">
                  <span className="fb-dim">{t('shift.name')}</span>
                  <input className="fb-input mt-1" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder={t('shift.namePlaceholder')} required />
                </label>
                <label className="block text-xs md:col-span-2">
                  <span className="fb-dim">{t('shift.instruction')}</span>
                  <textarea className="fb-input mt-1 min-h-[70px] resize-none" rows={3} value={instruction} maxLength={1500} onChange={(e) => setInstruction(e.target.value)} placeholder={t('shift.instructionPlaceholder')} />
                </label>
                <label className="block text-xs">
                  <span className="fb-dim">{t('shift.cadence')}</span>
                  <select className="fb-input mt-1" value={cadence} onChange={(e) => setCadence(e.target.value as Cadence)}>
                    {CADENCES.map((c) => <option key={c} value={c}>{t(`shift.cad.${c}` as TKey)}</option>)}
                  </select>
                </label>
                <div className="grid grid-cols-2 gap-3">
                  {cadence !== 'hourly' && (
                    <label className="block text-xs">
                      <span className="fb-dim">{t('shift.hour')}</span>
                      <select className="fb-input mt-1" value={hour} onChange={(e) => setHour(Number(e.target.value))}>
                        {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
                      </select>
                    </label>
                  )}
                  {cadence === 'weekly' && (
                    <label className="block text-xs">
                      <span className="fb-dim">{t('shift.weekday')}</span>
                      <select className="fb-input mt-1" value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>
                        {[1, 2, 3, 4, 5, 6, 0].map((d) => <option key={d} value={d}>{weekdayName(d)}</option>)}
                      </select>
                    </label>
                  )}
                </div>
                <div className="md:col-span-2">
                  <button className="fb-btn fb-btn--primary" disabled={!agentId || !title.trim() || busy !== null}>{busy === 'create' ? t('common.loading') : t('shift.create')}</button>
                  <span className="fb-dim ms-3 text-xs">{t('shift.approvalNote')}</span>
                </div>
              </form>
            )}
          </Panel>
        )}

        <Panel title={t('shift.list')}>
          {!loaded ? (
            <p className="fb-dim text-sm">{t('common.loading')}</p>
          ) : shifts.length === 0 ? (
            <p className="fb-dim text-sm">{t('shift.empty')}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {shifts.map((s) => {
                const a = agentOf(s.agent_id);
                return (
                  <li key={s.id} className="fb-row flex-wrap" style={{ opacity: s.enabled ? 1 : 0.6 }}>
                    <span className="fb-dot" style={{ background: a ? agentColor(a.type, a.slug) : 'var(--fb-dim)' }} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold">{s.title}</div>
                      <div className="fb-dim truncate text-xs">{nameOf(s.agent_id)} · {when(s)}</div>
                      <div className="fb-dim text-[11px]">
                        {s.enabled && s.next_run_at ? t('shift.next', { when: fmt.dateTime(s.next_run_at) }) : t('shift.paused')}
                        {s.last_run_at ? ` · ${t('shift.last', { when: fmt.dateTime(s.last_run_at) })}` : ''}
                      </div>
                    </div>
                    {canManage && (
                      <>
                        <button className="fb-btn fb-btn--ghost" style={{ height: 32, padding: '0 12px', fontSize: 13 }} disabled={busy !== null} onClick={() => void runNow(s)}>
                          <Play size={13} /> {busy === s.id ? t('run.busy') : t('shift.runNow')}
                        </button>
                        <button
                          role="switch"
                          aria-checked={s.enabled}
                          aria-label={t(s.enabled ? 'shift.on' : 'shift.off')}
                          disabled={busy !== null}
                          onClick={() => void toggle(s)}
                          className="fb-chip cursor-pointer"
                          style={s.enabled ? { color: 'var(--fb-ok)', borderColor: 'var(--fb-ok)' } : undefined}
                        >
                          <StatusDot tone={s.enabled ? 'ok' : 'idle'} live={s.enabled} /> {t(s.enabled ? 'shift.on' : 'shift.off')}
                        </button>
                        <button className="fb-btn fb-btn--ghost" style={{ height: 32, padding: '0 10px' }} disabled={busy !== null} aria-label={t('shift.delete')} title={t('shift.delete')} onClick={() => void remove(s)}>
                          <Trash2 size={14} />
                        </button>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}

const enabledCount = (a: AgentRow[]) => a.filter((x) => x.enabled).length;
