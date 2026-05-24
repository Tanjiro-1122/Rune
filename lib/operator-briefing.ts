import { getAppHealthSnapshot, type AppHealthSnapshot } from "@/lib/app-health-snapshot";
import { getBuildIntelligenceSnapshot, type BuildIntelligenceSnapshot } from "@/lib/build-intelligence";
import { getDeployHealthSnapshot, type DeployHealthSnapshot } from "@/lib/deploy-health";
import { getSupabaseClient } from "@/lib/supabase";
import { listRepoActionProposals, type RepoActionProposalRow } from "@/lib/repo-actions";
import { RUNE_CANONICAL_PROJECTS, getProjectByKey, type RuneProjectKey } from "@/lib/project-registry";
import { logError } from "@/lib/errors";
import { createOperatorPriorityDecisionBrief, type OperatorPriorityDecisionBrief } from "@/lib/operator-priority-brain";
import { applyDecisionHistoryBoost, getOperatorDecisionHistorySignal } from "@/lib/operator-decision-history";
import { createOperatorRootCauseRunbook } from "@/lib/operator-root-cause-runbook";
import { getOperatorCompletionLedger, type OperatorCompletionLedger } from "@/lib/operator-completion-ledger";

export type OperatorBriefingStatus = "healthy" | "warning" | "blocked";

export interface OperatorBriefingProjectSummary {
  key: RuneProjectKey;
  label: string;
  repo: string;
  safetyLevel: string;
  healthStatus: string;
  healthScore: number | null;
  operatorReadinessScore: number | null;
  buildStatus: string;
  latestCommit: string | null;
  deploySignal: string;
  warnings: string[];
}

export interface OperatorBriefingProposalSummary {
  id: string;
  title: string;
  status: string;
  riskLevel: string;
  projectKey: string | null;
  repo: string | null;
  updatedAt: string;
  nextStep: string;
}

export interface OperatorBriefingTaskSummary {
  id: string;
  title: string;
  status: string;
  runnerStatus: string | null;
  updatedAt: string;
}

export interface OperatorBriefingMemorySummary {
  supabaseConfigured: boolean;
  agentMemoriesReachable: boolean;
  agentMemoryEventsReachable: boolean;
  ownerMemorySource: "env" | "not_configured";
  warning: string | null;
}

export interface OperatorBriefing {
  generatedAt: string;
  readOnly: true;
  briefingType: "daily_operator";
  overallStatus: OperatorBriefingStatus;
  headline: string;
  recommendedNextAction: {
    title: string;
    detail: string;
    target: "health" | "repo" | "memory" | "tasks" | "none";
  };
  projects: OperatorBriefingProjectSummary[];
  proposals: OperatorBriefingProposalSummary[];
  tasks: OperatorBriefingTaskSummary[];
  memory: OperatorBriefingMemorySummary;
  priorityDecisionBrief: OperatorPriorityDecisionBrief;
  completionLedger: OperatorCompletionLedger;
  safetyNotice: string[];
}

function normalizeBriefingStatus(value?: string | null): OperatorBriefingStatus {
  const normalized = (value || "").toLowerCase();
  if (["blocked", "error", "failed", "failure"].includes(normalized)) return "blocked";
  if (["warning", "partial", "missing", "proposed", "queued", "running"].includes(normalized)) return "warning";
  return "healthy";
}

function isIntegrationVisibilityWarning(value?: string | null) {
  const text = (value || "").toLowerCase();
  return text.includes("external service readiness")
    || text.includes("read-only credentials")
    || text.includes("visibility")
    || text.includes("missing configuration")
    || text.includes("not configured yet");
}

function hasOnlyIntegrationVisibilityWarnings(warnings: string[]) {
  return warnings.length > 0 && warnings.every(isIntegrationVisibilityWarning);
}

function hasHardProjectBlocker(project: OperatorBriefingProjectSummary) {
  return normalizeBriefingStatus(project.healthStatus) === "blocked" && !hasOnlyIntegrationVisibilityWarnings(project.warnings);
}

function combineStatuses(statuses: OperatorBriefingStatus[]): OperatorBriefingStatus {
  if (statuses.includes("blocked")) return "blocked";
  if (statuses.includes("warning")) return "warning";
  return "healthy";
}

function getBuildRunStatus(build: BuildIntelligenceSnapshot) {
  return build.github.latestWorkflowRun?.conclusion || build.github.latestWorkflowRun?.status || (build.github.error ? "warning" : "unknown");
}

