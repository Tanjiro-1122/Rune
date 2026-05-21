import type { OperatorBriefing } from "@/lib/operator-briefing";
import type { RevenueCatOverviewResult } from "@/lib/revenuecat-overview";

export interface WhatsAppBriefingOptions {
  briefing: OperatorBriefing;
  rc: RevenueCatOverviewResult;
  previousScore: number | null;
  openAiSpend: number | null;
}

function statusEmoji(status: string): string {
  if (status === "healthy") return "✅";
  if (status === "warning") return "⚠️";
  return "🚨";
}

function trendArrow(current: number | null, previous: number | null): string {
  if (current === null || previous === null) return "";
  const diff = current - previous;
  if (diff > 0) return ` ↑ (+${diff} vs yesterday)`;
  if (diff < 0) return ` ↓ (${diff} vs yesterday)`;
  return " → (same as yesterday)";
}

function formatMoney(value: number | null, currency = "USD"): string {
  if (value === null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatDayOfWeek(): string {
  return new Date().toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "America/New_York",
  });
}

/**
 * Builds a structured, scannable WhatsApp message for the daily Rune briefing.
 * Designed to be readable in ~10 seconds on mobile.
 */
export function buildWhatsAppBriefingMessage(opts: WhatsAppBriefingOptions): string {
  const { briefing, rc, previousScore, openAiSpend } = opts;

  // ── Header ──────────────────────────────────────────────────────────────
  const lines: string[] = [];
  lines.push(`🔥 *Rune — ${formatDayOfWeek()}*`);
  lines.push("");

  // ── Operator Readiness Score ──────────────────────────────────────────────
  const overallEmoji = statusEmoji(briefing.overallStatus);
  const projectScores = briefing.projects.map((p) => p.operatorReadinessScore ?? p.healthScore).filter((s): s is number => s !== null);
  const avgScore = projectScores.length
    ? Math.round(projectScores.reduce((a, b) => a + b, 0) / projectScores.length)
    : null;
  const trend = trendArrow(avgScore, previousScore);
  lines.push(`${overallEmoji} *Operator readiness:* ${avgScore !== null ? `${avgScore}/100${trend}` : briefing.overallStatus}`);

  // ── Revenue ──────────────────────────────────────────────────────────────
  if (rc.ok && (rc.mrr !== null || rc.activeSubscribers !== null)) {
    const mrrStr = rc.mrr !== null ? `${formatMoney(rc.mrr, rc.currency)} MRR` : "";
    const subsStr = rc.activeSubscribers !== null ? `${rc.activeSubscribers} active sub${rc.activeSubscribers !== 1 ? "s" : ""}` : "";
    const revParts = [mrrStr, subsStr].filter(Boolean).join(" · ");
    lines.push(`💰 *Revenue:* ${revParts || "—"}`);
  } else if (rc.configured) {
    lines.push(`💰 *Revenue:* data unavailable`);
  }

  // ── Deployments ───────────────────────────────────────────────────────────
  const deployParts = briefing.projects.map((p) => {
    const emoji = statusEmoji(p.healthStatus);
    return `${emoji} ${p.label}`;
  });
  lines.push(`🚀 *Deploy:* ${deployParts.join(" · ")}`);

  // ── CI ───────────────────────────────────────────────────────────────────
  const ciFailing = briefing.projects.filter((p) => p.buildStatus === "failure" || p.buildStatus === "failed");
  if (ciFailing.length > 0) {
    lines.push(`🔨 *Current CI:* ⚠️ ${ciFailing.map((p) => p.label).join(", ")} failing`);
  } else {
    lines.push(`🔨 *Current CI:* ✅ latest runs passing`);
  }

  // ── OpenAI Spend ─────────────────────────────────────────────────────────
  if (openAiSpend !== null) {
    lines.push(`🤖 *OpenAI:* ${formatMoney(openAiSpend)} spent this month`);
  }

  lines.push("");

  // ── Action Item ──────────────────────────────────────────────────────────
  const action = briefing.recommendedNextAction;
  if (action && action.target !== "none" && action.title) {
    lines.push(`⚡ *Action:* ${action.title}`);
    if (action.detail && action.detail !== action.title) {
      lines.push(`   ${action.detail.slice(0, 120)}`);
    }
  } else {
    lines.push(`⚡ *Action:* All clear — nothing urgent`);
  }

  // ── Open Proposals ────────────────────────────────────────────────────────
  const openProposals = briefing.proposals?.filter((p) => p.status === "proposed" || p.status === "pending");
  if (openProposals?.length) {
    lines.push(`📋 *Pending PRs:* ${openProposals.length} awaiting review`);
  }

  lines.push("");
  lines.push(`→ mrruneai.vercel.app`);

  return lines.join("\n");
}
