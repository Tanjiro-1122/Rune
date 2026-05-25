import { NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";

export const maxDuration = 60;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseClient();
  if (!supabase) return NextResponse.json({ error: "No Supabase" }, { status: 500 });

  const [proposals, tasks, events] = await Promise.all([
    supabase
      .from("jarvis_repo_action_proposals")
      .select("title, status, repo, updated_at")
      .in("status", ["proposed", "approved"])
      .order("updated_at", { ascending: false })
      .limit(5),
    supabase
      .from("workspace_tasks")
      .select("title, status, progress, error_message")
      .eq("status", "failed")
      .order("created_at", { ascending: false })
      .limit(5),
    supabase
      .from("rune_action_events")
      .select("event_type, summary, status, project_key")
      .not("event_type", "like", "workspace_file%")
      .eq("status", "failed")
      .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .limit(5),
  ]);

  const pendingProposals = proposals.data ?? [];
  const failedTasks      = tasks.data ?? [];
  const failedEvents     = events.data ?? [];

  const lines = [
    `Morning briefing — ${new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}`,
    "",
    pendingProposals.length
      ? `📋 ${pendingProposals.length} pending repo proposals: ${pendingProposals.map((p: any) => p.title).join(", ")}`
      : "📋 No pending proposals",
    failedTasks.length
      ? `⚠️ ${failedTasks.length} failed tasks: ${failedTasks.map((t: any) => t.title).join(", ")}`
      : "✅ No failed tasks",
    failedEvents.length
      ? `🔴 ${failedEvents.length} system errors in last 24h: ${failedEvents.map((e: any) => e.summary).join(", ")}`
      : "🟢 No system errors in last 24h",
  ];

  const content = lines.join("\n");

  await supabase.from("agent_memories").insert({
    kind: "briefing",
    title: "Morning briefing",
    content,
    project_key: "rune",
    priority: 90,
    is_active: true,
    source: "cron",
  });

  return NextResponse.json({ ok: true, briefing: content });
}
