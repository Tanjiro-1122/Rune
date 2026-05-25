import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";

export const maxDuration = 30;

/** POST — save a notification to rune_outbox */
export async function POST(req: NextRequest) {
  try {
    const { type, title, body, proposalId } = await req.json();

    const supabase = getSupabaseClient();
    if (!supabase) return NextResponse.json({ error: "No Supabase" }, { status: 500 });

    await supabase.from("rune_outbox").insert({
      type: type ?? "info",
      title: title ?? "Rune",
      body: body ?? "",
      metadata: proposalId ? { proposalId } : {},
      created_at: new Date().toISOString(),
    });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}

/** GET — poll for new notifications since a timestamp */
export async function GET(req: NextRequest) {
  try {
    const since = req.nextUrl.searchParams.get("since") ?? new Date(0).toISOString();

    const supabase = getSupabaseClient();
    if (!supabase) return NextResponse.json({ items: [] });

    const { data } = await supabase
      .from("rune_outbox")
      .select("id, type, title, body, metadata, created_at")
      .gt("created_at", since)
      .order("created_at", { ascending: true })
      .limit(10);

    return NextResponse.json({ items: data ?? [] });
  } catch {
    return NextResponse.json({ items: [] });
  }
}