function isCurrentCiFailure(build: BuildIntelligenceSnapshot) {
  const run = build.github.latestWorkflowRun;
  if (!run) return false;
  const conclusion = (run.conclusion || "").toLowerCase();
  return conclusion === "failure" || conclusion === "failed";
}

function getOperatorReadinessScore(options: {
  project: typeof RUNE_CANONICAL_PROJECTS[number];
  health: AppHealthSnapshot;
  build: BuildIntelligenceSnapshot;
  deploy: DeployHealthSnapshot | null;
  warnings: string[];
}) {
  let score = 96;

  // GitHub/source visibility and current CI are real operator signals.
  if (options.build.github.error) score -= 30;
  if (isCurrentCiFailure(options.build)) score -= 25;

  // Vercel matters for web/operator availability. A READY deploy should not be punished.
  if (options.build.vercel.error) score -= 12;
  const latestDeploymentState = (options.build.vercel.latestDeployment?.state || "").toUpperCase();
  if (latestDeploymentState && latestDeploymentState !== "READY") score -= 20;

  // Rune's own deploy snapshot is an extra production availability signal.
  if (options.project.key === "rune") {
    const deployOverall = (options.deploy?.overall || "unknown").toLowerCase();
    if (deployOverall === "blocked") score -= 35;
    else if (deployOverall === "warning" || deployOverall === "unknown") score -= 8;
  }

  // Store credentials / optional external visibility should be visible, but not tank readiness.
  const visibilityWarnings = options.warnings.filter(isIntegrationVisibilityWarning).length;
  const hardWarnings = options.warnings.length - visibilityWarnings;
  score -= Math.min(8, visibilityWarnings * 2);
  score -= Math.min(18, hardWarnings * 6);

  return Math.max(35, Math.min(99, score));
}

function summarizeProject(
  projectKey: RuneProjectKey,
  health: AppHealthSnapshot,
  build: BuildIntelligenceSnapshot,
  deploy: DeployHealthSnapshot | null
): OperatorBriefingProjectSummary {
  const project = getProjectByKey(projectKey) || RUNE_CANONICAL_PROJECTS.find((item) => item.key === projectKey)!;
  const warnings = [
    ...health.blockers.slice(0, 4),
    ...(build.github.error ? [`GitHub visibility: ${build.github.error}`] : []),
    ...(build.vercel.error ? [`Vercel visibility: ${build.vercel.error}`] : []),
  ].slice(0, 6);
  const externalVisibilityOnly = hasOnlyIntegrationVisibilityWarnings(warnings);
  const operatorReadinessScore = getOperatorReadinessScore({ project, health, build, deploy, warnings });

  return {
    key: project.key,
    label: project.label,
    repo: project.repo,
    safetyLevel: project.safetyLevel,
    healthStatus: externalVisibilityOnly && health.status === "blocked" ? "warning" : health.status,
    healthScore: typeof health.score === "number" ? health.score : null,
    operatorReadinessScore,
    buildStatus: getBuildRunStatus(build),
    latestCommit: build.github.latestCommit?.sha?.slice(0, 7) || null,
    deploySignal: project.key === "rune" ? deploy?.overall || "unknown" : "not_applicable",
    warnings,
  };
}

function proposalNextStep(proposal: RepoActionProposalRow) {
  if (proposal.status === "draft") return "Review findings and decide whether to propose it.";
  if (proposal.status === "proposed") return "Run the Repo Control ladder only after Javier approval.";
  if (proposal.status === "approved") return "Continue approved PR-only checks; do not merge or deploy.";
  if (proposal.status === "blocked") return "Resolve blocker before any further action.";
  if (proposal.status === "executed") return "No action needed unless follow-up is requested.";
  return "No action unless Javier reopens it.";
}

function summarizeProposal(proposal: RepoActionProposalRow): OperatorBriefingProposalSummary {
  return {
    id: proposal.id,
    title: proposal.title,
    status: proposal.status,
    riskLevel: proposal.risk_level,
    projectKey: proposal.project_key,
    repo: proposal.repo,
    updatedAt: proposal.updated_at,
    nextStep: proposalNextStep(proposal),
  };
}

