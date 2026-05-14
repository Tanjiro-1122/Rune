import { NextRequest, NextResponse } from "next/server";
import { getBuildIntelligenceSnapshot } from "@/lib/build-intelligence";

export async function GET(req: NextRequest) {
  const projectKey = req.nextUrl.searchParams.get("projectKey") ?? "jarvis";
  const repo = req.nextUrl.searchParams.get("repo") ?? undefined;
  const snapshot = await getBuildIntelligenceSnapshot({ projectKey, repo });
  return NextResponse.json(snapshot);
}
