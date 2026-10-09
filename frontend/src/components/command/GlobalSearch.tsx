import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Search } from 'lucide-react';
import { useI18n } from '../../i18n/I18nProvider';
import type { TKey } from '../../i18n/locales/en';
import { agentLabel } from '../../lib/company/labels';
import type { AgentRow, TaskRow } from '../../lib/company/types';

interface Hit {
  key: string;
  label: string;
  kind: string;
  to: string;
}

const PAGES: [TKey, string][] = [
  ['nav.office', '/office'],
  ['nav.ceo', '/ceo'],
  ['nav.studio', '/studio'],
  ['nav.missions', '/missions'],
  ['nav.shifts', '/shifts'],
  ['nav.chat', '/chat'],
  ['nav.team', '/team'],
  ['nav.memory', '/memory'],
  ['nav.reviews', '/reviews'],
  ['nav.store', '/store'],
  ['nav.inbox', '/inbox'],
  ['nav.tasks', '/tasks'],
  ['nav.activity', '/activity'],
  ['nav.analytics', '/analytics'],
  ['nav.computers', '/computers'],
  ['nav.integrations', '/integrations'],
  ['nav.billing', '/billing'],
  ['nav.gateway', '/gateway'],
];

/** Search pages, AI employees and tasks. Press "/" anywhere on the page to jump in. */
export function GlobalSearch({ agents, tasks }: { agents: AgentRow[]; tasks: TaskRow[] }) {
  const i18n = useI18n();
  const { t } = i18n;
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [idx, setIdx] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (e.key === '/' && tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const all = useMemo<Hit[]>(
    () => [
      ...PAGES.map(([k, to]) => ({ key: `p-${to}`, label: t(k), kind: t('search.page'), to })),
      ...agents.map((a) => ({ key: `a-${a.id}`, label: agentLabel(a, i18n).name, kind: t('search.agent'), to: `/team?agent=${a.id}` })),
      ...tasks.slice(0, 200).map((k) => ({ key: `t-${k.id}`, label: k.title, kind: t('search.task'), to: '/tasks' })),
    ],
    [agents, tasks, i18n, t],
  );
  const hits = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    return all.filter((h) => h.label.toLowerCase().includes(s)).slice(0, 8);
  }, [q, all]);

  const go = (h: Hit) => {
    setOpen(false);
    setQ('');
    navigate(h.to);
  };

  return (
    <div className="relative w-full max-w-[320px]">
      <label className="fb-input flex items-center gap-2" style={{ height: 38 }}>
        <Search size={14} className="fb-dim" aria-hidden />
        <input
          ref={input}
          className="min-w-0 flex-1 bg-transparent text-sm outline-none"
          value={q}
          placeholder={t('search.placeholder')}
          aria-label={t('search.placeholder')}
          role="combobox"
          aria-expanded={open && hits.length > 0}
          aria-controls="fb-search-list"
          onChange={(e) => (setQ(e.target.value), setIdx(0), setOpen(true))}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') (e.preventDefault(), setIdx((i) => Math.min(i + 1, hits.length - 1)));
            else if (e.key === 'ArrowUp') (e.preventDefault(), setIdx((i) => Math.max(i - 1, 0)));
            else if (e.key === 'Enter' && hits[idx]) go(hits[idx]);
            else if (e.key === 'Escape') (setOpen(false), input.current?.blur());
          }}
        />
        <kbd className="fb-dim hidden rounded px-1.5 text-[10px] md:inline" style={{ border: '1px solid var(--fb-border)' }}>/</kbd>
      </label>
      {open && q.trim() && (
        <ul id="fb-search-list" role="listbox" className="fb-glass absolute start-0 top-[44px] z-30 w-full p-1" style={{ background: 'var(--fb-glass-strong)' }}>
          {hits.length === 0 ? (
            <li className="fb-dim p-2 text-sm">{t('search.none')}</li>
          ) : (
            hits.map((h, i) => (
              <li key={h.key} role="option" aria-selected={i === idx}>
                <button className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-start text-sm" style={{ background: i === idx ? 'rgba(0,212,255,0.12)' : 'transparent' }} onMouseDown={(e) => (e.preventDefault(), go(h))} onMouseEnter={() => setIdx(i)}>
                  <span className="min-w-0 flex-1 truncate">{h.label}</span>
                  <span className="fb-dim text-[11px]">{h.kind}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
