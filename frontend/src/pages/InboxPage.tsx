import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { CheckCircle2, Inbox as InboxIcon } from 'lucide-react';
import { Avatar, EmptyState, humanize, PageHeader, Pill, Segmented } from '../components/ui/kit';
import { useCompanyAuth } from '../lib/company/AuthProvider';
import { decideApproval, listApprovalHistory } from '../lib/company/data';
import { computerApprovalDevice, decideComputerApproval, isComputerApprovalAction, isNativeComputerApprovalAction, listDevices, type DeviceRow } from '../lib/company/computers';
import { listIntegrations, sendIntegration, type IntegrationRow } from '../lib/company/integrations';
import { timeAgo } from '../lib/company/feed';
import { agentLabel } from '../lib/company/labels';
import { agentColor } from '../lib/company/status';
import { useI18n } from '../i18n/I18nProvider';
import type { TKey } from '../i18n/locales/en';
import { MANAGER_ROLES, type ApprovalRow } from '../lib/company/types';
import { useOrgData } from '../lib/company/useOrgData';
import '../styles/firbo.css';

/** The text an approved action should deliver: the agent's own wording, not raw JSON. */
function deliverText(a: ApprovalRow): string {
  const p = (a.payload ?? {}) as Record<string, unknown>;
  const pick = ['text', 'message', 'body', 'content', 'post'].map((k) => p[k]).find((v) => typeof v === 'string' && v.trim());
  const subject = typeof p.subject === 'string' ? p.subject.trim() : '';
  const main = typeof pick === 'string' ? pick.trim() : JSON.stringify(Object.fromEntries(Object.entries(p).filter(([k]) => k !== 'ai_generated' && k !== 'disclosure')), null, 2);
  const note = typeof p.disclosure === 'string' ? `\n\n${p.disclosure}` : '';
  return `${subject ? `${subject}\n\n` : ''}${main}${note}`.slice(0, 3500);
}

const RISK_COLOR = { low: 'var(--fb-ok)', medium: 'var(--fb-warn)', high: 'var(--fb-err)' } as const;

const HIDDEN = new Set(['ai_generated', 'disclosure']);
const LONG = new Set(['text', 'message', 'body', 'content', 'post']);

/** What the agent wants to do, as plain labelled rows instead of a JSON blob. */
function Summary({ payload }: { payload: Record<string, unknown> }) {
  const rows = Object.entries(payload ?? {}).filter(([k, v]) => !HIDDEN.has(k) && v != null && v !== '');
  if (rows.length === 0) return null;
  const small = rows.filter(([k, v]) => !LONG.has(k) && typeof v !== 'object' && String(v).length <= 120);
  const big = rows.filter(([k, v]) => !small.some(([sk]) => sk === k) && (typeof v === 'string' || typeof v === 'object'));
  return (
    <div className="fb-col gap-3">
      {small.length > 0 && (
        <dl className="fb-kv">
          {small.map(([k, v]) => (
            <div key={k} className="contents">
              <dt>{humanize(k)}</dt>
              <dd>{typeof v === 'number' && /usd|amount|cost|price/i.test(k) ? `$${v.toLocaleString()}` : String(v)}</dd>
            </div>
          ))}
        </dl>
      )}
      {big.map(([k, v]) => (
        <div key={k}>
          <div className="fb-dim mb-1.5 mt-1 text-[11px]">{humanize(k)}</div>
          <blockquote className="rounded-xl px-4 py-3 text-sm leading-relaxed" style={{ background: 'rgba(255,255,255,.03)', borderInlineStart: '3px solid var(--fb-border-strong)' }}>
            {typeof v === 'string' ? v : JSON.stringify(v, null, 2)}
          </blockquote>
        </div>
      ))}
    </div>
  );
}

function Payload({ payload }: { payload: Record<string, unknown> }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const text = JSON.stringify(payload, null, 2);
  if (!payload || Object.keys(payload).length === 0) return <p className="fb-dim text-xs">{t('inbox.noDetails')}</p>;
  const long = text.length > 320;
  return (
    <div>
      <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-xl p-3 text-xs" style={{ background: 'rgba(5,10,20,.8)', border: '1px solid var(--fb-border)' }}>
        {long && !open ? `${text.slice(0, 320)}…` : text}
      </pre>
      {long && (
        <button className="fb-link fb-muted mt-1 cursor-pointer text-xs underline" onClick={() => setOpen(!open)}>
          {open ? t('inbox.showLess') : t('inbox.showAll')}
        </button>
      )}
    </div>
  );
}

