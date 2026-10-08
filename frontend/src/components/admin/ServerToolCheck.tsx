import { useState } from 'react';
import { useI18n } from '../../i18n/I18nProvider';
import { requireClient } from '../../lib/company/client';
import { serverExecution } from '../../../../supabase/functions/_shared/server-execution';
import { serverRuntime } from '../../../../supabase/functions/_shared/server-runtime';
import { ServerExecutionReceipt } from './ServerExecutionReceipt';

/** A manual arithmetic check through the existing authenticated admin chat bridge. */
export function ServerToolCheck({ runtime, disabled }: { runtime: unknown; disabled: boolean }) {
  const { lang } = useI18n();
  const el = lang === 'el';
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ execution?: unknown; reported: boolean; failed: boolean } | null>(null);
  const inventory = serverRuntime(runtime);
  const tool = inventory?.tool_names.includes('calculator') ? 'calculator' : inventory?.tool_names.includes('code_interpreter') ? 'code_interpreter' : null;
  async function check() {
    if (busy || disabled || !tool) return;
    setBusy(true); setResult(null);
    try {
      const { data, error } = await requireClient().functions.invoke('server-jarvis', { body: {
        action: 'chat',
        message: `Use the ${tool} tool exactly once to calculate 17 * 19 and return the result. Do not use shell, files, network or any other tools. If the tool is unavailable, say so.`,
      } });
      const receipt = !error ? serverExecution(data?.execution) : null;
      const reported = !!receipt && receipt.failed_count === 0 && receipt.tools.some(t => t.name === tool && t.success && /\b323\b/.test(t.output));
      setResult({ execution: receipt, reported, failed: !!error });
    } catch { setResult({ reported: false, failed: true }); }
    finally { setBusy(false); }
  }
  return <div className="mt-4 rounded-xl border border-white/10 p-3">
    <h3 className="text-sm font-semibold">{el ? 'Έλεγχος εργαλείων' : 'Tool execution check'}</h3>
    <p className="fb-muted mt-1 text-xs">{el ? 'Ζητά έναν απλό υπολογισμό από εργαλείο και ελέγχει την αναφορά εκτέλεσης του server. Δεν πιστοποιεί όλα τα εργαλεία.' : 'Requests one arithmetic calculation and checks the server execution report. This does not certify every tool.'}</p>
    <button type="button" className="fb-btn fb-btn--ghost mt-3" onClick={() => void check()} disabled={disabled || busy || !tool}>{busy ? (el ? 'Έλεγχος…' : 'Checking…') : (el ? 'Έλεγχος τώρα' : 'Check now')}</button>
    {!tool && <p className="fb-dim mt-2 text-xs">{el ? 'Δεν έχει επιβεβαιωθεί διαθέσιμο εργαλείο υπολογισμού.' : 'No arithmetic tool has been confirmed in the runtime inventory.'}</p>}
    {result && <div role="status" className="mt-3 text-sm">
      <p>{result.failed ? (el ? 'Ο έλεγχος δεν ολοκληρώθηκε. Δοκίμασε ξανά.' : 'The check could not complete. Try again.') : result.reported ? (el ? 'Ο server ανέφερε επιτυχημένο υπολογισμό μέσω εργαλείου.' : 'The server reported a successful tool calculation.') : (el ? 'Δεν επιβεβαιώθηκε εκτέλεση του υπολογισμού μέσω εργαλείου.' : 'Tool execution of the calculation was not confirmed.')}</p>
      {!result.failed && <ServerExecutionReceipt value={result.execution} />}
    </div>}
  </div>;
}
