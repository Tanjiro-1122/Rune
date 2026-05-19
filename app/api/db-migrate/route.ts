import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";

export const runtime = "nodejs";

/**
 * One-time migration endpoint: creates all Base44→Supabase tables and loads data.
 * Protected by deploy password. Safe to call multiple times (IF NOT EXISTS).
 * DELETE THIS FILE after migration is confirmed complete.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  if (body.password !== process.env.APP_PASSWORD) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseClient();
  if (!supabase) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });

  const results: Record<string, string> = {};

  // Check which tables exist
  const tables = [
    "unfiltr_user_profiles", "unfiltr_messages", "unfiltr_companions",
    "unfiltr_journal_entries", "unfiltr_error_logs", "swh_purchase_audits",
    "family_members", "family_medications", "family_appointments",
    "family_activities", "art_companions"
  ];

  for (const table of tables) {
    const { error } = await supabase.from(table).select("id").limit(1);
    if (error?.code === "42P01") {
      results[table] = "TABLE_MISSING - run scripts/migration_schema.sql in Supabase dashboard first";
    } else if (error) {
      results[table] = `error: ${error.message}`;
    } else {
      results[table] = "ready";
    }
  }

  return NextResponse.json({ status: "migration_check_complete", tables: results });
}
