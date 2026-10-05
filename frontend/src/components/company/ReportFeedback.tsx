import { useEffect, useState } from 'react';
import { ThumbsDown, ThumbsUp } from 'lucide-react';
import { toast } from 'sonner';
import { useCompanyAuth } from '../../lib/company/AuthProvider';
import { WRITER_ROLES } from '../../lib/company/types';
import { myFeedback, rateReport } from '../../lib/company/workspace';
import { useWorkspaceCopy } from '../../lib/company/workspaceCopy';

/** 👍 / 👎 on an AI report. Two 👎 in a row move that employee to a stronger model, and the notes go into its next tasks. */
export function ReportFeedback({ task }: { task: { id: string; assigned_agent_id: string | null; result?: { model?: string } | null } }) {
  const c = useWorkspaceCopy();
  const { current, user } = useCompanyAuth();
  const [rating, setRating] = useState<1 | -1 | 0>(0);
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const canRate = WRITER_ROLES.includes(current?.role ?? 'viewer');

  useEffect(() => {
    if (!user) return;
    let live = true;
    myFeedback(task.id, user.id).then(f => { if (live && f) setRating(f.rating > 0 ? 1 : -1); }).catch(() => undefined);
    return () => { live = false; };
  }, [task.id, user]);
  if (!canRate || !current || !user) return null;

  const send = async (value: 1 | -1, text = '') => {
    setBusy(true);
    try {
      await rateReport(current.organization.id, user.id, { id: task.id, agentId: task.assigned_agent_id, model: task.result?.model ?? null }, value, text);
      setRating(value); setAsking(false); setNote('');
      toast.success(c('fThanks'));
    } catch { toast.error(c('kErr')); } finally { setBusy(false); }
  };

  return (
    <div className="fb-col gap-2">
      <div className="flex items-center gap-2">
        <button type="button" className="fb-btn fb-btn--ghost" aria-pressed={rating === 1} title={c('fGood')} aria-label={c('fGood')} disabled={busy}
          style={rating === 1 ? { borderColor: 'var(--fb-accent)' } : undefined} onClick={() => void send(1)}><ThumbsUp size={14} /></button>
        <button type="button" className="fb-btn fb-btn--ghost" aria-pressed={rating === -1} title={c('fBad')} aria-label={c('fBad')} disabled={busy}
          style={rating === -1 ? { borderColor: 'var(--fb-err)' } : undefined} onClick={() => setAsking(true)}><ThumbsDown size={14} /></button>
      </div>
      {asking && (
        <form className="flex flex-wrap gap-2" onSubmit={e => { e.preventDefault(); void send(-1, note); }}>
          <input className="fb-input min-w-0 flex-1" value={note} onChange={e => setNote(e.target.value)} placeholder={c('fNote')} maxLength={500} autoFocus />
          <button className="fb-btn fb-btn--primary" disabled={busy}>{c('fSend')}</button>
        </form>
      )}
    </div>
  );
}
