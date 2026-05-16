import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { logActionEvent } from "@/lib/action-events";
import { getGooglePlayReadOnlySummary } from "@/lib/google-play-readonly";

const GooglePlayQuerySchema = z.object({
  packageName: z.string().min(1).max(220).optional(),
});

export async function GET(req: NextRequest) {
  const parsed = GooglePlayQuerySchema.safeParse({
    packageName: req.nextUrl.searchParams.get("packageName") ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid Google Play packageName query parameter." }, { status: 400 });
  }

  const result = await getGooglePlayReadOnlySummary(parsed.data.packageName);

  await logActionEvent({
    eventType: result.ok ? "google_play.inspected" : "google_play.lookup_failed",
    summary: result.ok ? "Google Play inspected read-only" : "Google Play lookup failed read-only",
    status: result.ok ? "executed" : "failed",
    approvalStage: "findings",
    riskLevel: "low",
    projectKey: "unfiltr",
    metadata: {
      readOnly: true,
      configured: result.configured,
      packageName: result.summary?.packageName,
      reviewCount: result.summary?.reviews.length ?? 0,
      subscriptionCount: result.summary?.subscriptions.length ?? 0,
      inAppProductCount: result.summary?.inAppProducts.length ?? 0,
      blockedCapabilities: result.summary?.blockedCapabilities.map((item) => item.name) ?? [],
      error: result.error,
    },
  });

  return NextResponse.json(result, { status: result.ok ? 200 : result.configured ? 502 : 503 });
}
