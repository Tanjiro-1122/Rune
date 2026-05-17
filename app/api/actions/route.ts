import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { listActionEvents, logActionEvent } from "@/lib/action-events";
import { resolveOwnerSessionId } from "@/lib/owner-session";

const ActionSchema = z.object({
  eventType: z.string().min(1).max(120),
  summary: z.string().min(1).max(500),
  status: z.enum(["proposed", "approved", "executed", "blocked", "failed", "info"]).optional(),
  approvalStage: z.enum(["none", "findings", "plan", "approval", "action", "complete"]).optional(),
  riskLevel: z.enum(["low", "medium", "high"]).optional(),
  projectKey: z.string().max(80).nullable().optional(),
  sessionId: z.string().max(120).nullable().optional(),
  workspaceId: z.string().uuid().nullable().optional(),
  conversationId: z.string().uuid().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export async function GET(req: NextRequest) {
  const projectKey = req.nextUrl.searchParams.get("projectKey") ?? undefined;
  const clientSessionId = req.nextUrl.searchParams.get("sessionId") ?? undefined;
  const sessionId = await resolveOwnerSessionId(req, clientSessionId);
  const events = await listActionEvents({ projectKey, sessionId, limit: 50 });
  return NextResponse.json({ events });
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = ActionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid action event data.", details: parsed.error.flatten() }, { status: 400 });
  }

  const sessionId = await resolveOwnerSessionId(req, parsed.data.sessionId ?? null);
  const result = await logActionEvent({ ...parsed.data, sessionId });
  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? "Failed to log action event." }, { status: 500 });
  }

  return NextResponse.json(result, { status: 201 });
}
