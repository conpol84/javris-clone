import { useCallback, useEffect, useRef, useState } from 'react';
import { RequestGeneration } from './computer-state';

type Phase = 'loading' | 'ready' | 'error';
/** Scope-tagged results, cleanup invalidation and non-overlapping background polling.
 * Resetting/hiding this state does NOT replace backend membership/RLS checks.
 */
export function useComputerQuery<T>(scope: string, enabled: boolean, load: () => Promise<T[]>, interval: number) {
  const [state, setState] = useState<{ scope: string; rows: T[]; phase: Phase }>({ scope, rows: [], phase: 'loading' });
  const guard = useRef(new RequestGeneration());
  const inflight = useRef(false);
  const mounted = useRef(false);
  const refresh = useCallback(async () => {
    if (!enabled || !mounted.current || inflight.current) return;
    const ticket = guard.current.begin();
    inflight.current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const rows = await Promise.race([load(), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('computer_read_timeout')), 15_000);
      })]);
      if (mounted.current && guard.current.isCurrent(ticket)) setState({ scope, rows, phase: 'ready' });
    } catch {
      // Never present cached devices as current, or a failed read as an empty list.
      if (mounted.current && guard.current.isCurrent(ticket)) setState({ scope, rows: [], phase: 'error' });
    } finally {
      if (timer) clearTimeout(timer);
      if (guard.current.isCurrent(ticket)) inflight.current = false;
    }
  }, [scope, enabled, load]);
  useEffect(() => {
    mounted.current = true; inflight.current = false;
    setState({ scope, rows: [], phase: 'loading' });
    void refresh();
    const id = enabled ? window.setInterval(() => { if (!document.hidden) void refresh(); }, interval) : undefined;
    return () => {
      mounted.current = false; guard.current.invalidate(); inflight.current = false;
      if (id !== undefined) window.clearInterval(id);
    };
  }, [scope, enabled, refresh, interval]);
  const visible = enabled && state.scope === scope ? state : { scope, rows: [] as T[], phase: 'loading' as const };
  return { ...visible, refresh };
}
