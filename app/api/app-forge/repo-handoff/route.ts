import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAppForgeRepoHandoff } from "@/lib/app-forge";

export const dynamic = "force-dynamic";

const Schema = z.object({
  idea: z.string().min(8).max(1600),
  appName: z.string().max(80).optional().nullable(),
  targetUsers: z.string().max(180).optional().nullable(),
  platform: z.enum(["web", "mobile", "both"]).optional(),
  complexity: z.enum(["simple", "standard", "advanced"]).optional(),
  mustHaveFeatures: z.array(z.string().max(140)).max(8).optional(),
  preferredStack: z.string().max(240).optional().nullable(),
  owner: z.string().max(80).optional().nullable(),
  repo: z.string().max(180).optional().nullable(),
  visibility: z.enum(["private", "public"]).optional(),
});

function isOwnerAuthorized(req: NextRequest) {
  const secret = process.env.RUNE_DEPLOY_TOKEN || process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  const auth = req.headers.get("authorization") ?? "";
  return auth === `Bearer ${secret}`;
}

export async function POST(req: NextRequest) {
  if (!isOwnerAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid App Forge input.", details: parsed.error.flatten() }, { status: 400 });
  }

  return NextResponse.json(createAppForgeRepoHandoff(parsed.data));
}
