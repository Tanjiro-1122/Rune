import { NextResponse } from "next/server";
import { getDailyOperatorBriefing } from "@/lib/operator-briefing";

export async function GET() {
  const briefing = await getDailyOperatorBriefing();
  return NextResponse.json(briefing);
}
