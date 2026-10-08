import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bot, CheckCircle2, History, ListChecks, Users, type LucideIcon } from 'lucide-react';
import { EmptyState, PageHeader, Segmented } from '../components/ui/kit';
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
const TONE_COLOR = { info: '#7f9fc4', ok: '#34d399', warn: '#fbbf24', err: '#f87171' } as const;
const GROUP_ICON: Record<string, LucideIcon> = { approvals: CheckCircle2, agents: Bot, tasks: ListChecks, people: Users };

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
      <div className="mx-auto max-w-3xl px-4 pb-10 pt-14 md:px-8 md:pt-8">
        <PageHeader
          eyebrow={t('act.eyebrow')}
          title={t('act.title')}
          sub={t('act.sub')}
          right={isAdmin ? <Segmented value={group} onChange={setGroup} options={GROUPS.map((g) => ({ id: g, label: t(`act.group.${g}` as TKey) }))} /> : undefined}
        />

        {!isAdmin ? (
          <div className="fb-glass p-5 text-sm fb-muted">{t('act.onlyAdmins')}</div>
        ) : (
          <>
            {error && (
              <p role="alert" className="fb-pill fb-pill--err mb-3">
                {error}
              </p>
            )}
            {loading ? (
              <p className="fb-dim p-4 text-sm">{t('common.loading')}</p>
            ) : items.length === 0 ? (
              <EmptyState icon={<History size={24} />} title={t('act.empty')} />
            ) : (
              <ol className="fb-timeline">
                {items.map(({ row, text, tone, group: g }, i) => {
                  const Icon = GROUP_ICON[g] ?? History;
                  const day = fmt.date(row.created_at);
                  const newDay = i === 0 || day !== fmt.date(items[i - 1].row.created_at);
                  return (
                    <li key={row.id}>
                      {newDay && <div className="fb-timeline__day">{day}</div>}
                      <div className="fb-timeline__item">
                        <span className="fb-timeline__dot" style={{ color: TONE_COLOR[tone], borderColor: `${TONE_COLOR[tone]}66`, background: `${TONE_COLOR[tone]}14` }}>
                          <Icon size={14} />
                        </span>
                        <div className="fb-glass min-w-0 flex-1 px-4 py-3">
                          <div className="text-sm leading-snug">{text}</div>
                          <time className="fb-dim mt-1 block text-xs" dateTime={row.created_at} title={fmt.dateTime(row.created_at)}>
                            {timeAgo(Date.parse(row.created_at), Date.now(), fmt)}
                          </time>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </>
        )}
      </div>
    </div>
  );
}
