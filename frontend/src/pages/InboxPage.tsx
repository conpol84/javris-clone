import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Panel } from '../components/command/Panel';
import { useCompanyAuth } from '../lib/company/AuthProvider';
import { decideApproval, listApprovalHistory } from '../lib/company/data';
import { timeAgo } from '../lib/company/feed';
import { agentLabel } from '../lib/company/labels';
import { agentColor } from '../lib/company/status';
import { useI18n } from '../i18n/I18nProvider';
import type { TKey } from '../i18n/locales/en';
import { MANAGER_ROLES, type ApprovalRow } from '../lib/company/types';
import { useOrgData } from '../lib/company/useOrgData';
import '../styles/firbo.css';

const RISK_COLOR = { low: 'var(--fb-ok)', medium: 'var(--fb-warn)', high: 'var(--fb-err)' } as const;

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
  const data = useOrgData(orgId, false);
  const [tab, setTab] = useState<'pending' | 'history'>('pending');
  const [history, setHistory] = useState<ApprovalRow[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});

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
      await decideApproval(a.id, user.id, status, notes[a.id], payload);
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
      <div className="mx-auto max-w-3xl px-4 pb-8 pt-14 md:px-6 md:pt-6">
        <header className="mb-5">
          <div className="fb-eyebrow">{t('inbox.eyebrow')}</div>
          <h1 className="mt-1 text-2xl font-semibold">{t('inbox.title')}</h1>
          <p className="fb-muted mt-1 text-sm">{t('inbox.sub')}</p>
        </header>

        <div className="mb-4 flex gap-2" role="tablist">
          {(['pending', 'history'] as const).map((id) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className="fb-chip cursor-pointer"
              style={tab === id ? { color: 'var(--fb-accent)', borderColor: 'var(--fb-border-strong)', background: 'rgba(74, 222, 128,.1)' } : undefined}
            >
              {id === 'pending' ? t('inbox.tab.pending', { count: data.approvals.length }) : t('inbox.tab.history')}
            </button>
          ))}
        </div>

        {list.length === 0 ? (
          <Panel title={tab === 'pending' ? t('inbox.empty.pendingTitle') : t('inbox.empty.historyTitle')}>
            <p className="fb-muted text-sm">
              {tab === 'pending'
                ? t('inbox.empty.pendingText')
                : t('inbox.empty.historyText')}
            </p>
          </Panel>
        ) : (
          <ul className="flex flex-col gap-3">
            {list.map((a) => {
              const agent = agentName(a.agent_id);
              const color = agent ? agentColor(agent.type, agent.slug) : '#94a3b8';
              return (
                <li key={a.id} className="fb-glass p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="fb-dot" style={{ background: color, boxShadow: `0 0 10px ${color}` }} />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold">{a.action}</div>
                        <div className="fb-dim text-xs">
                          {agent ? agentLabel(agent, i18n).name : t('agent.fallbackName')} · {timeAgo(Date.parse(a.requested_at), Date.now(), fmt)}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {a.payload?.ai_generated === true && <span className="fb-chip">{t('inbox.aiBadge')}</span>}
                      <span className="fb-chip" style={{ color: RISK_COLOR[a.risk] }}>{t('inbox.risk', { risk: t(`risk.${a.risk}` as TKey) })}</span>
                      {a.status !== 'pending' && (
                        <span className="fb-chip" style={{ color: a.status === 'approved' ? 'var(--fb-ok)' : 'var(--fb-err)' }}>{t(`inbox.${a.status}` as TKey)}</span>
                      )}
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
                      <Payload payload={a.payload} />
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
                        <div className="flex gap-2">
                          <button className="fb-btn fb-btn--primary" disabled={busy === a.id} onClick={() => void decide(a, 'approved')}>
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
                    a.decision_note && <p className="fb-muted mt-3 text-xs">{t('inbox.note', { note: a.decision_note })}</p>
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
