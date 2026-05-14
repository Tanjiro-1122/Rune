import { getSupabaseClient } from "@/lib/supabase";

const MAX_TASKS_PER_QUERY = 25;
const STALE_TASK_WINDOW_MS = 15 * 60 * 1000;
const STALE_TASK_WINDOW_MINUTES = Math.round(STALE_TASK_WINDOW_MS / 60_000);

export type WorkspaceTaskStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type WorkspaceTaskStepStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed";

export interface WorkspaceTaskStepInput {
  key: string;
  label: string;
  detail?: string | null;
}

export interface WorkspaceTaskSummary {
  id: string;
  workspaceId: string;
  conversationId: string | null;
  title: string;
  inputText: string;
  intent: string | null;
  status: WorkspaceTaskStatus;
  progress: number;
  resultSummary: string | null;
  errorMessage: string | null;
  resumeCount: number;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  steps: WorkspaceTaskStepSummary[];
}

export interface WorkspaceTaskStepSummary {
  id: string;
  taskId: string;
  key: string;
  label: string;
  orderIndex: number;
  status: WorkspaceTaskStepStatus;
  detail: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

interface WorkspaceTaskRow {
  id: string;
  workspace_id: string;
  conversation_id: string | null;
  title: string;
  input_text: string;
  intent: string | null;
  status: WorkspaceTaskStatus;
  progress: number;
  result_summary: string | null;
  error_message: string | null;
  resume_count: number;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
}

interface WorkspaceTaskStepRow {
  id: string;
  task_id: string;
  step_key: string;
  label: string;
  order_index: number;
  status: WorkspaceTaskStepStatus;
  detail: string | null;
  started_at: string | null;
  completed_at: string | null;
}

function clampProgress(value?: number | null) {
  if (typeof value !== "number" || Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function mapTask(
  task: WorkspaceTaskRow,
  stepsByTaskId: Map<string, WorkspaceTaskStepSummary[]>
): WorkspaceTaskSummary {
  return {
    id: task.id,
    workspaceId: task.workspace_id,
    conversationId: task.conversation_id,
    title: task.title,
    inputText: task.input_text,
    intent: task.intent,
    status: task.status,
    progress: clampProgress(task.progress),
    resultSummary: task.result_summary,
    errorMessage: task.error_message,
    resumeCount: task.resume_count,
    createdAt: task.created_at,
    updatedAt: task.updated_at,
    startedAt: task.started_at,
    completedAt: task.completed_at,
    steps: stepsByTaskId.get(task.id) ?? [],
  };
}

function mapStep(step: WorkspaceTaskStepRow): WorkspaceTaskStepSummary {
  return {
    id: step.id,
    taskId: step.task_id,
    key: step.step_key,
    label: step.label,
    orderIndex: step.order_index,
    status: step.status,
    detail: step.detail,
    startedAt: step.started_at,
    completedAt: step.completed_at,
  };
}

async function markStaleTasks(workspaceId: string) {
  const supabase = getSupabaseClient();
  if (!supabase) return;

  const cutoff = new Date(Date.now() - STALE_TASK_WINDOW_MS).toISOString();

  await supabase
    .from("workspace_tasks")
    .update({
      status: "failed",
      progress: 100,
      error_message: `Task was interrupted after exceeding the ${STALE_TASK_WINDOW_MINUTES}-minute activity window. Use Resume to continue from the saved context.`,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("workspace_id", workspaceId)
    .in("status", ["queued", "running"])
    .lt("updated_at", cutoff);
}

export async function createWorkspaceTask(options: {
  workspaceId?: string | null;
  conversationId?: string | null;
  title: string;
  inputText: string;
  intent?: string | null;
  steps: WorkspaceTaskStepInput[];
}) {
  const { workspaceId, conversationId, title, inputText, intent, steps } = options;
  const supabase = getSupabaseClient();
  if (!supabase || !workspaceId) return null;

  const taskResponse = await supabase
    .from("workspace_tasks")
    .insert({
      workspace_id: workspaceId,
      conversation_id: conversationId ?? null,
      title,
      input_text: inputText,
      intent: intent ?? null,
      status: "queued",
      progress: 0,
      resume_count: 0,
    })
    .select(
      "id, workspace_id, conversation_id, title, input_text, intent, status, progress, result_summary, error_message, resume_count, created_at, updated_at, started_at, completed_at"
    )
    .single();

  if (taskResponse.error || !taskResponse.data) {
    return null;
  }

  if (steps.length > 0) {
    await supabase.from("workspace_task_steps").insert(
      steps.map((step, index) => ({
        task_id: taskResponse.data.id,
        step_key: step.key,
        label: step.label,
        order_index: index,
        status: "pending",
        detail: step.detail ?? null,
        started_at: null,
      }))
    );
  }

  await supabase
    .from("workspace_tasks")
    .update({
      status: "running",
      progress: 10,
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", taskResponse.data.id);

  await supabase
    .from("workspace_task_steps")
    .update({ status: "running", started_at: new Date().toISOString() })
    .eq("task_id", taskResponse.data.id)
    .eq("order_index", 0);

  return taskResponse.data.id;
}

export async function resumeWorkspaceTask(taskId: string) {
  const supabase = getSupabaseClient();
  if (!supabase) return null;

  const taskResponse = await supabase
    .from("workspace_tasks")
    .select(
      "id, workspace_id, conversation_id, title, input_text, intent, status, progress, result_summary, error_message, resume_count, created_at, updated_at, started_at, completed_at"
    )
    .eq("id", taskId)
    .maybeSingle();

  if (taskResponse.error || !taskResponse.data) {
    return null;
  }

  await Promise.all([
    supabase
      .from("workspace_tasks")
      .update({
        status: "queued",
        progress: 0,
        result_summary: null,
        error_message: null,
        started_at: null,
        completed_at: null,
        resume_count: (taskResponse.data.resume_count ?? 0) + 1,
        updated_at: new Date().toISOString(),
      })
      .eq("id", taskId),
    supabase
      .from("workspace_task_steps")
      .update({
        status: "pending",
        detail: null,
        started_at: null,
        completed_at: null,
      })
      .eq("task_id", taskId),
  ]);

  const firstStep = await supabase
    .from("workspace_task_steps")
    .select("id")
    .eq("task_id", taskId)
    .order("order_index", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!firstStep.error && firstStep.data?.id) {
    await supabase
      .from("workspace_task_steps")
      .update({
        status: "running",
        started_at: new Date().toISOString(),
      })
      .eq("id", firstStep.data.id);
  }

  return taskResponse.data;
}

export async function updateWorkspaceTaskStep(options: {
  taskId: string;
  stepKey: string;
  status: WorkspaceTaskStepStatus;
  detail?: string | null;
  progress?: number;
}) {
  const { taskId, stepKey, status, detail, progress } = options;
  const supabase = getSupabaseClient();
  if (!supabase) return;

  const now = new Date().toISOString();
  const stepPayload: Record<string, string | null> = {
    status,
    detail: detail ?? null,
  };
  if (status === "running") stepPayload.started_at = now;
  if (status === "completed" || status === "failed") stepPayload.completed_at = now;

  await supabase
    .from("workspace_task_steps")
    .update(stepPayload)
    .eq("task_id", taskId)
    .eq("step_key", stepKey);

  const taskPayload: Record<string, string | number | null> = {
    updated_at: now,
  };
  if (typeof progress === "number") {
    taskPayload.progress = clampProgress(progress);
  }
  if (status === "failed") {
    taskPayload.status = "failed";
    taskPayload.completed_at = now;
  }

  await supabase.from("workspace_tasks").update(taskPayload).eq("id", taskId);
}

export async function startWorkspaceTask(taskId: string, progress = 5) {
  const supabase = getSupabaseClient();
  if (!supabase) return;
  const now = new Date().toISOString();
  await supabase
    .from("workspace_tasks")
    .update({
      status: "running",
      progress: clampProgress(progress),
      started_at: now,
      completed_at: null,
      updated_at: now,
    })
    .eq("id", taskId);
}

export async function completeWorkspaceTask(taskId: string, resultSummary?: string | null) {
  const supabase = getSupabaseClient();
  if (!supabase) return;

  const now = new Date().toISOString();

  await Promise.all([
    supabase
      .from("workspace_task_steps")
      .update({ status: "completed", completed_at: now })
      .eq("task_id", taskId)
      .eq("status", "running"),
    supabase
      .from("workspace_tasks")
      .update({
        status: "completed",
        progress: 100,
        result_summary: resultSummary ?? null,
        error_message: null,
        completed_at: now,
        updated_at: now,
      })
      .eq("id", taskId),
  ]);
}

export async function failWorkspaceTask(taskId: string, errorMessage: string) {
  const supabase = getSupabaseClient();
  if (!supabase) return;

  const now = new Date().toISOString();

  await Promise.all([
    supabase
      .from("workspace_task_steps")
      .update({ status: "failed", completed_at: now })
      .eq("task_id", taskId)
      .eq("status", "running"),
    supabase
      .from("workspace_tasks")
      .update({
        status: "failed",
        progress: 100,
        error_message: errorMessage,
        completed_at: now,
        updated_at: now,
      })
      .eq("id", taskId),
  ]);
}

export async function getWorkspaceTasks(options: {
  workspaceId?: string | null;
  conversationId?: string | null;
  limit?: number;
}) {
  const { workspaceId, conversationId, limit } = options;
  const supabase = getSupabaseClient();
  if (!supabase || !workspaceId) return [] as WorkspaceTaskSummary[];

  await markStaleTasks(workspaceId);

  const maxRows = Math.max(1, Math.min(limit ?? 12, MAX_TASKS_PER_QUERY));
  let query = supabase
    .from("workspace_tasks")
    .select(
      "id, workspace_id, conversation_id, title, input_text, intent, status, progress, result_summary, error_message, resume_count, created_at, updated_at, started_at, completed_at"
    )
    .eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false })
    .limit(maxRows);

  if (conversationId) {
    query = query.eq("conversation_id", conversationId);
  }

  const taskResponse = await query;
  if (taskResponse.error) {
    return [] as WorkspaceTaskSummary[];
  }

  const taskRows = (taskResponse.data ?? []) as WorkspaceTaskRow[];
  const taskIds = taskRows.map((task) => task.id);

  const stepsByTaskId = new Map<string, WorkspaceTaskStepSummary[]>();
  if (taskIds.length > 0) {
    const stepResponse = await supabase
      .from("workspace_task_steps")
      .select(
        "id, task_id, step_key, label, order_index, status, detail, started_at, completed_at"
      )
      .in("task_id", taskIds)
      .order("order_index", { ascending: true });

    if (!stepResponse.error) {
      for (const row of (stepResponse.data ?? []) as WorkspaceTaskStepRow[]) {
        const mapped = mapStep(row);
        const existing = stepsByTaskId.get(mapped.taskId) ?? [];
        existing.push(mapped);
        stepsByTaskId.set(mapped.taskId, existing);
      }
    }
  }

  return taskRows.map((task) => mapTask(task, stepsByTaskId));
}


export async function createQueuedWorkspaceJob(options: {
  workspaceId: string;
  conversationId?: string | null;
  title: string;
  inputText: string;
  intent: string;
  steps?: WorkspaceTaskStepInput[];
}) {
  const supabase = getSupabaseClient();
  if (!supabase) return null;

  const defaultSteps = options.steps?.length
    ? options.steps
    : [
        { key: "prepare", label: "Prepare job" },
        { key: "run", label: "Run safe job" },
        { key: "save", label: "Save result" },
      ];

  const taskResponse = await supabase
    .from("workspace_tasks")
    .insert({
      workspace_id: options.workspaceId,
      conversation_id: options.conversationId ?? null,
      title: options.title,
      input_text: options.inputText,
      intent: options.intent,
      status: "queued",
      progress: 0,
      resume_count: 0,
    })
    .select(
      "id, workspace_id, conversation_id, title, input_text, intent, status, progress, result_summary, error_message, resume_count, created_at, updated_at, started_at, completed_at"
    )
    .single();

  if (taskResponse.error || !taskResponse.data) return null;

  await supabase.from("workspace_task_steps").insert(
    defaultSteps.map((step, index) => ({
      task_id: taskResponse.data.id,
      step_key: step.key,
      label: step.label,
      order_index: index,
      status: "pending",
      detail: step.detail ?? null,
      started_at: null,
    }))
  );

  return taskResponse.data.id as string;
}

export async function getWorkspaceTask(taskId: string) {
  const supabase = getSupabaseClient();
  if (!supabase) return null;

  const taskResponse = await supabase
    .from("workspace_tasks")
    .select(
      "id, workspace_id, conversation_id, title, input_text, intent, status, progress, result_summary, error_message, resume_count, created_at, updated_at, started_at, completed_at"
    )
    .eq("id", taskId)
    .maybeSingle();

  if (taskResponse.error || !taskResponse.data) return null;

  const stepResponse = await supabase
    .from("workspace_task_steps")
    .select("id, task_id, step_key, label, order_index, status, detail, started_at, completed_at")
    .eq("task_id", taskId)
    .order("order_index", { ascending: true });

  const stepsByTaskId = new Map<string, WorkspaceTaskStepSummary[]>();
  if (!stepResponse.error) {
    stepsByTaskId.set(
      taskId,
      ((stepResponse.data ?? []) as WorkspaceTaskStepRow[]).map((step) => mapStep(step))
    );
  }

  return mapTask(taskResponse.data as WorkspaceTaskRow, stepsByTaskId);
}

export async function claimQueuedWorkspaceTask(taskId: string) {
  const supabase = getSupabaseClient();
  if (!supabase) return null;

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("workspace_tasks")
    .update({ status: "running", progress: 5, started_at: now, completed_at: null, updated_at: now })
    .eq("id", taskId)
    .eq("status", "queued")
    .select("id")
    .maybeSingle();

  if (error || !data) return null;
  return getWorkspaceTask(taskId);
}
