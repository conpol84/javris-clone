import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Company workspace backend (auth + multi-tenant data). Deliberately separate
// from the legacy VITE_SUPABASE_* leaderboard variables in ../supabase.ts.
const url = import.meta.env.VITE_COMPANY_SUPABASE_URL ?? '';
const key = import.meta.env.VITE_COMPANY_SUPABASE_PUBLISHABLE_KEY ?? '';

/** When false the app behaves exactly like upstream OpenJarvis (no login). */
export const COMPANY_ENABLED = url.length > 0 && key.length > 0;

export const companyClient: SupabaseClient | null = COMPANY_ENABLED
  ? createClient(url, key)
  : null;

export function requireClient(): SupabaseClient {
  if (!companyClient) throw new Error('Company workspace is not configured');
  return companyClient;
}
