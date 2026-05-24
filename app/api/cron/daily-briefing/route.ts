/**
 * /api/cron/daily-briefing
 * Called by Vercel Cron at 9:00 AM ET every day.
 * 1. Runs the operator briefing
 * 2. Fetches RevenueCat MRR + subscriber counts
 * 3. Fetches OpenAI spend
 * 4. Stores result summary in Supabase agent_memories for trend tracking
 * 5. Sends a structured WhatsApp-style push notification
 *
 * Protected by CRON_SECRET (Vercel sets this automatically).
 */
import { NextRequest, NextResponse } from "next/server";
import { getDailyOperatorBriefing } from "@/lib/operator-briefing";
import { getSupabaseClient } from "@/lib/supabase";
import { sendPushNotificationsToAll } from "@/lib/push-notify";
import { getRevenueCatOverview } from "@/lib/revenuecat-overview";
import { buildWhatsAppBriefingMessage } from "@/lib/whatsapp-briefing";
import { getCrossAppIntelligence } from "@/lib/cross-app-intelligence";
import { writeOperatorDecisionMemory } from "@/lib/operator-decision-memory";

function isAuthorizedCron(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers.get("authorization");
  return auth === `Bearer ${secret}`;
}

async function getOpenAiSpendThisMonth(): Promise<number | null> {
  const key = process.env.OPENAI_ADMIN_KEY?.trim();
  if (!key) return null;
  try {
    const now = new Date();
    const startDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    const endDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const res = await fetch(
      `https://api.openai.com/v1/organization/costs?start_time=${startDate}&end_time=${endDate}&limit=1`,
      { headers: { Authorization: `Bearer ${key}`, Accept: "application/json" }, cache: "no-store" }
    );
    if (!res.ok) return null;
    const data = await res.json();
    // sum all buckets
    const total = (data?.data ?? []).reduce((sum: number, bucket: { results?: Array<{ amount?: { value?: number } }> }) => {
      const bucketTotal = (bucket.results ?? []).reduce((s: number, r) => s + (r?.amount?.value ?? 0), 0);
      return sum + bucketTotal;
    }, 0);
    return total > 0 ? Math.round(total * 100) / 100 : null;
  } catch {
    return null;
  }
}

async function getPreviousHealthScore(supabase: ReturnType<typeof getSupabaseClient>): Promise<number | null> {
  if (!supabase) return null;
  try {
    const { data } = await supabase
      .from("agent_memories")
      .select("content")
      .eq("title", "rune-daily-briefing-score")
      .eq("project_key", "rune")
      .eq("is_active", true)
      .single();
    if (!data?.content) return null;
    const parsed = JSON.parse(data.content);
    return typeof parsed.score === "number" ? parsed.score : null;
  } catch {
    return null;
  }
}

async function saveTodayHealthScore(
  supabase: ReturnType<typeof getSupabaseClient>,
  score: number | null
) {
  if (!supabase || score === null) return;
  try {
    await supabase.from("agent_memories").upsert(
      {
        kind: "note",
        title: "rune-daily-briefing-score",
        content: JSON.stringify({ score, date: new Date().toISOString() }),
        project_key: "rune",
        tags: ["briefing", "health-score", "trend"],
        priority: 3,
        is_active: true,
        source: "cron",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "title,project_key" }
    );
  } catch {
    // non-fatal
  }
}

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    console.log("[cron/daily-briefing] starting at", new Date().toISOString());

    const supabase = getSupabaseClient();

    // Run all data fetches in parallel
    const [briefing, rc, openAiSpend, previousScore, intelligence] = await Promise.all([
      getDailyOperatorBriefing(),
      getRevenueCatOverview(),
      getOpenAiSpendThisMonth(),
      getPreviousHealthScore(supabase),
      getCrossAppIntelligence(false),
    ]);

    // Compute avg operator readiness for trend tracking.
    // This intentionally uses the briefing-specific readiness score instead of raw app-health scores,
    // so stale CI and optional store-credential visibility do not masquerade as production outages.
    const projectScores = briefing.projects
      .map((p) => p.operatorReadinessScore ?? p.healthScore)
      .filter((s): s is number => s !== null);
    const avgScore = projectScores.length
      ? Math.round(projectScores.reduce((a, b) => a + b, 0) / projectScores.length)
      : null;

    // Save today's score for tomorrow's trend
    await saveTodayHealthScore(supabase, avgScore);

    // Save the top operator decision as compact long-term memory.
    // This is intentionally in the cron path, not the read-only briefing GET route.
    const decisionMemory = await writeOperatorDecisionMemory({
      briefingGeneratedAt: briefing.generatedAt,
      overallStatus: briefing.overallStatus,
      priorityDecisionBrief: briefing.priorityDecisionBrief,
    }).catch((error) => {
      console.warn("[cron/daily-briefing] decision memory writeback failed:", error);
      return { ok: false, error: String(error) };
    });

    // Build the structured WhatsApp message
    const message = buildWhatsAppBriefingMessage({ briefing, rc, previousScore, openAiSpend });

    // Save briefing to briefing_log for history
  try {
    await supabase
      ?.from("briefing_log")
      .insert({ content: message, sent_via: "whatsapp" });
  } catch (logErr) {
    console.warn("[cron/daily-briefing] briefing_log insert failed:", logErr);
  }

  // Send push notification with structured message
    const statusEmoji =
      briefing.overallStatus === "healthy" ? "✅" :
      briefing.overallStatus === "warning" ? "⚠️" : "🚨";

    const pushResult = await sendPushNotificationsToAll({
      title: `Rune Morning Briefing ${statusEmoji}`,
      body: message.slice(0, 500),
      url: "/?view=briefing",
    });

    console.log("[cron/daily-briefing] done", { avgScore, rcOk: rc.ok, openAiSpend, pushResult });

    return NextResponse.json({
      ok: true,
      generatedAt: briefing.generatedAt,
      overallStatus: briefing.overallStatus,
      avgHealthScore: avgScore,
      previousScore,
      rc: { ok: rc.ok, mrr: rc.mrr, activeSubscribers: rc.activeSubscribers },
      openAiSpend,
      message,
      pushResult,
      decisionMemory,
      weeklyHighlight: intelligence.weeklyHighlight,
      crossAppInsight: intelligence.crossAppInsight,
    });
  } catch (err) {
    console.error("[cron/daily-briefing] error", err);
    return NextResponse.json({ error: "Briefing generation failed.", detail: String(err) }, { status: 500 });
  }
}
