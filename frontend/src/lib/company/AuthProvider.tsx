import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { COMPANY_ENABLED, companyClient } from './client';
import { createOrganization, loadMemberships } from './data';
import type { Membership } from './types';

interface CompanyAuth {
  enabled: boolean;
  loading: boolean;
  session: Session | null;
  user: User | null;
  memberships: Membership[];
  current: Membership | null;
  loadError: string;
  retry: () => void;
  selectOrg: (orgId: string) => void;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<{ needsConfirmation: boolean }>;
  signOut: () => Promise<void>;
  createOrg: (name: string) => Promise<void>;
}

const ORG_KEY = 'firbo-company-org';
const noop = async () => {};

const Ctx = createContext<CompanyAuth>({
  enabled: false,
  loading: false,
  session: null,
  user: null,
  memberships: [],
  current: null,
  loadError: '',
  retry: () => {},
  selectOrg: () => {},
  signIn: noop,
  signUp: async () => ({ needsConfirmation: false }),
  signOut: noop,
  createOrg: noop,
});

export const useCompanyAuth = () => useContext(Ctx);

function readStoredOrg(): string | null {
  try {
    return localStorage.getItem(ORG_KEY);
  } catch {
    return null;
  }
}

export function CompanyAuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(COMPANY_ENABLED);
  const [session, setSession] = useState<Session | null>(null);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [orgId, setOrgId] = useState<string | null>(readStoredOrg);
  const [loadError, setLoadError] = useState('');

  const userId = session?.user.id ?? null;

  useEffect(() => {
    if (!companyClient) return;
    let active = true;
    companyClient.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      if (!data.session) setLoading(false);
    });
    const { data: sub } = companyClient.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      if (!next) {
        setMemberships([]);
        setLoading(false);
      }
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!userId) return;
    setLoadError('');
    try {
      setMemberships(await loadMemberships(userId));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load your workspace');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    setLoading(true);
    void refresh();
  }, [userId, refresh]);

  const current = useMemo(
    () => memberships.find((m) => m.organization.id === orgId) ?? memberships[0] ?? null,
    [memberships, orgId],
  );

  const value = useMemo<CompanyAuth>(
    () => ({
      enabled: COMPANY_ENABLED,
      loading,
      session,
      user: session?.user ?? null,
      memberships,
      current,
      loadError,
      retry: () => {
        setLoading(true);
        void refresh();
      },
      selectOrg: (id) => {
        setOrgId(id);
        try {
          localStorage.setItem(ORG_KEY, id);
        } catch {
          /* storage unavailable */
        }
      },
      signIn: async (email, password) => {
        const { error } = await companyClient!.auth.signInWithPassword({ email, password });
        if (error) throw new Error(error.message);
      },
      signUp: async (email, password) => {
        const { data, error } = await companyClient!.auth.signUp({ email, password });
        if (error) throw new Error(error.message);
        return { needsConfirmation: !data.session };
      },
      signOut: async () => {
        await companyClient!.auth.signOut();
      },
      createOrg: async (name) => {
        const id = await createOrganization(name);
        setOrgId(id);
        await refresh();
      },
    }),
    [loading, session, memberships, current, loadError, refresh],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
