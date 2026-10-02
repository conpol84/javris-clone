import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useNavigate } from 'react-router';
import { useI18n } from '../i18n/I18nProvider';
import type { TKey } from '../i18n/locales/en';
import { useCompanyAuth } from '../lib/company/AuthProvider';
import { deleteOrganization, loadOrgSummary, type OrgSummary } from '../lib/company/data';
import { MANAGER_ROLES } from '../lib/company/types';
import '../styles/firbo.css';

/** One overview for every company you belong to. */
export function CompaniesPage() {
  const { t, fmt } = useI18n();
  const navigate = useNavigate();
  const { memberships, current, selectOrg, refresh } = useCompanyAuth();
  const [removing, setRemoving] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [stats, setStats] = useState<Record<string, OrgSummary | 'error'>>({});

  useEffect(() => {
    let live = true;
    for (const m of memberships) {
      loadOrgSummary(m.organization.id, MANAGER_ROLES.includes(m.role))
        .then((s) => live && setStats((prev) => ({ ...prev, [m.organization.id]: s })))
        .catch(() => live && setStats((prev) => ({ ...prev, [m.organization.id]: 'error' })));
    }
    return () => {
      live = false;
    };
  }, [memberships]);

  const open = (id: string, to: string) => {
    selectOrg(id);
    navigate(to);
  };

  const remove = async (id: string) => {
    setBusy(true);
    try {
      await deleteOrganization(id);
      toast.success(t('cmp.removed'));
      setRemoving(null);
      setTyped('');
      await refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String((err as { message?: string })?.message ?? '');
      toast.error(msg.includes('active_subscription') ? t('cmp.removeSub') : msg.includes('not_owner') ? t('cmp.removeOwner') : t('cmp.removeError'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fb-root h-full overflow-y-auto">
      <div className="mx-auto max-w-[1100px] px-4 pb-8 pt-14 md:px-6 md:pt-6">
        <header className="mb-5">
          <div className="fb-eyebrow">{t('nav.companies')}</div>
          <h1 className="mt-1 text-2xl font-semibold">{t('cmp.title')}</h1>
          <p className="fb-muted mt-1 text-sm">{t('cmp.sub', { count: memberships.length })}</p>
        </header>
        <ul className="grid gap-4 md:grid-cols-2">
          {memberships.map((m) => {
            const id = m.organization.id;
            const s = stats[id];
            const isCurrent = id === current?.organization.id;
            return (
              <li key={id} className="fb-glass p-4" style={isCurrent ? { borderColor: 'var(--fb-border-strong)' } : undefined}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-lg font-semibold">{m.organization.name}</div>
                    <div className="fb-dim text-xs">{t(`role.${m.role}` as TKey)}</div>
                  </div>
                  {isCurrent && <span className="fb-chip">{t('cmp.current')}</span>}
                </div>
                {s === undefined ? (
                  <p className="fb-dim mt-4 text-sm">{t('common.loading')}</p>
                ) : s === 'error' ? (
                  <p className="mt-4 text-sm" style={{ color: 'var(--fb-warn)' }}>{t('cmp.error')}</p>
                ) : (
                  <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                    <Metric label={t('cmp.agents')} value={fmt.number(s.agents)} onClick={() => open(id, '/team')} />
                    <Metric label={t('cmp.tasks')} value={fmt.number(s.openTasks)} onClick={() => open(id, '/tasks')} />
                    <Metric label={t('cmp.approvals')} value={fmt.number(s.approvals)} onClick={() => open(id, '/inbox')} warn={s.approvals > 0} />
                    <Metric label={t('cmp.spend')} value={s.cost30d == null ? '–' : fmt.currency(s.cost30d)} onClick={() => open(id, '/analytics')} />
                  </div>
                )}
                <button className="fb-btn fb-btn--primary mt-4 w-full" onClick={() => open(id, '/')}>
                  {t('cmp.open')}
                </button>
                {m.role === 'owner' &&
                  (removing === id ? (
                    <div className="fb-col mt-3 gap-2">
                      <p className="text-xs" style={{ color: 'var(--fb-warn)' }}>{t('cmp.removeWarn', { name: m.organization.name })}</p>
                      <input className="fb-input" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={m.organization.name} aria-label={t('cmp.removeType')} />
                      <div className="flex gap-2">
                        <button className="fb-btn fb-btn--ghost flex-1" onClick={() => (setRemoving(null), setTyped(''))}>{t('cmp.removeCancel')}</button>
                        <button className="fb-btn flex-1" disabled={busy || typed.trim() !== m.organization.name} onClick={() => void remove(id)} style={{ color: 'var(--fb-warn)' }}>
                          <Trash2 size={14} /> {t('cmp.removeConfirm')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button className="fb-btn fb-btn--ghost mt-2 w-full" onClick={() => (setRemoving(id), setTyped(''))}>
                      <Trash2 size={14} /> {t('cmp.remove')}
                    </button>
                  ))}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function Metric({ label, value, onClick, warn }: { label: string; value: string; onClick: () => void; warn?: boolean }) {
  return (
    <button onClick={onClick} className="fb-row fb-glass--hover cursor-pointer flex-col items-start gap-0.5 py-2.5 text-start">
      <span className="fb-dim text-[11px]">{label}</span>
      <span className="text-lg font-semibold tabular-nums" style={warn ? { color: 'var(--fb-warn)' } : undefined}>{value}</span>
    </button>
  );
}
