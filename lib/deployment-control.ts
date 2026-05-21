import { getRuneRuntimeIdentity } from "@/lib/project-runtime";
import { logActionEvent } from "@/lib/action-events";
import { logError } from "@/lib/errors";
import { queueCliRunnerJob } from "@/lib/cli-runner-jobs";

export type DeploymentControlAction = "inspect" | "prepare_redeploy" | "prepare_rollback" | "execute_redeploy" | "execute_rollback";

type VercelDeploymentSummary = {
  uid?: string;
  name?: string | null;
  state?: string | null;
  url?: string | null;
  createdAt?: string | null;
  readyAt?: string | null;
  target?: string | null;
  gitBranch?: string | null;
  creator?: string | null;
};

function isoFromVercelTimestamp(value: unknown) {
  if (typeof value === "number") return new Date(value < 10_000_000_000 ? value * 1000 : value).toISOString();
  if (typeof value === "string" && value) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return null;
}

function getVercelConfig() {
  const token = process.env.VERCEL_TOKEN || process.env.RUNE_VERCEL_TOKEN;
  const project = getRuneRuntimeIdentity().vercelProjectId || process.env.VERCEL_PROJECT_NAME || process.env.JARVIS_VERCEL_PROJECT_NAME;
  const teamId = process.env.VERCEL_TEAM_ID || ((process.env.RUNE_VERCEL_TEAM_ID ?? process.env.JARVIS_VERCEL_TEAM_ID));
  return { token, project, teamId };
}

function toDeploymentSummary(deployment: {
  uid?: string;
  name?: string | null;
  state?: string | null;
  url?: string | null;
  createdAt?: number;
  ready?: number;
  readyAt?: number;
  target?: string | null;
  meta?: Record<string, unknown>;
  creator?: { username?: string | null; email?: string | null } | null;
}): VercelDeploymentSummary {
  return {
    uid: deployment.uid,
    name: deployment.name,
    state: deployment.state,
    url: deployment.url ? `https://${deployment.url}` : null,
    createdAt: isoFromVercelTimestamp(deployment.createdAt),
    readyAt: isoFromVercelTimestamp(deployment.readyAt ?? deployment.ready),
    target: deployment.target,
    gitBranch: typeof deployment.meta?.githubCommitRef === "string" ? deployment.meta.githubCommitRef : null,
    creator: deployment.creator?.username || deployment.creator?.email || null,
  };
}

async function listVercelDeployments(options: { limit?: number; target?: string | null; gitBranch?: string | null } = {}) {
  const { token, project, teamId } = getVercelConfig();
  if (!token) return { ok: false, configured: false, error: "Vercel token is not configured." } as const;

  try {
    const params = new URLSearchParams({ limit: String(options.limit || 5) });
    if (project) params.set("projectId", project);
    if (teamId) params.set("teamId", teamId);
    if (options.target) params.set("target", options.target);
    if (options.gitBranch) params.set("gitBranch", options.gitBranch);

    const response = await fetch(`https://api.vercel.com/v6/deployments?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Vercel API ${response.status}: ${text.slice(0, 180)}`);
    }
    const payload = (await response.json()) as {
      deployments?: Parameters<typeof toDeploymentSummary>[0][];
    };
    return {
      ok: true,
      configured: true,
      project: project || null,
      deployments: (payload.deployments || []).map(toDeploymentSummary),
    } as const;
  } catch (error) {
    logError("deploymentControl.listVercelDeployments", error);
    return {
      ok: false,
      configured: true,
      project: project || null,
      error: error instanceof Error ? error.message : "Unable to inspect Vercel deployments.",
    } as const;
  }
}

export async function inspectDeploymentControl(options: { gitBranch?: string | null; target?: string | null; limit?: number } = {}) {
  const result = await listVercelDeployments({
    gitBranch: options.gitBranch || undefined,
    target: options.target || undefined,
    limit: options.limit || 5,
  });

  await logActionEvent({
    eventType: "deployment.inspect",
    summary: result.ok ? "Deployment status inspected" : "Deployment inspection unavailable",
    status: result.ok ? "info" : "blocked",
    approvalStage: "none",
    riskLevel: "medium",
    projectKey: "rune",
    metadata: {
      configured: result.configured,
      project: "project" in result ? result.project : null,
      deploymentCount: result.ok ? result.deployments.length : 0,
      error: result.ok ? null : result.error,
    },
  });

  return result;
}

