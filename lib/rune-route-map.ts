export type RuneRouteGroupKey =
  | "auth"
  | "chat"
  | "projects"
  | "tasks"
  | "memory"
  | "vault"
  | "tools"
  | "operator"
  | "automations"
  | "system";

export interface RuneRouteGroup {
  key: RuneRouteGroupKey;
  label: string;
  purpose: string;
  currentRoutes: string[];
  targetPrefix: string;
}

export const RUNE_ROUTE_GROUPS: RuneRouteGroup[] = [
  {
    key: "auth",
    label: "Auth",
    purpose: "Owner-only login, logout, session checks, and protected access boundaries.",
    currentRoutes: ["/api/auth/login", "/api/auth/logout"],
    targetPrefix: "/api/auth",
  },
  {
    key: "chat",
    label: "Chat",
    purpose: "Rune's main conversation transport, streaming lifecycle, conversation history, and visible chat state.",
    currentRoutes: ["/api/chat", "/api/conversations", "/api/history"],
    targetPrefix: "/api/chat",
  },
  {
    key: "projects",
    label: "Projects",
    purpose: "Known managed systems, project registry, health snapshots, deployment signals, and integration status.",
    currentRoutes: ["/api/app-health", "/api/deploy-health", "/api/app-store-connect", "/api/google-play", "/api/revenuecat", "/api/schema-intel"],
    targetPrefix: "/api/projects",
  },
  {
    key: "tasks",
    label: "Tasks",
    purpose: "Durable operator tasks, task runs, queued jobs, checkpoints, and task reconciliation state.",
    currentRoutes: ["/api/tasks", "/api/jobs", "/api/runner", "/api/actions"],
    targetPrefix: "/api/tasks",
  },
  {
    key: "memory",
    label: "Memory",
    purpose: "Personal, project, and decision memory stored outside chat text.",
    currentRoutes: ["/api/memory", "/api/memory/import", "/api/memory/seed", "/api/intelligence"],
    targetPrefix: "/api/memory",
  },
  {
    key: "vault",
    label: "Vault",
    purpose: "Private artifacts, files, uploads, signed URLs, and owner-only generated material.",
    currentRoutes: ["/api/vault", "/api/vault/migrate", "/api/artifacts", "/api/upload", "/api/files/signed-url"],
    targetPrefix: "/api/vault",
  },
  {
    key: "tools",
    label: "Tools",
    purpose: "Read-only diagnostics, safe utility checks, and non-mutating tool surfaces.",
    currentRoutes: ["/api/self-test", "/api/rune-lifecycle", "/api/plan", "/api/push"],
    targetPrefix: "/api/tools",
  },
  {
    key: "operator",
    label: "Operator",
    purpose: "Safety-gated execution, Repo Control, briefings, remediation planning, and approval boundaries.",
    currentRoutes: ["/api/operator-briefing", "/api/repo-actions", "/api/app-creator-pipeline"],
    targetPrefix: "/api/operator",
  },
  {
    key: "automations",
    label: "Automations",
    purpose: "Scheduled work that Rune performs without a live chat request, always behind cron/auth guards.",
    currentRoutes: ["/api/cron/daily-briefing", "/api/cron/operator-events", "/api/cron/reconcile-tasks", "/api/cron/reminders"],
    targetPrefix: "/api/cron",
  },
  {
    key: "system",
    label: "System",
    purpose: "Legacy compatibility, migration support, diagnostics, and temporary operational endpoints.",
    currentRoutes: ["/api/workspaces", "/api/debug-crash"],
    targetPrefix: "/api/system",
  },
];

export function getRuneRouteGroup(key: RuneRouteGroupKey) {
  return RUNE_ROUTE_GROUPS.find((group) => group.key === key) ?? RUNE_ROUTE_GROUPS[0];
}

export function findRuneRouteGroup(pathname: string) {
  return RUNE_ROUTE_GROUPS.find((group) => group.currentRoutes.some((route) => pathname === route || pathname.startsWith(`${route}/`))) ?? null;
}
