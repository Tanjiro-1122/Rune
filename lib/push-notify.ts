/**
 * lib/push-notify.ts
 * Sends Web Push notifications to all stored subscriptions using VAPID.
 * Uses the web-push npm package.
 */
import webpush from "web-push";
import { getSupabaseClient } from "@/lib/supabase";

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  icon?: string;
}

function getVapidConfig() {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:huertasfam@gmail.com";
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey, subject };
}

export async function sendPushNotificationsToAll(payload: PushPayload): Promise<{
  sent: number;
  failed: number;
  expired: number;
  configured: boolean;
}> {
  const vapid = getVapidConfig();
  if (!vapid) {
    console.warn("[push-notify] VAPID keys not configured — skipping push");
    return { sent: 0, failed: 0, expired: 0, configured: false };
  }

  webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);

  const supabase = getSupabaseClient();
  if (!supabase) return { sent: 0, failed: 0, expired: 0, configured: false };
  const { data: subs, error } = await supabase
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth");

  if (error || !subs || subs.length === 0) {
    console.log("[push-notify] no subscriptions found");
    return { sent: 0, failed: 0, expired: 0, configured: true };
  }

  const notification = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: payload.url || "/",
    icon: payload.icon || "/icons/icon-192.png",
  });

  let sent = 0, failed = 0, expired = 0;
  const expiredEndpoints: string[] = [];

  await Promise.allSettled(
    subs.map(async (sub: { endpoint: string; p256dh: string; auth: string }) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          notification,
          { TTL: 86400 }
        );
        sent++;
      } catch (err: unknown) {
        const statusCode = (err as { statusCode?: number }).statusCode;
        if (statusCode === 410 || statusCode === 404) {
          // Subscription expired — remove it
          expiredEndpoints.push(sub.endpoint);
          expired++;
        } else {
          console.error("[push-notify] send failed", statusCode, (err as Error).message?.slice(0, 100));
          failed++;
        }
      }
    })
  );

  // Clean up expired subscriptions
  if (expiredEndpoints.length > 0) {
    if (supabase) await supabase.from("push_subscriptions").delete().in("endpoint", expiredEndpoints);
  }

  return { sent, failed, expired, configured: true };
}
