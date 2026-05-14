import { NextResponse } from "next/server";
import { getDeployHealthSnapshot } from "@/lib/deploy-health";

export async function GET() {
  const snapshot = await getDeployHealthSnapshot();
  return NextResponse.json(snapshot);
}
