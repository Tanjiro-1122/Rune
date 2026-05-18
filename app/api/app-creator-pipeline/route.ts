/**
 * /api/app-creator-pipeline
 * Owner-only endpoint for the Rune App Creator Pipeline.
 * POST body: PipelineInput
 */
import { NextRequest, NextResponse } from "next/server";
import { getSessionSecret, verifySessionCookie, SESSION_COOKIE } from "@/lib/auth";
import { runAppCreatorPipeline, type PipelineInput } from "@/lib/app-creator-pipeline";

async function isOwnerRequest(req: NextRequest): Promise<boolean> {
  const internalToken = process.env.RUNE_INTERNAL_TOKEN?.trim();
  const auth = req.headers.get("authorization");
  if (internalToken && auth === `Bearer ${internalToken}`) return true;
  const secret = getSessionSecret();
  if (!secret) return false;
  const cookieValue =
    req.cookies?.get?.(SESSION_COOKIE)?.value ??
    req.headers.get("cookie")?.split(";").map((p) => p.trim())
      .find((p) => p.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
  const result = await verifySessionCookie(cookieValue, secret);
  return result.ok;
}

export async function POST(req: NextRequest) {
  if (!(await isOwnerRequest(req))) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  let body: Partial<PipelineInput>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  if (!body.idea && body.stage !== "status") {
    return NextResponse.json({ error: "idea is required." }, { status: 400 });
  }
  const result = await runAppCreatorPipeline(body as PipelineInput);
  return NextResponse.json(result, { status: result.ok ? 200 : 422 });
}

export async function GET() {
  return NextResponse.json({ error: "Use POST." }, { status: 405 });
}
