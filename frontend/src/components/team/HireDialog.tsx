import { useState } from 'react';
import { toast } from 'sonner';
import { Modal } from './Modal';
import { AGENT_TEMPLATES, TEMPLATE_CATEGORIES, type AgentTemplate } from '../../lib/company/templates';
import { hireAgent } from '../../lib/company/data';
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
  const [cat, setCat] = useState<string>('All');
  const [busy, setBusy] = useState<string | null>(null);
  const hired = (tpl: AgentTemplate) => existing.some((a) => a.slug === tpl.slug || a.slug.startsWith(`${tpl.slug}-`));
  const list = AGENT_TEMPLATES.filter((t) => cat === 'All' || t.category === cat);

  const hire = async (tpl: AgentTemplate) => {
    setBusy(tpl.slug);
    try {
      await hireAgent(orgId, tpl);
      toast.success(`${tpl.name} joined your team`);
      onHired();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not hire this agent');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal title="Hire an AI employee" onClose={onClose} wide>
      <p className="fb-muted mb-4 text-sm">
        Pre-built roles with sensible tools. Anything that reaches outside your company needs your approval until you decide otherwise.
      </p>
      <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Categories">
        {['All', ...TEMPLATE_CATEGORIES].map((c) => (
          <button
            key={c}
            role="tab"
            aria-selected={cat === c}
            onClick={() => setCat(c)}
            className="fb-chip cursor-pointer"
            style={cat === c ? { color: 'var(--fb-accent)', borderColor: 'var(--fb-border-strong)', background: 'rgba(34,211,238,0.1)' } : undefined}
          >
            {c}
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
                <div className="truncate text-sm font-semibold">{tpl.name}</div>
                <div className="fb-dim text-[11px]">{tpl.category}</div>
              </div>
            </div>
            <p className="fb-muted flex-1 text-xs leading-relaxed">{tpl.tagline}</p>
            <div className="flex items-center justify-between gap-2">
              <span className="fb-dim text-[11px]">
                {tpl.tools.length} tools · {tpl.tools.filter((t) => t.policy === 'approval').length} need approval
              </span>
              <button
                className="fb-btn fb-btn--primary"
                style={{ height: 32, padding: '0 14px', fontSize: 13 }}
                disabled={busy !== null}
                onClick={() => void hire(tpl)}
              >
                {busy === tpl.slug ? 'Hiring…' : hired(tpl) ? 'Hire another' : 'Hire'}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
