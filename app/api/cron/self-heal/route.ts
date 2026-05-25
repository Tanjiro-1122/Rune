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

  const { data: failures } = await supabase
    .from("rune_action_events")
    .select("event_type, summary, metadata")
    .eq("status", "failed")
    .gte("created_at", new Date(Date.now() - 60 * 60 * 1000).toISOString())
    .not("event_type", "like", "workspace_file%");

  if (!failures?.length) {
    return NextResponse.json({ ok: true, message: "No failures detected" });
  }

  const grouped = failures.reduce((acc: Record<string, number>, f: any) => {
    acc[f.event_type] = (acc[f.event_type] || 0) + 1;
    return acc;
  }, {});

  const repeated = Object.entries(grouped).filter(([, count]) => (count as number) >= 3);

  if (!repeated.length) {
    return NextResponse.json({ ok: true, message: "No repeated failures" });
  }

  await supabase.from("agent_memories").insert({
    kind: "alert",
    title: "Self-heal alert",
    content: `Repeated failures detected: ${repeated.map(([type, count]) => `${type} (${count}x)`).join(", ")}. Review and fix needed.`,
    project_key: "rune",
    priority: 95,
    is_active: true,
    source: "self-heal-cron",
  });

  return NextResponse.json({ ok: true, repeated });
}
