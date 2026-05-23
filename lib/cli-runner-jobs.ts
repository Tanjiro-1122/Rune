import { logActionEvent } from "@/lib/action-events";
import { createQueuedWorkspaceJob, getWorkspaceTask } from "@/lib/tasks";

export type CliRunnerJobKind = "vercel_redeploy" | "vercel_rollback" | "private_app_creator_deploy" | "app_forge_repo_create" | "app_forge_preview_deploy" | "repo_check" | "maintenance";

const ALLOWED_COMMAND_PREFIXES = ["vercel redeploy ", "vercel rollback ", "npm ", "npx ", "git "];

function cleanCommand(command: string) {
  return command.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
}

function isAllowedCommand(command: string) {
  return ALLOWED_COMMAND_PREFIXES.some((prefix) => command.startsWith(prefix));
}

export async function queueCliRunnerJob(options: {
  workspaceId?: string | null;
  conversationId?: string | null;
  sessionId?: string | null;
  title: string;
  command: string;
  kind: CliRunnerJobKind;
  riskLevel?: "low" | "medium" | "high";
  approvalText?: string | null;
  reason?: string | null;
  metadata?: Record<string, unknown> | null;
}) {
  const command = cleanCommand(options.command);
  const workspaceId = options.workspaceId || (process.env.RUNE_DEFAULT_WORKSPACE_ID ?? process.env.JARVIS_DEFAULT_WORKSPACE_ID) || null;

  if (!workspaceId) {
    return { ok: false as const, error: "workspaceId is required to queue a CLI runner job." };
  }
  if (!command || command.length > 1200) {
    return { ok: false as const, error: "CLI runner command is empty or too long." };
  }
  if (!isAllowedCommand(command)) {
    await logActionEvent({
      eventType: "cli_runner.queue_blocked",
      summary: `CLI runner job blocked: ${options.title}`,
      status: "blocked",
      approvalStage: "approval",
      riskLevel: "high",
      projectKey: "rune",
      workspaceId,
      conversationId: options.conversationId ?? null,
      metadata: { kind: options.kind, reason_blocked: "command_prefix_not_allowlisted", commandPreview: command.slice(0, 160) },
    });
    return { ok: false as const, error: "CLI command prefix is not allowlisted for runner queueing." };
  }

  const runnerMetadata = {
    job_kind: options.kind,
    execution_mode: "queued_only_no_local_execution",
    command,
    approval_text: options.approvalText || null,
    reason: options.reason || null,
    risk_level: options.riskLevel || "high",
    queued_at: new Date().toISOString(),
    ...(options.metadata ?? {}),
  };

  const taskId = await createQueuedWorkspaceJob({
    workspaceId,
    conversationId: options.conversationId ?? null,
    title: options.title,
    inputText: command,
    intent: "cli_runner",
    steps: [
      { key: "verify", label: "Verify approval and command" },
      { key: "execute", label: "Run command in external CLI runner" },
      { key: "report", label: "Report CLI runner result" },
    ],
    runnerMetadata,
  });

  if (!taskId) return { ok: false as const, error: "Failed to queue CLI runner job." };

  await logActionEvent({
    eventType: "cli_runner.job_queued",
    summary: `CLI runner job queued: ${options.title}`,
    status: "approved",
    approvalStage: "action",
    riskLevel: options.riskLevel || "high",
    projectKey: "rune",
    workspaceId,
    conversationId: options.conversationId ?? null,
    metadata: { taskId, kind: options.kind, commandPreview: command.slice(0, 220), executionMode: "queued_only_no_local_execution" },
  });

  return {
    ok: true as const,
    taskId,
    task: await getWorkspaceTask(taskId),
    command,
    safety: "queued_only_no_local_execution",
    message: "CLI runner job was queued for an external approved runner. Rune did not execute the command in the web runtime.",
  };
}
