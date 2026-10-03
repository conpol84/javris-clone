import { useCallback, useEffect, useState } from 'react';
import { companyClient } from './client';
import { useRealtimeReload } from './useRealtime';

/** Live number of approvals waiting for a human (drives the sidebar badge). */
export function usePendingCount(orgId: string): number {
  const [count, setCount] = useState(0);
  const load = useCallback(async () => {
    if (!companyClient || !orgId) return;
    const { count: c } = await companyClient
      .from('approvals')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .eq('status', 'pending');
    setCount(c ?? 0);
  }, [orgId]);
  useEffect(() => {
    void load();
  }, [load]);
  useRealtimeReload(orgId, ['approvals'], () => void load());
  return count;
}
