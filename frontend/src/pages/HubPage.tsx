import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Search, ThumbsUp } from 'lucide-react';
import { toast } from 'sonner';
import { useI18n } from '../i18n/I18nProvider';
import type { TKey } from '../i18n/locales/en';
import { useCompanyAuth } from '../lib/company/AuthProvider';
import { CATALOG, countBy, GROUPS, loadVotes, setVote, type CatalogGroup, type CatalogStatus } from '../lib/company/catalog';
import '../styles/firbo.css';

const TONE: Record<CatalogStatus, string> = { live: '#00f58a', engine: '#fbbf24', planned: '#93b8a3' };

/** Everything the platform can do: what works now, what already exists in our engine, and what is coming. */
export function HubPage() {
  const { t } = useI18n();
  const { current, user } = useCompanyAuth();
  const orgId = current?.organization.id ?? '';
  const [group, setGroup] = useState<CatalogGroup | 'all'>('all');
  const [status, setStatus] = useState<CatalogStatus | 'all'>('all');
  const [q, setQ] = useState('');
  const [votes, setVotes] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!orgId || !user) return;
    loadVotes(orgId, user.id).then(setVotes).catch(() => undefined);
  }, [orgId, user]);

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return CATALOG.filter((c) => (group === 'all' || c.group === group) && (status === 'all' || c.status === status) && (!needle || c.name.toLowerCase().includes(needle)));
  }, [group, status, q]);

  const vote = async (id: string) => {
    if (!user) return;
    const on = !votes.has(id);
    setVotes((s) => {
      const n = new Set(s);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });
    try {
      await setVote(orgId, user.id, id, on);
      if (on) toast.success(t('hub.voted'));
    } catch (err) {
      console.error(err);
      setVotes((s) => {
        const n = new Set(s);
        if (on) n.delete(id);
        else n.add(id);
        return n;
      });
      toast.error(t('hub.voteError'));
    }
  };

  const chip = (active: boolean, color?: string) => ({
    className: 'fb-chip cursor-pointer',
    style: active ? { color: color ?? 'var(--fb-accent)', borderColor: color ?? 'var(--fb-border-strong)', background: 'rgba(0,245,138,0.08)' } : undefined,
  });

  return (
    <div className="fb-root h-full overflow-y-auto">
      <div className="mx-auto max-w-[1180px] space-y-5 px-4 pb-10 pt-14 md:px-6 md:pt-6">
        <header>
          <div className="fb-eyebrow">{t('hub.eyebrow')}</div>
          <h1 className="fb-grad-text mt-1 text-2xl font-semibold">{t('hub.title')}</h1>
          <p className="fb-muted mt-1 max-w-3xl text-sm">{t('hub.intro')}</p>
        </header>

        <div className="grid gap-3 sm:grid-cols-3">
          {(['live', 'engine', 'planned'] as const).map((s) => (
            <button key={s} className="fb-glass fb-glass--hover flex flex-col cursor-pointer gap-1 p-4 text-start" style={status === s ? { borderColor: TONE[s] } : undefined} aria-pressed={status === s} onClick={() => setStatus(status === s ? 'all' : s)}>
              <span className="text-3xl font-bold tabular-nums" style={{ color: TONE[s] }}>{countBy(s)}</span>
              <span className="text-sm font-semibold">{t(`hub.status.${s}` as TKey)}</span>
              <span className="fb-dim text-xs">{t(`hub.statusHelp.${s}` as TKey)}</span>
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="fb-input flex min-w-[220px] flex-1 items-center gap-2">
            <Search size={15} aria-hidden />
            <input className="w-full bg-transparent outline-none" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('hub.search')} aria-label={t('hub.search')} />
          </label>
          <button {...chip(group === 'all')} aria-pressed={group === 'all'} onClick={() => setGroup('all')}>{t('cat.all')}</button>
          {GROUPS.map((g) => (
            <button key={g} {...chip(group === g)} aria-pressed={group === g} onClick={() => setGroup(g)}>
              {t(`hub.group.${g}` as TKey)} · {CATALOG.filter((c) => c.group === g).length}
            </button>
          ))}
        </div>

        {GROUPS.filter((g) => group === 'all' || g === group).map((g) => {
          const items = list.filter((c) => c.group === g);
          if (items.length === 0) return null;
          return (
            <section key={g}>
              <div className="mb-2">
                <h2 className="text-base font-semibold">{t(`hub.group.${g}` as TKey)}</h2>
                <p className="fb-dim text-xs">{t(`hub.groupHelp.${g}` as TKey)}</p>
              </div>
              <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {items.map((c) => (
                  <li key={c.id} className="fb-row fb-col gap-2 p-3">
                    <div className="flex items-center gap-2">
                      <span className="fb-dot" style={{ background: TONE[c.status], boxShadow: c.status === 'live' ? `0 0 10px ${TONE[c.status]}` : undefined }} />
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold" title={c.name}>{c.name}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="fb-chip" style={{ color: TONE[c.status], borderColor: TONE[c.status] }}>{t(`hub.status.${c.status}` as TKey)}</span>
                      <span className="fb-dim text-[11px]">{t(`hub.source.${c.source}` as TKey)}</span>
                    </div>
                    {c.status === 'live' && c.href ? (
                      <Link to={c.href} className="inline-flex items-center gap-1 text-xs font-medium" style={{ color: 'var(--fb-accent)' }}>{t('hub.open')} →</Link>
                    ) : c.status !== 'live' ? (
                      <button className="fb-btn fb-btn--ghost self-start" style={{ height: 28, padding: '0 10px', fontSize: 12, ...(votes.has(c.id) ? { color: 'var(--fb-accent)', borderColor: 'var(--fb-accent)' } : {}) }} aria-pressed={votes.has(c.id)} onClick={() => void vote(c.id)}>
                        <ThumbsUp size={12} /> {votes.has(c.id) ? t('hub.needed') : t('hub.need')}
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
        {list.length === 0 && <div className="fb-glass p-6 text-sm">{t('store.none')}</div>}
      </div>
    </div>
  );
}
