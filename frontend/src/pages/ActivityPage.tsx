import { useCallback, useEffect, useMemo, useState } from 'react';
import { StatusDot } from '../components/command/Panel';
import { describeAudit, type AuditGroup } from '../lib/company/audit';
import { useCompanyAuth } from '../lib/company/AuthProvider';
import { listAudit, listAgents, listMembers } from '../lib/company/data';
import { timeAgo } from '../lib/company/feed';
import { agentLabel } from '../lib/company/labels';
import { useI18n } from '../i18n/I18nProvider';
import type { TKey } from '../i18n/locales/en';
import type { AgentRow, AuditRow, MemberRow } from '../lib/company/types';
import { useRealtimeReload } from '../lib/company/useRealtime';
import '../styles/firbo.css';

const GROUPS: (AuditGroup | 'all')[] = ['all', 'approvals', 'agents', 'tasks', 'people'];
const TONE = { info: 'idle', ok: 'ok', warn: 'warn', err: 'err' } as const;

export function ActivityPage() {
  const i18n = useI18n();
  const { t, fmt } = i18n;
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
      console.error(err);
      setError(t('act.loadError'));
    } finally {
      setLoading(false);
    }
  }, [orgId, isAdmin, t]);
  useEffect(() => {
    void load();
  }, [load]);
  useRealtimeReload(isAdmin ? orgId : '', ['audit_log'], () => void load(), 800);

  const who = useMemo(
    () => ({
      agent: (id: unknown) => {
        const a = agents.find((x) => x.id === id);
        return a ? agentLabel(a, i18n).name : t('audit.agent.fallback');
      },
      person: (id: unknown) => {
        const m = members.find((x) => x.user_id === id);
        return m?.full_name || m?.email || t('act.formerMember');
      },
    }),
    [agents, members, i18n, t],
  );
  const items = rows.map((r) => ({ row: r, ...describeAudit(r, who, i18n) })).filter((i) => group === 'all' || i.group === group);

  return (
    <div className="fb-root h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-4 pb-8 pt-14 md:px-6 md:pt-6">
        <header className="mb-5">
          <div className="fb-eyebrow">{t('act.eyebrow')}</div>
          <h1 className="mt-1 text-2xl font-semibold">{t('act.title')}</h1>
          <p className="fb-muted mt-1 text-sm">{t('act.sub')}</p>
        </header>

        {!isAdmin ? (
          <div className="fb-glass p-5 text-sm fb-muted">{t('act.onlyAdmins')}</div>
        ) : (
          <>
            <div className="mb-4 flex flex-wrap gap-2" role="tablist">
              {GROUPS.map((g) => (
                <button
                  key={g}
                  role="tab"
                  aria-selected={group === g}
                  onClick={() => setGroup(g)}
                  className="fb-chip cursor-pointer"
                  style={group === g ? { color: 'var(--fb-accent)', borderColor: 'var(--fb-border-strong)', background: 'rgba(0, 212, 255,.1)' } : undefined}
                >
                  {t(`act.group.${g}` as TKey)}
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
                <p className="fb-dim p-4 text-sm">{t('common.loading')}</p>
              ) : items.length === 0 ? (
                <p className="fb-dim p-4 text-sm">{t('act.empty')}</p>
              ) : (
                <ul>
                  {items.map(({ row, text, tone }) => (
                    <li key={row.id} className="flex items-start gap-3 px-3 py-2.5" style={{ borderTop: '1px solid var(--fb-border)' }}>
                      <span className="mt-1.5">
                        <StatusDot tone={TONE[tone]} />
                      </span>
                      <div className="min-w-0 flex-1 text-sm">{text}</div>
                      <time className="fb-dim shrink-0 text-xs" dateTime={row.created_at} title={fmt.dateTime(row.created_at)}>
                        {timeAgo(Date.parse(row.created_at), Date.now(), fmt)}
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
