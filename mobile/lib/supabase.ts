import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';

// Same project the website uses. The publishable key is safe in the app; row level security guards the data.
export const SUPABASE_URL = 'https://fairfhgyrosjqualmhwu.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_1qg2GRUgxGxVMhOaoGGGFw_lm0j_j4h';

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    storage: Platform.OS === 'web' ? undefined : AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: Platform.OS === 'web',
  },
});
