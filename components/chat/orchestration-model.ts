import { getRuneRuntimeIdentity } from "@/lib/project-runtime";

export const PROJECT_SWITCHBOARD_OPTIONS = [
  {
    key: "rune",
    label: "Rune",
    subtitle: "Private AI workspace",
    repo: getRuneRuntimeIdentity().repo,
    accent: "#7dd3fc",
    safetyLabel: "Owner-console",
    safetyTone: "owner",
  },
  {
    key: "unfiltr",
    label: "Unfiltr",
    subtitle: "AI companion app",
    repo: "Tanjiro-1122/UniltrbyJavierbackup",
    accent: "#c084fc",
    safetyLabel: "Sensitive production",
    safetyTone: "sensitive",
  },
  {
    key: "swh",
    label: "SWH",
    subtitle: "SportsWager Helper",
    repo: "Tanjiro-1122/swhmobile",
    accent: "#34d399",
    safetyLabel: "Production app",
    safetyTone: "production",
  },
  {
    key: "unfiltr-family",
    label: "Unfiltr Family",
    subtitle: "Elderly-care companion",
    repo: "Tanjiro-1122/UnfiltrFamily",
    accent: "#fbbf24",
    safetyLabel: "Sensitive production",
    safetyTone: "sensitive",
  },
] as const;

export type ProjectSwitchboardKey = (typeof PROJECT_SWITCHBOARD_OPTIONS)[number]["key"];

export const PROJECT_MEMORY_OPTIONS = [
  { key: "global", label: "General" },
  ...PROJECT_SWITCHBOARD_OPTIONS.map((project) => ({ key: project.key, label: project.label })),
];

export type CabinetDrawerKey = "operator" | "memory" | "health" | "repo" | "build" | "activity" | "files" | "tasks" | "self_test";

export const CABINET_DRAWERS: Array<{ key: CabinetDrawerKey; label: string; hint: string }> = [
  { key: "operator", label: "Operator", hint: "Command view" },
  { key: "memory", label: "Memory", hint: "Facts + rules" },
  { key: "health", label: "Health", hint: "Setup checks" },
  { key: "repo", label: "Repo", hint: "Approvals" },
  { key: "build", label: "Build", hint: "GitHub + Vercel" },
  { key: "activity", label: "Activity", hint: "Audit trail" },
  { key: "files", label: "Files", hint: "Artifacts + docs" },
  { key: "tasks", label: "Tasks", hint: "Timeline" },
  { key: "self_test", label: "Self-Test", hint: "System checks" },
];

export function getToolsShellClassName(isMobileToolsMode: boolean) {
  return isMobileToolsMode
    ? "context-sidebar context-sidebar--open mobile-tools-shell"
    : "context-sidebar context-sidebar--open";
}

export function getToolsPanelClassName(isMobileToolsMode: boolean) {
  return isMobileToolsMode ? "context-panel mobile-tools-tile-board" : "context-panel";
}

export function getToolsTitlebarClassName(isMobileToolsMode: boolean) {
  return isMobileToolsMode ? "glass-drawer-titlebar mobile-tools-titlebar" : "glass-drawer-titlebar";
}

export function getProjectSwitchboardClassName(isMobileToolsMode: boolean) {
  return isMobileToolsMode
    ? "context-panel-section project-switchboard-section mobile-tools-project-tile"
    : "context-panel-section project-switchboard-section";
}

export function getFilingCabinetClassName(isMobileToolsMode: boolean) {
  return isMobileToolsMode ? "filing-cabinet-drawers mobile-tools-top-tiles" : "filing-cabinet-drawers";
}

export function getFilingCabinetTabClassName(options: { drawerKey: CabinetDrawerKey; activeCabinetDrawer: CabinetDrawerKey; isMobileToolsMode: boolean }) {
  const active = options.activeCabinetDrawer === options.drawerKey;
  return options.isMobileToolsMode
    ? `filing-cabinet-tab mobile-tools-top-tile ${active ? "filing-cabinet-tab--active mobile-tools-top-tile--active" : ""}`
    : `filing-cabinet-tab ${active ? "filing-cabinet-tab--active" : ""}`;
}

export function getFilingCabinetActiveLabelClassName(isMobileToolsMode: boolean) {
  return isMobileToolsMode ? "filing-cabinet-active-label mobile-tools-active-label" : "filing-cabinet-active-label";
}

export function getOperatorConsoleClassName(isMobileToolsMode: boolean) {
  return isMobileToolsMode ? "operator-console-panel mobile-tools-section" : "operator-console-panel";
}

export function getToolsSectionClassName(baseClassName: string, isMobileToolsMode: boolean) {
  return isMobileToolsMode ? `${baseClassName} mobile-tools-section` : baseClassName;
}
