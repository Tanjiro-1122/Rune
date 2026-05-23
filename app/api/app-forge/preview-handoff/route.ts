import { NextResponse } from "next/server";
import { createAppForgePreviewHandoff } from "@/lib/app-forge";

function authorized(request: Request) {
  const token = process.env.RUNE_DEPLOY_TOKEN || process.env.JARVIS_DEPLOY_TOKEN || process.env.RUNE_OWNER_TOKEN;
  if (!token) return false;
  const header = request.headers.get("authorization") || "";
  return header === `Bearer ${token}`;
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  return NextResponse.json(createAppForgePreviewHandoff(body));
}
