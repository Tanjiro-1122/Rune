import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { logActionEvent } from "@/lib/action-events";
import {
  addWorkspaceTaskCheckpoint,
  claimQueuedWorkspaceTask,
  completeWorkspaceTask,
  createQueuedWorkspaceJob,
  failWorkspaceTask,
  getLatestWorkspaceTaskCheckpoint,
  getWorkspaceTask,
  getWorkspaceTasks,
  updateWorkspaceTaskStep,
} from "@/lib/tasks";
import { resolveOwnerSessionId } from "@/lib/owner-session";

const CreateJobSchema = z.object({
  workspaceId: z.string().uuid(),
  conversationId: z.string().uuid().optional().nullable(),
  sessionId: z.string().max(160).optional().nullable(),
  title: z.string().min(1).max(180),
  inputText: z.string().min(1).max(3000),
  intent: z.enum(["audit", "research", "plan", "file_review"]).default("plan"),
});

const RunJobSchema = z.object({
  taskId: z.string().uuid(),
  sessionId: z.string().max(160).optional().nullable(),
});

const CheckpointJobSchema = z.object({
  action: z.literal("checkpoint"),
  taskId: z.string().uuid(),
  sessionId: z.string().max(160).optional().nullable(),
  label: z.string().min(1).max(180),
  summary: z.string().min(1).max(1600),
  completedStep: z.string().max(300).optional().nullable(),
  nextStep: z.string().max(300).optional().nullable(),
  blocker: z.string().max(500).optional().nullable(),
  metadata: z.record(z.unknown()).optional().nullable(),
});

const LatestCheckpointSchema = z.object({
  action: z.literal("latest_checkpoint"),
  taskId: z.string().uuid(),
});

function summarizeJob(input: string, intent: string) {
  const compact = input.replace(/\s+/g, " ").trim();
  const clipped = compact.length > 360 ? `${compact.slice(0, 360).trimEnd()}…` : compact;
  if (intent === "audit") return `Audit queued work completed. Scope reviewed: ${clipped}`;
  if (intent === "research") return `Research job completed. Topic captured for follow-up: ${clipped}`;
  if (intent === "file_review") return `File-review job completed. Request captured: ${clipped}`;
  return `Planning job completed. Request captured: ${clipped}`;
}

function jobStepsForIntent(intent: string) {
  if (intent === "audit") {
    return [
      { key: "prepare", label: "Capture audit scope" },
      { key: "inspect", label: "Inspect saved workspace context" },
      { key: "report", label: "Save audit checkpoint" },
    ];
  }
  if (intent === "research") {
    return [
      { key: "prepare", label: "Capture research question" },
      { key: "organize", label: "Organize research plan" },
      { key: "report", label: "Save research checkpoint" },
    ];
  }
  return [
    { key: "prepare", label: "Capture job request" },
    { key: "run", label: "Run safe queue step" },
    { key: "report", label: "Save checkpoint" },
  ];
}

