import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Panel } from '../components/command/Panel';
import { useCompanyAuth } from '../lib/company/AuthProvider';
import { decideApproval, listApprovalHistory } from '../lib/company/data';
import { timeAgo } from '../lib/company/feed';
import { agentColor } from '../lib/company/status';
import { MANAGER_ROLES, type ApprovalRow } from '../lib/company/types';
import { useOrgData } from '../lib/company/useOrgData';
import '../styles/firbo.css';

const RISK_COLOR = { low: 'var(--fb-ok)', medium: 'var(--fb-warn)', high: 'var(--fb-err)' } as const;

function Payload({ payload }: { payload: Record<string, unknown> }) {
  const [open, setOpen] = useState(false);
  const text = JSON.stringify(payload, null, 2);
  if (!payload || Object.keys(payload).length === 0) return <p className="fb-dim text-xs">No extra details were attached.</p>;
  const long = text.length > 320;
  return (
    <div>
      <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-xl p-3 text-xs" style={{ background: 'rgba(5,10,20,.8)', border: '1px solid var(--fb-border)' }}>
        {long && !open ? `${text.slice(0, 320)}…` : text}
      </pre>
      {long && (
        <button className="fb-link fb-muted mt-1 cursor-pointer text-xs underline" onClick={() => setOpen(!open)}>
          {open ? 'Show less' : 'Show everything'}
        </button>
      )}
    </div>
  );
}

export function InboxPage() {
  const { current, user } = useCompanyAuth();
  const orgId = current?.organization.id ?? '';
  const role = current?.role ?? 'viewer';
  const canDecide = MANAGER_ROLES.includes(role);
  const data = useOrgData(orgId, false);
  const [tab, setTab] = useState<'pending' | 'history'>('pending');
  const [history, setHistory] = useState<ApprovalRow[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

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
    setBusy(a.id);
    try {
      await decideApproval(a.id, user.id, status, notes[a.id]);
      toast.success(status === 'approved' ? 'Approved' : 'Rejected');
      await data.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save your decision');
    } finally {
      setBusy(null);
    }
  };

  const list = tab === 'pending' ? data.approvals : history;

  return (
    <div className="fb-root h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-4 pb-8 pt-14 md:px-6 md:pt-6">
        <header className="mb-5">
          <div className="fb-eyebrow">Human in the loop</div>
          <h1 className="mt-1 text-2xl font-semibold">Inbox</h1>
          <p className="fb-muted mt-1 text-sm">Nothing leaves the company without a person saying yes.</p>
        </header>

        <div className="mb-4 flex gap-2" role="tablist">
          {(['pending', 'history'] as const).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className="fb-chip cursor-pointer"
              style={tab === t ? { color: 'var(--fb-accent)', borderColor: 'var(--fb-border-strong)', background: 'rgba(34,211,238,.1)' } : undefined}
            >
              {t === 'pending' ? `Waiting for you (${data.approvals.length})` : 'History'}
            </button>
          ))}
        </div>

        {list.length === 0 ? (
          <Panel title={tab === 'pending' ? 'All clear' : 'No decisions yet'}>
            <p className="fb-muted text-sm">
              {tab === 'pending'
                ? 'Nothing is waiting for approval. When an agent wants to do something that needs a person, it will appear here instantly.'
                : 'Approved and rejected requests will be listed here.'}
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
                          {agent?.name ?? 'An agent'} · {timeAgo(Date.parse(a.requested_at))}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="fb-chip" style={{ color: RISK_COLOR[a.risk] }}>{a.risk} risk</span>
                      {a.status !== 'pending' && (
                        <span className="fb-chip" style={{ color: a.status === 'approved' ? 'var(--fb-ok)' : 'var(--fb-err)' }}>{a.status}</span>
                      )}
                    </div>
                  </div>
                  <div className="mt-3">
                    <Payload payload={a.payload} />
                  </div>
                  {a.status === 'pending' ? (
                    canDecide ? (
                      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                        <input
                          className="fb-input"
                          placeholder="Add a note (optional)"
                          maxLength={500}
                          value={notes[a.id] ?? ''}
                          onChange={(e) => setNotes({ ...notes, [a.id]: e.target.value })}
                          aria-label="Decision note"
                        />
                        <div className="flex gap-2">
                          <button className="fb-btn fb-btn--primary" disabled={busy === a.id} onClick={() => void decide(a, 'approved')}>
                            Approve
                          </button>
                          <button className="fb-btn fb-btn--ghost" style={{ color: 'var(--fb-err)' }} disabled={busy === a.id} onClick={() => void decide(a, 'rejected')}>
                            Reject
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p className="fb-dim mt-3 text-xs">Only managers, admins and owners can decide.</p>
                    )
                  ) : (
                    a.decision_note && <p className="fb-muted mt-3 text-xs">Note: {a.decision_note}</p>
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
