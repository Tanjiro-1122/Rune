/**
 * Rune Task Tracker
 * ─────────────────
 * Event-driven task lifecycle management.
 * Tasks move through: pending → running → completed | failed | blocked
 *
 * Instead of fire-and-forget async chains, Rune now explicitly tracks
 * every significant operation. This prevents the "giant async chain"
 * problem and gives full visibility into what Rune is doing.
 */

import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export type TaskStatus = "pending" | "running" | "completed" | "failed" | "blocked";
export type TaskPriority = "low" | "normal" | "high" | "critical";

export interface Task {
  id?: string;
  title: string;
  description?: string;
  status: TaskStatus;
  priority?: TaskPriority;
  project?: string;
  conversation_id?: string;
  workspace_id?: string;
  started_at?: string;
  completed_at?: string;
  error?: string;
  result_summary?: string;
  steps?: TaskStep[];
  metadata?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
}

export interface TaskStep {
  key: string;
  label: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  detail?: string;
  started_at?: string;
  completed_at?: string;
}

/**
 * Create a new task and mark it as running immediately.
 */
export async function createTask(params: {
  title: string;
  description?: string;
  priority?: TaskPriority;
  project?: string;
  conversation_id?: string;
  workspace_id?: string;
  steps?: { key: string; label: string }[];
  metadata?: Record<string, unknown>;
}): Promise<string | null> {
  try {
    const sb = getSupabase();
    const steps: TaskStep[] = (params.steps ?? []).map((s, i) => ({
      key: s.key,
      label: s.label,
      status: i === 0 ? "running" : "pending",
      started_at: i === 0 ? new Date().toISOString() : undefined,
    }));

    const { data, error } = await sb
      .from("rune_tasks")
      .insert({
        title: params.title,
        description: params.description ?? null,
        status: "running",
        priority: params.priority ?? "normal",
        project: params.project ?? "global",
        conversation_id: params.conversation_id ?? null,
        workspace_id: params.workspace_id ?? null,
        steps: steps.length > 0 ? JSON.stringify(steps) : null,
        metadata: params.metadata ? JSON.stringify(params.metadata) : null,
        started_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (error) {
      console.error("[task-tracker] createTask error:", error.message);
      return null;
    }
    console.log(`[task-tracker] Created task ${data?.id}: ${params.title}`);
    return data?.id ?? null;
  } catch (e) {
    console.error("[task-tracker] createTask exception:", e);
    return null;
  }
}

/**
 * Mark a task as completed with an optional result summary.
 */
export async function completeTask(taskId: string, resultSummary?: string): Promise<void> {
  try {
    const sb = getSupabase();
    await sb
      .from("rune_tasks")
      .update({
        status: "completed",
        result_summary: resultSummary ?? null,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", taskId);
    console.log(`[task-tracker] Completed task ${taskId}`);
  } catch (e) {
    console.error("[task-tracker] completeTask exception:", e);
  }
}

/**
 * Mark a task as failed with an error message.
 */
export async function failTask(taskId: string, error: string): Promise<void> {
  try {
    const sb = getSupabase();
    await sb
      .from("rune_tasks")
      .update({
        status: "failed",
        error,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", taskId);
    console.log(`[task-tracker] Failed task ${taskId}: ${error}`);
  } catch (e) {
    console.error("[task-tracker] failTask exception:", e);
  }
}

/**
 * Update a specific step within a task.
 */
export async function updateTaskStep(
  taskId: string,
  stepKey: string,
  update: { status: TaskStep["status"]; detail?: string }
): Promise<void> {
  try {
    const sb = getSupabase();
    const { data } = await sb
      .from("rune_tasks")
      .select("steps")
      .eq("id", taskId)
      .single();

    if (!data?.steps) return;
    const steps: TaskStep[] = typeof data.steps === "string"
      ? JSON.parse(data.steps)
      : data.steps;

    const now = new Date().toISOString();
    const updated = steps.map((s) => {
      if (s.key !== stepKey) return s;
      const next = { ...s, status: update.status, detail: update.detail ?? s.detail };
      if (update.status === "running" && !s.started_at) next.started_at = now;
      if (update.status === "completed" || update.status === "failed") next.completed_at = now;
      return next;
    });

    // Auto-advance: if this step completed, mark next pending step as running
    if (update.status === "completed") {
      const nextPending = updated.find((s) => s.status === "pending");
      if (nextPending) {
        nextPending.status = "running";
        nextPending.started_at = now;
      }
    }

    await sb
      .from("rune_tasks")
      .update({ steps: JSON.stringify(updated), updated_at: now })
      .eq("id", taskId);
  } catch (e) {
    console.error("[task-tracker] updateTaskStep exception:", e);
  }
}

/**
 * Get recent tasks — for dashboard/operator console display.
 */
export async function getRecentTasks(options: {
  limit?: number;
  project?: string;
  status?: TaskStatus;
  workspace_id?: string;
} = {}): Promise<Task[]> {
  try {
    const sb = getSupabase();
    let q = sb
      .from("rune_tasks")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(options.limit ?? 20);

    if (options.project) q = q.eq("project", options.project);
    if (options.status) q = q.eq("status", options.status);
    if (options.workspace_id) q = q.eq("workspace_id", options.workspace_id);

    const { data, error } = await q;
    if (error) return [];
    return (data ?? []).map((row) => ({
      ...row,
      steps: row.steps ? (typeof row.steps === "string" ? JSON.parse(row.steps) : row.steps) : [],
      metadata: row.metadata ? (typeof row.metadata === "string" ? JSON.parse(row.metadata) : row.metadata) : {},
    }));
  } catch {
    return [];
  }
}

/**
 * Auto-cleanup: mark stale "running" tasks as failed if they are older than maxAgeMinutes.
 * Call this from a cron job or at startup.
 */
export async function cleanupStaleTasks(maxAgeMinutes = 30): Promise<number> {
  try {
    const sb = getSupabase();
    const cutoff = new Date(Date.now() - maxAgeMinutes * 60000).toISOString();
    const { data } = await sb
      .from("rune_tasks")
      .update({
        status: "failed",
        error: `Task timed out after ${maxAgeMinutes} minutes with no completion signal.`,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("status", "running")
      .lt("started_at", cutoff)
      .select("id");
    const count = data?.length ?? 0;
    if (count > 0) console.log(`[task-tracker] Cleaned up ${count} stale tasks`);
    return count;
  } catch {
    return 0;
  }
}