export async function prepareDeploymentControlAction(options: {
  action: Exclude<DeploymentControlAction, "inspect">;
  deploymentId?: string | null;
  reason?: string | null;
}) {
  const inspection = await listVercelDeployments({ limit: 8, target: "production" });
  const latest = inspection.ok ? inspection.deployments[0] ?? null : null;
  const rollbackCandidate = inspection.ok
    ? inspection.deployments.find((deployment, index) => index > 0 && deployment.state === "READY") ?? null
    : null;
  const selectedDeployment = options.deploymentId && inspection.ok
    ? inspection.deployments.find((deployment) => deployment.uid === options.deploymentId) ?? null
    : options.action === "prepare_rollback"
      ? rollbackCandidate
      : latest;

  const ready = inspection.ok && Boolean(selectedDeployment);
  const safety = options.action === "prepare_redeploy"
    ? "prepared_redeploy_only_no_api_mutation"
    : "prepared_rollback_only_no_api_mutation";

  await logActionEvent({
    eventType: `deployment.${options.action}`,
    summary: ready ? `Deployment ${options.action.replace("prepare_", "")} prepared for approval` : `Deployment ${options.action.replace("prepare_", "")} could not be prepared`,
    status: ready ? "proposed" : "blocked",
    approvalStage: "approval",
    riskLevel: "high",
    projectKey: "rune",
    metadata: {
      action: options.action,
      reason: options.reason || null,
      selectedDeployment,
      latestDeployment: latest,
      rollbackCandidate,
      safety,
      error: inspection.ok ? null : inspection.error,
    },
  });

  if (!inspection.ok) return { ok: false, error: inspection.error, configured: inspection.configured };
  if (!selectedDeployment) {
    return {
      ok: false,
      error: options.action === "prepare_rollback"
        ? "No READY rollback candidate was found in recent production deployments."
        : "No deployment was found to prepare redeploy.",
      deployments: inspection.deployments,
    };
  }

  return {
    ok: true,
    action: options.action,
    deployment: selectedDeployment,
    latestDeployment: latest,
    rollbackCandidate,
    safety,
    message: "Deployment action prepared for Javier approval only. No redeploy, rollback, merge, or production mutation happened.",
  };
}


function getDeploymentMutationMode() {
  return ((process.env.RUNE_DEPLOYMENT_MUTATION_MODE ?? process.env.JARVIS_DEPLOYMENT_MUTATION_MODE) || "disabled").trim().toLowerCase();
}

function expectedDeploymentApprovalText(action: "execute_redeploy" | "execute_rollback") {
  return action === "execute_redeploy"
    ? "APPROVE RUNE REDEPLOY"
    : "APPROVE RUNE ROLLBACK";
}

