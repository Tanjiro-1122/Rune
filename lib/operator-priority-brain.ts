import type {
  OperatorBriefingMemorySummary,
  OperatorBriefingProjectSummary,
  OperatorBriefingProposalSummary,
  OperatorBriefingTaskSummary,
} from "@/lib/operator-briefing";

export type OperatorDecisionTarget = "health" | "repo" | "memory" | "tasks" | "none";
export type OperatorDecisionRisk = "low" | "medium" | "high";

export interface OperatorDecisionSignal {
  id: string;
  target: OperatorDecisionTarget;
  projectKey?: string | null;
  title: string;
  detail: string;
  score: number;
  risk: OperatorDecisionRisk;
  rationale: string[];
  nextStep: string;
}

export interface OperatorDecisionExplanation {
  summary: string;
  whyItMatters: string;
  allowedNextStep: string;
  blockedActions: string[];
  confidence: "low" | "medium" | "high";
}

export interface OperatorPriorityDecisionBrief {
  generatedAt: string;
  readOnly: true;
  brainVersion: "operator_priority_brain_v1";
  topDecision: OperatorDecisionSignal;
  decisionExplanation: OperatorDecisionExplanation;
  decisionHistory?: import("@/lib/operator-decision-history").OperatorDecisionHistorySignal;
  rootCauseRunbook?: import("@/lib/operator-root-cause-runbook").OperatorRootCauseRunbook;
  rankedSignals: OperatorDecisionSignal[];
  safetyBoundary: string[];
}

const clampScore = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

function projectRisk(project: OperatorBriefingProjectSummary): OperatorDecisionRisk {
  if (project.healthStatus === "blocked" || (project.operatorReadinessScore ?? 100) < 55) return "high";
  if (project.healthStatus === "warning" || project.warnings.length > 0 || (project.operatorReadinessScore ?? 100) < 80) return "medium";
  return "low";
}

function scoreProject(project: OperatorBriefingProjectSummary) {
  const readinessGap = 100 - (project.operatorReadinessScore ?? project.healthScore ?? 90);
  const statusWeight = project.healthStatus === "blocked" ? 42 : project.healthStatus === "warning" ? 24 : 0;
  const warningWeight = Math.min(18, project.warnings.length * 4);
  const buildWeight = ["failure", "failed", "cancelled", "timed_out"].includes(project.buildStatus.toLowerCase()) ? 18 : 0;
  return clampScore(readinessGap + statusWeight + warningWeight + buildWeight);
}

function projectSignals(projects: OperatorBriefingProjectSummary[]): OperatorDecisionSignal[] {
  return projects
    .map((project) => {
      const score = scoreProject(project);
      return {
        id: `project:${project.key}`,
        target: "health" as const,
        projectKey: project.key,
        title: `Stabilize ${project.label}`,
        detail: project.warnings[0] || `${project.label} readiness is ${project.operatorReadinessScore ?? "unknown"}/100 with ${project.healthStatus} health.`,
        score,
        risk: projectRisk(project),
        rationale: [
          `Health: ${project.healthStatus}`,
          `Readiness: ${project.operatorReadinessScore ?? "unknown"}`,
          `Build: ${project.buildStatus}`,
          project.warnings.length ? `${project.warnings.length} warning signal(s)` : "No project warnings",
        ],
        nextStep: project.warnings[0] ? "Inspect the warning source and create a Repo Control proposal only if code remediation is needed." : "Keep monitoring; no code action required yet.",
      };
    })
    .filter((signal) => signal.score > 0);
}

function proposalSignals(proposals: OperatorBriefingProposalSummary[]): OperatorDecisionSignal[] {
  return proposals
    .filter((proposal) => ["draft", "proposed", "approved", "blocked"].includes(proposal.status))
    .map((proposal) => {
      const statusWeight = proposal.status === "blocked" ? 52 : proposal.status === "approved" ? 42 : proposal.status === "proposed" ? 34 : 22;
      const riskWeight = proposal.riskLevel === "high" ? 16 : proposal.riskLevel === "medium" ? 8 : 2;
      return {
        id: `proposal:${proposal.id}`,
        target: "repo" as const,
        projectKey: proposal.projectKey,
        title: `Review proposal: ${proposal.title}`,
        detail: proposal.nextStep,
        score: clampScore(statusWeight + riskWeight),
        risk: proposal.riskLevel === "high" ? "high" as const : proposal.riskLevel === "medium" ? "medium" as const : "low" as const,
        rationale: [`Status: ${proposal.status}`, `Risk: ${proposal.riskLevel}`, `Repo: ${proposal.repo || "unknown"}`],
        nextStep: proposal.nextStep,
      };
    });
}

