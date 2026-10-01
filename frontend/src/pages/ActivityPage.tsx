import { useCallback, useEffect, useMemo, useState } from 'react';
import { StatusDot } from '../components/command/Panel';
import { describeAudit, type AuditGroup } from '../lib/company/audit';
import { useCompanyAuth } from '../lib/company/AuthProvider';
import { listAudit, listAgents, listMembers } from '../lib/company/data';
import { timeAgo } from '../lib/company/feed';
import type { AgentRow, AuditRow, MemberRow } from '../lib/company/types';
import { useRealtimeReload } from '../lib/company/useRealtime';
import '../styles/firbo.css';

const GROUPS: { id: AuditGroup | 'all'; label: string }[] = [
  { id: 'all', label: 'Everything' },
  { id: 'approvals', label: 'Approvals' },
  { id: 'agents', label: 'Agents' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'people', label: 'People' },
];
const TONE = { info: 'idle', ok: 'ok', warn: 'warn', err: 'err' } as const;

export function ActivityPage() {
  const { current } = useCompanyAuth();
  const orgId = current?.organization.id ?? '';
  const isAdmin = current?.role === 'owner' || current?.role === 'admin';
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [group, setGroup] = useState<AuditGroup | 'all'>('all');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!orgId || !isAdmin) return setLoading(false);
    try {
      const [r, a, m] = await Promise.all([listAudit(orgId), listAgents(orgId), listMembers(orgId)]);
      setRows(r);
      setAgents(a);
      setMembers(m);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the activity log');
    } finally {
      setLoading(false);
    }
  }, [orgId, isAdmin]);
  useEffect(() => {
    void load();
  }, [load]);
  useRealtimeReload(isAdmin ? orgId : '', ['audit_log'], () => void load(), 800);

  const who = useMemo(
    () => ({
      agent: (id: unknown) => agents.find((a) => a.id === id)?.name ?? 'An agent',
      person: (id: unknown) => {
        const m = members.find((x) => x.user_id === id);
        return m?.full_name || m?.email || 'a former member';
      },
    }),
    [agents, members],
  );
  const items = rows.map((r) => ({ row: r, ...describeAudit(r, who) })).filter((i) => group === 'all' || i.group === group);

  return (
    <div className="fb-root h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-4 pb-8 pt-14 md:px-6 md:pt-6">
        <header className="mb-5">
          <div className="fb-eyebrow">Accountability</div>
          <h1 className="mt-1 text-2xl font-semibold">Activity</h1>
          <p className="fb-muted mt-1 text-sm">A tamper-proof record of who approved, changed and hired what. It cannot be edited or deleted.</p>
        </header>

        {!isAdmin ? (
          <div className="fb-glass p-5 text-sm fb-muted">Only owners and admins can view the audit log.</div>
        ) : (
          <>
            <div className="mb-4 flex flex-wrap gap-2" role="tablist">
              {GROUPS.map((g) => (
                <button
                  key={g.id}
                  role="tab"
                  aria-selected={group === g.id}
                  onClick={() => setGroup(g.id)}
                  className="fb-chip cursor-pointer"
                  style={group === g.id ? { color: 'var(--fb-accent)', borderColor: 'var(--fb-border-strong)', background: 'rgba(34,211,238,.1)' } : undefined}
                >
                  {g.label}
                </button>
              ))}
            </div>
            {error && (
              <p role="alert" className="fb-chip mb-3" style={{ color: 'var(--fb-err)' }}>
                {error}
              </p>
            )}
            <div className="fb-glass p-2">
              {loading ? (
                <p className="fb-dim p-4 text-sm">Loading…</p>
              ) : items.length === 0 ? (
                <p className="fb-dim p-4 text-sm">No activity yet. Changes and decisions will appear here as they happen.</p>
              ) : (
                <ul>
                  {items.map(({ row, text, tone }) => (
                    <li key={row.id} className="flex items-start gap-3 px-3 py-2.5" style={{ borderTop: '1px solid var(--fb-border)' }}>
                      <span className="mt-1.5">
                        <StatusDot tone={TONE[tone]} />
                      </span>
                      <div className="min-w-0 flex-1 text-sm">{text}</div>
                      <time className="fb-dim shrink-0 text-xs" dateTime={row.created_at} title={new Date(row.created_at).toLocaleString()}>
                        {timeAgo(Date.parse(row.created_at))}
                      </time>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
