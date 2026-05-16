import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAppHealthSnapshot } from "@/lib/app-health-snapshot";

const AppHealthQuerySchema = z.object({
  projectKey: z.string().min(1).max(64).optional(),
  repo: z.string().min(1).max(180).optional(),
  revenueCatAppUserId: z.string().min(1).max(180).optional(),
  appStoreAppId: z.string().min(1).max(64).optional(),
  googlePlayPackageName: z.string().min(1).max(220).optional(),
});

export async function GET(req: NextRequest) {
  const parsed = AppHealthQuerySchema.safeParse({
    projectKey: req.nextUrl.searchParams.get("projectKey") ?? undefined,
    repo: req.nextUrl.searchParams.get("repo") ?? undefined,
    revenueCatAppUserId: req.nextUrl.searchParams.get("revenueCatAppUserId") ?? undefined,
    appStoreAppId: req.nextUrl.searchParams.get("appStoreAppId") ?? undefined,
    googlePlayPackageName: req.nextUrl.searchParams.get("googlePlayPackageName") ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid app health query parameters." }, { status: 400 });
  }

  const snapshot = await getAppHealthSnapshot(parsed.data);
  return NextResponse.json(snapshot);
}
