/**
 * /api/rune-lifecycle
 * Owner-only endpoint that executes the full Rune PR lifecycle.
 * Called internally by Rune when APPROVE RUNE: <task> is detected.
 *
 * POST body: LifecyclePROptions | { rollback: true }
 * Returns: LifecycleResult
 */
import { NextRequest, NextResponse } from "next/server";
import { getSessionSecret, verifySessionCookie, SESSION_COOKIE } from "@/lib/auth";
import { runLifecycle, rollbackProduction, type LifecyclePROptions } from "@/lib/rune-lifecycle";

async function isOwnerRequest(req: NextRequest): Promise<boolean> {
  // Option 1: internal bearer token (used by cron / agent calls)
  const internalToken = process.env.RUNE_INTERNAL_TOKEN?.trim();
  const auth = req.headers.get("authorization");
  if (internalToken && auth === `Bearer ${internalToken}`) return true;

  // Option 2: valid signed session cookie (browser login)
  const secret = getSessionSecret();
  if (!secret) return false;
  const cookieValue =
    req.cookies?.get?.(SESSION_COOKIE)?.value ??
    req.headers
      .get("cookie")
      ?.split(";")
      .map((p) => p.trim())
      .find((p) => p.startsWith(`${SESSION_COOKIE}=`))
      ?.slice(SESSION_COOKIE.length + 1);
  const result = await verifySessionCookie(cookieValue, secret);
  return result.ok;
}

export async function POST(req: NextRequest) {
  const authorized = await isOwnerRequest(req);
  if (!authorized) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  // Rollback shortcut
  if (body && typeof body === "object" && (body as Record<string, unknown>).rollback === true) {
    const result = await rollbackProduction();
    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  }

  // Validate lifecycle options
  const opts = body as Partial<LifecyclePROptions>;
  if (!opts.taskSlug || !opts.title || !opts.files?.length || !opts.commitMessage) {
    return NextResponse.json(
      { error: "Missing required fields: taskSlug, title, files, commitMessage" },
      { status: 400 }
    );
  }

  const result = await runLifecycle(opts as LifecyclePROptions);
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

export async function GET() {
  return NextResponse.json({ error: "Use POST." }, { status: 405 });
}
