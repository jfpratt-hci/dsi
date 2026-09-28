import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

// Public values. The publishable key is safe in the browser; row level security guards the data.
export const SUPABASE_URL = 'https://fairfhgyrosjqualmhwu.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_1qg2GRUgxGxVMhOaoGGGFw_lm0j_j4h';

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' },
});