export async function GET(req: NextRequest) {
  const workspaceId = req.nextUrl.searchParams.get("workspaceId");
  const conversationId = req.nextUrl.searchParams.get("conversationId");
  if (!workspaceId) return NextResponse.json({ error: "workspaceId is required." }, { status: 400 });
  const tasks = await getWorkspaceTasks({ workspaceId, conversationId, limit: 20 });
  return NextResponse.json({ jobs: tasks });
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = CreateJobSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid job request.", details: parsed.error.flatten() }, { status: 400 });
  }

  const sessionId = await resolveOwnerSessionId(req, parsed.data.sessionId ?? null);

  const taskId = await createQueuedWorkspaceJob({
    workspaceId: parsed.data.workspaceId,
    conversationId: parsed.data.conversationId ?? null,
    title: parsed.data.title,
    inputText: parsed.data.inputText,
    intent: parsed.data.intent,
    steps: jobStepsForIntent(parsed.data.intent),
  });

  if (!taskId) return NextResponse.json({ error: "Failed to create job." }, { status: 500 });

  await logActionEvent({
    eventType: "job.queued",
    summary: `Queued job: ${parsed.data.title}`,
    status: "proposed",
    approvalStage: "plan",
    riskLevel: "low",
    projectKey: "jarvis",
    sessionId,
    workspaceId: parsed.data.workspaceId,
    conversationId: parsed.data.conversationId ?? null,
    metadata: { taskId, intent: parsed.data.intent },
  });

  const task = await getWorkspaceTask(taskId);
  return NextResponse.json({ job: task, taskId }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const checkpointParsed = CheckpointJobSchema.safeParse(body);
  if (checkpointParsed.success) {
    const sessionId = await resolveOwnerSessionId(req, checkpointParsed.data.sessionId ?? null);
    const task = await addWorkspaceTaskCheckpoint(checkpointParsed.data.taskId, {
      label: checkpointParsed.data.label,
      summary: checkpointParsed.data.summary,
      completedStep: checkpointParsed.data.completedStep ?? null,
      nextStep: checkpointParsed.data.nextStep ?? null,
      blocker: checkpointParsed.data.blocker ?? null,
      metadata: checkpointParsed.data.metadata ?? null,
    });
    if (!task) return NextResponse.json({ error: "Unable to save checkpoint." }, { status: 404 });

    await logActionEvent({
      eventType: checkpointParsed.data.blocker ? "job.checkpoint_blocked" : "job.checkpoint_saved",
      summary: `Saved checkpoint: ${checkpointParsed.data.label}`,
      status: checkpointParsed.data.blocker ? "blocked" : "info",
      approvalStage: "action",
      riskLevel: "low",
      projectKey: "jarvis",
      sessionId,
      workspaceId: task.workspaceId,
      conversationId: task.conversationId,
      metadata: { taskId: task.id, nextStep: checkpointParsed.data.nextStep ?? null, blocker: checkpointParsed.data.blocker ?? null },
    });

    return NextResponse.json({ job: task, checkpoint: task.runnerMetadata?.latest_checkpoint ?? null });
  }

  const latestCheckpointParsed = LatestCheckpointSchema.safeParse(body);
  if (latestCheckpointParsed.success) {
    const checkpoint = await getLatestWorkspaceTaskCheckpoint(latestCheckpointParsed.data.taskId);
    const task = await getWorkspaceTask(latestCheckpointParsed.data.taskId);
    if (!task) return NextResponse.json({ error: "Job not found." }, { status: 404 });
    return NextResponse.json({ job: task, checkpoint });
  }

  const parsed = RunJobSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid run/checkpoint request.", details: parsed.error.flatten() }, { status: 400 });
  }

  const sessionId = await resolveOwnerSessionId(req, parsed.data.sessionId ?? null);

  const task = await claimQueuedWorkspaceTask(parsed.data.taskId);
  if (!task) {
    const existing = await getWorkspaceTask(parsed.data.taskId);
    if (!existing) return NextResponse.json({ error: "Job not found." }, { status: 404 });
    return NextResponse.json({ job: existing, message: "Job is not queued, so it was not claimed." });
  }

  try {
    await updateWorkspaceTaskStep({ taskId: task.id, stepKey: "prepare", status: "completed", detail: "Job request captured.", progress: 25 });
    await updateWorkspaceTaskStep({ taskId: task.id, stepKey: task.steps.some((step) => step.key === "inspect") ? "inspect" : "run", status: "running", detail: "Running safe built-in queue action.", progress: 55 });
    await updateWorkspaceTaskStep({ taskId: task.id, stepKey: task.steps.some((step) => step.key === "inspect") ? "inspect" : "run", status: "completed", detail: "Safe queue action completed.", progress: 80 });
    await updateWorkspaceTaskStep({ taskId: task.id, stepKey: "report", status: "completed", detail: "Checkpoint saved.", progress: 95 });
    await completeWorkspaceTask(task.id, summarizeJob(task.inputText, task.intent ?? "plan"));

    await logActionEvent({
      eventType: "job.completed",
      summary: `Completed job: ${task.title}`,
      status: "executed",
      approvalStage: "complete",
      riskLevel: "low",
      projectKey: "jarvis",
      sessionId,
      workspaceId: task.workspaceId,
      conversationId: task.conversationId,
      metadata: { taskId: task.id, intent: task.intent },
    });

    const updated = await getWorkspaceTask(task.id);
    return NextResponse.json({ job: updated });
  } catch (error) {
    await failWorkspaceTask(task.id, error instanceof Error ? error.message : "Job failed.");
    await logActionEvent({
      eventType: "job.failed",
      summary: `Failed job: ${task.title}`,
      status: "failed",
      approvalStage: "action",
      riskLevel: "medium",
      projectKey: "jarvis",
      sessionId,
      workspaceId: task.workspaceId,
      conversationId: task.conversationId,
      metadata: { taskId: task.id, intent: task.intent },
    });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Job failed." }, { status: 500 });
  }
}
