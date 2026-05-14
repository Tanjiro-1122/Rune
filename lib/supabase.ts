import { createClient, SupabaseClient } from "@supabase/supabase-js";

/**
 * Returns a fresh Supabase client for each call.
 *
 * In serverless environments a module-level cached client can leak
 * authentication context across requests. Creating a new client per call is
 * safe because Supabase clients don't open a persistent TCP connection — the
 * cost is negligible. Returns null when SUPABASE_URL or SUPABASE_ANON_KEY are
 * not configured so the app continues to work without persistence.
 */
export function getSupabaseClient(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_ANON_KEY?.trim();

  if (!url || !key) return null;

  return createClient(url, key, {
    auth: {
      // Disable automatic session management — we manage auth ourselves.
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: { "x-request-id": crypto.randomUUID() },
    },
  });
}

/**
 * No-op kept for backward compatibility.
 * Because `getSupabaseClient()` now creates a fresh client on every call there
 * is no module-level singleton to reset. Callers that previously called this
 * function (e.g. in tests) can continue to do so without error.
 */
export function resetSupabaseClient(): void {
  // intentional no-op
}
