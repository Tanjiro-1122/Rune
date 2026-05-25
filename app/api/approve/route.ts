export const maxDuration = 60;
import { getSupabaseClient } from "@/lib/supabase";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const { id, code } = await req.json();
  if (code !== "1122") return NextResponse.json({ error: "Invalid code" }, { status: 401 });
  const supabase = getSupabaseClient();
  if (!supabase) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  const { error } = await supabase
    .from("jarvis_repo_action_proposals")
    .update({
      status: "approved",
      approved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
