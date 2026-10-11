import { useEffect, useState } from 'react';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { companyClient, requireClient } from './client';
import { useCompanyAuth } from './AuthProvider';

export interface AdminCompany {
  id: string;
  name: string;
  status: string;
  created_at: string;
  members: number;
  agents: number;
  open_tasks: number;
  cost30d: number;
  tokens30d: number;
  runs30d: number;
}

export interface AdminUser {
  id: string;
  email: string;
  created_at: string;
  last_sign_in_at: string | null;
}

export interface AdminOverview {
  totals: { companies: number; users: number; agents: number; open_tasks: number; cost30d: number; tokens30d: number; runs30d: number };
  companies: AdminCompany[];
  users: AdminUser[];
}

export class AdminError extends Error {
  constructor(public code: 'forbidden' | 'unknown') {
    super(code);
  }
}

export async function loadAdminOverview(): Promise<AdminOverview> {
  const { data, error } = await requireClient().functions.invoke('admin-overview', { body: {} });
  if (error) {
    let code: 'forbidden' | 'unknown' = 'unknown';
    if (error instanceof FunctionsHttpError) {
      try {
        if ((await error.context.json())?.error === 'forbidden') code = 'forbidden';
      } catch {
        /* keep unknown */
      }
    }
    throw new AdminError(code);
  }
  if (!data?.totals || !Array.isArray(data.companies)) throw new AdminError('unknown');
  return data as AdminOverview;
}

/** A platform grant is tied to the authenticated user, never a global cached
 * boolean that could be reused after signing into a second FIRBO account.
 * Sensitive Gateway/Overview endpoints enforce the same role server-side.
 */
export function usePlatformAdminAccess(): { authorized: boolean; loading: boolean } {
  const { user } = useCompanyAuth();
  const userId = user?.id ?? null;
  const [result,setResult] = useState<{userId:string|null;authorized:boolean;loading:boolean}>({
    userId,authorized:false,loading:!!userId,
  });
  useEffect(() => {
    let live=true;
    setResult({userId,authorized:false,loading:!!userId});
    if(!userId||!companyClient)return () => {live=false;};
    void Promise.resolve(companyClient.rpc('is_platform_admin'))
      .then(({data,error}) => {
        if(live)setResult({userId,authorized:!error&&data===true,loading:false});
      })
      .catch(() => {if(live)setResult({userId,authorized:false,loading:false});});
    return () => {live=false;};
  },[userId]);
  // Never render another account's cached authority even for one React frame.
  if(result.userId!==userId)return{authorized:false,loading:!!userId};
  return{authorized:result.authorized,loading:result.loading};
}
export const usePlatformAdmin = ():boolean => usePlatformAdminAccess().authorized;

/** Kept for old callers. Permission is now intentionally NOT cached. */
export function resetPlatformAdminCache():void {
  // Every auth-user change causes a server revalidation.
}