function taskSignals(tasks: OperatorBriefingTaskSummary[]): OperatorDecisionSignal[] {
  return tasks
    .filter((task) => ["queued", "running", "failed"].includes(task.status))
    .map((task) => {
      const score = task.status === "failed" ? 70 : task.status === "running" ? 44 : 30;
      return {
        id: `task:${task.id}`,
        target: "tasks" as const,
        title: `Check task: ${task.title}`,
        detail: `Task is ${task.status}${task.runnerStatus ? ` / ${task.runnerStatus}` : ""}.`,
        score,
        risk: task.status === "failed" ? "medium" as const : "low" as const,
        rationale: [`Status: ${task.status}`, `Runner: ${task.runnerStatus || "none"}`, `Updated: ${task.updatedAt || "unknown"}`],
        nextStep: task.status === "failed" ? "Inspect failure proof and queue a follow-up remediation only if local verification is possible." : "Let the runner continue unless it stalls or asks for approval.",
      };
    });
}

function memorySignals(memory: OperatorBriefingMemorySummary): OperatorDecisionSignal[] {
  if (!memory.warning) return [];
  return [{
    id: "memory:persistence",
    target: "memory",
    title: "Repair Rune memory visibility",
    detail: memory.warning,
    score: 58,
    risk: "medium",
    rationale: [
      `Supabase configured: ${memory.supabaseConfigured}`,
      `agent_memories reachable: ${memory.agentMemoriesReachable}`,
      `agent_memory_events reachable: ${memory.agentMemoryEventsReachable}`,
    ],
    nextStep: "Inspect Supabase memory table reachability and propose a schema/config repair if needed.",
  }];
}


function confidenceFor(signal: OperatorDecisionSignal, rankedSignals: OperatorDecisionSignal[]): "low" | "medium" | "high" {
  if (signal.target === "none") return "high";
  const secondScore = rankedSignals[1]?.score ?? 0;
  if (signal.score >= 70 && signal.score - secondScore >= 10) return "high";
  if (signal.score >= 40) return "medium";
  return "low";
}

function explainDecision(signal: OperatorDecisionSignal, rankedSignals: OperatorDecisionSignal[]): OperatorDecisionExplanation {
  if (signal.target === "none") {
    return {
      summary: "Rune does not see an urgent operator action right now.",
      whyItMatters: "This keeps the operator from inventing work when health, task, proposal, and memory signals are calm.",
      allowedNextStep: signal.nextStep,
      blockedActions: ["Do not create busywork PRs.", "Do not deploy or mutate production without a real signal."],
      confidence: "high",
    };
  }

  const whyByTarget: Record<OperatorDecisionTarget, string> = {
    health: "Project health issues can affect user-facing reliability, builds, deployments, or runtime confidence.",
    repo: "Repo Control proposals are where code changes become auditable before any PR or release action.",
    memory: "Rune depends on persistent owner/project memory to avoid repeating mistakes and losing context.",
    tasks: "Runner tasks represent active or failed operator work that may need proof review before another step.",
    none: "No action required.",
  };

  return {
    summary: `${signal.title} is the current top-ranked operator decision at ${signal.score}/100 priority.`,
    whyItMatters: whyByTarget[signal.target],
    allowedNextStep: signal.nextStep,
    blockedActions: [
      "No merge without Javier approval.",
      "No production deploy or rollback from this decision brief.",
      "No schema, payment, entitlement, or customer-message mutation.",
    ],
    confidence: confidenceFor(signal, rankedSignals),
  };
}

const noActionSignal = (): OperatorDecisionSignal => ({
  id: "none:calm",
  target: "none",
  title: "No urgent operator action",
  detail: "Rune has no ranked blockers, active proposals, failed tasks, or memory warnings needing immediate review.",
  score: 0,
  risk: "low",
  rationale: ["All ranked signals are calm."],
  nextStep: "Keep monitoring and wait for the next health, CI, deploy, or owner signal.",
});

export function createOperatorPriorityDecisionBrief(input: {
  projects: OperatorBriefingProjectSummary[];
  proposals: OperatorBriefingProposalSummary[];
  tasks: OperatorBriefingTaskSummary[];
  memory: OperatorBriefingMemorySummary;
}): OperatorPriorityDecisionBrief {
  const rankedSignals = [
    ...projectSignals(input.projects),
    ...proposalSignals(input.proposals),
    ...taskSignals(input.tasks),
    ...memorySignals(input.memory),
  ].sort((a, b) => b.score - a.score).slice(0, 8);

  const topDecision = rankedSignals[0] || noActionSignal();
  const decisionExplanation = explainDecision(topDecision, rankedSignals);

  return {
    generatedAt: new Date().toISOString(),
    readOnly: true,
    brainVersion: "operator_priority_brain_v1",
    topDecision,
    decisionExplanation,
    rankedSignals,
    safetyBoundary: [
      "Decision brief is read-only ranking only.",
      "It cannot merge, deploy, mutate schemas, change payments, grant entitlements, or contact customers.",
      "Repo actions still require Repo Control approval gates.",
    ],
  };
}
