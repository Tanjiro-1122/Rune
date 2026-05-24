import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { logActionEvent } from "@/lib/action-events";
import { verifyAppForgeRunnerResult } from "@/lib/app-forge";
import {
  claimNextRunnerTask,
  heartbeatRunnerTask,
  releaseRunnerTask,
  updateWorkspaceTaskStep,
} from "@/lib/tasks";

const RunnerEvidenceSchema = z.object({
  repo: z.string().max(180).optional().nullable(),
  branch: z.string().max(180).optional().nullable(),
  commitSha: z.string().max(80).optional().nullable(),
  prUrl: z.string().max(260).optional().nullable(),
  deploymentUrl: z.string().max(500).optional().nullable(),
  liveSmokeOk: z.boolean().optional().nullable(),
}).optional();

const RunnerActionSchema = z.object({
  action: z.enum(["claim", "heartbeat", "complete", "fail"]),
  runnerId: z.string().min(3).max(120),
  taskId: z.string().uuid().optional(),
  message: z.string().max(1000).optional(),
  evidence: RunnerEvidenceSchema,
});

function getBearerToken(req: NextRequest) {
  const header = req.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
}

function isRunnerAuthorized(req: NextRequest) {
  const configured = process.env.RUNE_RUNNER_TOKEN?.trim();
  if (!configured) return { ok: false, error: "Runner token is not configured. Set RUNE_RUNNER_TOKEN." };
  const provided = getBearerToken(req);
  if (!provided || provided !== configured) return { ok: false, error: "Runner authorization failed." };
  return { ok: true };
}

export async function POST(req: NextRequest) {
  const auth = isRunnerAuthorized(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.error?.includes("configured") ? 503 : 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = RunnerActionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid runner request.", details: parsed.error.flatten() }, { status: 400 });
  }

  const { action, runnerId, taskId, message, evidence } = parsed.data;

  if (action === "claim") {
    const task = await claimNextRunnerTask({ runnerId });
    await logActionEvent({
      eventType: task ? "runner.task_claimed" : "runner.claim_empty",
      summary: task ? `Runner claimed job: ${task.title}` : `Runner ${runnerId} found no queued job`,
      status: "info",
      approvalStage: "action",
      riskLevel: "low",
      projectKey: "rune",
      workspaceId: task?.workspaceId ?? null,
      conversationId: task?.conversationId ?? null,
      metadata: { runnerId, taskId: task?.id ?? null },
    });
    return NextResponse.json({ task });
  }

  if (!taskId) return NextResponse.json({ error: "taskId is required for this runner action." }, { status: 400 });

  if (action === "heartbeat") {
    const task = await heartbeatRunnerTask({ taskId, runnerId, message });
    if (!task) return NextResponse.json({ error: "Task not found or runner does not own it." }, { status: 404 });
    return NextResponse.json({ task });
  }

  if (action === "complete") {
    const task = await heartbeatRunnerTask({ taskId, runnerId, message: message ?? "Runner submitted completion evidence." });
    if (!task) return NextResponse.json({ error: "Task not found or runner does not own it." }, { status: 404 });

    const jobKind = String(task.runnerMetadata?.job_kind ?? "");
    if (jobKind === "app_forge_repo_create" || jobKind === "app_forge_preview_deploy") {
      const verification = verifyAppForgeRunnerResult({
        kind: jobKind === "app_forge_repo_create" ? "repo_create" : "preview_deploy",
        repo: evidence?.repo || String(task.runnerMetadata?.target_repo || task.runnerMetadata?.repo || ""),
        branch: evidence?.branch || (typeof task.runnerMetadata?.branch === "string" ? task.runnerMetadata.branch : null),
        commitSha: evidence?.commitSha || null,
        prUrl: evidence?.prUrl || null,
        deploymentUrl: evidence?.deploymentUrl || null,
        liveSmokeOk: evidence?.liveSmokeOk ?? null,
        runnerTaskId: taskId,
        runnerStatus: "complete_submitted",
      });

      await logActionEvent({
        eventType: verification.completed ? "runner.app_forge_proof_verified" : "runner.app_forge_proof_missing",
        summary: verification.completed ? `Runner proof verified: ${task.title}` : `Runner completion blocked: missing App Forge proof for ${task.title}`,
        status: verification.completed ? "executed" : "blocked",
        approvalStage: verification.completed ? "complete" : "action",
        riskLevel: verification.completed ? "low" : "medium",
        projectKey: "rune",
        workspaceId: task.workspaceId,
        conversationId: task.conversationId,
        metadata: { runnerId, taskId, jobKind, completionTruth: verification.completionTruth, completionEvidence: verification.completionEvidence },
      });

      if (!verification.completed) {
        await updateWorkspaceTaskStep({ taskId, stepKey: "report", status: "running", detail: verification.message, progress: 90 });
        return NextResponse.json({
          ok: false,
          completed: false,
          completionTruth: verification.completionTruth,
          completionEvidence: verification.completionEvidence,
          message: verification.message,
          task,
        }, { status: 409 });
      }

      await updateWorkspaceTaskStep({ taskId, stepKey: "report", status: "completed", detail: verification.message, progress: 95 });
      const released = await releaseRunnerTask({ taskId, runnerId, status: "completed", message: verification.message });
      return NextResponse.json({ task: released, completed: true, completionTruth: verification.completionTruth, completionEvidence: verification.completionEvidence });
    }

    await updateWorkspaceTaskStep({ taskId, stepKey: "report", status: "completed", detail: message ?? "Runner completed job.", progress: 95 });
    const released = await releaseRunnerTask({ taskId, runnerId, status: "completed", message: message ?? "Runner completed job." });
    await logActionEvent({
      eventType: "runner.task_completed",
      summary: `Runner completed job: ${task.title}`,
      status: "executed",
      approvalStage: "complete",
      riskLevel: "low",
      projectKey: "rune",
      workspaceId: task.workspaceId,
      conversationId: task.conversationId,
      metadata: { runnerId, taskId },
    });
    return NextResponse.json({ task: released });
  }

  await updateWorkspaceTaskStep({ taskId, stepKey: "report", status: "failed", detail: message ?? "Runner failed job.", progress: 100 });
  const task = await releaseRunnerTask({ taskId, runnerId, status: "failed", message: message ?? "Runner failed job." });
  if (!task) return NextResponse.json({ error: "Task not found or runner does not own it." }, { status: 404 });
  await logActionEvent({
    eventType: "runner.task_failed",
    summary: `Runner failed job: ${task.title}`,
    status: "failed",
    approvalStage: "action",
    riskLevel: "medium",
    projectKey: "rune",
    workspaceId: task.workspaceId,
    conversationId: task.conversationId,
    metadata: { runnerId, taskId },
  });
  return NextResponse.json({ task });
}
