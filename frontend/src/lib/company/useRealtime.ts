import { useEffect, useRef } from 'react';
import { companyClient } from './client';

/** Several screens can watch the same tables at once (a page plus an open dialog), so every subscription gets its own channel name. */
let seq = 0;
export const channelName = (orgId: string, key: string): string => `org-${orgId}-${key}-${++seq}`;

/**
 * Calls `onChange` (debounced) whenever rows of the given tables change for this company.
 * Supabase Realtime applies row-level security, so users only receive what they may read.
 */
export function useRealtimeReload(orgId: string, tables: string[], onChange: () => void, debounceMs = 400): void {
  const cb = useRef(onChange);
  cb.current = onChange;
  const key = tables.join(',');

  useEffect(() => {
    if (!companyClient || !orgId) return;
    let timer: number | undefined;
    const fire = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => cb.current(), debounceMs);
    };
    let channel = companyClient.channel(channelName(orgId, key));
    for (const table of key.split(',')) {
      channel = channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table, filter: `organization_id=eq.${orgId}` },
        fire,
      );
    }
    channel.subscribe();
    return () => {
      window.clearTimeout(timer);
      void companyClient?.removeChannel(channel);
    };
  }, [orgId, key, debounceMs]);
}
