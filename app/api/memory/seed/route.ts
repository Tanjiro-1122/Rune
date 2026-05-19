import { NextRequest, NextResponse } from "next/server";
import { seedSafeMemories } from "@/lib/memory";

function isAuthorized(req: NextRequest) {
  const seedToken = process.env.RUNE_MEMORY_SEED_TOKEN;
  if (!seedToken) return true;
  const provided = req.headers.get("x-rune-seed-token") ?? req.nextUrl.searchParams.get("token");
  return provided === seedToken;
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized seed request." }, { status: 401 });
  }

  const results = await seedSafeMemories();
  const failed = results.filter((result) => !result.ok);
  return NextResponse.json({
    ok: failed.length === 0,
    insertedOrUpdated: results.length - failed.length,
    failed,
  });
}
