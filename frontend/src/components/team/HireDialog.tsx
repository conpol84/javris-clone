import { useState } from 'react';
import { toast } from 'sonner';
import { Modal } from './Modal';
import { AGENT_TEMPLATES, TEMPLATE_CATEGORIES, type AgentTemplate } from '../../lib/company/templates';
import { hireAgent } from '../../lib/company/data';
import { useI18n } from '../../i18n/I18nProvider';
import { categoryLabel } from '../../lib/company/labels';
import type { TKey } from '../../i18n/locales/en';
import type { AgentRow } from '../../lib/company/types';

export function HireDialog({
  orgId,
  existing,
  onClose,
  onHired,
}: {
  orgId: string;
  existing: AgentRow[];
  onClose: () => void;
  onHired: () => void;
}) {
  const i18n = useI18n();
  const { t } = i18n;
  const [cat, setCat] = useState<string>('All');
  const [busy, setBusy] = useState<string | null>(null);
  const hired = (tpl: AgentTemplate) => existing.some((a) => a.slug === tpl.slug || a.slug.startsWith(`${tpl.slug}-`));
  const list = AGENT_TEMPLATES.filter((x) => cat === 'All' || x.category === cat);

  const hire = async (tpl: AgentTemplate) => {
    setBusy(tpl.slug);
    try {
      await hireAgent(orgId, tpl);
      toast.success(t('hire.success', { name: t(`tpl.${tpl.slug}.name` as TKey) }));
      onHired();
    } catch (err) {
      console.error(err);
      toast.error(t('hire.error'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal title={t('hire.title')} onClose={onClose} wide>
      <p className="fb-muted mb-4 text-sm">
        {t('hire.intro')}
      </p>
      <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label={t('hire.catsAria')}>
        {['All', ...TEMPLATE_CATEGORIES].map((c) => (
          <button
            key={c}
            role="tab"
            aria-selected={cat === c}
            onClick={() => setCat(c)}
            className="fb-chip cursor-pointer"
            style={cat === c ? { color: 'var(--fb-accent)', borderColor: 'var(--fb-border-strong)', background: 'rgba(34,211,238,0.1)' } : undefined}
          >
            {c === 'All' ? t('cat.all') : categoryLabel(c, i18n)}
          </button>
        ))}
      </div>
      <ul className="grid gap-3 sm:grid-cols-2">
        {list.map((tpl) => (
          <li key={tpl.slug} className="fb-row fb-col gap-2 p-4">
            <div className="flex items-center gap-2.5">
              <span className="grid h-9 w-9 place-items-center rounded-xl" style={{ background: `${tpl.color}22`, border: `1px solid ${tpl.color}55` }}>
                <span className="fb-dot" style={{ background: tpl.color, boxShadow: `0 0 12px ${tpl.color}` }} />
              </span>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">{t(`tpl.${tpl.slug}.name` as TKey)}</div>
                <div className="fb-dim text-[11px]">{categoryLabel(tpl.category, i18n)}</div>
              </div>
            </div>
            <p className="fb-muted flex-1 text-xs leading-relaxed">{t(`tpl.${tpl.slug}.tagline` as TKey)}</p>
            <div className="flex items-center justify-between gap-2">
              <span className="fb-dim text-[11px]">
                {t('hire.meta', { tools: tpl.tools.length, ask: tpl.tools.filter((x) => x.policy === 'approval').length })}
              </span>
              <button
                className="fb-btn fb-btn--primary"
                style={{ height: 32, padding: '0 14px', fontSize: 13 }}
                disabled={busy !== null}
                onClick={() => void hire(tpl)}
              >
                {busy === tpl.slug ? t('hire.busy') : hired(tpl) ? t('hire.another') : t('hire.btn')}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
