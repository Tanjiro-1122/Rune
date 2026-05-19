import { createClient, SupabaseClient } from "@supabase/supabase-js";

/**
 * Returns a fresh Supabase client for each server-side call.
 *
 * Rune manages authentication with its own password/session cookie, so all
 * Supabase access happens from trusted Next.js server routes. Prefer the
 * service-role key when it is available so private workspace writes are not
 * blocked by Supabase row-level security. Fall back to the anon key only for
 * local/dev setups that have not added a service key yet.
 */
export function getSupabaseClient(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL?.trim()?.replace(/\/rest\/v1\/?$/, '');
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    process.env.SUPABASE_ANON_KEY?.trim();

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
