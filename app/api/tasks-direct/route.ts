import { getSupabaseClient } from "@/lib/supabase";
import { NextResponse } from "next/server";

export const maxDuration = 30;

export async function GET() {
  const supabase = getSupabaseClient();
  if (!supabase) return NextResponse.json([]);
  const { data, error } = await supabase
    .from("workspace_tasks")
    .select("id, title, status, progress, result_summary, error_message, created_at")
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) {
    console.error("[tasks-direct] Supabase error:", error.message);
    return NextResponse.json([]);
  }
  return NextResponse.json(data || []);
}
