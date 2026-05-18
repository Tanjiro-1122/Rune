"use client";
/**
 * PushSubscribeButton
 * Shows an "Enable notifications" button.
 * When clicked, requests push permission and saves subscription to /api/push.
 * Renders nothing if push is not supported or already subscribed.
 */
import { useEffect, useState } from "react";

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "";

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

type State = "idle" | "checking" | "subscribed" | "subscribing" | "denied" | "unsupported" | "error";

export function PushSubscribeButton({ className }: { className?: string }) {
  const [state, setState] = useState<State>("checking");

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setState("unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setState("denied");
      return;
    }
    navigator.serviceWorker.ready.then((reg) => {
      reg.pushManager.getSubscription().then((sub) => {
        setState(sub ? "subscribed" : "idle");
      });
    });
  }, []);

  async function subscribe() {
    if (!VAPID_PUBLIC_KEY) {
      console.warn("[push] NEXT_PUBLIC_VAPID_PUBLIC_KEY not set");
      return;
    }
    setState("subscribing");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") { setState("denied"); return; }

      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });

      const res = await fetch("/api/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: sub.toJSON() }),
      });

      if (!res.ok) throw new Error("Failed to save subscription");
      setState("subscribed");
    } catch (err) {
      console.error("[push] subscribe error", err);
      setState("error");
    }
  }

  if (state === "unsupported" || state === "subscribed") return null;

  return (
    <button
      onClick={subscribe}
      disabled={state === "subscribing" || state === "checking"}
      className={className}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "8px",
        padding: "10px 16px",
        borderRadius: "10px",
        border: "1px solid rgba(99,102,241,0.3)",
        background: "rgba(99,102,241,0.08)",
        color: "#a5b4fc",
        fontSize: "14px",
        cursor: state === "subscribing" ? "wait" : "pointer",
        width: "100%",
      }}
    >
      <span style={{ fontSize: "18px" }}>🔔</span>
      {state === "subscribing" ? "Enabling notifications…" :
       state === "denied" ? "Notifications blocked — check browser settings" :
       state === "error" ? "Try again" :
       "Enable morning briefing notifications"}
    </button>
  );
}
