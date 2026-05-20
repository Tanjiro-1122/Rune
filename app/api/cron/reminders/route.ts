import { NextResponse } from "next/server";
import { getDueReminders, markReminderSent } from "@/lib/reminders";
import { sendPushNotificationsToAll } from "@/lib/push-notify";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET ?? process.env.RUNE_DEPLOY_TOKEN}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const due = await getDueReminders();
  if (due.length === 0) return NextResponse.json({ fired: 0 });

  const results = await Promise.allSettled(
    due.map(async (r) => {
      await sendPushNotificationsToAll({
        title: r.title,
        body: r.body ?? "Rune reminder",
      });
      await markReminderSent(r.id!, r.repeat ?? null);
      return r.id;
    })
  );

  const fired = results.filter((r) => r.status === "fulfilled").length;
  console.log(`[cron/reminders] Fired ${fired}/${due.length} reminders`);
  return NextResponse.json({ fired, total: due.length });
}