async function getRecentWorkspaceTasks(): Promise<OperatorBriefingTaskSummary[]> {
  const supabase = getSupabaseClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("workspace_tasks")
    .select("id, title, status, runner_status, updated_at")
    .order("updated_at", { ascending: false })
    .limit(8);

  if (error) {
    logError("operatorBriefing.getRecentWorkspaceTasks", error);
    return [];
  }

  return (data ?? []).map((task) => ({
    id: String(task.id),
    title: String(task.title || "Untitled task"),
    status: String(task.status || "unknown"),
    runnerStatus: task.runner_status ? String(task.runner_status) : null,
    updatedAt: String(task.updated_at || ""),
  }));
}

async function getMemorySummary(): Promise<OperatorBriefingMemorySummary> {
  const supabase = getSupabaseClient();
  const ownerMemoryConfigured = Boolean(process.env.RUNE_OWNER_MEMORY?.trim());

  if (!supabase) {
    return {
      supabaseConfigured: false,
      agentMemoriesReachable: false,
      agentMemoryEventsReachable: false,
      ownerMemorySource: ownerMemoryConfigured ? "env" : "not_configured",
      warning: "Supabase is not configured, so memory persistence visibility is unavailable.",
    };
  }

  const [memoriesResult, eventsResult] = await Promise.allSettled([
    supabase.from("agent_memories").select("id", { count: "exact", head: true }),
    supabase.from("agent_memory_events").select("id", { count: "exact", head: true }),
  ]);

  const agentMemoriesReachable = memoriesResult.status === "fulfilled" && !memoriesResult.value.error;
  const agentMemoryEventsReachable = eventsResult.status === "fulfilled" && !eventsResult.value.error;

  return {
    supabaseConfigured: true,
    agentMemoriesReachable,
    agentMemoryEventsReachable,
    ownerMemorySource: ownerMemoryConfigured ? "env" : "not_configured",
    warning: agentMemoriesReachable && agentMemoryEventsReachable
      ? null
      : "Supabase memory tables are not fully reachable from Rune.",
  };
}


function getBriefingWarningText(projects: OperatorBriefingProjectSummary[], memory: OperatorBriefingMemorySummary) {
  return [
    ...projects.flatMap((project) => project.warnings),
    memory.warning,
  ].filter(Boolean).join(" ");
}

function normalizeFinalBriefingStatus(options: {
  overallStatus: OperatorBriefingStatus;
  projects: OperatorBriefingProjectSummary[];
  memory: OperatorBriefingMemorySummary;
  deployStatus: OperatorBriefingStatus;
}): OperatorBriefingStatus {
  if (options.overallStatus !== "blocked") return options.overallStatus;
  if (options.deployStatus === "blocked") return "blocked";
  if (options.projects.some(hasHardProjectBlocker)) return "blocked";

  const warningText = getBriefingWarningText(options.projects, options.memory);
  return isIntegrationVisibilityWarning(warningText) ? "warning" : "blocked";
}

function getBriefingHeadline(overallStatus: OperatorBriefingStatus) {
  return overallStatus === "healthy"
    ? "Rune operator signals look calm."
    : overallStatus === "warning"
      ? "Rune has integration visibility or health warnings to review."
      : "Rune found a blocked operator signal that needs review.";
}

function chooseRecommendedNextAction(options: {
  overallStatus: OperatorBriefingStatus;
  projects: OperatorBriefingProjectSummary[];
  proposals: OperatorBriefingProposalSummary[];
  tasks: OperatorBriefingTaskSummary[];
  memory: OperatorBriefingMemorySummary;
}): OperatorBriefing["recommendedNextAction"] {
  const warningProject = options.projects.find((project) => project.healthStatus !== "healthy" || project.warnings.length > 0);
  if (warningProject) {
    return {
      title: `Review ${warningProject.label} health warnings`,
      detail: warningProject.warnings[0] || `${warningProject.label} is reporting a ${warningProject.healthStatus} status.`,
      target: "health",
    };
  }

  if (options.memory.warning) {
    return {
      title: "Review memory independence",
      detail: options.memory.warning,
      target: "memory",
    };
  }

  const activeProposal = options.proposals.find((proposal) => ["draft", "proposed", "approved"].includes(proposal.status));
  if (activeProposal) {
    return {
      title: `Review proposal: ${activeProposal.title}`,
      detail: activeProposal.nextStep,
      target: "repo",
    };
  }

  const activeTask = options.tasks.find((task) => ["queued", "running"].includes(task.status));
  if (activeTask) {
    return {
      title: `Check task: ${activeTask.title}`,
      detail: `Task is ${activeTask.status}${activeTask.runnerStatus ? ` / ${activeTask.runnerStatus}` : ""}.`,
      target: "tasks",
    };
  }

  return {
    title: "No urgent operator action",
    detail: "Rune has no active blockers, proposals, or runner jobs needing immediate review.",
    target: "none",
  };
}

