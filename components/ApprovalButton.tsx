"use client";
import { useState } from "react";

export function ApprovalButton({
  proposalId,
  onApproved,
}: {
  proposalId: string;
  onApproved?: () => void;
}) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");

  async function approve() {
    setState("loading");
    try {
      const res = await fetch("/api/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: proposalId, code: "1122" }),
      });
      if (res.ok) {
        setState("done");
        onApproved?.();
      } else {
        setState("error");
      }
    } catch {
      setState("error");
    }
  }

  if (state === "done") return (
    <div style={{ fontSize: 11, color: "#4ade80" }}>✓ Approved — PR opening...</div>
  );

  return (
    <button
      onClick={approve}
      disabled={state === "loading"}
      style={{
        background: state === "loading" ? "#333" : "#c0392b",
        color: "#fff",
        border: "none",
        borderRadius: 6,
        padding: "6px 14px",
        fontSize: 11,
        cursor: state === "loading" ? "default" : "pointer",
        fontFamily: "inherit",
      }}
    >
      {state === "loading" ? "Approving..." : state === "error" ? "Try again" : "✓ Approve"}
    </button>
  );
}
