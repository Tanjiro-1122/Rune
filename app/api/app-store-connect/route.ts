import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { logActionEvent } from "@/lib/action-events";
import { getAppStoreConnectReadOnlySummary } from "@/lib/app-store-connect-readonly";

const AppStoreConnectQuerySchema = z.object({
  appId: z.string().min(1).max(64).optional(),
});

export async function GET(req: NextRequest) {
  const parsed = AppStoreConnectQuerySchema.safeParse({
    appId: req.nextUrl.searchParams.get("appId") ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid App Store Connect appId query parameter." }, { status: 400 });
  }

  const result = await getAppStoreConnectReadOnlySummary(parsed.data.appId);

  await logActionEvent({
    eventType: result.ok ? "app_store_connect.inspected" : "app_store_connect.lookup_failed",
    summary: result.ok ? "App Store Connect inspected read-only" : "App Store Connect lookup failed read-only",
    status: result.ok ? "executed" : "failed",
    approvalStage: "findings",
    riskLevel: "low",
    projectKey: "unfiltr",
    metadata: {
      readOnly: true,
      configured: result.configured,
      appId: result.summary?.appId,
      buildCount: result.summary?.latestBuilds.length ?? 0,
      versionCount: result.summary?.latestVersions.length ?? 0,
      error: result.error,
    },
  });

  return NextResponse.json(result, { status: result.ok ? 200 : result.configured ? 502 : 503 });
}
