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

export interface OperatorPriorityDecisionBrief {
  generatedAt: string;
  readOnly: true;
  brainVersion: "operator_priority_brain_v1";
  topDecision: OperatorDecisionSignal;
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

  return {
    generatedAt: new Date().toISOString(),
    readOnly: true,
    brainVersion: "operator_priority_brain_v1",
    topDecision,
    rankedSignals,
    safetyBoundary: [
      "Decision brief is read-only ranking only.",
      "It cannot merge, deploy, mutate schemas, change payments, grant entitlements, or contact customers.",
      "Repo actions still require Repo Control approval gates.",
    ],
  };
}