export async function getDailyOperatorBriefing(): Promise<OperatorBriefing> {
  const [deployResult, memory, tasks, proposals, completionLedger] = await Promise.all([
    getDeployHealthSnapshot({ skipActionLog: true }).catch((error) => {
      logError("operatorBriefing.deployHealth", error);
      return null;
    }),
    getMemorySummary(),
    getRecentWorkspaceTasks(),
    listRepoActionProposals({ limit: 12 }),
    getOperatorCompletionLedger({ limit: 6 }),
  ]);

  const projectResults = await Promise.all(
    RUNE_CANONICAL_PROJECTS.map(async (project) => {
      const [health, build] = await Promise.all([
        getAppHealthSnapshot({ projectKey: project.key, repo: project.repo, skipActionLog: true }),
        getBuildIntelligenceSnapshot({ projectKey: project.key, repo: project.repo, skipActionLog: true }),
      ]);
      return summarizeProject(project.key, health, build, deployResult);
    })
  );

  const proposalSummaries = proposals.slice(0, 8).map(summarizeProposal);
  const deployStatus = normalizeBriefingStatus(deployResult?.overall);
  const projectStatuses = projectResults.map((project) => normalizeBriefingStatus(project.healthStatus));
  const hasHardBlocker = projectResults.some(hasHardProjectBlocker) || deployStatus === "blocked";
  const statusSignals = [
    ...projectStatuses.map((status) => status === "blocked" && !hasHardBlocker ? "warning" as const : status),
    deployStatus,
    memory.warning ? "warning" as const : "healthy" as const,
  ];
  const computedOverallStatus = hasHardBlocker ? "blocked" : combineStatuses(statusSignals);
  const overallStatus = normalizeFinalBriefingStatus({
    overallStatus: computedOverallStatus,
    projects: projectResults,
    memory,
    deployStatus,
  });
  const basePriorityDecisionBrief = createOperatorPriorityDecisionBrief({
    projects: projectResults,
    proposals: proposalSummaries,
    tasks,
    memory,
  });
  const decisionHistory = await getOperatorDecisionHistorySignal(basePriorityDecisionBrief.topDecision).catch(() => ({
    decisionId: basePriorityDecisionBrief.topDecision.id,
    seenCount: 0,
    lastSeenAt: null,
    isRecurring: false,
    recurrenceBoost: 0,
    summary: "Decision history unavailable.",
  }));
  const boostedTopDecision = applyDecisionHistoryBoost(basePriorityDecisionBrief.topDecision, decisionHistory);
  const rootCauseRunbook = createOperatorRootCauseRunbook({ decision: boostedTopDecision, history: decisionHistory });
  const priorityDecisionBrief = {
    ...basePriorityDecisionBrief,
    topDecision: boostedTopDecision,
    decisionHistory,
    rootCauseRunbook,
    rankedSignals: [boostedTopDecision, ...basePriorityDecisionBrief.rankedSignals.filter((signal) => signal.id !== boostedTopDecision.id)],
  };
  const recommendedNextAction = priorityDecisionBrief.topDecision.target === "none"
    ? chooseRecommendedNextAction({
      overallStatus,
      projects: projectResults,
      proposals: proposalSummaries,
      tasks,
      memory,
    })
    : {
      title: priorityDecisionBrief.topDecision.title,
      detail: priorityDecisionBrief.topDecision.detail,
      target: priorityDecisionBrief.topDecision.target,
    };

  return {
    generatedAt: new Date().toISOString(),
    readOnly: true,
    briefingType: "daily_operator",
    overallStatus,
    headline: getBriefingHeadline(overallStatus),
    recommendedNextAction,
    projects: projectResults,
    proposals: proposalSummaries,
    tasks,
    memory,
    priorityDecisionBrief,
    completionLedger,
    safetyNotice: [
      "Daily Operator Briefing is read-only.",
      "No repo merge, deploy, rollback, release, schema change, payment action, customer message, runner job, or entitlement change is executed.",
      "Repo Control actions remain behind Javier approval gates.",
    ],
  };
}
