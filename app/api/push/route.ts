/**
 * /api/push
 * Stores and retrieves Web Push subscriptions in Supabase.
 * POST  { subscription: PushSubscription }  — save/update a subscription
 * DELETE { endpoint: string }               — remove a subscription
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseClient } from "@/lib/supabase";

const SubscriptionSchema = z.object({
  endpoint: z.string().url().max(500),
  keys: z.object({
    p256dh: z.string().min(1).max(200),
    auth: z.string().min(1).max(100),
  }),
  expirationTime: z.number().nullable().optional(),
});

const SaveSchema = z.object({ subscription: SubscriptionSchema });
const DeleteSchema = z.object({ endpoint: z.string().url().max(500) });

function isAuthorized(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const cookie = req.cookies.get("rune_session")?.value;
  const ownerToken = process.env.RUNE_OWNER_TOKEN;
  if (ownerToken && cookie === ownerToken) return true;
  // Also allow from same-origin requests (browser)
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (origin && host && origin.includes(host)) return true;
  if (cronSecret && req.headers.get("authorization") === `Bearer ${cronSecret}`) return true;
  return false;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = SaveSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid subscription payload." }, { status: 400 });
    }
    const { subscription } = parsed.data;
    const supabase = getSupabaseClient();
    if (!supabase) return NextResponse.json({ error: "Database not configured." }, { status: 503 });
    const { error } = await supabase.from("push_subscriptions").upsert(
      {
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        expiration_time: subscription.expirationTime ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "endpoint" }
    );
    if (error) {
      console.error("[push] upsert error", error.message);
      return NextResponse.json({ error: "Failed to save subscription." }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[push] POST error", err);
    return NextResponse.json({ error: "Server error." }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = DeleteSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid delete payload." }, { status: 400 });
    }
    const supabase = getSupabaseClient();
    if (!supabase) return NextResponse.json({ error: "Database not configured." }, { status: 503 });
    await supabase.from("push_subscriptions").delete().eq("endpoint", parsed.data.endpoint);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[push] DELETE error", err);
    return NextResponse.json({ error: "Server error." }, { status: 500 });
  }
}
