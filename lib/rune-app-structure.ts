export type RuneAppAreaKey =
  | "command_center"
  | "projects"
  | "tasks"
  | "memory"
  | "vault"
  | "tools"
  | "operator";

export interface RuneAppArea {
  key: RuneAppAreaKey;
  label: string;
  shortLabel: string;
  description: string;
}

export const RUNE_APP_NAME = "Rune";
export const RUNE_HOME_LABEL = "Command Center";
export const RUNE_PRIMARY_WORKSPACE_LABEL = "Command Center";

export const RUNE_APP_AREAS: RuneAppArea[] = [
  {
    key: "command_center",
    label: "Command Center",
    shortLabel: "Center",
    description: "Javier's single place for chat, health, projects, and active work.",
  },
  {
    key: "projects",
    label: "Projects",
    shortLabel: "Projects",
    description: "Known apps and systems Rune manages, including Unfiltr, Rune, and Sports Wager Helper.",
  },
  {
    key: "tasks",
    label: "Tasks",
    shortLabel: "Tasks",
    description: "Durable operator work, queued jobs, recovery steps, and proof trails.",
  },
  {
    key: "memory",
    label: "Memory",
    shortLabel: "Memory",
    description: "Personal, project, and decision context stored in Javier-owned infrastructure.",
  },
  {
    key: "vault",
    label: "Vault",
    shortLabel: "Vault",
    description: "Private files, generated artifacts, and owner-only project material.",
  },
  {
    key: "tools",
    label: "Tools",
    shortLabel: "Tools",
    description: "Read-only checks, integrations, diagnostics, and controlled utility actions.",
  },
  {
    key: "operator",
    label: "Operator",
    shortLabel: "Operator",
    description: "Safety gates for repo control, execution, approvals, deployments, and rollback boundaries.",
  },
];

export function getRuneAppArea(key: RuneAppAreaKey) {
  return RUNE_APP_AREAS.find((area) => area.key === key) ?? RUNE_APP_AREAS[0];
}

export function getRuneVisibleWorkspaceLabel(name?: string | null) {
  const normalized = String(name || "").trim().toLowerCase();
  if (!normalized || normalized === "general workspace" || normalized === "general") return RUNE_PRIMARY_WORKSPACE_LABEL;
  return name || RUNE_PRIMARY_WORKSPACE_LABEL;
}