export function InboxPage() {
  const i18n = useI18n();
  const { t, fmt } = i18n;
  const { current, user } = useCompanyAuth();
  const orgId = current?.organization.id ?? '';
  const role = current?.role ?? 'viewer';
  const canDecide = MANAGER_ROLES.includes(role);
  const canRunComputer = role === 'owner' || role === 'admin';
  const data = useOrgData(orgId, false);
  const [tab, setTab] = useState<'pending' | 'history'>('pending');
  const [history, setHistory] = useState<ApprovalRow[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [apps, setApps] = useState<IntegrationRow[]>([]);
  const [target, setTarget] = useState<Record<string, string>>({});
  const [sent, setSent] = useState<Record<string, string>>({});
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [deviceTarget, setDeviceTarget] = useState<Record<string,string>>({});
  const deviceFor=(a:{id:string;action:string;payload?:unknown})=>computerApprovalDevice(a,devices,deviceTarget[a.id]);
  const computerCopy: Record<string,[string,string]> = {
    en:['Select computer','Pair a computer first in My computers.'], el:['Επίλεξε υπολογιστή','Σύνδεσε πρώτα υπολογιστή στο My computers.'],
    es:['Seleccionar ordenador','Conecta primero un ordenador en My computers.'], 'pt-BR':['Selecionar computador','Conecte primeiro um computador em My computers.'],
    fr:['Sélectionner un ordinateur','Connectez d’abord un ordinateur dans My computers.'], de:['Computer auswählen','Verbinde zuerst einen Computer unter My computers.'],
    ar:['اختر الكمبيوتر','اربط جهاز كمبيوتر أولاً في My computers.'], 'zh-CN':['选择电脑','请先在 My computers 中连接一台电脑。'],
  };
  const cc=computerCopy[i18n.lang]??computerCopy.en;

  useEffect(() => {
    if (!orgId || !canDecide) return;
    listIntegrations(orgId).then(setApps).catch(() => undefined);
  }, [orgId, canDecide]);

  useEffect(() => {
    if (!orgId || !canRunComputer) { setDevices([]); return; }
    listDevices(orgId).then(rows=>setDevices(rows.filter(d=>d.paired && !d.revoked_at))).catch(()=>setDevices([]));
  }, [orgId, canRunComputer]);

  const deliver = async (a: ApprovalRow) => {
    const id = target[a.id] ?? apps[0]?.id;
    const app = apps.find((x) => x.id === id);
    if (!app) return;
    setBusy(a.id);
    try {
      await sendIntegration(app.id, deliverText(a));
      setSent((m) => ({ ...m, [a.id]: app.name }));
      toast.success(t('inbox.sentVia', { app: app.name }));
    } catch (err) {
      console.error(err);
      toast.error(t('int.err.send_failed'));
    } finally {
      setBusy(null);
    }
  };

  const agentName = (id: string | null) => data.agents.find((a) => a.id === id);

  const loadHistory = useCallback(async () => {
    if (!orgId) return;
    try {
      setHistory(await listApprovalHistory(orgId));
    } catch {
      /* history is secondary */
    }
  }, [orgId]);
  useEffect(() => {
    if (tab === 'history') void loadHistory();
  }, [tab, loadHistory, data.approvals.length]);

  const decide = async (a: ApprovalRow, status: 'approved' | 'rejected') => {
    if (!user) return;
    let payload: Record<string, unknown> | undefined;
    if (status === 'approved' && edits[a.id] !== undefined) {
      try {
        const parsed = JSON.parse(edits[a.id]);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('shape');
        payload = parsed;
      } catch {
        toast.error(t('inbox.editInvalid'));
        return;
      }
    }
    setBusy(a.id);
    try {
      if (isComputerApprovalAction(a.action)) {
        if (!canRunComputer) throw new Error('computer_owner_required');
        const deviceId=deviceFor(a);
        if (status==='approved' && !deviceId) { toast.error(cc[1]); return; }
        await decideComputerApproval({approval_id:a.id,decision:status,device_id:status==='approved'?deviceId:undefined,note:notes[a.id],payload});
      } else {
        await decideApproval(a.id, user.id, status, notes[a.id], payload);
      }
      toast.success(status === 'approved' ? t('inbox.approved') : t('inbox.rejected'));
      await data.reload();
    } catch (err) {
      console.error(err);
      toast.error(t('inbox.saveError'));
    } finally {
      setBusy(null);
    }
  };

  const list = tab === 'pending' ? data.approvals : history;

  return (
    <div className="fb-root h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-4 pb-10 pt-14 md:px-8 md:pt-8">
        <PageHeader
          eyebrow={t('inbox.eyebrow')}
          title={t('inbox.title')}
          sub={t('inbox.sub')}
          right={<Segmented value={tab} onChange={setTab} options={[{ id: 'pending', label: t('inbox.tab.pending', { count: data.approvals.length }) }, { id: 'history', label: t('inbox.tab.history') }]} />}
        />

        {list.length === 0 ? (
          <EmptyState
            icon={tab === 'pending' ? <CheckCircle2 size={24} /> : <InboxIcon size={24} />}
            title={tab === 'pending' ? t('inbox.empty.pendingTitle') : t('inbox.empty.historyTitle')}
            text={tab === 'pending' ? t('inbox.empty.pendingText') : t('inbox.empty.historyText')}
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {list.map((a) => {
              const agent = agentName(a.agent_id);
              const color = agent ? agentColor(agent.type, agent.slug) : '#94a3b8';
              return (
                <li key={a.id} className="fb-glass p-5" style={{ borderInlineStart: `3px solid ${RISK_COLOR[a.risk]}` }}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-3">
                      <Avatar name={agent ? agentLabel(agent, i18n).name : '?'} color={color} />
                      <div className="min-w-0">
                        <div className="truncate text-[15px] font-semibold">{humanize(a.action)}</div>
                        <div className="fb-dim text-xs">
                          {agent ? agentLabel(agent, i18n).name : t('agent.fallbackName')} · {timeAgo(Date.parse(a.requested_at), Date.now(), fmt)}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {a.payload?.ai_generated === true && <Pill tone="accent">{t('inbox.aiBadge')}</Pill>}
                      <Pill tone={a.risk === 'high' ? 'err' : a.risk === 'medium' ? 'warn' : 'ok'}>{t('inbox.risk', { risk: t(`risk.${a.risk}` as TKey) })}</Pill>
                      {a.status !== 'pending' && <Pill tone={a.status === 'approved' ? 'ok' : 'err'}>{t(`inbox.${a.status}` as TKey)}</Pill>}
                    </div>
                  </div>
                  <div className="mt-3">
                    {edits[a.id] !== undefined ? (
                      <textarea
                        className="fb-input font-mono text-xs"
                        style={{ height: 180, padding: 12 }}
                        spellCheck={false}
                        aria-label={t('inbox.editAria')}
                        value={edits[a.id]}
                        onChange={(e) => setEdits({ ...edits, [a.id]: e.target.value })}
                      />
                    ) : (
                      <>
                        <Summary payload={a.payload} />
                        {Object.keys(a.payload ?? {}).length > 0 && (
                          <details className="mt-3">
                            <summary className="fb-dim cursor-pointer text-xs">{t('inbox.showAll')}</summary>
                            <div className="mt-2"><Payload payload={a.payload} /></div>
                          </details>
                        )}
                      </>
                    )}
                    {a.status === 'pending' && canDecide && edits[a.id] === undefined && Object.keys(a.payload ?? {}).length > 0 && (
                      <button className="fb-link fb-muted mt-1 cursor-pointer text-xs underline" onClick={() => setEdits({ ...edits, [a.id]: JSON.stringify(a.payload, null, 2) })}>
                        {t('inbox.edit')}
                      </button>
                    )}
                  </div>
                  {a.status === 'pending' ? (
                    canDecide ? (
                      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                        <input
                          className="fb-input"
                          placeholder={t('inbox.notePlaceholder')}
                          maxLength={500}
                          value={notes[a.id] ?? ''}
                          onChange={(e) => setNotes({ ...notes, [a.id]: e.target.value })}
                          aria-label={t('inbox.noteAria')}
                        />
                        {isComputerApprovalAction(a.action) && (
                          <select className="fb-input" style={{width:'auto',minWidth:160}} disabled={!canRunComputer||busy===a.id||devices.length===0||isNativeComputerApprovalAction(a.action)}
                            aria-label={cc[0]} value={deviceFor(a)??''}
                            onChange={e=>setDeviceTarget({...deviceTarget,[a.id]:e.target.value})}>
                            {!deviceFor(a)&&<option value="">{cc[1]}</option>}{devices.map(d=><option key={d.id} value={d.id}>{d.name+(d.platform?' · '+d.platform:'')}</option>)}
                          </select>
                        )}
                        <div className="flex gap-2">
                          <button className="fb-btn fb-btn--primary" disabled={busy === a.id || (isComputerApprovalAction(a.action)&&(!canRunComputer||!deviceFor(a)))} onClick={() => void decide(a, 'approved')}>
                            {t('inbox.approve')}
                          </button>
                          <button className="fb-btn fb-btn--ghost" style={{ color: 'var(--fb-err)' }} disabled={busy === a.id} onClick={() => void decide(a, 'rejected')}>
                            {t('inbox.reject')}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p className="fb-dim mt-3 text-xs">{t('inbox.onlyManagers')}</p>
                    )
                  ) : (
                    <>
                      {a.decision_note && <p className="fb-muted mt-3 text-xs">{t('inbox.note', { note: a.decision_note })}</p>}
                      {a.status === 'approved' && canDecide && (
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          {sent[a.id] ? (
                            <span className="fb-chip" style={{ color: 'var(--fb-ok)' }}>{t('inbox.sentVia', { app: sent[a.id] })}</span>
                          ) : apps.length === 0 ? (
                            <span className="fb-dim text-xs">{t('inbox.noApps')}</span>
                          ) : (
                            <>
                              <select className="fb-input" style={{ width: 'auto' }} aria-label={t('inbox.deliverVia')} value={target[a.id] ?? apps[0].id} onChange={(e) => setTarget({ ...target, [a.id]: e.target.value })}>
                                {apps.map((x) => (
                                  <option key={x.id} value={x.id}>{x.name}</option>
                                ))}
                              </select>
                              <button className="fb-btn fb-btn--primary" disabled={busy === a.id} onClick={() => void deliver(a)}>
                                {busy === a.id ? t('common.loading') : t('inbox.deliver')}
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
