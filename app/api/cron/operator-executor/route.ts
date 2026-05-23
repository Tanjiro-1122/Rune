import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseClient } from "@/lib/supabase";
import { runOperatorExecutorBridge } from "@/lib/operator-executor";

export const dynamic = "force-dynamic";

const QuerySchema = z.object({
  workspaceId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(5).optional(),
});

function isAuthorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  return bearer === secret || req.nextUrl.searchParams.get("secret") === secret;
}

function getDefaultWorkspaceId(input?: string | null) {
  return input || process.env.RUNE_DEFAULT_WORKSPACE_ID || process.env.JARVIS_DEFAULT_WORKSPACE_ID || null;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = QuerySchema.safeParse({
    workspaceId: req.nextUrl.searchParams.get("workspaceId") ?? undefined,
    limit: req.nextUrl.searchParams.get("limit") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid operator executor query.", details: parsed.error.flatten() }, { status: 400 });
  }

  const workspaceId = getDefaultWorkspaceId(parsed.data.workspaceId ?? null);
  if (!workspaceId) {
    return NextResponse.json({ ok: false, configured: false, message: "RUNE_DEFAULT_WORKSPACE_ID is required for unattended executor cron." }, { status: 200 });
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    return NextResponse.json({ ok: false, configured: false, message: "Supabase is not configured." }, { status: 200 });
  }

  const limit = parsed.data.limit ?? 2;
  const { data, error } = await supabase
    .from("workspace_tasks")
    .select("id, runner_metadata, title, created_at")
    .eq("workspace_id", workspaceId)
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(25);

  if (error) {
    return NextResponse.json({ ok: false, configured: true, message: error.message }, { status: 500 });
  }

  const eligible = (data ?? [])
    .filter((task) => {
      const metadata = task.runner_metadata as Record<string, unknown> | null;
      return metadata?.executor === "operator_executor_bridge_v3" && metadata?.approvalRequired !== true;
    })
    .slice(0, limit);

  const results = [];
  for (const task of eligible) {
    results.push(await runOperatorExecutorBridge({
      taskId: task.id,
      workspaceId,
      runnerId: `operator-executor-cron-${Date.now()}-${String(task.id).slice(0, 8)}`,
      openPrIfApproved: false,
      trackPrIfOpened: false,
      maxAttempts: 2,
    }));
  }

  return NextResponse.json({
    ok: true,
    configured: true,
    eligibleTaskIds: eligible.map((task) => task.id),
    results,
    message: results.length
      ? `Advanced ${results.length} safe queued operator task(s). Merge, deploy, PR creation, payments, database migrations, and external account changes remain gated.`
      : "No eligible queued operator executor tasks found.",
  });
}
