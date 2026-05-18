/**
 * /api/cron/daily-briefing
 * Called by Vercel Cron at 9:00 AM ET every day.
 * 1. Runs the operator briefing
 * 2. Stores result in Supabase
 * 3. Pushes a Web Push notification to all subscribed devices
 *
 * Protected by CRON_SECRET (Vercel sets this automatically).
 */
import { NextRequest, NextResponse } from "next/server";
import { getDailyOperatorBriefing } from "@/lib/operator-briefing";
import { getSupabaseClient } from "@/lib/supabase";
import { sendPushNotificationsToAll } from "@/lib/push-notify";

function isAuthorizedCron(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers.get("authorization");
  return auth === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    console.log("[cron/daily-briefing] starting at", new Date().toISOString());

    // 1. Run the briefing
    const briefing = await getDailyOperatorBriefing();

    // 2. Store in Supabase for Jarvis to recall
    const supabase = getSupabaseClient();
    if (supabase) await supabase.from("daily_briefings").insert({
      generated_at: briefing.generatedAt,
      overall_status: briefing.overallStatus,
      headline: briefing.headline,
      recommended_next_action: briefing.recommendedNextAction,
      briefing_json: briefing,
    }).then(({ error }: { error: { message: string } | null }) => {
      if (error) console.error("[cron/daily-briefing] supabase store error", error.message);
    });

    // 3. Build push notification message
    const statusEmoji =
      briefing.overallStatus === "healthy" ? "✅" :
      briefing.overallStatus === "warning" ? "⚠️" :
      "🚨";

    const projectLine = briefing.projects
      .slice(0, 2)
      .map((p) => `${p.key}: ${p.healthStatus}`)
      .join(" · ");

    const pushPayload = {
      title: `Jarvis Morning Briefing ${statusEmoji}`,
      body: briefing.headline + (projectLine ? `\n${projectLine}` : ""),
      url: "/?view=briefing",
    };

    // 4. Send push to all subscribed devices
    const pushResult = await sendPushNotificationsToAll(pushPayload);
    console.log("[cron/daily-briefing] push result", pushResult);

    return NextResponse.json({
      ok: true,
      generatedAt: briefing.generatedAt,
      overallStatus: briefing.overallStatus,
      headline: briefing.headline,
      pushResult,
    });
  } catch (err) {
    console.error("[cron/daily-briefing] error", err);
    return NextResponse.json({ error: "Briefing generation failed.", detail: String(err) }, { status: 500 });
  }
}
