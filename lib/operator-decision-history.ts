import { listActiveMemories } from "@/lib/memory";
import type { OperatorDecisionSignal } from "@/lib/operator-priority-brain";

export interface OperatorDecisionHistorySignal {
  decisionId: string;
  seenCount: number;
  lastSeenAt: string | null;
  isRecurring: boolean;
  recurrenceBoost: number;
  summary: string;
}

function extractDecisionId(content = "") {
  const match = content.match(/Top decision:\s*([^\n]+)/i);
  return match?.[1]?.trim() || null;
}

function extractGeneratedAt(content = "") {
  const match = content.match(/Generated:\s*([^\n]+)/i);
  return match?.[1]?.trim() || null;
}

export async function getOperatorDecisionHistorySignal(decision: OperatorDecisionSignal) {
  if (!decision || decision.target === "none") {
    return {
      decisionId: "none",
      seenCount: 0,
      lastSeenAt: null,
      isRecurring: false,
      recurrenceBoost: 0,
      summary: "No recurring decision history applies.",
    } satisfies OperatorDecisionHistorySignal;
  }

  const memories = await listActiveMemories({
    query: `${decision.title} ${decision.id} operator decision priority-brain`,
    projectKey: decision.projectKey || "rune",
    limit: 25,
  });

  const matching = memories.filter((memory) => {
    const text = `${memory.title}\n${memory.content}`.toLowerCase();
    return memory.source === "operator_decision_writeback"
      && (text.includes(decision.id.toLowerCase()) || text.includes(decision.title.toLowerCase()));
  });

  const generatedDates = matching
    .map((memory) => extractGeneratedAt(memory.content) || memory.updated_at || memory.created_at || null)
    .filter(Boolean) as string[];
  const lastSeenAt = generatedDates.sort().at(-1) || null;
  const seenCount = matching.length;
  const isRecurring = seenCount >= 2;
  const recurrenceBoost = isRecurring ? Math.min(12, 4 + seenCount * 2) : 0;

  return {
    decisionId: decision.id,
    seenCount,
    lastSeenAt,
    isRecurring,
    recurrenceBoost,
    summary: isRecurring
      ? `Recurring operator decision: seen ${seenCount} time(s), last seen ${lastSeenAt || "unknown"}.`
      : "No recurring decision history found yet.",
  } satisfies OperatorDecisionHistorySignal;
}

export function applyDecisionHistoryBoost(decision: OperatorDecisionSignal, history: OperatorDecisionHistorySignal): OperatorDecisionSignal {
  if (!history.isRecurring || history.recurrenceBoost <= 0) return decision;
  return {
    ...decision,
    score: Math.min(100, decision.score + history.recurrenceBoost),
    rationale: [
      ...decision.rationale,
      history.summary,
      `Recurrence boost: +${history.recurrenceBoost}`,
    ],
    nextStep: `${decision.nextStep} This issue is recurring, so preserve proof and check for root cause rather than only patching symptoms.`,
  };
}
