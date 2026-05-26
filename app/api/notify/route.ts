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
      read: false,
      metadata: proposalId ? { proposalId } : {},
      created_at: new Date().toISOString(),
    });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}

/** GET — poll for unread notifications, mark them read after fetching */
export async function GET(req: NextRequest) {
  try {
    const since = req.nextUrl.searchParams.get("since") ?? new Date(0).toISOString();

    const supabase = getSupabaseClient();
    if (!supabase) return NextResponse.json({ items: [] });

    // Fetch unread rows newer than since
    const { data } = await supabase
      .from("rune_outbox")
      .select("id, type, title, body, metadata, created_at")
      .eq("read", false)
      .gt("created_at", since)
      .order("created_at", { ascending: true })
      .limit(20);

    const items = data ?? [];

    // Mark fetched rows as read
    if (items.length > 0) {
      const ids = items.map((n: any) => n.id);
      await supabase
        .from("rune_outbox")
        .update({ read: true })
        .in("id", ids);
    }

    return NextResponse.json({ items });
  } catch {
    return NextResponse.json({ items: [] });
  }
}
