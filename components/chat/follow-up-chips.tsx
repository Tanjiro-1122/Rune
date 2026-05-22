export type FollowUpMessage = {
  role?: string;
  content?: string;
  parts?: Array<{ type: string; text?: string; toolName?: string }>;
};

export function deriveFollowUpChips(message: FollowUpMessage): string[] {
  const text = ((message.parts ?? [])
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join(" ") || message.content || "").toLowerCase();

  const toolsUsed = (message.parts ?? [])
    .filter((p) => p.type === "tool-invocation")
    .map((p) => (p as { type: string; toolName?: string }).toolName ?? "");

  // Deploy / build related
  if (toolsUsed.some(t => t.includes("deploy") || t.includes("build")) ||
      /deploy|vercel|build (succeeded|failed|ready)/i.test(text)) {
    return ["Run health check", "Check build logs", "Open Operator Console"];
  }
  // Repo / code changes
  if (toolsUsed.some(t => t.includes("repo") || t.includes("pr") || t.includes("commit")) ||
      /pull request|pr #|merged|commit|patched/i.test(text)) {
    return ["Check PR status", "Run self-audit", "What else needs fixing?"];
  }
  // Health / audit
  if (toolsUsed.some(t => t.includes("health") || t.includes("audit") || t.includes("snapshot")) ||
      /health score|audit|readiness|signal/i.test(text)) {
    return ["Fix the top issue", "Check deployment", "View memory"];
  }
  // Analytics / revenue
  if (toolsUsed.some(t => t.includes("intelligence") || t.includes("revenuecat")) ||
      /revenue|subscriber|mrr|retention|dau|mau/i.test(text)) {
    return ["Compare with last week", "Run health check", "What should I focus on?"];
  }
  // Memory
  if (toolsUsed.some(t => t.includes("memory") || t.includes("save_memory")) ||
      /saved|remembered|memory/i.test(text)) {
    return ["Show all memories", "What are the open tasks?", "Daily brief"];
  }
  // Web search
  if (toolsUsed.some(t => t === "web_search") || /search results|found.*results/i.test(text)) {
    return ["Go deeper on this", "Save this to memory", "How does this apply to my stack?"];
  }
  // Default — generic next moves
  return ["Daily brief", "Run health check", "What's next?"];
}

export function FollowUpChips({ lastMessage, onChipClick }: { lastMessage: FollowUpMessage; onChipClick: (prompt: string) => void }) {
  const chips = deriveFollowUpChips(lastMessage);
  if (!chips.length) return null;
  return (
    <div className="followup-chips" aria-label="Suggested follow-up actions">
      {chips.map((chip) => (
        <button
          key={chip}
          type="button"
          className="followup-chip"
          onClick={() => onChipClick(chip)}
        >
          {chip}
        </button>
      ))}
    </div>
  );
}
