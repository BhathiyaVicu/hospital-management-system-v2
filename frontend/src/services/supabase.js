import { createClient } from '@supabase/supabase-js';

let supabase;

export function getSupabaseClient() {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error('Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in the frontend environment.');
  }
  if (!supabase) {
    supabase = createClient(url, anonKey, {
      auth: {
        flowType: 'pkce',
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: true,
      },
    });
  }
  return supabase;
}
