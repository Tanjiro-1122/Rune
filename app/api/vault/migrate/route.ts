import { NextResponse } from "next/server";

/**
 * One-time Base44 vault migration endpoint retired after Supabase migration.
 *
 * Rune must not call Base44 at runtime. Keep this route as an explicit 410 so
 * stale automation cannot silently reintroduce Base44 reads or credential use.
 */
export async function POST() {
  return NextResponse.json(
    {
      error: "vault_migration_retired",
      message: "The Base44 vault migration route is retired. Use Supabase-native vault tables and migration artifacts only.",
    },
    { status: 410 }
  );
}
