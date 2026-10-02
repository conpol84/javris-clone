import { useEffect, useState } from 'react';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { companyClient, requireClient } from './client';

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
  return data as AdminOverview;
}

let cached: Promise<boolean> | null = null;

/** Is the signed-in user a Firbo platform administrator? (Server-checked; the UI only hides what they cannot use.) */
export function usePlatformAdmin(): boolean {
  const [admin, setAdmin] = useState(false);
  useEffect(() => {
    if (!companyClient) return;
    cached ??= Promise.resolve(companyClient.rpc('is_platform_admin')).then(({ data }) => data === true).catch(() => false);
    let live = true;
    void cached.then((v) => live && setAdmin(v));
    return () => {
      live = false;
    };
  }, []);
  return admin;
}

export function resetPlatformAdminCache(): void {
  cached = null;
}
