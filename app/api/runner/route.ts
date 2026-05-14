import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { logActionEvent } from "@/lib/action-events";
import {
  claimNextRunnerTask,
  heartbeatRunnerTask,
  releaseRunnerTask,
  updateWorkspaceTaskStep,
} from "@/lib/tasks";

const RunnerActionSchema = z.object({
  action: z.enum(["claim", "heartbeat", "complete", "fail"]),
  runnerId: z.string().min(3).max(120),
  taskId: z.string().uuid().optional(),
  message: z.string().max(1000).optional(),
});

function getBearerToken(req: NextRequest) {
  const header = req.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
}

function isRunnerAuthorized(req: NextRequest) {
  const configured = process.env.JARVIS_RUNNER_TOKEN?.trim();
  if (!configured) return { ok: false, error: "Runner token is not configured. Set JARVIS_RUNNER_TOKEN." };
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

  const { action, runnerId, taskId, message } = parsed.data;

  if (action === "claim") {
    const task = await claimNextRunnerTask({ runnerId });
    await logActionEvent({
      eventType: task ? "runner.task_claimed" : "runner.claim_empty",
      summary: task ? `Runner claimed job: ${task.title}` : `Runner ${runnerId} found no queued job`,
      status: "info",
      approvalStage: "action",
      riskLevel: "low",
      projectKey: "jarvis",
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
    await updateWorkspaceTaskStep({ taskId, stepKey: "report", status: "completed", detail: message ?? "Runner completed job.", progress: 95 });
    const task = await releaseRunnerTask({ taskId, runnerId, status: "completed", message: message ?? "Runner completed job." });
    if (!task) return NextResponse.json({ error: "Task not found or runner does not own it." }, { status: 404 });
    await logActionEvent({
      eventType: "runner.task_completed",
      summary: `Runner completed job: ${task.title}`,
      status: "executed",
      approvalStage: "complete",
      riskLevel: "low",
      projectKey: "jarvis",
      workspaceId: task.workspaceId,
      conversationId: task.conversationId,
      metadata: { runnerId, taskId },
    });
    return NextResponse.json({ task });
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
    projectKey: "jarvis",
    workspaceId: task.workspaceId,
    conversationId: task.conversationId,
    metadata: { runnerId, taskId },
  });
  return NextResponse.json({ task });
}
