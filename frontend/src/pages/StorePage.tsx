import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { toast } from 'sonner';
import { HireDialog } from '../components/team/HireDialog';
import { useI18n } from '../i18n/I18nProvider';
import type { TKey } from '../i18n/locales/en';
import { useCompanyAuth } from '../lib/company/AuthProvider';
import { listAgents } from '../lib/company/data';
import { categoryLabel } from '../lib/company/labels';
import { AGENT_TEMPLATES, TEMPLATE_CATEGORIES, type AgentTemplate } from '../lib/company/templates';
import { MANAGER_ROLES, type AgentRow } from '../lib/company/types';
import '../styles/firbo.css';

/** Browse every AI employee you can hire, with search and categories. */
export function StorePage() {
  const i18n = useI18n();
  const { t } = i18n;
  const { current } = useCompanyAuth();
  const orgId = current?.organization.id ?? '';
  const canHire = MANAGER_ROLES.includes(current?.role ?? 'viewer');
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [cat, setCat] = useState('All');
  const [q, setQ] = useState('');
  const [pick, setPick] = useState<AgentTemplate | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!orgId) return;
    listAgents(orgId).then(setAgents).catch(() => toast.error(t('chat.loadError')));
  }, [orgId, version, t]);

  const hired = (tpl: AgentTemplate) => agents.filter((a) => a.slug === tpl.slug || a.slug.startsWith(`${tpl.slug}-`)).length;
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return AGENT_TEMPLATES.filter((x) => {
      if (cat !== 'All' && x.category !== cat) return false;
      if (!needle) return true;
      const text = `${t(`tpl.${x.slug}.name` as TKey)} ${t(`tpl.${x.slug}.tagline` as TKey)} ${x.tools.map((k) => k.tool).join(' ')}`.toLowerCase();
      return text.includes(needle);
    });
  }, [cat, q, t]);

  return (
    <div className="fb-root fb-col gap-4 p-4 lg:p-6" style={{ minHeight: '100%' }}>
      <header>
        <div className="fb-eyebrow">{t('store.eyebrow')}</div>
        <h1 className="fb-grad-text text-2xl font-semibold">{t('store.title')}</h1>
        <p className="fb-muted mt-1 max-w-2xl text-sm">{t('store.intro', { n: AGENT_TEMPLATES.length })}</p>
      </header>
      <div className="flex flex-wrap items-center gap-2">
        <label className="fb-input flex min-w-[220px] flex-1 items-center gap-2">
          <Search size={15} aria-hidden />
          <input className="w-full bg-transparent outline-none" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('store.search')} aria-label={t('store.search')} />
        </label>
        {['All', ...TEMPLATE_CATEGORIES].map((c) => (
          <button
            key={c}
            className="fb-chip cursor-pointer"
            aria-pressed={cat === c}
            onClick={() => setCat(c)}
            style={cat === c ? { color: 'var(--fb-accent)', borderColor: 'var(--fb-border-strong)', background: 'rgba(34, 211, 238,0.1)' } : undefined}
          >
            {c === 'All' ? t('cat.all') : categoryLabel(c, i18n)}
          </button>
        ))}
      </div>
      {list.length === 0 && <div className="fb-glass p-6 text-sm">{t('store.none')}</div>}
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {list.map((tpl) => {
          const n = hired(tpl);
          const ask = tpl.tools.filter((x) => x.policy === 'approval').length;
          return (
            <li key={tpl.slug} className="fb-glass fb-col gap-3 p-4">
              <div className="flex items-center gap-3">
                <span className="grid h-11 w-11 place-items-center rounded-xl" style={{ background: `${tpl.color}22`, border: `1px solid ${tpl.color}55`, boxShadow: `0 0 18px ${tpl.color}33` }}>
                  <span className="fb-dot" style={{ background: tpl.color, boxShadow: `0 0 12px ${tpl.color}` }} />
                </span>
                <div className="min-w-0">
                  <div className="truncate font-semibold">{t(`tpl.${tpl.slug}.name` as TKey)}</div>
                  <div className="fb-dim text-xs">{categoryLabel(tpl.category, i18n)}</div>
                </div>
                {n > 0 && <span className="fb-chip ms-auto">{t('store.hired', { n })}</span>}
              </div>
              <p className="fb-muted flex-1 text-sm leading-relaxed">{t(`tpl.${tpl.slug}.tagline` as TKey)}</p>
              <div className="flex flex-wrap gap-1.5">
                {tpl.tools.slice(0, 4).map((k) => (
                  <span key={k.tool} className="fb-chip">{k.tool}</span>
                ))}
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="fb-dim text-xs">{t('hire.meta', { tools: tpl.tools.length, ask })}</span>
                <button className="fb-btn fb-btn--primary" disabled={!canHire} onClick={() => setPick(tpl)}>
                  {n > 0 ? t('hire.another') : t('hire.btn')}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {pick && (
        <HireDialog
          orgId={orgId}
          existing={agents}
          initial={pick}
          onClose={() => setPick(null)}
          onHired={() => {
            setPick(null);
            setVersion((v) => v + 1);
          }}
        />
      )}
    </div>
  );
}
