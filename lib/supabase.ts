import { createClient, SupabaseClient } from "@supabase/supabase-js";

let _client: SupabaseClient | null = null;

/**
 * Returns a Supabase client for server-side use.
 *
 * The client is cached after first construction so repeated calls within the
 * same serverless invocation are cheap.  Returns null when SUPABASE_URL or
 * SUPABASE_ANON_KEY are not configured so the app continues to work without
 * persistence.
 */
export function getSupabaseClient(): SupabaseClient | null {
  if (_client) return _client;

  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_ANON_KEY?.trim();

  if (!url || !key) return null;

  _client = createClient(url, key, {
    auth: {
      // Disable automatic session management — we manage auth ourselves.
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  return _client;
}

/**
 * Reset the cached Supabase client.
 * Useful in tests or when env vars change between invocations.
 */
export function resetSupabaseClient(): void {
  _client = null;
}
