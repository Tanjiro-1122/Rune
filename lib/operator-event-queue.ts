import { getSupabaseClient } from "@/lib/supabase";
import { getAppHealthSnapshot } from "@/lib/app-health-snapshot";
import { createQueuedWorkspaceJob, getWorkspaceTasks, type WorkspaceTaskStepInput } from "@/lib/tasks";
import type { OperatorRemediationAction } from "@/lib/operator-remediation";

export type OperatorEventKind = "health_snapshot" | "ci_failure" | "deployment_failure";

export interface OperatorQueueEventInput {
  kind: OperatorEventKind;
  projectKey: string;
  workspaceId?: string | null;
  conversationId?: string | null;
  source?: string | null;
  payload?: Record<string, unknown> | null;
}

export interface OperatorEventQueueResult {
  ok: boolean;
  configured: boolean;
  eventKey?: string;
  queuedTaskIds: string[];
  skipped: Array<{ actionId?: string; reason: string }>;
  message: string;
}

function getDefaultWorkspaceId(input?: string | null) {
  return input || process.env.RUNE_DEFAULT_WORKSPACE_ID || process.env.JARVIS_DEFAULT_WORKSPACE_ID || null;
}

function stableEventKey(parts: Array<string | null | undefined>) {
  return parts.map((part) => String(part || "none").trim().toLowerCase()).join(":").replace(/[^a-z0-9:_-]+/g, "-").slice(0, 240);
}

function actionSteps(action: OperatorRemediationAction): WorkspaceTaskStepInput[] {
  return [
    ...(action.targetFiles?.length ? [{ key: "inspect_targets", label: `Inspect ${action.targetFiles.join(", ")}` }] : []),
    ...(action.probableFix ?? []).map((label, index) => ({ key: `fix_${index + 1}`, label })),
    ...(action.verification ?? []).map((label, index) => ({ key: `verify_${index + 1}`, label })),
    { key: "executor_ready", label: "Ready for Operator Executor claim" },
  ].slice(0, 10);
}

async function hasExistingQueuedEventTask(workspaceId: string, eventKey: string, actionId: string) {
  const supabase = getSupabaseClient();
  if (!supabase) return false;

  const { data, error } = await supabase
    .from("workspace_tasks")
    .select("id, runner_metadata, status")
    .eq("workspace_id", workspaceId)
    .in("status", ["queued", "running"])
    .limit(50);

  if (error || !data) return false;
  return data.some((row) => {
    const metadata = row.runner_metadata as Record<string, unknown> | null;
    return metadata?.operatorEventKey === eventKey && metadata?.operatorActionId === actionId;
  });
}

async function queueRemediationAction(input: {
  workspaceId: string;
  conversationId?: string | null;
  eventKey: string;
  projectKey: string;
  action: OperatorRemediationAction;
  source?: string | null;
}) {
  const alreadyQueued = await hasExistingQueuedEventTask(input.workspaceId, input.eventKey, input.action.id);
  if (alreadyQueued) return { taskId: null, skipped: true, reason: "matching queued/running task already exists" };

  const taskId = await createQueuedWorkspaceJob({
    workspaceId: input.workspaceId,
    conversationId: input.conversationId ?? null,
    title: `Queued remediation: ${input.action.title}`,
    inputText: [
      `Event key: ${input.eventKey}`,
      `Project: ${input.projectKey}`,
      `Source: ${input.source || "operator-event-queue"}`,
      `Action: ${input.action.id}`,
      `Reason: ${input.action.reason}`,
    ].join("\n"),
    intent: input.action.type,
    steps: actionSteps(input.action),
    runnerMetadata: {
      operatorQueueVersion: 1,
      operatorEventKey: input.eventKey,
      operatorActionId: input.action.id,
      operatorActionType: input.action.type,
      approvalRequired: input.action.approvalRequired,
      targetFiles: input.action.targetFiles ?? [],
      source: input.source || "operator-event-queue",
      executor: input.action.approvalRequired ? "approval_required_before_executor" : "operator_executor_bridge_v3",
    },
  });

  return { taskId, skipped: false, reason: taskId ? "queued" : "task creation failed" };
}

export async function enqueueOperatorEvent(input: OperatorQueueEventInput): Promise<OperatorEventQueueResult> {
  const workspaceId = getDefaultWorkspaceId(input.workspaceId);
  if (!workspaceId) {
    return {
      ok: false,
      configured: false,
      queuedTaskIds: [],
      skipped: [{ reason: "RUNE_DEFAULT_WORKSPACE_ID or explicit workspaceId is required for background operator events." }],
      message: "Operator event queue is not configured with a default workspace.",
    };
  }

  const projectKey = input.projectKey || "rune";
  const eventKey = stableEventKey([input.kind, projectKey, input.source, JSON.stringify(input.payload ?? {}).slice(0, 120)]);
  const queuedTaskIds: string[] = [];
  const skipped: OperatorEventQueueResult["skipped"] = [];

  if (input.kind === "health_snapshot") {
    const snapshot = await getAppHealthSnapshot({ projectKey });
    for (const action of snapshot.actionRecommendations.slice(0, 5)) {
      const result = await queueRemediationAction({
        workspaceId,
        conversationId: input.conversationId ?? null,
        eventKey,
        projectKey,
        action,
        source: input.source || "health_snapshot",
      });
      if (result.taskId) queuedTaskIds.push(result.taskId);
      if (result.skipped) skipped.push({ actionId: action.id, reason: result.reason });
    }
    if (snapshot.actionRecommendations.length === 0) skipped.push({ reason: "health snapshot had no remediation recommendations" });
  } else {
    skipped.push({ reason: `${input.kind} event ingestion is reserved for webhook-specific mappers in a later PR.` });
  }

  return {
    ok: true,
    configured: true,
    eventKey,
    queuedTaskIds,
    skipped,
    message: queuedTaskIds.length
      ? `Queued ${queuedTaskIds.length} operator remediation task(s). Execution remains gated by Executor Bridge and Repo Control.`
      : "No operator remediation tasks were queued.",
  };
}

export async function runOperatorEventQueueHealthSweep(options: { projectKeys?: string[]; workspaceId?: string | null } = {}) {
  const projectKeys = options.projectKeys?.length ? options.projectKeys : ["unfiltr", "sports-wager-helper", "rune"];
  const results = [];
  for (const projectKey of projectKeys) {
    results.push(await enqueueOperatorEvent({ kind: "health_snapshot", projectKey, workspaceId: options.workspaceId ?? null, source: "cron.health_sweep" }));
  }
  return {
    ok: results.every((result) => result.ok || result.configured === false),
    results,
    queuedTaskIds: results.flatMap((result) => result.queuedTaskIds),
  };
}
