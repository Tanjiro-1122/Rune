import type { OperatorDecisionHistorySignal } from "@/lib/operator-decision-history";
import type { OperatorDecisionSignal } from "@/lib/operator-priority-brain";

export interface OperatorRootCauseRunbook {
  applies: boolean;
  title: string;
  trigger: string;
  evidenceToCollect: string[];
  safeInvestigationSteps: string[];
  stopConditions: string[];
  blockedActions: string[];
}

const BASE_BLOCKED_ACTIONS = [
  "Do not merge without Javier approval.",
  "Do not deploy, redeploy, or rollback from this runbook.",
  "Do not mutate database schemas, payments, entitlements, secrets, DNS, or customer messages.",
  "Do not guess at code paths; inspect live source first.",
];

function evidenceForTarget(target: OperatorDecisionSignal["target"]) {
  if (target === "health") return ["latest app-health snapshot", "latest build/deploy signal", "affected project registry entry", "recent related warnings"];
  if (target === "repo") return ["Repo Control proposal state", "target file list", "latest PR/check status", "approval gate status"];
  if (target === "memory") return ["agent_memories reachability", "agent_memory_events reachability", "recent memory write errors", "Supabase configuration presence"];
  if (target === "tasks") return ["workspace task checkpoints", "runner status", "failure classification", "preserved executor proof"];
  return ["current operator briefing", "ranked signal list"];
}

export function createOperatorRootCauseRunbook(input: {
  decision: OperatorDecisionSignal;
  history?: OperatorDecisionHistorySignal | null;
}): OperatorRootCauseRunbook {
  const recurring = Boolean(input.history?.isRecurring);
  const decision = input.decision;

  if (!recurring || decision.target === "none") {
    return {
      applies: false,
      title: "Root-cause runbook not required",
      trigger: "Decision is not recurring yet.",
      evidenceToCollect: [],
      safeInvestigationSteps: [],
      stopConditions: ["No recurring signal is present."],
      blockedActions: BASE_BLOCKED_ACTIONS,
    };
  }

  return {
    applies: true,
    title: `Root-cause runbook: ${decision.title}`,
    trigger: input.history?.summary || "Recurring operator decision detected.",
    evidenceToCollect: evidenceForTarget(decision.target),
    safeInvestigationSteps: [
      "Compare the current signal to the prior decision memory before proposing any patch.",
      "Identify whether the recurring issue is caused by configuration, dependency drift, code regression, stale monitoring, or missing credentials.",
      "Preserve proof links, command output, and affected files in the investigation notes.",
      "If code is implicated, create or update a Repo Control proposal only after live source inspection.",
      "Prefer a small root-cause fix over repeated symptom patches.",
    ],
    stopConditions: [
      "Stop before merge/deploy/rollback gates.",
      "Stop if the evidence points to payments, DNS, secrets, or customer messaging.",
      "Stop if target files cannot be identified safely.",
      "Stop if the issue is only an optional visibility warning and no user-facing impact is found.",
    ],
    blockedActions: BASE_BLOCKED_ACTIONS,
  };
}