export async function executeDeploymentControlAction(options: {
  action: "execute_redeploy" | "execute_rollback";
  deploymentId?: string | null;
  approvalText?: string | null;
  reason?: string | null;
  workspaceId?: string | null;
  conversationId?: string | null;
}) {
  const expectedApproval = expectedDeploymentApprovalText(options.action);
  const approvalText = (options.approvalText || "").trim();
  const mutationMode = getDeploymentMutationMode();
  const { token, project, teamId } = getVercelConfig();

  const inspection = await listVercelDeployments({ limit: 8, target: "production" });
  const selectedDeployment = options.deploymentId && inspection.ok
    ? inspection.deployments.find((deployment) => deployment.uid === options.deploymentId) ?? null
    : options.action === "execute_rollback" && inspection.ok
      ? inspection.deployments.find((deployment, index) => index > 0 && deployment.state === "READY") ?? null
      : inspection.ok
        ? inspection.deployments[0] ?? null
        : null;

  const baseMetadata = {
    action: options.action,
    reason: options.reason || null,
    selectedDeployment,
    expectedApproval,
    receivedApproval: approvalText ? "provided" : "missing",
    mutationMode,
    configured: Boolean(token),
    project: project || null,
    teamId: teamId || null,
  };

  if (approvalText !== expectedApproval) {
    await logActionEvent({
      eventType: `deployment.${options.action}.blocked`,
      summary: `Deployment ${options.action.replace("execute_", "")} blocked: approval phrase missing`,
      status: "blocked",
      approvalStage: "approval",
      riskLevel: "high",
      projectKey: "rune",
      metadata: { ...baseMetadata, reason_blocked: "approval_text_mismatch" },
    });
    return {
      ok: false,
      blocked: true,
      error: `Deployment mutation requires exact approval text: ${expectedApproval}`,
      expectedApproval,
      safety: "blocked_no_deployment_mutation",
    };
  }

  if (!inspection.ok) {
    await logActionEvent({
      eventType: `deployment.${options.action}.blocked`,
      summary: `Deployment ${options.action.replace("execute_", "")} blocked: Vercel inspection unavailable`,
      status: "blocked",
      approvalStage: "action",
      riskLevel: "high",
      projectKey: "rune",
      metadata: { ...baseMetadata, reason_blocked: "inspection_failed", error: inspection.error },
    });
    return { ok: false, blocked: true, error: inspection.error, configured: inspection.configured, safety: "blocked_no_deployment_mutation" };
  }

  if (!selectedDeployment?.uid && !selectedDeployment?.url) {
    await logActionEvent({
      eventType: `deployment.${options.action}.blocked`,
      summary: `Deployment ${options.action.replace("execute_", "")} blocked: no deployment target`,
      status: "blocked",
      approvalStage: "action",
      riskLevel: "high",
      projectKey: "rune",
      metadata: { ...baseMetadata, reason_blocked: "no_deployment_target" },
    });
    return { ok: false, blocked: true, error: "No deployment target was found for this action.", deployments: inspection.deployments, safety: "blocked_no_deployment_mutation" };
  }

  // Vercel documents redeploy/rollback through the CLI. We intentionally do not call
  // undocumented production mutation endpoints from the web app runtime. A future
  // runner can execute the documented CLI command after this same approval gate.
  const command = options.action === "execute_redeploy"
    ? `vercel redeploy ${selectedDeployment.url || selectedDeployment.uid} --token=$VERCEL_TOKEN`
    : `vercel rollback ${selectedDeployment.url || selectedDeployment.uid} --token=$VERCEL_TOKEN`;

  if (mutationMode !== "cli_runner") {
    await logActionEvent({
      eventType: `deployment.${options.action}.blocked`,
      summary: `Deployment ${options.action.replace("execute_", "")} approved but blocked: CLI runner not enabled`,
      status: "blocked",
      approvalStage: "action",
      riskLevel: "high",
      projectKey: "rune",
      metadata: { ...baseMetadata, workspaceId: options.workspaceId ?? null, conversationId: options.conversationId ?? null, reason_blocked: "cli_runner_not_enabled", documentedCommand: command },
    });
    return {
      ok: false,
      blocked: true,
      error: "Approval was valid, but deployment mutation is disabled because JARVIS_DEPLOYMENT_MUTATION_MODE is not set to cli_runner.",
      action: options.action,
      deployment: selectedDeployment,
      documentedCommand: command,
      safety: "approved_but_blocked_no_deployment_mutation",
      message: "Rune prepared the exact documented Vercel CLI command but did not redeploy or rollback production.",
    };
  }

  const queued = await queueCliRunnerJob({
    workspaceId: options.workspaceId || ((process.env.RUNE_DEFAULT_WORKSPACE_ID ?? process.env.JARVIS_DEFAULT_WORKSPACE_ID)) || null,
    conversationId: options.conversationId ?? null,
    title: options.action === "execute_redeploy" ? "Approved Vercel redeploy" : "Approved Vercel rollback",
    command,
    kind: options.action === "execute_redeploy" ? "vercel_redeploy" : "vercel_rollback",
    riskLevel: "high",
    approvalText,
    reason: options.reason || null,
    metadata: { deployment: selectedDeployment, action: options.action },
  });

  if (!queued.ok) {
    await logActionEvent({
      eventType: `deployment.${options.action}.blocked`,
      summary: `Deployment ${options.action.replace("execute_", "")} approved but queueing failed`,
      status: "blocked",
      approvalStage: "action",
      riskLevel: "high",
      projectKey: "rune",
      metadata: { ...baseMetadata, workspaceId: options.workspaceId ?? null, conversationId: options.conversationId ?? null, reason_blocked: "cli_runner_queue_failed", documentedCommand: command, error: queued.error },
    });
    return {
      ok: false,
      blocked: true,
      error: queued.error,
      action: options.action,
      deployment: selectedDeployment,
      documentedCommand: command,
      safety: "approved_but_not_queued_no_deployment_mutation",
    };
  }

  return {
    ok: true,
    blocked: false,
    action: options.action,
    deployment: selectedDeployment,
    documentedCommand: command,
    taskId: queued.taskId,
    task: queued.task,
    safety: queued.safety,
    message: queued.message,
  };
}
