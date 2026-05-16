import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { logActionEvent } from "@/lib/action-events";
import { getRevenueCatSubscriberReadOnly } from "@/lib/revenuecat-readonly";

const RevenueCatQuerySchema = z.object({
  appUserId: z.string().min(1).max(180),
});

export async function GET(req: NextRequest) {
  const parsed = RevenueCatQuerySchema.safeParse({
    appUserId: req.nextUrl.searchParams.get("appUserId") ?? "",
  });

  if (!parsed.success) {
    return NextResponse.json({ error: "A valid RevenueCat appUserId query parameter is required." }, { status: 400 });
  }

  const result = await getRevenueCatSubscriberReadOnly(parsed.data.appUserId);

  await logActionEvent({
    eventType: result.ok ? "revenuecat.subscriber_inspected" : "revenuecat.subscriber_lookup_failed",
    summary: result.ok ? "RevenueCat subscriber inspected read-only" : "RevenueCat subscriber lookup failed read-only",
    status: result.ok ? "executed" : "failed",
    approvalStage: "findings",
    riskLevel: "low",
    projectKey: "unfiltr",
    metadata: {
      readOnly: true,
      configured: result.configured,
      appUserIdPreview: `${parsed.data.appUserId.slice(0, 6)}…`,
      entitlementCount: result.subscriber?.entitlements.length ?? 0,
      subscriptionCount: result.subscriber?.subscriptions.length ?? 0,
      error: result.error,
    },
  });

  return NextResponse.json(result, { status: result.ok ? 200 : result.configured ? 502 : 503 });
}
