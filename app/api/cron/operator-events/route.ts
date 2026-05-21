import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { runOperatorEventQueueHealthSweep } from "@/lib/operator-event-queue";

export const dynamic = "force-dynamic";

const QuerySchema = z.object({
  workspaceId: z.string().uuid().optional(),
  projects: z.string().max(240).optional(),
});

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

  const parsed = QuerySchema.safeParse({
    workspaceId: req.nextUrl.searchParams.get("workspaceId") ?? undefined,
    projects: req.nextUrl.searchParams.get("projects") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid operator event query.", details: parsed.error.flatten() }, { status: 400 });
  }

  const projectKeys = parsed.data.projects
    ?.split(",")
    .map((project) => project.trim())
    .filter(Boolean)
    .slice(0, 8);

  const result = await runOperatorEventQueueHealthSweep({
    projectKeys,
    workspaceId: parsed.data.workspaceId ?? null,
  });

  return NextResponse.json(result);
}
