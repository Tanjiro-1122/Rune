export type TaskActivitySummary = {
  status: "queued" | "running" | "completed" | "failed" | "cancelled" | "stopped" | string;
  progress?: number | null;
  updatedAt?: string | null;
};

export function getTaskStatusLabel(status: TaskActivitySummary["status"]) {
  if (status === "running") return "Running";
  if (status === "queued") return "Queued";
  if (status === "completed") return "Completed";
  if (status === "failed") return "Failed";
  return "Stopped";
}

export function getTaskAgeLabel(updatedAt?: string | null, nowMs = Date.now()) {
  if (!updatedAt) return "age unknown";
  const updatedMs = Date.parse(updatedAt);
  if (!Number.isFinite(updatedMs)) return "age unknown";
  const diffSeconds = Math.max(0, Math.floor((nowMs - updatedMs) / 1000));
  if (diffSeconds < 45) return "just now";
  if (diffSeconds < 90) return "1m ago";
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  return `${diffHours}h ago`;
}

export function isPossiblyStaleTask(task: TaskActivitySummary, nowMs = Date.now()) {
  const updatedMs = Date.parse(task.updatedAt ?? "");
  if (!Number.isFinite(updatedMs)) return false;
  return nowMs - updatedMs > 90_000;
}

export function getTaskActivityLabel(task: TaskActivitySummary | null, nowMs = Date.now()) {
  if (!task) return "No active task";
  const status = getTaskStatusLabel(task.status);
  const progress = Number.isFinite(task.progress) ? ` · ${Math.max(0, Math.min(100, Math.round(Number(task.progress))))}%` : "";
  const age = getTaskAgeLabel(task.updatedAt, nowMs);
  return `${status}${progress} · ${age}`;
}

export function getRunnerJobLabel(kind?: string | null) {
  if (kind === "vercel_redeploy") return "Vercel redeploy";
  if (kind === "vercel_rollback") return "Vercel rollback";
  if (kind === "private_app_creator_deploy") return "Private App Creator deploy";
  if (kind === "repo_check") return "Repo check";
  if (kind === "maintenance") return "Maintenance";
  return kind ? kind.replace(/_/g, " ") : null;
}

export function getCommandPreview(command?: string | null) {
  if (!command) return null;
  return command.length > 110 ? `${command.slice(0, 107)}…` : command;
}
