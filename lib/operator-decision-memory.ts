import { logError } from "@/lib/errors";
import { logMemoryEvent, upsertMemory } from "@/lib/memory";
import type { OperatorPriorityDecisionBrief } from "@/lib/operator-priority-brain";
import type { OperatorBriefingStatus } from "@/lib/operator-briefing";

const MAX_REASON_CHARS = 1200;

function cleanMemoryText(value: unknown, maxChars = MAX_REASON_CHARS) {
  const text = String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\b(sk|pk|rk|whsec|ghp|github_pat|vcp|eyJ)[A-Za-z0-9_\-\.]{12,}\b/g, "[redacted]")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
}

export interface OperatorDecisionMemoryWritebackInput {
  briefingGeneratedAt: string;
  overallStatus: OperatorBriefingStatus;
  priorityDecisionBrief: OperatorPriorityDecisionBrief;
}

export async function writeOperatorDecisionMemory(input: OperatorDecisionMemoryWritebackInput) {
  const decision = input.priorityDecisionBrief.topDecision;
  const explanation = input.priorityDecisionBrief.decisionExplanation;
  if (!decision || decision.target === "none") {
    await logMemoryEvent({
      eventType: "operator.decision_memory.skipped",
      summary: "Operator decision memory skipped because no urgent decision was ranked.",
      metadata: { generatedAt: input.briefingGeneratedAt, overallStatus: input.overallStatus },
    }).catch(() => {});
    return { ok: true, skipped: true, reason: "no_ranked_decision" as const };
  }

  const title = `operator-decision:${decision.target}:${decision.id}`.slice(0, 180);
  const content = cleanMemoryText([
    `Generated: ${input.briefingGeneratedAt}`,
    `Overall status: ${input.overallStatus}`,
    `Top decision: ${decision.title}`,
    `Priority: ${decision.score}/100; risk: ${decision.risk}; confidence: ${explanation?.confidence ?? "unknown"}`,
    `Why it matters: ${explanation?.whyItMatters ?? decision.detail}`,
    `Allowed next step: ${explanation?.allowedNextStep ?? decision.nextStep}`,
    `Blocked actions: ${(explanation?.blockedActions ?? input.priorityDecisionBrief.safetyBoundary).join(" | ")}`,
  ].join("\n"), 1800);

  const result = await upsertMemory({
    kind: "decision",
    title,
    content,
    project_key: decision.projectKey || "rune",
    tags: ["operator", "decision", "priority-brain", decision.target, decision.risk],
    priority: decision.risk === "high" ? 8 : decision.risk === "medium" ? 6 : 4,
    source: "operator_decision_writeback",
  });

  if (!result.ok) {
    logError("operatorDecisionMemory.write", result.error);
    return { ok: false, error: result.error };
  }

  await logMemoryEvent({
    memoryId: result.memory?.id ?? null,
    eventType: "operator.decision_memory.saved",
    summary: cleanMemoryText(`Saved operator decision memory: ${decision.title}`, 300),
    metadata: {
      generatedAt: input.briefingGeneratedAt,
      brainVersion: input.priorityDecisionBrief.brainVersion,
      decisionId: decision.id,
      target: decision.target,
      projectKey: decision.projectKey ?? null,
      score: decision.score,
      risk: decision.risk,
      confidence: explanation?.confidence ?? null,
    },
  }).catch(() => {});

  return { ok: true, skipped: false, memoryId: result.memory?.id ?? null, title };
}
