/**
 * Rune Reminder System
 * --------------------
 * Rune can schedule reminders from chat.
 * Reminders are stored in rune_reminders (Supabase).
 * The /api/cron/reminders endpoint fires every 5 minutes and sends due ones.
 */

import { createClient } from "@supabase/supabase-js";

function sb() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

export interface Reminder {
  id?: string;
  title: string;
  body?: string;
  fire_at: string;        // ISO datetime (UTC)
  timezone?: string;      // e.g. "America/New_York"
  repeat?: string | null; // "daily" | "weekly" | null
  status?: string;        // "pending" | "sent" | "cancelled"
  created_at?: string;
}

export async function createReminder(r: Reminder): Promise<{ id: string | null; error?: string }> {
  try {
    const { data, error } = await sb()
      .from("rune_reminders")
      .insert({
        title: r.title,
        body: r.body ?? null,
        fire_at: r.fire_at,
        timezone: r.timezone ?? "America/New_York",
        repeat: r.repeat ?? null,
        status: "pending",
        created_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (error) return { id: null, error: error.message };
    return { id: data?.id ?? null };
  } catch (e) {
    return { id: null, error: e instanceof Error ? e.message : "Failed to create reminder" };
  }
}

export async function listReminders(status = "pending"): Promise<Reminder[]> {
  try {
    const { data } = await sb()
      .from("rune_reminders")
      .select("*")
      .eq("status", status)
      .order("fire_at", { ascending: true })
      .limit(20);
    return data ?? [];
  } catch {
    return [];
  }
}

export async function cancelReminder(id: string): Promise<boolean> {
  try {
    const { error } = await sb()
      .from("rune_reminders")
      .update({ status: "cancelled" })
      .eq("id", id);
    return !error;
  } catch {
    return false;
  }
}

export async function getDueReminders(): Promise<Reminder[]> {
  try {
    const now = new Date().toISOString();
    const { data } = await sb()
      .from("rune_reminders")
      .select("*")
      .eq("status", "pending")
      .lte("fire_at", now);
    return data ?? [];
  } catch {
    return [];
  }
}

export async function markReminderSent(id: string, repeat: string | null): Promise<void> {
  try {
    if (repeat === "daily") {
      const next = new Date(Date.now() + 86400000).toISOString();
      await sb().from("rune_reminders").update({ fire_at: next }).eq("id", id);
    } else if (repeat === "weekly") {
      const next = new Date(Date.now() + 7 * 86400000).toISOString();
      await sb().from("rune_reminders").update({ fire_at: next }).eq("id", id);
    } else {
      await sb().from("rune_reminders").update({ status: "sent" }).eq("id", id);
    }
  } catch { /* ignore */ }
}
