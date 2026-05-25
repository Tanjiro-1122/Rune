import { getSupabaseClient } from "@/lib/supabase";
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const supabase = getSupabaseClient();
  if (!supabase) return NextResponse.json([]);

  const { searchParams } = new URL(req.url);
  const taskId       = searchParams.get("taskId");
  const includeSteps = searchParams.get("includeSteps") === "1";

  // ── Single task + steps mode ─────────────────────────────────────────────
  if (taskId && includeSteps) {
    const { data: steps, error } = await supabase
      .from("workspace_task_steps")
      .select("id, step_key, label, status, detail, order_index, started_at, completed_at")
      .eq("task_id", taskId)
      .order("order_index", { ascending: true });

    if (error) {
      console.error("[tasks-direct] steps error:", error.message);
      return NextResponse.json({ steps: [] });
    }
    return NextResponse.json({ steps: steps || [] });
  }

  // ── Single task metadata only ─────────────────────────────────────────────
  if (taskId) {
    const { data, error } = await supabase
      .from("workspace_tasks")
      .select("id, title, status, progress, result_summary, error_message, created_at, updated_at")
      .eq("id", taskId)
      .single();

    if (error) {
      console.error("[tasks-direct] single task error:", error.message);
      return NextResponse.json(null);
    }
    return NextResponse.json(data);
  }

  // ── Task list (default) ───────────────────────────────────────────────────
  const { data, error } = await supabase
    .from("workspace_tasks")
    .select("id, title, status, progress, result_summary, error_message, created_at, updated_at")
    .order("created_at", { ascending: false })
    .limit(30);

  if (error) {
    console.error("[tasks-direct] list error:", error.message);
    return NextResponse.json([]);
  }
  return NextResponse.json(data || []);
}
