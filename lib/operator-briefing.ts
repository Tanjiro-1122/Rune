import { getAppHealthSnapshot, type AppHealthSnapshot } from "@/lib/app-health-snapshot";
import { getBuildIntelligenceSnapshot, type BuildIntelligenceSnapshot } from "@/lib/build-intelligence";
import { getDeployHealthSnapshot, type DeployHealthSnapshot } from "@/lib/deploy-health";
import { getSupabaseClient } from "@/lib/supabase";
import { listRepoActionProposals, type RepoActionProposalRow } from "@/lib/repo-actions";
import { JARVIS_CANONICAL_PROJECTS, getProjectByKey, type JarvisProjectKey } from "@/lib/project-registry";
import { logError } from "@/lib/errors";

export type OperatorBriefingStatus = "healthy" | "warning" | "blocked";

export interface OperatorBriefingProjectSummary {
  key: JarvisProjectKey;
  label: string;
  repo: string;
  safetyLevel: string;
  healthStatus: string;
  healthScore: number | null;
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
  return text.includes("external service readiness") || text.includes("read-only credentials") || text.includes("visibility") || text.includes("missing configuration");
}

function combineStatuses(statuses: OperatorBriefingStatus[]): OperatorBriefingStatus {
  if (statuses.includes("blocked")) return "blocked";
  if (statuses.includes("warning")) return "warning";
  return "healthy";
}

function getBuildRunStatus(build: BuildIntelligenceSnapshot) {
  return build.github.latestWorkflowRun?.conclusion || build.github.latestWorkflowRun?.status || (build.github.error ? "warning" : "unknown");
}

function summarizeProject(
  projectKey: JarvisProjectKey,
  health: AppHealthSnapshot,
  build: BuildIntelligenceSnapshot,
  deploy: DeployHealthSnapshot | null
): OperatorBriefingProjectSummary {
  const project = getProjectByKey(projectKey) || JARVIS_CANONICAL_PROJECTS.find((item) => item.key === projectKey)!;
  const warnings = [
    ...health.blockers.slice(0, 4),
    ...(build.github.error ? [`GitHub visibility: ${build.github.error}`] : []),
    ...(build.vercel.error ? [`Vercel visibility: ${build.vercel.error}`] : []),
  ].slice(0, 6);
  const hasOnlyIntegrationVisibilityWarnings = warnings.length > 0 && warnings.every(isIntegrationVisibilityWarning);

  return {
    key: project.key,
    label: project.label,
    repo: project.repo,
    safetyLevel: project.safetyLevel,
    healthStatus: hasOnlyIntegrationVisibilityWarnings && health.status === "blocked" ? "warning" : health.status,
    healthScore: typeof health.score === "number" ? health.score : null,
    buildStatus: getBuildRunStatus(build),
    latestCommit: build.github.latestCommit?.sha?.slice(0, 7) || null,
    deploySignal: project.key === "jarvis" ? deploy?.overall || "unknown" : "not_applicable",
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
  const ownerMemoryConfigured = Boolean(process.env.JARVIS_OWNER_MEMORY?.trim());

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
      : "Supabase memory tables are not fully reachable from Jarvis.",
  };
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
    detail: "Jarvis has no active blockers, proposals, or runner jobs needing immediate review.",
    target: "none",
  };
}

export async function getDailyOperatorBriefing(): Promise<OperatorBriefing> {
  const [deployResult, memory, tasks, proposals] = await Promise.all([
    getDeployHealthSnapshot({ skipActionLog: true }).catch((error) => {
      logError("operatorBriefing.deployHealth", error);
      return null;
    }),
    getMemorySummary(),
    getRecentWorkspaceTasks(),
    listRepoActionProposals({ limit: 12 }),
  ]);

  const projectResults = await Promise.all(
    JARVIS_CANONICAL_PROJECTS.map(async (project) => {
      const [health, build] = await Promise.all([
        getAppHealthSnapshot({ projectKey: project.key, repo: project.repo, skipActionLog: true }),
        getBuildIntelligenceSnapshot({ projectKey: project.key, repo: project.repo, skipActionLog: true }),
      ]);
      return summarizeProject(project.key, health, build, deployResult);
    })
  );

  const proposalSummaries = proposals.slice(0, 8).map(summarizeProposal);
  const statusSignals = [
    ...projectResults.map((project) => normalizeBriefingStatus(project.healthStatus)),
    normalizeBriefingStatus(deployResult?.overall),
    memory.warning ? "warning" as const : "healthy" as const,
  ];
  const overallStatus = combineStatuses(statusSignals);
  const recommendedNextAction = chooseRecommendedNextAction({
    overallStatus,
    projects: projectResults,
    proposals: proposalSummaries,
    tasks,
    memory,
  });

  return {
    generatedAt: new Date().toISOString(),
    readOnly: true,
    briefingType: "daily_operator",
    overallStatus,
    headline: overallStatus === "healthy"
      ? "Jarvis operator signals look calm."
      : overallStatus === "warning"
        ? "Jarvis has integration visibility or health warnings to review."
        : "Jarvis found a blocked operator signal that needs review.",
    recommendedNextAction,
    projects: projectResults,
    proposals: proposalSummaries,
    tasks,
    memory,
    safetyNotice: [
      "Daily Operator Briefing is read-only.",
      "No repo merge, deploy, rollback, release, schema change, payment action, customer message, runner job, or entitlement change is executed.",
      "Repo Control actions remain behind Javier approval gates.",
    ],
  };
}
