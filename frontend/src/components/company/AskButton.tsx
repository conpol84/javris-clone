import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { MessageSquare } from 'lucide-react';
import { useI18n } from '../../i18n/I18nProvider';
import { useCompanyAuth } from '../../lib/company/AuthProvider';
import { listAgents } from '../../lib/company/data';
import { handoffLink, type Handoff } from '../../lib/company/handoff';
import { agentLabel } from '../../lib/company/labels';
import type { AgentRow } from '../../lib/company/types';
import { useWorkspaceCopy } from '../../lib/company/workspaceCopy';

/** "Ask <employee>": the CEO puts the owner through to the employee who did the work. */
export function AskButton({ ask }: { ask: Handoff }) {
  const i18n = useI18n();
  const copy = useWorkspaceCopy();
  const { current } = useCompanyAuth();
  const [agent, setAgent] = useState<AgentRow | null>(null);
  const orgId = current?.organization.id ?? '';
  useEffect(() => {
    let live = true;
    if (orgId) listAgents(orgId).then((all) => live && setAgent(all.find((a) => a.id === ask.agentId) ?? null)).catch(() => undefined);
    return () => { live = false; };
  }, [orgId, ask.agentId]);
  if (!agent) return null;
  return (
    <Link className="fb-btn fb-btn--ghost mt-2 inline-flex" to={handoffLink(ask)}>
      <MessageSquare size={14} /> {copy('aAsk', { name: agentLabel(agent, i18n).name })}
    </Link>
  );
}
