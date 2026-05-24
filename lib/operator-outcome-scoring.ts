import type { OperatorCompletionLedger } from "@/lib/operator-completion-ledger";
import type { OperatorDecisionHistorySignal } from "@/lib/operator-decision-history";
import type { OperatorDecisionSignal } from "@/lib/operator-priority-brain";

export type OperatorOutcomeStatus = "likely_resolved" | "recurring" | "pending" | "unknown";

export interface OperatorOutcomeScore {
  status: OperatorOutcomeStatus;
  score: number;
  confidence: "low" | "medium" | "high";
  summary: string;
  evidence: string[];
  suggestedAdjustment: string;
  readOnly: true;
}

function normalize(value: unknown) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function tokenOverlap(a: string, b: string) {
  const aTokens = new Set(normalize(a).split(/\s+/).filter((token) => token.length >= 4));
  const bTokens = new Set(normalize(b).split(/\s+/).filter((token) => token.length >= 4));
  if (!aTokens.size || !bTokens.size) return 0;
  let matches = 0;
  for (const token of aTokens) if (bTokens.has(token)) matches += 1;
  return matches / Math.max(aTokens.size, 1);
}

export function scoreOperatorOutcome(input: {
  decision: OperatorDecisionSignal;
  history?: OperatorDecisionHistorySignal | null;
  completionLedger?: OperatorCompletionLedger | null;
}): OperatorOutcomeScore {
  const decision = input.decision;
  const history = input.history;
  const completions = input.completionLedger?.recentCompletions ?? [];

  if (!decision || decision.target === "none") {
    return {
      status: "unknown",
      score: 50,
      confidence: "high",
      summary: "No active operator decision requires outcome scoring.",
      evidence: ["Top decision target is none."],
      suggestedAdjustment: "Keep monitoring without creating busywork.",
      readOnly: true,
    };
  }

  const bestCompletion = completions
    .map((completion) => ({
      completion,
      overlap: Math.max(
        tokenOverlap(decision.title, completion.title),
        tokenOverlap(decision.detail, `${completion.title} ${completion.summary}`),
      ),
    }))
    .sort((a, b) => b.overlap - a.overlap)[0] ?? null;

  const recurring = Boolean(history?.isRecurring);
  if (recurring) {
    return {
      status: "recurring",
      score: Math.max(15, 45 - (history?.seenCount ?? 1) * 5),
      confidence: (history?.seenCount ?? 0) >= 3 ? "high" : "medium",
      summary: "The same operator decision has appeared multiple times, so prior action probably did not remove the root cause yet.",
      evidence: [
        history?.summary || "Recurring decision history found.",
        bestCompletion?.completion ? `Nearest completion: PR #${bestCompletion.completion.prNumber} ${bestCompletion.completion.title}` : "No matching completion found.",
      ],
      suggestedAdjustment: "Escalate from symptom patching to root-cause investigation before proposing more code changes.",
      readOnly: true,
    };
  }

  if (bestCompletion && bestCompletion.overlap >= 0.35) {
    return {
      status: "likely_resolved",
      score: Math.min(95, 70 + Math.round(bestCompletion.overlap * 25)),
      confidence: bestCompletion.overlap >= 0.6 ? "high" : "medium",
      summary: `A recent merged PR appears related to the top decision: PR #${bestCompletion.completion.prNumber}.`,
      evidence: [
        `Decision: ${decision.title}`,
        `Completion: PR #${bestCompletion.completion.prNumber} ${bestCompletion.completion.title}`,
        `Similarity: ${Math.round(bestCompletion.overlap * 100)}%`,
      ],
      suggestedAdjustment: "Verify with health/build/deploy signals before recommending more work on the same issue.",
      readOnly: true,
    };
  }

  return {
    status: "pending",
    score: 55,
    confidence: "medium",
    summary: "No matching completion was found yet for the current top operator decision.",
    evidence: [
      `Decision: ${decision.title}`,
      `Recent completions checked: ${completions.length}`,
    ],
    suggestedAdjustment: "Keep the next action focused on evidence collection or a gated Repo Control proposal, not direct execution.",
    readOnly: true,
  };
}
