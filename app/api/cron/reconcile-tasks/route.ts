import { NextRequest, NextResponse } from "next/server";
import { reconcileWorkspaceTasks } from "@/lib/tasks";

export const dynamic = "force-dynamic";

function isAuthorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  return bearer === secret || req.nextUrl.searchParams.get("secret") === secret;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workspaceId = req.nextUrl.searchParams.get("workspaceId");
  const result = await reconcileWorkspaceTasks({
    workspaceId: workspaceId || undefined,
    maxAgeSeconds: 8,
    staleAgeMinutes: 15,
    limit: 100,
  });

  return NextResponse.json({ ok: true, result });
}
