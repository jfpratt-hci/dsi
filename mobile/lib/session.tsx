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
  terms_accepted_at: string | null;
};

type Ctx = {
  session: Session | null;
  me: Profile | null;
  ready: boolean;
  isPro: boolean;
  isStaff: boolean;
  blocked: Set<string>;
  reloadMe: () => Promise<void>;
  reloadBlocks: () => Promise<void>;
};
const SessionCtx = createContext<Ctx>({
  session: null, me: null, ready: false, isPro: false, isStaff: false, blocked: new Set(),
  reloadMe: async () => {}, reloadBlocks: async () => {},
});

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [me, setMe] = useState<Profile | null>(null);
  const [blocked, setBlocked] = useState<Set<string>>(new Set());
  const [ready, setReady] = useState(false);

  const loadBlocks = useCallback(async (pid: string | null) => {
    if (!pid) { setBlocked(new Set()); return; }
    const { data } = await sb.from('blocks').select('blocked').eq('blocker', pid);
    setBlocked(new Set((data ?? []).map((b: any) => b.blocked)));
  }, []);

  const loadMe = useCallback(async (s: Session | null) => {
    if (!s) { setMe(null); setBlocked(new Set()); return; }
    const { data } = await sb.from('profiles').select('*').eq('user_id', s.user.id).maybeSingle();
    setMe((data as Profile) ?? null);
    await loadBlocks(data?.id ?? null);
  }, [loadBlocks]);

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

  const isStaff = !!me && (me.role === 'admin' || me.role === 'commissioner');
  const isPro = !!me && (me.tier === 'pro' || isStaff);

  return (
    <SessionCtx.Provider value={{
      session, me, ready, isPro, isStaff, blocked,
      reloadMe: () => loadMe(session), reloadBlocks: () => loadBlocks(me?.id ?? null),
    }}>
      {children}
    </SessionCtx.Provider>
  );
}

export const useSession = () => useContext(SessionCtx);
