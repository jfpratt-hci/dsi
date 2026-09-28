import type { Session } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { sb } from './supabase';

export type Profile = {
  id: string;
  display_name: string | null;
  division: string;
  sex: string;
  birth_year: number | null;
  bodyweight: number | null;
  roast_opt_in: boolean;
  tier: string;
  role: string;
};

type Ctx = { session: Session | null; me: Profile | null; ready: boolean; reloadMe: () => Promise<void> };
const SessionCtx = createContext<Ctx>({ session: null, me: null, ready: false, reloadMe: async () => {} });

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [me, setMe] = useState<Profile | null>(null);
  const [ready, setReady] = useState(false);

  const loadMe = useCallback(async (s: Session | null) => {
    if (!s) { setMe(null); return; }
    const { data } = await sb.from('profiles').select('*').eq('user_id', s.user.id).maybeSingle();
    setMe((data as Profile) ?? null);
  }, []);

  useEffect(() => {
    sb.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      await loadMe(data.session);
      setReady(true);
    });
    const { data: sub } = sb.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setTimeout(() => loadMe(s), 0);
    });
    return () => sub.subscription.unsubscribe();
  }, [loadMe]);

  return (
    <SessionCtx.Provider value={{ session, me, ready, reloadMe: () => loadMe(session) }}>
      {children}
    </SessionCtx.Provider>
  );
}

export const useSession = () => useContext(SessionCtx);
