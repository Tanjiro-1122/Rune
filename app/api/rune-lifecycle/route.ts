/**
 * /api/rune-lifecycle
 * Owner-only endpoint that executes the full Rune PR lifecycle.
 * Called internally by Rune's chat tools when APPROVE RUNE: <task> is detected.
 *
 * POST body: LifecyclePROptions
 * Returns: LifecycleResult (streamed progress + final result)
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/session";
import { runLifecycle, rollbackProduction, type LifecyclePROptions } from "@/lib/rune-lifecycle";

function isOwner(req: NextRequest): boolean {
  // Must be authenticated as owner (signed v2 cookie) OR carry internal bearer token
  const internalToken = process.env.RUNE_INTERNAL_TOKEN?.trim();
  const auth = req.headers.get("authorization");
  if (internalToken && auth === `Bearer ${internalToken}`) return true;
  return false;
}

async function isOwnerSession(req: NextRequest): Promise<boolean> {
  if (isOwner(req)) return true;
  try {
    const session = await getServerSession();
    return session?.isOwner === true;
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  const authorized = await isOwnerSession(req);
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
