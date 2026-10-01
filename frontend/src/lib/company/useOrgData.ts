import { useCallback, useEffect, useRef, useState } from 'react';
import { listAgents, listPendingApprovals, listTasks, loadCounts } from './data';
import { useRealtimeReload } from './useRealtime';
import type { AgentRow, ApprovalRow, OrgCounts, TaskRow } from './types';

export interface OrgData {
  agents: AgentRow[];
  tasks: TaskRow[];
  approvals: ApprovalRow[];
  counts: OrgCounts | null;
  loading: boolean;
  error: string;
  reload: () => Promise<void>;
}

/** Loads real company data and refreshes it in the background. */
export function useOrgData(orgId: string, canSeeUsage: boolean, intervalMs = 60_000): OrgData {
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRow[]>([]);
  const [counts, setCounts] = useState<OrgCounts | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const seq = useRef(0);

  const reload = useCallback(async () => {
    if (!orgId) return;
    const mine = ++seq.current;
    try {
      const [a, t, p, c] = await Promise.all([
        listAgents(orgId),
        listTasks(orgId),
        listPendingApprovals(orgId),
        loadCounts(orgId, canSeeUsage),
      ]);
      if (mine !== seq.current) return; // a newer request (or org switch) superseded this one
      setAgents(a);
      setTasks(t);
      setApprovals(p);
      setCounts(c);
      setError('');
    } catch (err) {
      if (mine === seq.current) setError(err instanceof Error ? err.message : 'Could not load data');
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [orgId, canSeeUsage]);

  // Live updates; the interval below is only a safety net.
  useRealtimeReload(orgId, ['agents', 'tasks', 'approvals'], () => void reload());

  useEffect(() => {
    setLoading(true);
    void reload();
    const id = window.setInterval(() => {
      if (!document.hidden) void reload();
    }, intervalMs);
    return () => {
      seq.current++;
      window.clearInterval(id);
    };
  }, [reload, intervalMs]);

  return { agents, tasks, approvals, counts, loading, error, reload };
}
