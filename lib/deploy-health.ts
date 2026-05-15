import { getSupabaseClient } from "@/lib/supabase";
import { getBuildIntelligenceSnapshot } from "@/lib/build-intelligence";
import { logActionEvent } from "@/lib/action-events";
import { logError } from "@/lib/errors";

export type DeployHealthStatus = "ok" | "warning" | "missing" | "error";

export interface DeployHealthCheck {
  key: string;
  label: string;
  status: DeployHealthStatus;
  detail: string;
  required: boolean;
}

export interface DeployHealthSnapshot {
  generatedAt: string;
  overall: DeployHealthStatus;
  checks: DeployHealthCheck[];
}

const REQUIRED_ENV = [
  { key: "OPENAI_API_KEY", label: "OpenAI key" },
  { key: "APP_PASSWORD", label: "App password" },
  { key: "SESSION_SECRET", label: "Session secret" },
];

const OPTIONAL_ENV = [
  {
    keys: ["JARVIS_OWNER_MEMORY"],
    label: "Owner memory seed",
    fallbackDetail: "Covered by Supabase Memory Core",
  },
  { keys: ["GITHUB_TOKEN", "JARVIS_GITHUB_TOKEN"], label: "GitHub token" },
  { keys: ["VERCEL_TOKEN", "JARVIS_VERCEL_TOKEN"], label: "Vercel token" },
  { keys: ["JARVIS_MEMORY_SEED_TOKEN"], label: "Memory seed token" },
];

const REQUIRED_TABLES = [
  { table: "conversations", label: "Conversation table" },
  { table: "messages", label: "Messages table" },
  { table: "workspaces", label: "Workspaces table" },
  { table: "conversation_workspaces", label: "Conversation-workspace link table" },
  { table: "workspace_memberships", label: "Workspace memberships table" },
  { table: "workspace_documents", label: "Workspace documents table" },
  { table: "workspace_chunks", label: "Workspace chunks table" },
  { table: "workspace_artifacts", label: "Workspace artifacts table" },
  { table: "workspace_events", label: "Workspace events table" },
  { table: "workspace_project_files", label: "Workspace project files table" },
  { table: "workspace_tasks", label: "Workspace tasks table" },
  { table: "workspace_task_steps", label: "Workspace task steps table" },
  { table: "agent_memories", label: "Memory table" },
  { table: "agent_memory_events", label: "Memory events table" },
  { table: "jarvis_security_events", label: "Security events table" },
  { table: "jarvis_action_events", label: "Activity log table" },
  { table: "jarvis_repo_action_proposals", label: "Repo proposal table" },
];

function envPresent(key: string) {
  return Boolean(process.env[key]?.trim());
}

function requiredCheck(key: string, label: string): DeployHealthCheck {
  return envPresent(key)
    ? { key: `env.${key}`, label, status: "ok", detail: "Configured", required: true }
    : { key: `env.${key}`, label, status: "missing", detail: "Missing required environment variable", required: true };
}

function optionalCheck(keys: string[], label: string, fallbackDetail?: string): DeployHealthCheck {
  const present = keys.some(envPresent);
  return present
    ? { key: `env.${keys.join("_or_")}`, label, status: "ok", detail: "Configured", required: false }
    : { key: `env.${keys.join("_or_")}`, label, status: "ok", detail: fallbackDetail ?? "Optional — not required", required: false };
}

async function tableCheck(table: string, label: string): Promise<DeployHealthCheck> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return {
      key: `table.${table}`,
      label,
      status: "missing",
      detail: "Supabase is not configured",
      required: true,
    };
  }

  try {
    const { error } = await supabase.from(table).select("*", { count: "exact", head: true }).limit(1);
    if (error) {
      return {
        key: `table.${table}`,
        label,
        status: "missing",
        detail: error.message.includes("does not exist") ? "Table missing — run latest supabase/schema.sql" : error.message,
        required: true,
      };
    }
    return { key: `table.${table}`, label, status: "ok", detail: "Ready", required: true };
  } catch (error) {
    logError(`deployHealth.table.${table}`, error);
    return {
      key: `table.${table}`,
      label,
      status: "error",
      detail: error instanceof Error ? error.message : "Unable to verify table",
      required: true,
    };
  }
}

function overallStatus(checks: DeployHealthCheck[]): DeployHealthStatus {
  if (checks.some((check) => check.required && (check.status === "missing" || check.status === "error"))) return "error";
  if (checks.some((check) => check.required && check.status === "warning")) return "warning";
  return "ok";
}

export async function getDeployHealthSnapshot(): Promise<DeployHealthSnapshot> {
  const checks: DeployHealthCheck[] = [];

  for (const env of REQUIRED_ENV) checks.push(requiredCheck(env.key, env.label));
  for (const env of OPTIONAL_ENV) checks.push(optionalCheck(env.keys, env.label, env.fallbackDetail));

  const supabaseConfigured = Boolean(process.env.SUPABASE_URL?.trim()) && Boolean(
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    process.env.SUPABASE_ANON_KEY?.trim()
  );
  checks.push({
    key: "supabase.connection",
    label: "Supabase connection",
    status: supabaseConfigured ? "ok" : "missing",
    detail: supabaseConfigured ? "Configured" : "Missing Supabase URL/key",
    required: true,
  });

  const tableChecks = await Promise.all(REQUIRED_TABLES.map((entry) => tableCheck(entry.table, entry.label)));
  checks.push(...tableChecks);

  try {
    const intelligence = await getBuildIntelligenceSnapshot({ projectKey: "jarvis" });
    checks.push({
      key: "github.intelligence",
      label: "GitHub intelligence",
      status: intelligence.github.error ? "ok" : "ok",
      detail: intelligence.github.error ? `Optional — ${intelligence.github.error}` : `Latest repo signal: ${intelligence.github.repo}`,
      required: false,
    });
    checks.push({
      key: "vercel.intelligence",
      label: "Vercel deploy intelligence",
      status: intelligence.vercel.error ? "ok" : "ok",
      detail: intelligence.vercel.error ? `Optional — ${intelligence.vercel.error}` : "Deployment signal available",
      required: false,
    });
  } catch (error) {
    checks.push({
      key: "build.intelligence",
      label: "Build intelligence",
      status: "ok",
      detail: error instanceof Error ? `Optional — ${error.message}` : "Optional — unable to verify build intelligence",
      required: false,
    });
  }

  const snapshot = {
    generatedAt: new Date().toISOString(),
    overall: overallStatus(checks),
    checks,
  };

  await logActionEvent({
    eventType: "deploy_health.snapshot",
    summary: `Deploy health checked: ${snapshot.overall}`,
    status: snapshot.overall === "ok" ? "executed" : snapshot.overall === "warning" ? "info" : "failed",
    approvalStage: "findings",
    riskLevel: "low",
    projectKey: "jarvis",
    metadata: {
      overall: snapshot.overall,
      missing: checks.filter((check) => check.status === "missing" || check.status === "error").map((check) => check.key),
      warnings: checks.filter((check) => check.status === "warning").map((check) => check.key),
    },
  });

  return snapshot;
}
