"use client";

import { useChat } from "ai/react";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import { ToolCallCard, type AppHealthSnapshotResult, type LightweightAttachment, type ToolInvocation } from "./chat/tool-cards";

const MAX_FILE_SIZE_MB = 10;
const MAX_FILE_SIZE = MAX_FILE_SIZE_MB * 1024 * 1024;
const STORAGE_KEY_SESSION_ID = "jarvis_session_id";
const STORAGE_KEY_WORKSPACE_ID = "jarvis_workspace_id";
const STORAGE_KEY_CONVERSATION_ID = "jarvis_conversation_id";
const ACCEPTED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "text/plain",
  "text/csv",
  "text/markdown",
];

const STREAM_FINALIZATION_RECOVERY_MS = 12_000;
const STREAM_STALL_WATCHDOG_MS = 18_000;
const STREAM_STALL_SECONDARY_RECOVERY_MS = 10_000;

function getAssistantTextFromMessage(message: { role?: string; content?: unknown; parts?: Array<{ type?: string; text?: string }> } | undefined) {
  if (!message || message.role !== "assistant") return "";
  if (typeof message.content === "string") return message.content;
  return (message.parts ?? [])
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

// ─── Tool display helpers ────────────────────────────────────────────────────

interface WorkspaceConversationSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

interface WorkspaceSummary {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  conversationCount: number;
  documentCount: number;
  artifactCount: number;
  conversations: WorkspaceConversationSummary[];
}

interface WorkspaceDocumentSummary {
  id: string;
  conversationId: string | null;
  name: string;
  contentType: string;
  sourceKind: string;
  summary: string | null;
  createdAt: string;
}

interface WorkspaceArtifactSummary {
  id: string;
  conversationId: string | null;
  name: string;
  mimeType: string;
  content: string;
  bytes: number;
  createdAt: string;
}

interface WorkspaceBootstrapResponse {
  persistenceEnabled: boolean;
  schemaReady: boolean;
  notice: string | null;
  workspaces: WorkspaceSummary[];
  selectedWorkspaceId: string | null;
  selectedConversationId: string | null;
  projectFiles: WorkspaceProjectFileSummary[];
  documents: WorkspaceDocumentSummary[];
  artifacts: WorkspaceArtifactSummary[];
}

interface WorkspaceProjectFileSummary {
  id: string;
  conversationId: string | null;
  path: string;
  displayName: string;
  sourceKind: string;
  mimeType: string;
  bytes: number;
  summary: string | null;
  url?: string | null;
  storageBucket?: string | null;
  storagePath?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

interface WorkspaceTaskStepSummary {
  id: string;
  key: string;
  label: string;
  orderIndex: number;
  status: "pending" | "running" | "completed" | "failed";
  detail: string | null;
}

interface WorkspaceTaskCheckpoint {
  id: string;
  createdAt: string;
  label: string;
  summary: string;
  completedStep?: string | null;
  nextStep?: string | null;
  blocker?: string | null;
}

interface WorkspaceTaskSummary {
  id: string;
  title: string;
  inputText: string;
  intent: string | null;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  progress: number;
  resultSummary: string | null;
  errorMessage: string | null;
  updatedAt: string;
  runnerId?: string | null;
  runnerStatus?: string | null;
  runnerHeartbeatAt?: string | null;
  runnerAttempts?: number;
  runnerLogs?: Array<{ timestamp: string; level: string; message: string }>;
  runnerMetadata?: {
    latest_checkpoint?: WorkspaceTaskCheckpoint | null;
    checkpoints?: WorkspaceTaskCheckpoint[];
    job_kind?: string;
    execution_mode?: string;
    command?: string;
    approval_text?: string | null;
    risk_level?: string;
    queued_at?: string;
    reason?: string | null;
  } | null;
  steps: WorkspaceTaskStepSummary[];
}

interface AgentMemorySummary {
  id: string;
  kind: "identity" | "owner" | "project" | "rule" | "workflow" | "decision" | "safety" | "note";
  title: string;
  content: string;
  project_key: string | null;
  tags: string[] | null;
  priority: number;
  source: string | null;
  updated_at: string;
}

interface MemoryImportItemResult {
  index: number;
  title: string;
  projectKey: string;
  action: "would_import" | "imported" | "duplicate" | "blocked" | "failed";
  reason?: string;
  memoryId?: string;
}

interface MemoryImportResult {
  ok: boolean;
  mode: "dry_run" | "import";
  source?: string;
  total?: number;
  imported?: number;
  blocked?: number;
  duplicates?: number;
  ready?: number;
  results?: MemoryImportItemResult[];
  error?: string;
}

interface ActionEventSummary {
  id: string;
  event_type: string;
  summary: string;
  status: "proposed" | "approved" | "executed" | "blocked" | "failed" | "info";
  approval_stage: "none" | "findings" | "plan" | "approval" | "action" | "complete";
  risk_level: "low" | "medium" | "high";
  project_key: string;
  created_at: string;
}

interface BuildIntelligenceSnapshot {
  generatedAt: string;
  github: {
    configured: boolean;
    repo: string;
    htmlUrl?: string;
    defaultBranch?: string;
    private?: boolean;
    pushedAt?: string | null;
    latestCommit?: {
      sha: string;
      message: string;
      author?: string | null;
      date?: string | null;
      url?: string;
    } | null;
    latestWorkflowRun?: {
      id: number;
      name?: string | null;
      status?: string | null;
      conclusion?: string | null;
      branch?: string | null;
      updatedAt?: string | null;
      url?: string | null;
    } | null;
    error?: string;
  };
  vercel: {
    configured: boolean;
    project?: string | null;
    latestDeployment?: {
      uid?: string;
      name?: string | null;
      state?: string | null;
      url?: string | null;
      readyAt?: string | null;
      createdAt?: string | null;
      target?: string | null;
    } | null;
    error?: string;
  };
  externalServices?: {
    generatedAt: string;
    summary: { configured: number; partial: number; missing: number; total: number };
    services: Array<{
      key: "revenuecat" | "app_store_connect" | "google_play";
      label: string;
      status: "configured" | "partial" | "missing";
      summary: string;
      readOnly: boolean;
      configuredKeys: string[];
      missingKeys: string[];
      notes: string[];
    }>;
  };
}

interface RepoActionProposalSummary {
  id: string;
  title: string;
  summary: string;
  findings: string;
  plan: string;
  repo: string;
  project_key: string;
  risk_level: "low" | "medium" | "high";
  status: "draft" | "proposed" | "approved" | "rejected" | "blocked" | "executed" | "cancelled";
  files: Array<{ path: string; operation?: "create" | "update" | "delete" | "inspect"; note?: string }>;
  diff_preview: string;
  approval_note: string | null;
  draft_metadata?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  approved_at: string | null;
  executed_at: string | null;
}

interface DeployHealthSnapshot {
  generatedAt: string;
  overall: "ok" | "warning" | "missing" | "error";
  checks: Array<{
    key: string;
    label: string;
    status: "ok" | "warning" | "missing" | "error";
    detail: string;
    required: boolean;
  }>;
}

interface OperatorBriefingSnapshot {
  generatedAt: string;
  readOnly: true;
  briefingType: "daily_operator";
  overallStatus: "healthy" | "warning" | "blocked";
  headline: string;
  recommendedNextAction: {
    title: string;
    detail: string;
    target: "health" | "repo" | "memory" | "tasks" | "none";
  };
  projects: Array<{
    key: string;
    label: string;
    repo: string;
    safetyLevel: string;
    healthStatus: string;
    healthScore: number | null;
    buildStatus: string;
    latestCommit: string | null;
    deploySignal: string;
    warnings: string[];
  }>;
  proposals: Array<{
    id: string;
    title: string;
    status: string;
    riskLevel: string;
    projectKey: string | null;
    repo: string | null;
    updatedAt: string;
    nextStep: string;
  }>;
  tasks: Array<{
    id: string;
    title: string;
    status: string;
    runnerStatus: string | null;
    updatedAt: string;
  }>;
  memory: {
    supabaseConfigured: boolean;
    agentMemoriesReachable: boolean;
    agentMemoryEventsReachable: boolean;
    ownerMemorySource: "env" | "not_configured";
    warning: string | null;
  };
  safetyNotice: string[];
}

const PROJECT_SWITCHBOARD_OPTIONS = [
  {
    key: "jarvis",
    label: "Jarvis",
    subtitle: "Private AI workspace",
    repo: "Tanjiro-1122/Jarvis",
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

const PROJECT_MEMORY_OPTIONS = [
  { key: "global", label: "General" },
  ...PROJECT_SWITCHBOARD_OPTIONS.map((project) => ({ key: project.key, label: project.label })),
];


type CabinetDrawerKey = "operator" | "memory" | "health" | "repo" | "build" | "activity" | "files" | "tasks";

const CABINET_DRAWERS: Array<{ key: CabinetDrawerKey; label: string; hint: string }> = [
  { key: "operator", label: "Operator", hint: "Command view" },
  { key: "memory", label: "Memory", hint: "Facts + rules" },
  { key: "health", label: "Health", hint: "Setup checks" },
  { key: "repo", label: "Repo", hint: "Approvals" },
  { key: "build", label: "Build", hint: "GitHub + Vercel" },
  { key: "activity", label: "Activity", hint: "Audit trail" },
  { key: "files", label: "Files", hint: "Artifacts + docs" },
  { key: "tasks", label: "Tasks", hint: "Timeline" },
];

function dedupeMessages<T extends { id?: string; role?: string; content?: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const key = item.id || `${item.role ?? "unknown"}:${(item.content ?? "").trim()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function formatTimestamp(value: string) {
  try {
    return new Date(value).toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return value;
  }
}

function normalizeOperatorStatus(value?: string | null) {
  return (value || "unknown").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "unknown";
}


function isExternalServiceVisibilityOnlyText(value?: string | null) {
  const text = (value || "").toLowerCase();
  return text.includes("external service readiness")
    || text.includes("read-only credentials")
    || text.includes("visibility")
    || text.includes("missing configuration")
    || text.includes("not configured yet");
}

function normalizeBriefingForDisplay(briefing: OperatorBriefingSnapshot | null): OperatorBriefingSnapshot | null {
  if (!briefing || briefing.overallStatus !== "blocked") return briefing;

  const warningText = [
    briefing.headline,
    briefing.recommendedNextAction?.title,
    briefing.recommendedNextAction?.detail,
    ...briefing.projects.flatMap((project) => project.warnings ?? []),
    briefing.memory?.warning,
  ].filter(Boolean).join(" ");

  const hasDeployBlocker = briefing.projects.some((project) => normalizeOperatorStatus(project.deploySignal) === "blocked");
  const hasHardProjectBlocker = briefing.projects.some((project) => {
    const status = normalizeOperatorStatus(project.healthStatus);
    const projectWarnings = (project.warnings ?? []).join(" ");
    return status === "blocked" && !isExternalServiceVisibilityOnlyText(projectWarnings);
  });

  if (hasDeployBlocker || hasHardProjectBlocker || !isExternalServiceVisibilityOnlyText(warningText)) return briefing;

  return {
    ...briefing,
    overallStatus: "warning",
    headline: "Jarvis has integration visibility or health warnings to review.",
  };
}

function detectMobileToolsMode() {
  if (typeof window === "undefined") return false;

  const userAgent = window.navigator.userAgent || "";
  const isMobileUserAgent = /iPhone|iPad|iPod|Android|Mobile|IEMobile|Opera Mini/i.test(userAgent);
  const isSmallViewport = window.matchMedia("(max-width: 820px)").matches;
  const isTouchFirst = window.matchMedia("(pointer: coarse)").matches;
  const hasTouchPoints = window.navigator.maxTouchPoints > 1;

  return isSmallViewport || isMobileUserAgent || isTouchFirst || hasTouchPoints;
}

function getOperatorNextAction(options: {
  operatorHealth: AppHealthSnapshotResult | null;
  buildIntel: BuildIntelligenceSnapshot | null;
  deployHealth: DeployHealthSnapshot | null;
  latestRepoProposal: RepoActionProposalSummary | null;
  latestRepoPrReady: boolean;
  activeTaskCount: number;
  operatorLastRefreshedAt: string | null;
}) {
  if (!options.operatorLastRefreshedAt) {
    return {
      title: "Refresh the control tower",
      detail: "Pull the latest read-only health, build, deploy, repo, and runner signals for this project.",
      tone: "ready",
      actionLabel: "Refresh console",
    };
  }

  if (options.latestRepoPrReady) {
    return {
      title: "Review PR handoff",
      detail: "A Repo Control proposal has passed checks and is ready for an approval-gated handoff review.",
      tone: "warning",
      actionLabel: "Open Repo Control",
    };
  }

  const healthStatus = normalizeOperatorStatus(options.operatorHealth?.status);
  if (["warning", "partial", "missing", "error", "blocked", "unhealthy"].includes(healthStatus)) {
    return {
      title: "Review health warnings",
      detail: options.operatorHealth?.summary ?? "The latest app health snapshot needs attention before bigger changes.",
      tone: healthStatus === "error" || healthStatus === "blocked" ? "error" : "warning",
      actionLabel: "Run health snapshot",
    };
  }

  const deployStatus = normalizeOperatorStatus(options.deployHealth?.overall);
  if (["warning", "partial", "missing", "error", "blocked"].includes(deployStatus)) {
    return {
      title: "Check deployment visibility",
      detail: options.deployHealth?.checks?.find((check) => normalizeOperatorStatus(check.status) !== "ok")?.detail ?? "Some deployment diagnostics need configuration or review.",
      tone: deployStatus === "error" || deployStatus === "blocked" ? "error" : "warning",
      actionLabel: "Check deploy health",
    };
  }

  if (options.activeTaskCount > 0) {
    return {
      title: "Monitor active runner work",
      detail: `${options.activeTaskCount} queued or running task${options.activeTaskCount === 1 ? "" : "s"} should finish before starting another execution path.`,
      tone: "warning",
      actionLabel: "View runner jobs",
    };
  }

  if (options.latestRepoProposal) {
    return {
      title: "Review latest proposal",
      detail: `${options.latestRepoProposal.title} is the newest Repo Control item for this project.`,
      tone: "ready",
      actionLabel: "Open Repo Control",
    };
  }

  return {
    title: "Project looks stable",
    detail: "No active runner jobs or urgent proposal handoffs are loaded. Next best move is a focused feature proposal.",
    tone: "healthy",
    actionLabel: "Draft proposal",
  };
}

type OperatorCommandCard = {
  key: string;
  eyebrow: string;
  title: string;
  detail: string;
  tone: string;
  actionLabel: string;
  targetDrawer: CabinetDrawerKey;
};

function getProposalReadinessLabel(proposal: RepoActionProposalSummary | null, latestRepoPrReady: boolean) {
  if (!proposal) return "No proposal loaded";
  if (latestRepoPrReady) return "PR ready";
  if (proposal.status === "approved") return "Approved checkpoint";
  if (proposal.status === "blocked") return "Blocked";
  if (proposal.status === "rejected") return "Rejected";
  if (proposal.status === "cancelled") return "Cancelled";
  return "Draft proposal";
}

function getOperatorCommandCards(options: {
  operatorNextAction: ReturnType<typeof getOperatorNextAction>;
  operatorHealth: AppHealthSnapshotResult | null;
  buildIntel: BuildIntelligenceSnapshot | null;
  deployHealth: DeployHealthSnapshot | null;
  latestRepoProposal: RepoActionProposalSummary | null;
  latestRepoPrReady: boolean;
  activeTaskCount: number;
}): OperatorCommandCard[] {
  const healthStatus = normalizeOperatorStatus(options.operatorHealth?.status);
  const buildStatus = normalizeOperatorStatus(options.buildIntel?.github?.latestWorkflowRun?.conclusion ?? options.buildIntel?.github?.latestWorkflowRun?.status);
  const deployStatus = normalizeOperatorStatus(options.deployHealth?.overall);
  const proposalLabel = getProposalReadinessLabel(options.latestRepoProposal, options.latestRepoPrReady);
  const nextActionLabel = options.operatorNextAction.actionLabel.toLowerCase();
  const nextActionTarget: CabinetDrawerKey = nextActionLabel.includes("build")
    ? "build"
    : nextActionLabel.includes("health") || nextActionLabel.includes("deploy")
      ? "health"
      : nextActionLabel.includes("runner") || nextActionLabel.includes("jobs")
        ? "tasks"
        : "repo";

  return [
    {
      key: "next",
      eyebrow: "Best next move",
      title: options.operatorNextAction.title,
      detail: options.operatorNextAction.detail,
      tone: options.operatorNextAction.tone,
      actionLabel: options.operatorNextAction.actionLabel,
      targetDrawer: nextActionTarget,
    },
    {
      key: "proposal",
      eyebrow: "Repo Control",
      title: proposalLabel,
      detail: options.latestRepoProposal?.title ?? "Draft a focused proposal before changing files, deployments, schemas, payments, or customer-facing systems.",
      tone: options.latestRepoPrReady ? "ready" : normalizeOperatorStatus(options.latestRepoProposal?.status || "idle"),
      actionLabel: options.latestRepoProposal ? "Review proposal" : "Draft proposal",
      targetDrawer: "repo",
    },
    {
      key: "health",
      eyebrow: "Read-only health",
      title: options.operatorHealth?.status ? `Health ${options.operatorHealth.status}` : "Run health snapshot",
      detail: options.operatorHealth?.summary ?? "Load project health, integration visibility, and configuration signals without mutating production.",
      tone: healthStatus,
      actionLabel: "Open health",
      targetDrawer: "health",
    },
    {
      key: "build",
      eyebrow: "Build signal",
      title: options.buildIntel?.github?.latestWorkflowRun?.conclusion ?? options.buildIntel?.github?.latestWorkflowRun?.status ?? "Check build intelligence",
      detail: options.buildIntel?.github?.latestCommit?.message?.split("\n")[0] ?? "Review recent GitHub workflow and commit visibility before new work.",
      tone: buildStatus,
      actionLabel: "Open build",
      targetDrawer: "build",
    },
    {
      key: "runner",
      eyebrow: "Runner queue",
      title: options.activeTaskCount ? `${options.activeTaskCount} active task${options.activeTaskCount === 1 ? "" : "s"}` : "Runner idle",
      detail: options.activeTaskCount ? "Let active queued/running work finish before starting another execution path." : "No queued/running workspace tasks are loaded for this project.",
      tone: options.activeTaskCount ? "warning" : deployStatus === "unknown" ? "idle" : deployStatus,
      actionLabel: "Open tasks",
      targetDrawer: "tasks",
    },
  ];
}

function buildArtifactDownloadHref(artifact: WorkspaceArtifactSummary) {
  return `data:${artifact.mimeType};charset=utf-8,${encodeURIComponent(artifact.content)}`;
}

function getDocumentKindLabel(sourceKind: string) {
  return sourceKind === "artifact" ? "Artifact" : sourceKind === "upload" ? "Upload" : "Context";
}

function getTaskStatusLabel(status: WorkspaceTaskSummary["status"]) {
  if (status === "running") return "Running";
  if (status === "queued") return "Queued";
  if (status === "completed") return "Completed";
  if (status === "failed") return "Failed";
  return "Stopped";
}

function getRunnerJobLabel(kind?: string) {
  if (kind === "vercel_redeploy") return "Vercel redeploy";
  if (kind === "vercel_rollback") return "Vercel rollback";
  if (kind === "private_app_creator_deploy") return "Private App Creator deploy";
  if (kind === "repo_check") return "Repo check";
  if (kind === "maintenance") return "Maintenance";
  return kind ? kind.replace(/_/g, " ") : null;
}

function getCommandPreview(command?: string) {
  if (!command) return null;
  return command.length > 110 ? `${command.slice(0, 107)}…` : command;
}

function getSafeAttachmentImageUrl(
  url: string | undefined,
  allowedProtocols: Array<"blob:" | "https:">
) {
  if (!url) return undefined;

  try {
    const parsed = new URL(url);
    return allowedProtocols.some((protocol) => parsed.protocol === protocol) ? url : undefined;
  } catch {
    return undefined;
  }
}

export function Chat() {
  const router = useRouter();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [projectFiles, setProjectFiles] = useState<WorkspaceProjectFileSummary[]>([]);
  const [documents, setDocuments] = useState<WorkspaceDocumentSummary[]>([]);
  const [artifacts, setArtifacts] = useState<WorkspaceArtifactSummary[]>([]);
  const [tasks, setTasks] = useState<WorkspaceTaskSummary[]>([]);
  const [resumeTaskId, setResumeTaskId] = useState<string | null>(null);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [persistenceEnabled, setPersistenceEnabled] = useState(false);
  const [schemaReady, setSchemaReady] = useState(true);
  const [workspaceNotice, setWorkspaceNotice] = useState<string | null>(null);
  const [workspaceError, setWorkspaceError] = useState("");
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [newWorkspaceDescription, setNewWorkspaceDescription] = useState("");
  const [artifactPreviewId, setArtifactPreviewId] = useState<string | null>(null);
  const [showInfoSidebar, setShowInfoSidebar] = useState(false);
  const [isMobileToolsMode, setIsMobileToolsMode] = useState(false);
  const [showWorkspaceDrawer, setShowWorkspaceDrawer] = useState(false);
  const [chatErrorMessage, setChatErrorMessage] = useState("");
  const [memories, setMemories] = useState<AgentMemorySummary[]>([]);
  const [selectedProjectKey, setSelectedProjectKey] = useState<(typeof PROJECT_SWITCHBOARD_OPTIONS)[number]["key"]>("jarvis");
  const [memoryProjectKey, setMemoryProjectKey] = useState("jarvis");
  const [memorySearch, setMemorySearch] = useState("");
  const [memoryTitle, setMemoryTitle] = useState("");
  const [memoryContent, setMemoryContent] = useState("");
  const [memoryKind, setMemoryKind] = useState<AgentMemorySummary["kind"]>("note");
  const [memoryStatus, setMemoryStatus] = useState("");
  const [memoryBusy, setMemoryBusy] = useState(false);
  const [editingMemoryId, setEditingMemoryId] = useState<string | null>(null);
  const [memoryImportText, setMemoryImportText] = useState("");
  const [memoryImportApproved, setMemoryImportApproved] = useState(false);
  const [memoryImportBusy, setMemoryImportBusy] = useState(false);
  const [memoryImportStatus, setMemoryImportStatus] = useState("");
  const [memoryImportResult, setMemoryImportResult] = useState<MemoryImportResult | null>(null);
  const [actionEvents, setActionEvents] = useState<ActionEventSummary[]>([]);
  const [actionLogStatus, setActionLogStatus] = useState("");
  const [buildIntel, setBuildIntel] = useState<BuildIntelligenceSnapshot | null>(null);
  const [buildIntelStatus, setBuildIntelStatus] = useState("");
  const [buildIntelBusy, setBuildIntelBusy] = useState(false);
  const [operatorHealth, setOperatorHealth] = useState<AppHealthSnapshotResult | null>(null);
  const [operatorBriefing, setOperatorBriefing] = useState<OperatorBriefingSnapshot | null>(null);
  const [operatorBriefingStatus, setOperatorBriefingStatus] = useState("");
  const [operatorStatus, setOperatorStatus] = useState("");
  const [operatorBusy, setOperatorBusy] = useState(false);
  const [operatorLastRefreshedAt, setOperatorLastRefreshedAt] = useState<string | null>(null);
  const [repoProposals, setRepoProposals] = useState<RepoActionProposalSummary[]>([]);
  const [repoProposalStatus, setRepoProposalStatus] = useState("");
  const [repoProposalBusy, setRepoProposalBusy] = useState(false);
  const [repoProposalTitle, setRepoProposalTitle] = useState("");
  const [repoProposalSummary, setRepoProposalSummary] = useState("");
  const [deployHealth, setDeployHealth] = useState<DeployHealthSnapshot | null>(null);
  const [deployHealthBusy, setDeployHealthBusy] = useState(false);
  const [deployHealthStatus, setDeployHealthStatus] = useState("");
  const [jobBusy, setJobBusy] = useState(false);
  const [jobStatus, setJobStatus] = useState("");
  const [activeCabinetDrawer, setActiveCabinetDrawer] = useState<CabinetDrawerKey>("operator");
  const mobileToolsTopRef = useRef<HTMLDivElement>(null);
  const mobileActiveDrawerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function updateMobileToolsMode() {
      setIsMobileToolsMode(detectMobileToolsMode());
    }

    updateMobileToolsMode();
    const viewportQuery = window.matchMedia("(max-width: 820px)");
    const pointerQuery = window.matchMedia("(pointer: coarse)");
    viewportQuery.addEventListener("change", updateMobileToolsMode);
    pointerQuery.addEventListener("change", updateMobileToolsMode);
    window.addEventListener("resize", updateMobileToolsMode);
    window.addEventListener("orientationchange", updateMobileToolsMode);

    return () => {
      viewportQuery.removeEventListener("change", updateMobileToolsMode);
      pointerQuery.removeEventListener("change", updateMobileToolsMode);
      window.removeEventListener("resize", updateMobileToolsMode);
      window.removeEventListener("orientationchange", updateMobileToolsMode);
    };
  }, []);

  const toolsShellClassName = isMobileToolsMode
    ? "context-sidebar context-sidebar--open mobile-tools-shell"
    : "context-sidebar context-sidebar--open";
  const toolsPanelClassName = isMobileToolsMode
    ? "context-panel mobile-tools-tile-board"
    : "context-panel";
  const toolsTitlebarClassName = isMobileToolsMode
    ? "glass-drawer-titlebar mobile-tools-titlebar"
    : "glass-drawer-titlebar";
  const projectSwitchboardClassName = isMobileToolsMode
    ? "context-panel-section project-switchboard-section mobile-tools-project-tile"
    : "context-panel-section project-switchboard-section";
  const filingCabinetClassName = isMobileToolsMode
    ? "filing-cabinet-drawers mobile-tools-top-tiles"
    : "filing-cabinet-drawers";
  const filingCabinetTabClassName = (drawerKey: CabinetDrawerKey) => {
    const active = activeCabinetDrawer === drawerKey;
    return isMobileToolsMode
      ? `filing-cabinet-tab mobile-tools-top-tile ${active ? "filing-cabinet-tab--active mobile-tools-top-tile--active" : ""}`
      : `filing-cabinet-tab ${active ? "filing-cabinet-tab--active" : ""}`;
  };
  const filingCabinetActiveLabelClassName = isMobileToolsMode
    ? "filing-cabinet-active-label mobile-tools-active-label"
    : "filing-cabinet-active-label";
  const operatorConsoleClassName = isMobileToolsMode
    ? "operator-console-panel mobile-tools-section"
    : "operator-console-panel";
  const toolsSectionClassName = (baseClassName: string) =>
    isMobileToolsMode ? `${baseClassName} mobile-tools-section` : baseClassName;

  function handleCabinetDrawerSelect(drawerKey: CabinetDrawerKey) {
    setActiveCabinetDrawer(drawerKey);

    if (!isMobileToolsMode) return;

    window.setTimeout(() => {
      mobileActiveDrawerRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 80);
  }

  function scrollOperatorSection(targetRef: { current: HTMLDivElement | null }) {
    targetRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }

  function handleBackToMobileTools() {
    if (!isMobileToolsMode) return;

    mobileToolsTopRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }

  const {
    messages,
    input,
    handleInputChange,
    handleSubmit,
    status,
    setMessages,
    setInput,
    error: chatError,
  } = useChat({
    body: {
      sessionId: sessionId ?? undefined,
      conversationId: conversationId ?? undefined,
      workspaceId: workspaceId ?? undefined,
      resumeTaskId: resumeTaskId ?? undefined,
    },
    onError: (error) => {
      setChatErrorMessage(
        error instanceof Error
          ? error.message
          : "Jarvis could not complete that response."
      );
    },
  });

  const [files, setFiles] = useState<FileList | undefined>();
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const [fileError, setFileError] = useState("");
  const [isUploadingAttachment, setIsUploadingAttachment] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const operatorCommandRef = useRef<HTMLDivElement>(null);
  const operatorSummaryRef = useRef<HTMLDivElement>(null);
  const operatorProposalsRef = useRef<HTMLDivElement>(null);
  const operatorTasksRef = useRef<HTMLDivElement>(null);
  const taskRefreshInFlightRef = useRef(false);
  const streamRecoveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streamStallWatchdogTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streamStallSecondaryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streamStallRecoveryInFlightRef = useRef(false);
  const [streamFinalizationRecovered, setStreamFinalizationRecovered] = useState(false);
  const [streamStallRecovered, setStreamStallRecovered] = useState(false);
  const [streamRecoveryNotice, setStreamRecoveryNotice] = useState("");
  const selectedWorkspace =
    workspaces.find((workspace) => workspace.id === workspaceId) ?? null;
  const selectedArtifact =
    artifacts.find((artifact) => artifact.id === artifactPreviewId) ?? artifacts[0] ?? null;
  const selectedProject =
    PROJECT_SWITCHBOARD_OPTIONS.find((project) => project.key === selectedProjectKey) ?? PROJECT_SWITCHBOARD_OPTIONS[0];
  const canManageWorkspaces = persistenceEnabled && schemaReady;
  const activeOperatorTaskCount = tasks.filter((task) => task.status === "queued" || task.status === "running").length;
  const latestRepoProposal = repoProposals[0] ?? null;
  const latestRepoProposalMetadata = latestRepoProposal?.draft_metadata ?? {};
  const latestRepoPrReady = latestRepoProposalMetadata.pr_overall_ready === true;
  const latestRepoHandoff = latestRepoProposalMetadata.deployment_prep as { ready?: boolean; pr_url?: string; required_approval_phrase?: string } | undefined;
  const latestRepoPrUrl =
    (typeof latestRepoProposalMetadata.pr_url === "string" ? latestRepoProposalMetadata.pr_url : "") ||
    (typeof latestRepoHandoff?.pr_url === "string" ? latestRepoHandoff.pr_url : "");

  const operatorHealthStatus = normalizeOperatorStatus(operatorHealth?.status);
  const displayedOperatorBriefing = normalizeBriefingForDisplay(operatorBriefing);
  const operatorBriefingOverallStatus = normalizeOperatorStatus(displayedOperatorBriefing?.overallStatus);
  const operatorBuildStatus = normalizeOperatorStatus(buildIntel?.github?.latestWorkflowRun?.conclusion ?? buildIntel?.github?.latestWorkflowRun?.status);
  const operatorDeployStatus = normalizeOperatorStatus(deployHealth?.overall);
  const operatorNextAction = getOperatorNextAction({
    operatorHealth,
    buildIntel,
    deployHealth,
    latestRepoProposal,
    latestRepoPrReady,
    activeTaskCount: activeOperatorTaskCount,
    operatorLastRefreshedAt,
  });
  const operatorCommandCards = getOperatorCommandCards({
    operatorNextAction,
    operatorHealth,
    buildIntel,
    deployHealth,
    latestRepoProposal,
    latestRepoPrReady,
    activeTaskCount: activeOperatorTaskCount,
  });
  const operatorReadinessLabel = operatorHealth?.status
    ? operatorHealth.status.toUpperCase()
    : operatorLastRefreshedAt
      ? "Snapshot pending"
      : "Not refreshed";
  const operatorSignalCount = [operatorHealth, operatorBriefing, buildIntel, deployHealth, repoProposals.length > 0, tasks.length > 0].filter(Boolean).length;
  const selectedBriefingProject = operatorBriefing?.projects.find((project) => project.key === selectedProjectKey || (selectedProjectKey === "unfiltr-family" && project.key === "family"));

  function selectProject(projectKey: (typeof PROJECT_SWITCHBOARD_OPTIONS)[number]["key"]) {
    setSelectedProjectKey(projectKey);
    setMemoryProjectKey(projectKey);
    setRepoProposalStatus("");
    setActionLogStatus("");
    setBuildIntelStatus("");
    setDeployHealthStatus("");
    setOperatorStatus("");
    setOperatorBriefingStatus("");
  }

  async function fetchWorkspaceData(
    activeSessionId: string,
    nextWorkspaceId?: string | null
  ): Promise<WorkspaceBootstrapResponse> {
    const search = new URLSearchParams({ sessionId: activeSessionId });
    if (nextWorkspaceId) {
      search.set("workspaceId", nextWorkspaceId);
    }

    const response = await fetch(`/api/workspaces?${search.toString()}`);
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(payload.error ?? "Failed to load workspace data.");
    }
    return (await response.json()) as WorkspaceBootstrapResponse;
  }

  function applyWorkspaceData(data: WorkspaceBootstrapResponse) {
    setWorkspaces(data.workspaces);
    setProjectFiles(data.projectFiles ?? []);
    setDocuments(data.documents);
    setArtifacts(data.artifacts);
    setPersistenceEnabled(data.persistenceEnabled);
    setSchemaReady(data.schemaReady);
    setWorkspaceNotice(data.notice);
  }

  async function refreshTasks(
    activeSessionId: string,
    nextWorkspaceId: string | null,
    nextConversationId: string | null
  ) {
    if (!nextWorkspaceId) {
      setTasks([]);
      return;
    }

    const search = new URLSearchParams({
      sessionId: activeSessionId,
      workspaceId: nextWorkspaceId,
    });
    if (nextConversationId) {
      search.set("conversationId", nextConversationId);
    }

    const response = await fetch(`/api/tasks?${search.toString()}`);
    if (!response.ok) return;
    const payload = (await response.json()) as { tasks?: WorkspaceTaskSummary[] };
    setTasks(payload.tasks ?? []);
  }

  async function refreshMemories(nextProjectKey = memoryProjectKey, nextQuery = memorySearch) {
    const search = new URLSearchParams();
    if (nextProjectKey && nextProjectKey !== "global") search.set("projectKey", nextProjectKey);
    if (nextQuery.trim()) search.set("query", nextQuery.trim());

    const response = await fetch(`/api/memory?${search.toString()}`);
    if (!response.ok) return;
    const payload = (await response.json()) as { memories?: AgentMemorySummary[] };
    setMemories(payload.memories ?? []);
  }


  async function refreshActionEvents(nextProjectKey = memoryProjectKey) {
    const search = new URLSearchParams();
    if (nextProjectKey && nextProjectKey !== "global") search.set("projectKey", nextProjectKey);
    const response = await fetch(`/api/actions?${search.toString()}`);
    if (!response.ok) {
      setActionLogStatus("Activity log unavailable. Run the latest Supabase schema if this persists.");
      return;
    }
    const payload = (await response.json()) as { events?: ActionEventSummary[] };
    setActionEvents(payload.events ?? []);
    setActionLogStatus("");
  }


  async function refreshBuildIntelligence(nextProjectKey = selectedProjectKey) {
    setBuildIntelBusy(true);
    setBuildIntelStatus("");
    try {
      const projectForRequest = PROJECT_SWITCHBOARD_OPTIONS.find((project) => project.key === nextProjectKey) ?? selectedProject;
      const search = new URLSearchParams({ projectKey: nextProjectKey, repo: projectForRequest.repo });
      const response = await fetch(`/api/intelligence?${search.toString()}`);
      const payload = (await response.json().catch(() => ({}))) as BuildIntelligenceSnapshot & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Build intelligence unavailable.");
      setBuildIntel(payload);
      if (payload.github?.error || payload.vercel?.error) {
        setBuildIntelStatus("Some signals need env setup. GitHub works best with GITHUB_TOKEN; Vercel needs VERCEL_TOKEN/project env vars.");
      }
      await refreshActionEvents(memoryProjectKey);
    } catch (error) {
      setBuildIntelStatus(error instanceof Error ? error.message : "Build intelligence unavailable.");
    } finally {
      setBuildIntelBusy(false);
    }
  }


  async function refreshOperatorBriefing() {
    setOperatorBriefingStatus("");
    const response = await fetch("/api/operator-briefing");
    const payload = (await response.json().catch(() => ({}))) as OperatorBriefingSnapshot & { error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Daily Operator Briefing unavailable.");
    setOperatorBriefing(payload);
    return payload;
  }


  async function refreshOperatorConsole(nextProjectKey = selectedProjectKey) {
    setOperatorBusy(true);
    setOperatorStatus("");
    setOperatorBriefingStatus("");
    try {
      const projectForRequest = PROJECT_SWITCHBOARD_OPTIONS.find((project) => project.key === nextProjectKey) ?? selectedProject;
      const healthSearch = new URLSearchParams({ projectKey: nextProjectKey, repo: projectForRequest.repo });
      const [healthResponse] = await Promise.all([
        fetch(`/api/app-health?${healthSearch.toString()}`),
        refreshOperatorBriefing().catch((error) => {
          setOperatorBriefingStatus(error instanceof Error ? error.message : "Daily Operator Briefing unavailable.");
          return null;
        }),
      ]);
      const healthPayload = (await healthResponse.json().catch(() => ({}))) as AppHealthSnapshotResult & { error?: string };
      if (!healthResponse.ok) throw new Error(healthPayload.error ?? "App health snapshot unavailable.");
      setOperatorHealth(healthPayload);
      setOperatorLastRefreshedAt(new Date().toISOString());
      await Promise.all([
        refreshBuildIntelligence(nextProjectKey),
        refreshRepoProposals(nextProjectKey),
        refreshDeployHealth(),
        sessionId ? refreshTasks(sessionId, workspaceId, conversationId) : Promise.resolve(),
      ]);
      setOperatorStatus("Operator console refreshed. Read-only checks only — no deploys, merges, releases, or runner jobs.");
    } catch (error) {
      setOperatorStatus(error instanceof Error ? error.message : "Operator console unavailable.");
    } finally {
      setOperatorBusy(false);
    }
  }


  useEffect(() => {
    if (activeCabinetDrawer !== "operator") return;
    const timer = window.setInterval(() => {
      if (!operatorBusy && !buildIntelBusy && !deployHealthBusy) {
        void refreshOperatorConsole(selectedProjectKey);
      }
    }, 180000);
    return () => window.clearInterval(timer);
  }, [activeCabinetDrawer, selectedProjectKey, operatorBusy, buildIntelBusy, deployHealthBusy, sessionId, workspaceId, conversationId]);


  async function refreshRepoProposals(nextProjectKey = selectedProjectKey) {
    const search = new URLSearchParams({ projectKey: nextProjectKey });
    const response = await fetch(`/api/repo-actions?${search.toString()}`);
    if (!response.ok) {
      setRepoProposalStatus("Repo control unavailable. Run the latest Supabase schema if this persists.");
      return;
    }
    const payload = (await response.json()) as { proposals?: RepoActionProposalSummary[] };
    setRepoProposals(payload.proposals ?? []);
    setRepoProposalStatus("");
  }

  async function createRepoProposal(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!repoProposalTitle.trim() || !repoProposalSummary.trim() || repoProposalBusy) return;

    setRepoProposalBusy(true);
    setRepoProposalStatus("");
    try {
      const response = await fetch("/api/repo-actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: repoProposalTitle.trim(),
          summary: repoProposalSummary.trim(),
          findings: "Proposal created from Jarvis Repo Control. Full findings should be added by Jarvis before execution.",
          plan: "Review the proposal, confirm scope and risk, then approve only if Javier explicitly agrees.",
          projectKey: selectedProject.key,
          repo: selectedProject.repo,
          riskLevel: "medium",
          files: [],
          diffPreview: "No diff generated yet. This proposal is an approval checkpoint, not an executed change.",
          sessionId: sessionId ?? undefined,
          workspaceId: workspaceId ?? undefined,
          conversationId: conversationId ?? undefined,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Failed to create repo proposal.");
      setRepoProposalTitle("");
      setRepoProposalSummary("");
      setRepoProposalStatus("Proposal created. It still requires explicit approval before any future repo execution.");
      await refreshRepoProposals(selectedProjectKey);
      await refreshActionEvents(memoryProjectKey);
    } catch (error) {
      setRepoProposalStatus(error instanceof Error ? error.message : "Failed to create repo proposal.");
    } finally {
      setRepoProposalBusy(false);
    }
  }

  async function updateRepoProposalStatus(proposal: RepoActionProposalSummary, status: "approved" | "rejected" | "blocked" | "cancelled") {
    const note = status === "approved"
      ? "Approved from Jarvis Repo Control. Execution still requires a separate controlled action path."
      : `${status} from Jarvis Repo Control.`;
    const confirmed = window.confirm(`${status === "approved" ? "Approve" : "Update"} proposal?\n\n${proposal.title}`);
    if (!confirmed || repoProposalBusy) return;

    setRepoProposalBusy(true);
    setRepoProposalStatus("");
    try {
      const response = await fetch("/api/repo-actions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: proposal.id, status, approvalNote: note }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Failed to update proposal.");
      setRepoProposalStatus(`Proposal ${status}.`);
      await refreshRepoProposals(selectedProjectKey);
      await refreshActionEvents(memoryProjectKey);
    } catch (error) {
      setRepoProposalStatus(error instanceof Error ? error.message : "Failed to update proposal.");
    } finally {
      setRepoProposalBusy(false);
    }
  }


  async function draftRepoProposalDiff(proposal: RepoActionProposalSummary) {
    if (repoProposalBusy) return;

    setRepoProposalBusy(true);
    setRepoProposalStatus("");
    try {
      const response = await fetch("/api/repo-actions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: proposal.id, action: "draft_diff" }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Failed to draft diff preview.");
      setRepoProposalStatus("Draft preview prepared. Review it before any real repo execution.");
      await refreshRepoProposals(selectedProjectKey);
      await refreshActionEvents(memoryProjectKey);
    } catch (error) {
      setRepoProposalStatus(error instanceof Error ? error.message : "Failed to draft diff preview.");
    } finally {
      setRepoProposalBusy(false);
    }
  }


  async function inspectRepoProposalFiles(proposal: RepoActionProposalSummary) {
    if (repoProposalBusy) return;

    setRepoProposalBusy(true);
    setRepoProposalStatus("");
    try {
      const response = await fetch("/api/repo-actions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: proposal.id, action: "inspect_repo" }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Failed to inspect repo files.");
      setRepoProposalStatus("Repo files inspected. Review the real file snapshot before any change.");
      await refreshRepoProposals(selectedProjectKey);
      await refreshActionEvents(memoryProjectKey);
    } catch (error) {
      setRepoProposalStatus(error instanceof Error ? error.message : "Failed to inspect repo files.");
    } finally {
      setRepoProposalBusy(false);
    }
  }


  async function generateRepoProposalDiff(proposal: RepoActionProposalSummary) {
    if (repoProposalBusy) return;
    const confirmed = window.confirm(`Generate a real proposed diff for review?\n\n${proposal.title}\n\nThis will use OpenAI and GitHub read access, but will not change files or push commits.`);
    if (!confirmed) return;

    setRepoProposalBusy(true);
    setRepoProposalStatus("");
    try {
      const response = await fetch("/api/repo-actions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: proposal.id, action: "generate_diff" }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Failed to generate proposed diff.");
      setRepoProposalStatus("Proposed diff generated. Review carefully before any execution step.");
      await refreshRepoProposals(selectedProjectKey);
      await refreshActionEvents(memoryProjectKey);
    } catch (error) {
      setRepoProposalStatus(error instanceof Error ? error.message : "Failed to generate proposed diff.");
    } finally {
      setRepoProposalBusy(false);
    }
  }


  async function sandboxCheckRepoProposal(proposal: RepoActionProposalSummary) {
    if (repoProposalBusy) return;

    setRepoProposalBusy(true);
    setRepoProposalStatus("");
    try {
      const response = await fetch("/api/repo-actions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: proposal.id, action: "sandbox_check" }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string; ready?: boolean };
      if (!response.ok) throw new Error(payload.error ?? "Failed to run sandbox check.");
      setRepoProposalStatus(payload.ready ? "Sandbox check passed. Review before execution." : "Sandbox check completed with warnings/risks. Review required.");
      await refreshRepoProposals(selectedProjectKey);
      await refreshActionEvents(memoryProjectKey);
    } catch (error) {
      setRepoProposalStatus(error instanceof Error ? error.message : "Failed to run sandbox check.");
    } finally {
      setRepoProposalBusy(false);
    }
  }


  async function runTempWorkspaceCheck(proposal: RepoActionProposalSummary) {
    if (repoProposalBusy) return;
    const confirmed = window.confirm(`Run a temporary workspace build check?\n\n${proposal.title}\n\nJarvis will clone the allowlisted repo into a temporary server folder, apply the proposed diff locally, run validation/build, then delete the folder. No commit, push, or deploy will happen.`);
    if (!confirmed) return;

    setRepoProposalBusy(true);
    setRepoProposalStatus("");
    try {
      const response = await fetch("/api/repo-actions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: proposal.id, action: "temp_workspace_check" }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string; ready?: boolean };
      if (!response.ok) throw new Error(payload.error ?? "Failed to run temporary workspace check.");
      setRepoProposalStatus(payload.ready ? "Temporary workspace build passed. Review before approval." : "Temporary workspace check failed or needs review.");
      await refreshRepoProposals(selectedProjectKey);
      await refreshActionEvents(memoryProjectKey);
    } catch (error) {
      setRepoProposalStatus(error instanceof Error ? error.message : "Failed to run temporary workspace check.");
    } finally {
      setRepoProposalBusy(false);
    }
  }


  async function openRepoProposalPr(proposal: RepoActionProposalSummary) {
    if (repoProposalBusy) return;
    const confirmed = window.confirm(`Open a GitHub pull request?\n\n${proposal.title}\n\nRequired: proposal approved + passing temp build. Jarvis will create a branch and PR only. It will not merge, deploy, or push to main.`);
    if (!confirmed) return;

    setRepoProposalBusy(true);
    setRepoProposalStatus("");
    try {
      const response = await fetch("/api/repo-actions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: proposal.id, action: "open_pr" }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string; prUrl?: string };
      if (!response.ok) throw new Error(payload.error ?? "Failed to open pull request.");
      setRepoProposalStatus(payload.prUrl ? `Pull request opened: ${payload.prUrl}` : "Pull request opened.");
      await refreshRepoProposals(selectedProjectKey);
      await refreshActionEvents(memoryProjectKey);
    } catch (error) {
      setRepoProposalStatus(error instanceof Error ? error.message : "Failed to open pull request.");
    } finally {
      setRepoProposalBusy(false);
    }
  }


  async function trackRepoProposalPr(proposal: RepoActionProposalSummary) {
    if (repoProposalBusy) return;

    setRepoProposalBusy(true);
    setRepoProposalStatus("");
    try {
      const response = await fetch("/api/repo-actions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: proposal.id, action: "track_pr" }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string; overallReady?: boolean; prUrl?: string };
      if (!response.ok) throw new Error(payload.error ?? "Failed to track pull request.");
      setRepoProposalStatus(payload.overallReady ? "PR tracked: ready for human review." : "PR tracked: waiting or needs review.");
      await refreshRepoProposals(selectedProjectKey);
      await refreshActionEvents(memoryProjectKey);
    } catch (error) {
      setRepoProposalStatus(error instanceof Error ? error.message : "Failed to track pull request.");
    } finally {
      setRepoProposalBusy(false);
    }
  }



  async function queueWorkspaceJobFromPrompt() {
    if (jobBusy || !workspaceId || !input.trim()) return;
    const title = input.trim().replace(/\s+/g, " ").slice(0, 90);
    setJobBusy(true);
    setJobStatus("");
    try {
      const response = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          conversationId,
          sessionId,
          title: title || "Queued Jarvis job",
          inputText: input.trim(),
          intent: "plan",
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Failed to queue job.");
      setJobStatus("Job queued. Open Tasks to run or monitor it.");
      setInput("");
      if (sessionId) await refreshTasks(sessionId, workspaceId, conversationId);
      await refreshActionEvents(memoryProjectKey);
    } catch (error) {
      setJobStatus(error instanceof Error ? error.message : "Failed to queue job.");
    } finally {
      setJobBusy(false);
    }
  }

  async function runQueuedWorkspaceJob(task: WorkspaceTaskSummary) {
    if (jobBusy || !sessionId) return;
    setJobBusy(true);
    setJobStatus("");
    try {
      const response = await fetch("/api/jobs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: task.id, sessionId }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!response.ok) throw new Error(payload.error ?? "Failed to run job.");
      setJobStatus(payload.message ?? "Job checkpoint updated.");
      if (workspaceId) await refreshTasks(sessionId, workspaceId, conversationId);
      await refreshActionEvents(memoryProjectKey);
    } catch (error) {
      setJobStatus(error instanceof Error ? error.message : "Failed to run job.");
    } finally {
      setJobBusy(false);
    }
  }

  async function openStoredProjectFile(file: WorkspaceProjectFileSummary) {
    try {
      setFileError("");
      if (!file.storagePath) {
        if (file.url) {
          window.open(file.url, "_blank", "noopener,noreferrer");
          return;
        }
        throw new Error("This file does not have storage metadata yet.");
      }

      const response = await fetch("/api/files/signed-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectFileId: file.id,
          workspaceId,
          conversationId,
          sessionId,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string; url?: string };
      if (!response.ok || !payload.url) throw new Error(payload.error ?? "Failed to open stored file.");
      window.open(payload.url, "_blank", "noopener,noreferrer");
    } catch (error) {
      setFileError(error instanceof Error ? error.message : "Failed to open stored file.");
    }
  }


  async function refreshDeployHealth() {
    setDeployHealthBusy(true);
    setDeployHealthStatus("");
    try {
      const response = await fetch("/api/deploy-health");
      const payload = (await response.json().catch(() => ({}))) as DeployHealthSnapshot & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Deploy health unavailable.");
      setDeployHealth(payload);
      await refreshActionEvents(memoryProjectKey);
    } catch (error) {
      setDeployHealthStatus(error instanceof Error ? error.message : "Deploy health unavailable.");
    } finally {
      setDeployHealthBusy(false);
    }
  }

  async function handleSaveMemory(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!memoryTitle.trim() || !memoryContent.trim() || memoryBusy) return;

    setMemoryBusy(true);
    setMemoryStatus("");
    try {
      const response = await fetch("/api/memory", {
        method: editingMemoryId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(editingMemoryId ? { id: editingMemoryId } : {}),
          kind: memoryKind,
          title: memoryTitle.trim(),
          content: memoryContent.trim(),
          project_key: memoryProjectKey,
          tags: [memoryProjectKey, editingMemoryId ? "edited" : "manual"].filter(Boolean),
          priority: memoryKind === "rule" || memoryKind === "safety" ? 9 : 6,
          source: editingMemoryId ? "jarvis_ui_edit" : "jarvis_ui",
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        duplicate?: AgentMemorySummary;
      };
      if (!response.ok) {
        if (response.status === 409 && payload.duplicate) {
          throw new Error(`Duplicate memory found: ${payload.duplicate.title}`);
        }
        throw new Error(payload.error ?? "Failed to save memory.");
      }
      setMemoryTitle("");
      setMemoryContent("");
      setEditingMemoryId(null);
      setMemoryStatus(editingMemoryId ? "Memory updated." : "Memory saved.");
      await refreshMemories(memoryProjectKey, memorySearch);
      await refreshActionEvents(memoryProjectKey);
    } catch (error) {
      setMemoryStatus(error instanceof Error ? error.message : "Failed to save memory.");
    } finally {
      setMemoryBusy(false);
    }
  }

  function beginEditMemory(memory: AgentMemorySummary) {
    setEditingMemoryId(memory.id);
    setMemoryKind(memory.kind);
    setMemoryProjectKey(memory.project_key || "global");
    setMemoryTitle(memory.title);
    setMemoryContent(memory.content);
    setMemoryStatus("Editing memory. Save to update, or cancel to discard changes.");
    setShowInfoSidebar(true);
    window.setTimeout(() => {
      document.querySelector(".memory-save-form")?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 80);
  }

  function cancelMemoryEdit() {
    setEditingMemoryId(null);
    setMemoryTitle("");
    setMemoryContent("");
    setMemoryKind("note");
    setMemoryStatus("");
  }

  async function archiveExistingMemory(memory: AgentMemorySummary) {
    const confirmed = window.confirm(`Archive this memory?\n\n${memory.title}`);
    if (!confirmed || memoryBusy) return;

    setMemoryBusy(true);
    setMemoryStatus("");
    try {
      const response = await fetch("/api/memory", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: memory.id, action: "archive" }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Failed to archive memory.");
      if (editingMemoryId === memory.id) cancelMemoryEdit();
      setMemoryStatus("Memory archived.");
      await refreshMemories(memoryProjectKey, memorySearch);
      await refreshActionEvents(memoryProjectKey);
    } catch (error) {
      setMemoryStatus(error instanceof Error ? error.message : "Failed to archive memory.");
    } finally {
      setMemoryBusy(false);
    }
  }

  function parseMemoryImportPayload() {
    const trimmed = memoryImportText.trim();
    if (!trimmed) throw new Error("Paste a curated memory JSON array or an object with an items array.");
    const parsed = JSON.parse(trimmed) as unknown;
    const items = Array.isArray(parsed)
      ? parsed
      : typeof parsed === "object" && parsed !== null && Array.isArray((parsed as { items?: unknown }).items)
        ? (parsed as { items: unknown[] }).items
        : null;
    if (!items?.length) throw new Error("Memory import JSON must include at least one item.");
    return items;
  }

  async function runMemoryImport(mode: "dry_run" | "import") {
    if (memoryImportBusy) return;
    if (mode === "import" && !memoryImportApproved) {
      setMemoryImportStatus("Check the approval box before importing. Dry run first, then import only curated non-secret memories.");
      return;
    }

    setMemoryImportBusy(true);
    setMemoryImportStatus("");
    try {
      const items = parseMemoryImportPayload();
      const response = await fetch("/api/memory/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          approved: mode === "import" ? memoryImportApproved : false,
          source: "jarvis_ui_curated_import",
          items,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as MemoryImportResult;
      if (!response.ok && !payload.results?.length) throw new Error(payload.error ?? "Memory import failed.");
      setMemoryImportResult(payload);
      const ready = payload.ready ?? 0;
      const imported = payload.imported ?? 0;
      const blocked = payload.blocked ?? 0;
      const duplicates = payload.duplicates ?? 0;
      setMemoryImportStatus(
        mode === "import"
          ? `Import complete: ${imported} imported, ${blocked} blocked, ${duplicates} duplicates.`
          : `Dry run complete: ${ready} ready, ${blocked} blocked, ${duplicates} duplicates.`
      );
      if (mode === "import") {
        setMemoryImportApproved(false);
        await refreshMemories(memoryProjectKey, memorySearch);
      }
      await refreshActionEvents(memoryProjectKey);
    } catch (error) {
      setMemoryImportStatus(error instanceof Error ? error.message : "Memory import failed.");
    } finally {
      setMemoryImportBusy(false);
    }
  }

  function stageAssistantMessageAsMemory(content: string) {
    const cleaned = content.replace(/\s+/g, " ").trim();
    if (!cleaned) return;
    const firstSentence = cleaned.match(/^(.{24,110}?[.!?])\s/)?.[1] ?? cleaned.slice(0, 90);
    const title = firstSentence.length > 110 ? `${firstSentence.slice(0, 107)}…` : firstSentence;

    setEditingMemoryId(null);
    setMemoryKind("note");
    setMemoryTitle(title || "Saved Jarvis insight");
    setMemoryContent(cleaned.slice(0, 4000));
    setMemoryStatus("Review, edit, then save this memory.");
    setShowInfoSidebar(true);
    window.setTimeout(() => {
      document.querySelector(".memory-save-form")?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 80);
  }

  async function loadConversation(
    activeSessionId: string,
    nextWorkspaceId: string | null,
    nextConversationId: string | null
  ) {
    setHistoryLoaded(false);
    try {
      if (!nextConversationId) {
        setMessages([]);
        return;
      }

      const search = new URLSearchParams({ sessionId: activeSessionId });
      if (nextWorkspaceId) search.set("workspaceId", nextWorkspaceId);
      search.set("conversationId", nextConversationId);
      const response = await fetch(`/api/history?${search.toString()}`);
      if (!response.ok) {
        throw new Error("Failed to load conversation history.");
      }

      const payload = (await response.json()) as {
        conversationId: string | null;
        messages: { id: string; role: string; content: string }[];
      };

      setConversationId(payload.conversationId ?? nextConversationId);
      setMessages(
        dedupeMessages(payload.messages ?? []).map((message) => ({
          id: message.id,
          role: message.role as "user" | "assistant",
          content: message.content,
          parts: [{ type: "text" as const, text: message.content }],
        }))
      );
    } finally {
      setHistoryLoaded(true);
    }
  }

  async function createConversationForWorkspace(
    activeSessionId: string,
    nextWorkspaceId: string
  ) {
    const response = await fetch("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: activeSessionId,
        workspaceId: nextWorkspaceId,
      }),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(payload.error ?? "Failed to create a new chat.");
    }

    const payload = (await response.json()) as {
      conversation: WorkspaceConversationSummary;
    };
    return payload.conversation;
  }

  async function syncWorkspaceSelection(
    nextWorkspaceId?: string | null,
    preferredConversationId?: string | null,
    sessionOverride?: string | null
  ) {
    const activeSessionId = sessionOverride ?? sessionId;
    if (!activeSessionId) return;

    setWorkspaceBusy(true);
    setWorkspaceError("");

    try {
      let workspaceData = await fetchWorkspaceData(activeSessionId, nextWorkspaceId);
      applyWorkspaceData(workspaceData);

      const resolvedWorkspaceId =
        workspaceData.selectedWorkspaceId ??
        nextWorkspaceId ??
        workspaceData.workspaces[0]?.id ??
        null;
      const resolvedWorkspace = workspaceData.workspaces.find(
        (workspace) => workspace.id === resolvedWorkspaceId
      );

      let resolvedConversationId =
        preferredConversationId &&
        resolvedWorkspace?.conversations.some(
          (conversation) => conversation.id === preferredConversationId
        )
          ? preferredConversationId
          : resolvedWorkspace?.conversations[0]?.id ?? null;

      if (!resolvedConversationId && resolvedWorkspaceId) {
        const createdConversation = await createConversationForWorkspace(
          activeSessionId,
          resolvedWorkspaceId
        );
        workspaceData = await fetchWorkspaceData(activeSessionId, resolvedWorkspaceId);
        applyWorkspaceData(workspaceData);
        resolvedConversationId = createdConversation.id;
      }

      setWorkspaceId(resolvedWorkspaceId);
      setConversationId(resolvedConversationId);
      if (resolvedWorkspaceId) {
        localStorage.setItem(STORAGE_KEY_WORKSPACE_ID, resolvedWorkspaceId);
      }
      if (resolvedConversationId) {
        localStorage.setItem(STORAGE_KEY_CONVERSATION_ID, resolvedConversationId);
      }

      await loadConversation(activeSessionId, resolvedWorkspaceId, resolvedConversationId);
      await refreshTasks(
        activeSessionId,
        resolvedWorkspaceId,
        resolvedConversationId
      );
    } catch (error) {
      setWorkspaceError(
        error instanceof Error ? error.message : "Failed to load workspace data."
      );
      setHistoryLoaded(true);
    } finally {
      setWorkspaceBusy(false);
    }
  }

  useEffect(() => {
    let active = true;
    const activeSessionId =
      localStorage.getItem(STORAGE_KEY_SESSION_ID) ?? crypto.randomUUID();
    localStorage.setItem(STORAGE_KEY_SESSION_ID, activeSessionId);
    setSessionId(activeSessionId);

    const preferredWorkspaceId = localStorage.getItem(STORAGE_KEY_WORKSPACE_ID);
    const preferredConversationId = localStorage.getItem(STORAGE_KEY_CONVERSATION_ID);

    if (active) {
      void syncWorkspaceSelection(
        preferredWorkspaceId,
        preferredConversationId,
        activeSessionId
      );
    }

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isChatRequestInFlight = status === "submitted" || status === "streaming";
  const latestAssistantText = getAssistantTextFromMessage(messages[messages.length - 1]);
  const hasAssistantTextWhileStreaming = isChatRequestInFlight && latestAssistantText.trim().length > 0;
  const hasVisibleAssistantMessage = latestAssistantText.trim().length > 0;
  const isStreamFinalizing = isChatRequestInFlight && streamFinalizationRecovered;
  const isStreamStalled = isChatRequestInFlight && streamStallRecovered && !hasVisibleAssistantMessage;
  const isLoading = (isChatRequestInFlight && !isStreamFinalizing && !isStreamStalled) || isUploadingAttachment;
  const showBusyStatus = isChatRequestInFlight || isUploadingAttachment;

  // Scroll to bottom when a response finishes or a new message is added.
  useEffect(() => {
    if (status === "ready" || status === "error") {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [status, messages.length]);

  async function recoverStalledChatStream(reason: "watchdog" | "secondary") {
    if (!sessionId || !workspaceId || streamStallRecoveryInFlightRef.current) return;

    streamStallRecoveryInFlightRef.current = true;
    try {
      setStreamRecoveryNotice(
        reason === "watchdog"
          ? "Checking for completed answer…"
          : "Response stalled. I refreshed saved chat state so you can continue."
      );
      await Promise.all([
        loadConversation(sessionId, workspaceId, conversationId),
        refreshTasks(sessionId, workspaceId, conversationId),
      ]);
    } catch {
      setStreamRecoveryNotice(
        "Response stalled. The saved answer could not be refreshed automatically — you can send again."
      );
    } finally {
      streamStallRecoveryInFlightRef.current = false;
    }
  }

  useEffect(() => {
    if (!isChatRequestInFlight || !hasAssistantTextWhileStreaming) {
      if (streamRecoveryTimerRef.current) {
        clearTimeout(streamRecoveryTimerRef.current);
        streamRecoveryTimerRef.current = null;
      }
      setStreamFinalizationRecovered(false);
      return;
    }

    if (streamFinalizationRecovered || streamRecoveryTimerRef.current) return;

    streamRecoveryTimerRef.current = setTimeout(() => {
      streamRecoveryTimerRef.current = null;
      setStreamFinalizationRecovered(true);
    }, STREAM_FINALIZATION_RECOVERY_MS);

    return () => {
      if (streamRecoveryTimerRef.current) {
        clearTimeout(streamRecoveryTimerRef.current);
        streamRecoveryTimerRef.current = null;
      }
    };
  }, [hasAssistantTextWhileStreaming, isChatRequestInFlight, streamFinalizationRecovered]);

  useEffect(() => {
    if (streamFinalizationRecovered && sessionId && workspaceId) {
      void refreshTasks(sessionId, workspaceId, conversationId);
    }
  }, [streamFinalizationRecovered, sessionId, workspaceId, conversationId]);

  useEffect(() => {
    if (!isChatRequestInFlight || hasVisibleAssistantMessage) {
      if (streamStallWatchdogTimerRef.current) {
        clearTimeout(streamStallWatchdogTimerRef.current);
        streamStallWatchdogTimerRef.current = null;
      }
      if (streamStallSecondaryTimerRef.current) {
        clearTimeout(streamStallSecondaryTimerRef.current);
        streamStallSecondaryTimerRef.current = null;
      }
      setStreamStallRecovered(false);
      if (!isChatRequestInFlight) setStreamRecoveryNotice("");
      return;
    }

    if (streamStallRecovered || streamStallWatchdogTimerRef.current) return;

    streamStallWatchdogTimerRef.current = setTimeout(() => {
      streamStallWatchdogTimerRef.current = null;
      setStreamStallRecovered(true);
      void recoverStalledChatStream("watchdog");

      streamStallSecondaryTimerRef.current = setTimeout(() => {
        streamStallSecondaryTimerRef.current = null;
        void recoverStalledChatStream("secondary");
      }, STREAM_STALL_SECONDARY_RECOVERY_MS);
    }, STREAM_STALL_WATCHDOG_MS);

    return () => {
      if (streamStallWatchdogTimerRef.current) {
        clearTimeout(streamStallWatchdogTimerRef.current);
        streamStallWatchdogTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasVisibleAssistantMessage, isChatRequestInFlight, streamStallRecovered, sessionId, workspaceId, conversationId]);

  useEffect(() => {
    if (status === "ready" && sessionId && workspaceId) {
      setResumeTaskId(null);
      void (async () => {
        try {
          const data = await fetchWorkspaceData(sessionId, workspaceId);
          applyWorkspaceData(data);
          await refreshTasks(sessionId, workspaceId, conversationId);
        } catch {
          // Keep the current UI state if the refresh fails.
        }
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, sessionId, workspaceId, conversationId]);

  useEffect(() => {
    if (!sessionId || !workspaceId) return;

    const hasActiveTask = tasks.some(
      (task) => task.status === "queued" || task.status === "running"
    );
    if (!hasActiveTask && status !== "streaming" && status !== "submitted") {
      return;
    }

    const interval = window.setInterval(() => {
      if (taskRefreshInFlightRef.current) return;
      taskRefreshInFlightRef.current = true;
      void refreshTasks(sessionId, workspaceId, conversationId).finally(() => {
        taskRefreshInFlightRef.current = false;
      });
    }, 5000);

    return () => window.clearInterval(interval);
  }, [sessionId, workspaceId, conversationId, tasks, status]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void refreshMemories(memoryProjectKey, memorySearch);
    }, 250);

    return () => window.clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memoryProjectKey, memorySearch]);


  useEffect(() => {
    void refreshActionEvents(memoryProjectKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memoryProjectKey]);


  useEffect(() => {
    void refreshBuildIntelligence("jarvis");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  useEffect(() => {
    void refreshRepoProposals("jarvis");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  useEffect(() => {
    void refreshDeployHealth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  // Determine the active tool name while streaming
  const activeToolName = showBusyStatus
    ? (() => {
        const last = messages[messages.length - 1];
        if (!last || last.role !== "assistant") return null;
        const pending = (last.parts ?? []).findLast(
          (p) =>
            p.type === "tool-invocation" &&
            (p as { type: string; toolInvocation: ToolInvocation })
              .toolInvocation.state !== "result"
        );
        if (!pending) return null;
        const toolName = (
          pending as {
            type: string;
            toolInvocation: ToolInvocation;
          }
        ).toolInvocation.toolName;
        return `Running ${toolName.replace(/_/g, " ")}`;
      })()
    : null;

  // Revoke object URLs when they change or component unmounts
  useEffect(() => {
    return () => {
      previewUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [previewUrls]);

  useEffect(() => {
    if (!artifacts.length) {
      setArtifactPreviewId(null);
      return;
    }
    if (!artifactPreviewId || !artifacts.some((artifact) => artifact.id === artifactPreviewId)) {
      setArtifactPreviewId(artifacts[0].id);
    }
  }, [artifacts, artifactPreviewId]);

  function validateFiles(fileList: FileList): string {
    for (const file of Array.from(fileList)) {
      if (file.size > MAX_FILE_SIZE) {
        return `"${file.name}" exceeds the ${MAX_FILE_SIZE_MB} MB limit.`;
      }
      if (!ACCEPTED_TYPES.includes(file.type)) {
        return `"${file.name}" type not supported. Accepted: images (JPEG, PNG, GIF, WEBP) and text files.`;
      }
    }
    return "";
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    previewUrls.forEach((url) => URL.revokeObjectURL(url));

    const selected = e.target.files;
    if (!selected || selected.length === 0) {
      setFiles(undefined);
      setPreviewUrls([]);
      setFileError("");
      return;
    }

    const error = validateFiles(selected);
    if (error) {
      setFileError(error);
      setFiles(undefined);
      setPreviewUrls([]);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } else {
      setFileError("");
      setFiles(selected);
      setPreviewUrls(Array.from(selected).map((f) => URL.createObjectURL(f)));
    }
  }

  const handleScreenshotPaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
      if (items[itemIndex].type.indexOf("image") !== -1) {
        e.preventDefault();

        const file = items[itemIndex].getAsFile();
        if (!file) continue;

        if (file.size > MAX_FILE_SIZE) {
          setFileError(`File size exceeds limit of ${MAX_FILE_SIZE_MB}MB`);
          continue;
        }

        const formData = new FormData();
        formData.append("file", file);
        if (workspaceId) formData.append("workspaceId", workspaceId);
        if (conversationId) formData.append("conversationId", conversationId);
        if (sessionId) formData.append("sessionId", sessionId);

        try {
          const res = await fetch("/api/upload", {
            method: "POST",
            body: formData,
          });

          if (!res.ok) {
            const payload = await res.json().catch(() => ({})) as { error?: string };
            const msg = payload.error ?? `Upload failed with status ${res.status}`;
            throw new Error(msg);
          }

          const data = await res.json() as { url?: string };

          if (data.url) {
            setFileError("");
            setInput((prev: string) =>
              `${prev}${prev ? "\n" : ""}![pasted screenshot ${itemIndex + 1}](${data.url})`
            );
          }
        } catch (err) {
          console.error("Failed to upload pasted image:", err);
          setFileError(err instanceof Error ? err.message : "Failed to upload pasted image.");
        }
      }
    }
  };

  async function uploadImageAttachment(file: File): Promise<LightweightAttachment> {
    const formData = new FormData();
    formData.append("file", file);
    if (workspaceId) formData.append("workspaceId", workspaceId);
    if (conversationId) formData.append("conversationId", conversationId);
    if (sessionId) formData.append("sessionId", sessionId);

    const response = await fetch("/api/upload", {
      method: "POST",
      body: formData,
    });

    const payload = await response.json().catch(() => ({})) as {
      url?: string;
      name?: string;
      mimeType?: string;
      error?: string;
    };

    if (!response.ok || !payload.url) {
      throw new Error(payload.error ?? `Upload failed with status ${response.status}`);
    }

    return {
      name: payload.name ?? file.name,
      contentType: payload.mimeType ?? file.type,
      url: payload.url,
    };
  }

  async function prepareChatAttachments(fileList: FileList): Promise<LightweightAttachment[] | FileList> {
    const selectedFiles = Array.from(fileList);
    const imageFiles = selectedFiles.filter((file) => file.type.startsWith("image/"));
    const passthroughFiles = selectedFiles.filter((file) => !file.type.startsWith("image/"));

    if (imageFiles.length === 0) return fileList;
    if (passthroughFiles.length > 0) {
      throw new Error("Please send images and text files separately so Jarvis can process them safely.");
    }

    setFileError("Uploading image safely before sending…");
    return Promise.all(imageFiles.map(uploadImageAttachment));
  }

  function clearAttachments() {
    previewUrls.forEach((url) => URL.revokeObjectURL(url));
    setFiles(undefined);
    setPreviewUrls([]);
    setFileError("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleFormSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (isLoading) return;

    const hasFiles = files != null && files.length > 0;
    if (!input.trim() && !hasFiles) return;

    setChatErrorMessage("");
    try {
      setIsUploadingAttachment(hasFiles);
      const safeAttachments = hasFiles && files ? await prepareChatAttachments(files) : undefined;
      handleSubmit(e, {
        experimental_attachments: safeAttachments,
        allowEmptySubmit: hasFiles && !input.trim(),
      });
      if (!hasFiles || input.trim()) setResumeTaskId(null);
      clearAttachments();
    } catch (error) {
      setFileError(
        error instanceof Error
          ? error.message
          : "Jarvis could not prepare that attachment. Try a smaller image or send it separately."
      );
    } finally {
      setIsUploadingAttachment(false);
    }
  }

  const showTypingIndicator =
    isLoading && !isStreamStalled && messages[messages.length - 1]?.role !== "assistant";

  function fillStarterPrompt(prompt: string) {
    if (isLoading) return;
    setInput(prompt);
  }

  async function handleWorkspaceSelect(nextWorkspaceId: string) {
    if (workspaceBusy || nextWorkspaceId === workspaceId) return;
    await syncWorkspaceSelection(nextWorkspaceId, null);
  }

  async function handleConversationSelect(nextConversationId: string) {
    if (!sessionId || !workspaceId || nextConversationId === conversationId) return;
    setWorkspaceError("");
    setConversationId(nextConversationId);
    localStorage.setItem(STORAGE_KEY_CONVERSATION_ID, nextConversationId);
    await loadConversation(sessionId, workspaceId, nextConversationId);
    await refreshTasks(sessionId, workspaceId, nextConversationId);
  }

  async function handleCreateWorkspace(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!sessionId || !canManageWorkspaces || workspaceBusy) return;

    setWorkspaceBusy(true);
    setWorkspaceError("");
    try {
      const response = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          name: newWorkspaceName,
          description: newWorkspaceDescription,
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? "Failed to create workspace.");
      }

      const payload = (await response.json()) as {
        workspace: { id: string };
      };
      setNewWorkspaceName("");
      setNewWorkspaceDescription("");
      await syncWorkspaceSelection(payload.workspace.id, null);
    } catch (error) {
      setWorkspaceError(
        error instanceof Error ? error.message : "Failed to create workspace."
      );
    } finally {
      setWorkspaceBusy(false);
    }
  }

  async function handleNewChat() {
    if (!sessionId || !workspaceId || workspaceBusy || !canManageWorkspaces) return;
    setWorkspaceBusy(true);
    setWorkspaceError("");
    try {
      const conversation = await createConversationForWorkspace(sessionId, workspaceId);
      await syncWorkspaceSelection(workspaceId, conversation.id);
      setMessages([]);
    } catch (error) {
      setWorkspaceError(
        error instanceof Error ? error.message : "Failed to start a new chat."
      );
    } finally {
      setWorkspaceBusy(false);
    }
  }

  async function handleResumeTask(task: WorkspaceTaskSummary) {
    if (!task.id) return;
    try {
      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: task.id }),
      });
      if (!response.ok) return;

      setResumeTaskId(task.id);
      setInput(task.inputText ?? "");
      if (sessionId && workspaceId) {
        await refreshTasks(sessionId, workspaceId, conversationId);
      }
    } catch {
      // no-op
    }
  }

  return (
    <div className="workspace-app">
      {showWorkspaceDrawer && (
        <button
          type="button"
          className="drawer-backdrop workspace-drawer-backdrop"
          aria-label="Close workspace drawer"
          onClick={() => setShowWorkspaceDrawer(false)}
        />
      )}

      <aside className={`workspace-sidebar ${showWorkspaceDrawer ? "workspace-sidebar--open" : ""}`}>
        <div className="workspace-sidebar-top">
          <div className="workspace-brand">
            <span className="workspace-brand-mark">J</span>
            <div>
              <div className="workspace-brand-title">Jarvis</div>
              <p className="workspace-brand-subtitle">AI workspace</p>
            </div>
          </div>

          {workspaceNotice && (
            <div className="workspace-notice">
              <strong>Workspace status</strong>
              <p>{workspaceNotice}</p>
            </div>
          )}
          {workspaceError && <div className="workspace-error">{workspaceError}</div>}
        </div>

        <div className="workspace-list">
          {workspaces.map((workspace) => {
            const isActive = workspace.id === workspaceId;
            return (
              <button
                key={workspace.id}
                type="button"
                className={`workspace-list-item ${isActive ? "workspace-list-item--active" : ""}`}
                onClick={() => {
                  handleWorkspaceSelect(workspace.id);
                  setShowWorkspaceDrawer(false);
                }}
              >
                <div className="workspace-list-item-header">
                  <span>{workspace.name}</span>
                  <span className="workspace-count-pill">
                    {workspace.artifactCount + workspace.documentCount}
                  </span>
                </div>
                {workspace.description && (
                  <p className="workspace-list-item-description">
                    {workspace.description}
                  </p>
                )}
                <div className="workspace-list-item-meta">
                  <span>{workspace.conversationCount} chats</span>
                  <span>{workspace.documentCount} docs</span>
                  <span>{workspace.artifactCount} artifacts</span>
                </div>
              </button>
            );
          })}
        </div>

        <div className="conversation-sidebar">
          <div className="conversation-sidebar-header">
            <div>
              <div className="side-section-label">Chats</div>
              <p className="side-section-copy">
                Keep project-specific threads separated by workspace.
              </p>
            </div>
            <button
              type="button"
              className="secondary-button"
              onClick={handleNewChat}
              disabled={!canManageWorkspaces || workspaceBusy}
            >
              New chat
            </button>
          </div>

          <div className="conversation-list">
            {selectedWorkspace?.conversations.length ? (
              selectedWorkspace.conversations.map((conversation) => (
                <button
                  key={conversation.id}
                  type="button"
                  className={`conversation-list-item ${
                    conversation.id === conversationId
                      ? "conversation-list-item--active"
                      : ""
                  }`}
                  onClick={() => handleConversationSelect(conversation.id)}
                >
                  <span className="conversation-list-title">
                    {conversation.title}
                  </span>
                  <span className="conversation-list-meta">
                    {formatTimestamp(conversation.updatedAt)}
                  </span>
                </button>
              ))
            ) : (
              <div className="conversation-empty">
                Start a new chat to separate work within this workspace.
              </div>
            )}
          </div>
        </div>
      </aside>

      <section className="chat-panel">
        <div className="chat-header chat-header--workspace">
          <button
            type="button"
            className="native-icon-button"
            aria-label="Open workspaces"
            aria-expanded={showWorkspaceDrawer}
            onClick={() => setShowWorkspaceDrawer(true)}
          >
            ☰
          </button>
          <div className="chat-header-copy">
            <span className="chat-header-title">Jarvis</span>
            <p className="chat-header-subtitle">
              {selectedWorkspace?.name ?? "Private workspace"}
              {showBusyStatus ? (isStreamStalled ? " · checking" : isStreamFinalizing ? " · finalizing" : " · thinking") : ""}
            </p>
          </div>
          <div className="chat-header-right">
            {showBusyStatus && (
              <span className="status-badge">
                <span className="status-dot" />
                {isStreamStalled ? "Checking for completed answer…" : isStreamFinalizing ? "Finalizing answer…" : activeToolName ? activeToolName.replace(/_/g, " ") : "Thinking…"}
              </span>
            )}
            {resumeTaskId && !isLoading && (
              <span className="status-badge">Resuming task</span>
            )}
            <button
              type="button"
              className="native-tool-button"
              aria-label={showInfoSidebar ? "Hide tools" : "Open tools"}
              aria-expanded={showInfoSidebar}
              onClick={() => setShowInfoSidebar((prev) => !prev)}
            >
              Tools
            </button>
            <button className="logout-button native-logout-button" onClick={handleLogout}>
              Sign out
            </button>
          </div>
        </div>

        <div className="workspace-summary-bar native-status-strip" aria-label="Current workspace status">
          <span className="summary-chip">{selectedWorkspace?.name ?? "General"}</span>
          <span className="summary-chip">{persistenceEnabled && schemaReady ? "Synced" : "Local"}</span>
          {tasks.some((task) => task.status === "queued" || task.status === "running") && (
            <span className="summary-chip">Task running</span>
          )}
        </div>

        <div className="messages">
          {!historyLoaded ? (
            <div className="empty-state">
              <p>Loading workspace…</p>
            </div>
          ) : messages.length === 0 ? (
            <div className="private-owner-empty" aria-label="Private Jarvis workspace ready">
              <div className="private-owner-orb" aria-hidden="true">J</div>
              <p>Private workspace ready</p>
              <span>Ask Jarvis below. Your tools, memory, repo control, files, and tasks stay tucked into the drawers.</span>
            </div>
          ) : (
            messages.map((message) => {
              const messageText = (message.parts ?? [])
                .filter((part): part is { type: "text"; text: string } => part.type === "text")
                .map((part) => part.text)
                .join("\n\n") || message.content || "";
              const hasToolParts = (message.parts ?? []).some((part) => part.type === "tool-invocation");
              const hasAttachments = Boolean(message.experimental_attachments?.length);
              if (!messageText.trim() && !hasToolParts && !hasAttachments) return null;

              return (
              <div
                key={message.id}
                className={`message ${message.role === "user" ? "user" : "assistant"}`}
              >
                <div className="message-role-row">
                  <div className="message-role">
                    {message.role === "user" ? "" : "Jarvis"}
                  </div>
                  {message.role === "assistant" && messageText.trim() && (
                    <button
                      type="button"
                      className="remember-message-button"
                      onClick={() => stageAssistantMessageAsMemory(messageText)}
                    >
                      Remember
                    </button>
                  )}
                </div>
                <div className="message-content">
                  {(() => {
                    const seenToolCards = new Set<string>();
                    return message.parts.map((part, index) => {
                    if (part.type === "text") {
                      if (!part.text.trim()) return null;
                      if (message.role === "assistant") {
                        return (
                          <div
                            key={`${message.id}-${index}`}
                            className="markdown-body"
                          >
                            <ReactMarkdown>{part.text}</ReactMarkdown>
                          </div>
                        );
                      }
                      return <p key={`${message.id}-${index}`}>{part.text}</p>;
                    }

                    if (part.type === "tool-invocation") {
                      const invocation = (
                        part as {
                          type: string;
                          toolInvocation: ToolInvocation;
                        }
                      ).toolInvocation;
                      const stageKey =
                        typeof invocation.args?.action === "string"
                          ? invocation.args.action
                          : typeof (invocation.result as { action?: unknown } | undefined)?.action === "string"
                            ? ((invocation.result as { action?: string }).action as string)
                            : "";
                      const proposalKey =
                        typeof invocation.args?.proposalId === "string"
                          ? invocation.args.proposalId
                          : typeof (invocation.result as { proposalId?: unknown } | undefined)?.proposalId === "string"
                            ? ((invocation.result as { proposalId?: string }).proposalId as string)
                            : "";
                      const capabilityDedupeKey =
                        invocation.toolName === "get_jarvis_capability_snapshot" || invocation.toolName === "get_jarvis_self_audit_snapshot" || invocation.toolName === "get_tool_lifecycle_diagnostic"
                          ? invocation.toolName
                          : "";
                      const toolSignature = capabilityDedupeKey || `${invocation.toolName}:${stageKey}:${proposalKey}:${invocation.state === "result" ? JSON.stringify(invocation.result ?? {}) : invocation.state}`;
                      if (seenToolCards.has(toolSignature)) return null;
                      seenToolCards.add(toolSignature);
                      return (
                        <ToolCallCard
                          key={`${message.id}-${index}`}
                          invocation={invocation}
                          assistantHasText={Boolean(messageText.trim())}
                        />
                      );
                    }

                    return null;
                  });
                  })()}
                </div>
                {message.role === "user" &&
                  message.experimental_attachments &&
                  message.experimental_attachments.length > 0 && (
                    <div className="message-attachments">
                      {message.experimental_attachments.map((attachment, index) => {
                        const safeImageUrl = getSafeAttachmentImageUrl(attachment.url, [
                          "blob:",
                          "https:",
                        ]);

                        return attachment.contentType?.startsWith("image/") &&
                          safeImageUrl ? (
                          <img
                            key={index}
                            src={safeImageUrl}
                            alt={attachment.name ?? "Attached image"}
                            className="attachment-image"
                          />
                        ) : (
                          <div key={index} className="attachment-file">
                            📎 {attachment.name ?? "File"}
                          </div>
                        );
                      })}
                    </div>
                  )}
              </div>
              );
            })
          )}

          {showTypingIndicator && (
            <div className="message assistant message--typing">
              <div className="message-role">Jarvis</div>
              <div
                className="typing-indicator"
                role="status"
                aria-live="polite"
                aria-label="Jarvis is thinking"
              >
                <span />
                <span />
                <span />
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {files != null && files.length > 0 && (
          <div className="attachment-preview">
            {Array.from(files).map((file, idx) => (
              <div key={idx} className="attachment-preview-item">
                <span className="attachment-preview-file">
                  {file.type.startsWith("image/") ? "🖼️" : "📎"} {file.name}
                </span>
              </div>
            ))}
            <button
              type="button"
              className="attachment-clear"
              onClick={clearAttachments}
              aria-label="Clear attachments"
            >
              ✕
            </button>
          </div>
        )}

        {fileError && <div className="file-error">{fileError}</div>}
        {jobStatus && <div className="file-error">{jobStatus}</div>}
        {streamRecoveryNotice && <div className="file-error">{streamRecoveryNotice}</div>}
        {(chatErrorMessage || chatError) && (
          <div className="chat-error-banner" role="alert">
            <strong>Jarvis paused.</strong>
            <span>
              {chatErrorMessage || chatError?.message ||
                "Something interrupted the response. Try sending again."}
            </span>
          </div>
        )}

        <form ref={formRef} className="input-form" onSubmit={handleFormSubmit}>
          <label className="attach-button" title="Attach image or text file">
            📎
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={ACCEPTED_TYPES.join(",")}
              onChange={handleFileChange}
              className="file-input-hidden"
            />
          </label>
          <label htmlFor="chat-message-input" className="sr-only">
            Message input
          </label>
          <span id="chat-input-help" className="sr-only">
            Press Enter to send. Press Shift plus Enter for a new line.
          </span>
          <textarea
            id="chat-message-input"
            aria-describedby="chat-input-help"
            name="message"
            value={input}
            onChange={handleInputChange}
            onPaste={handleScreenshotPaste}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                formRef.current?.requestSubmit();
              }
            }}
            placeholder="Ask Jarvis anything for this workspace…"
            className="chat-input"
            rows={1}
          />
          <button
            type="button"
            className="send-button"
            disabled={jobBusy || isLoading || !workspaceId || !input.trim()}
            onClick={queueWorkspaceJobFromPrompt}
            title="Queue this request as a safe background job"
          >
            {jobBusy ? "Queuing…" : "Queue"}
          </button>
          <button type="submit" className="send-button" disabled={isLoading}>
            {isUploadingAttachment ? "Uploading…" : isStreamStalled ? "Send" : isStreamFinalizing ? "Send" : status === "submitted" || status === "streaming" ? "Working…" : "Send"}
          </button>
        </form>
      </section>

      {showInfoSidebar && (
        <button
          type="button"
          className="drawer-backdrop tools-drawer-backdrop"
          aria-label="Close tools drawer"
          onClick={() => setShowInfoSidebar(false)}
        />
      )}

      {showInfoSidebar && (
        <aside className={toolsShellClassName} data-tools-mode={isMobileToolsMode ? "mobile" : "desktop"} aria-label="Jarvis tools and controls">
          <div className={toolsPanelClassName}>
            <div className={toolsTitlebarClassName}>
              <div>
                <span>Jarvis tools</span>
                <small>{selectedProject.label}</small>
              </div>
              <button type="button" onClick={() => setShowInfoSidebar(false)} aria-label="Close tools">Close</button>
            </div>

            {isMobileToolsMode && (
              <div className="mobile-tools-board-intro" data-testid="mobile-tools-tile-board">
                <span>Mobile command board</span>
                <strong>{selectedProject.label}</strong>
                <p>Tap a tile to open focused tools. Each drawer stays read-only until an approval gate is required.</p>
              </div>
            )}
            <div className={projectSwitchboardClassName}>
              <div className="context-panel-header">
                <div>
                  <div className="side-section-label">Project switchboard</div>
                  <p className="side-section-copy">
                    Scope Jarvis controls to the project you are working on.
                  </p>
                </div>
              </div>

              <div className="project-switchboard-grid">
                {PROJECT_SWITCHBOARD_OPTIONS.map((project) => (
                  <button
                    key={project.key}
                    type="button"
                    className={`project-switchboard-card ${selectedProjectKey === project.key ? "project-switchboard-card--active" : ""}`}
                    onClick={() => selectProject(project.key)}
                    style={{ "--project-accent": project.accent } as React.CSSProperties}
                  >
                    <span>{project.label}</span>
                    <small>{project.subtitle}</small>
                    <em>{project.repo}</em>
                    <b className={`project-safety-badge project-safety-badge--${project.safetyTone}`}>{project.safetyLabel}</b>
                  </button>
                ))}
              </div>

              <div className="project-switchboard-current">
                <span>Active project</span>
                <strong>{selectedProject.label}</strong>
                <small>{selectedProject.repo}</small>
                <div className="project-current-meta">
                  <b className={`project-safety-badge project-safety-badge--${selectedProject.safetyTone}`}>{selectedProject.safetyLabel}</b>
                  <b className="project-safety-badge project-safety-badge--read-only">Read-only console</b>
                </div>
              </div>
            </div>

            <div ref={mobileToolsTopRef} className={filingCabinetClassName} data-testid={isMobileToolsMode ? "mobile-tools-top-tiles" : "desktop-tools-drawers"} aria-label="Jarvis filing cabinet sections">
              {CABINET_DRAWERS.map((drawer) => (
                <button
                  key={drawer.key}
                  type="button"
                  className={filingCabinetTabClassName(drawer.key)}
                  onClick={() => handleCabinetDrawerSelect(drawer.key)}
                >
                  <span>{drawer.label}</span>
                  <small>{drawer.hint}</small>
                </button>
              ))}
            </div>

            {isMobileToolsMode && (
              <div className="mobile-tools-scroll-hint" aria-hidden="true">
                <span>Scroll for drawer details</span>
              </div>
            )}

            <div ref={mobileActiveDrawerRef} className={filingCabinetActiveLabelClassName} data-testid="mobile-tools-active-drawer-anchor">
              <div>
                <span>Open drawer</span>
                <strong>{CABINET_DRAWERS.find((drawer) => drawer.key === activeCabinetDrawer)?.label}</strong>
                {isMobileToolsMode && <small>Read-only controls</small>}
              </div>
              {isMobileToolsMode && <b className="mobile-tools-active-badge">No mutations</b>}
              {isMobileToolsMode && (
                <button
                  type="button"
                  className="mobile-tools-back-button"
                  onClick={handleBackToMobileTools}
                >
                  Back to tools
                </button>
              )}
            </div>

            {activeCabinetDrawer === "operator" && (
              <section className={operatorConsoleClassName} data-testid="operator-console-panel">
                <div className="drawer-section-heading operator-heading">
                  <div>
                    <p className="drawer-eyebrow">Operator console</p>
                    <h3>{selectedProject.label} command view</h3>
                    <small className="operator-refresh-note">
                      {operatorLastRefreshedAt
                        ? `Last refreshed ${formatTimestamp(operatorLastRefreshedAt)} · auto-refreshes while open`
                        : "Read-only status appears here. Auto-refresh starts after the first refresh."}
                    </small>
                  </div>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => void refreshOperatorConsole(selectedProjectKey)}
                    disabled={operatorBusy || buildIntelBusy || deployHealthBusy}
                  >
                    {operatorBusy ? "Refreshing…" : "Refresh console"}
                  </button>
                </div>

                <article className="operator-control-tower-card" data-testid="operator-control-tower-card">
                  <div className="operator-control-tower-main">
                    <span className="operator-card-label">Control Tower v3</span>
                    <h4>{selectedProject.label}</h4>
                    <p>{selectedProject.repo}</p>
                    <div className="operator-control-tower-badges">
                      <span className={`operator-status-pill operator-status-pill--${operatorHealthStatus}`}>{operatorReadinessLabel}</span>
                      <span className={`project-safety-badge project-safety-badge--${selectedProject.safetyTone}`}>{selectedProject.safetyLabel}</span>
                      <span className="project-safety-badge project-safety-badge--read-only">No mutations</span>
                    </div>
                  </div>
                  <div className={`operator-next-action operator-next-action--${operatorNextAction.tone}`}>
                    <span>Recommended next action</span>
                    <strong>{operatorNextAction.title}</strong>
                    <p>{operatorNextAction.detail}</p>
                    <small>{operatorNextAction.actionLabel}</small>
                  </div>
                </article>

                <div className="operator-mini-nav" data-testid="operator-mini-nav" aria-label="Operator section shortcuts">
                  <button type="button" onClick={() => scrollOperatorSection(operatorCommandRef)}>Command</button>
                  <button type="button" onClick={() => scrollOperatorSection(operatorSummaryRef)}>Summary</button>
                  <button type="button" onClick={() => scrollOperatorSection(operatorProposalsRef)}>Proposals</button>
                  <button type="button" onClick={() => scrollOperatorSection(operatorTasksRef)}>Tasks</button>
                </div>

                <div ref={operatorCommandRef} className="operator-command-grid" data-testid="operator-command-grid" aria-label="Operator Console v3 command actions">
                  {operatorCommandCards.map((card) => (
                    <button
                      key={card.key}
                      type="button"
                      className={`operator-command-card operator-command-card--${normalizeOperatorStatus(card.tone)}`}
                      onClick={() => handleCabinetDrawerSelect(card.targetDrawer)}
                    >
                      <span>{card.eyebrow}</span>
                      <strong>{card.title}</strong>
                      <p>{card.detail}</p>
                      <small>{card.actionLabel}</small>
                    </button>
                  ))}
                </div>

                <div className="operator-proposal-badges" data-testid="operator-proposal-badges" aria-label="Operator proposal status badges">
                  <span className={`operator-status-pill operator-status-pill--${latestRepoPrReady ? "ready" : normalizeOperatorStatus(latestRepoProposal?.status || "idle")}`}>{getProposalReadinessLabel(latestRepoProposal, latestRepoPrReady)}</span>
                  <span className="project-safety-badge project-safety-badge--read-only">Proposal-only shortcuts</span>
                  <span className="project-safety-badge project-safety-badge--read-only">No merge or deploy</span>
                </div>

                <div className="operator-signal-strip" aria-label="Operator signal summary">
                  <span><strong>{operatorSignalCount}</strong> signals loaded</span>
                  <span>Health: {operatorHealth?.status ?? "not checked"}</span>
                  <span>Build: {buildIntel?.github?.latestWorkflowRun?.conclusion ?? buildIntel?.github?.latestWorkflowRun?.status ?? "unknown"}</span>
                  <span>Deploy: {deployHealth?.overall ?? "unknown"}</span>
                </div>

                <div className="operator-quick-actions" aria-label="Operator quick actions">
                  <button type="button" onClick={() => void refreshOperatorConsole(selectedProjectKey)} disabled={operatorBusy || buildIntelBusy || deployHealthBusy}>
                    Refresh control tower
                  </button>
                  <button type="button" onClick={() => setActiveCabinetDrawer("repo")}>
                    Open Repo Control
                  </button>
                  <button type="button" onClick={() => setActiveCabinetDrawer("build")}>
                    Check build intelligence
                  </button>
                  <button type="button" onClick={() => setActiveCabinetDrawer("tasks")}>
                    View runner jobs
                  </button>
                  <button type="button" onClick={() => setActiveCabinetDrawer("repo")}>
                    Draft proposal
                  </button>
                  {latestRepoPrUrl ? (
                    <a href={latestRepoPrUrl} target="_blank" rel="noreferrer">Open latest PR</a>
                  ) : (
                    <button type="button" disabled title="No PR URL loaded yet">Open latest PR</button>
                  )}
                </div>

                <div ref={operatorSummaryRef} className="operator-summary-grid" data-testid="operator-summary-grid">
                  <article className="operator-summary-card operator-summary-card--primary operator-briefing-card" data-testid="operator-briefing-card">
                    <span className="operator-card-label">Today’s Briefing</span>
                    <div className="operator-card-title-row">
                      <strong>{displayedOperatorBriefing?.headline ?? "Daily briefing not loaded"}</strong>
                      {displayedOperatorBriefing?.overallStatus && <span className={`operator-status-pill operator-status-pill--${operatorBriefingOverallStatus}`}>{displayedOperatorBriefing.overallStatus}</span>}
                    </div>
                    <p>{displayedOperatorBriefing?.recommendedNextAction.detail ?? "Refresh the control tower to load the read-only Daily Operator Briefing."}</p>
                    {displayedOperatorBriefing ? (
                      <div className="operator-briefing-meta" aria-label="Daily Operator Briefing summary">
                        <span>{displayedOperatorBriefing.projects.length} projects</span>
                        <span>{displayedOperatorBriefing.proposals.length} proposals</span>
                        <span>{displayedOperatorBriefing.tasks.length} tasks</span>
                        <span>{displayedOperatorBriefing.memory.agentMemoriesReachable && displayedOperatorBriefing.memory.agentMemoryEventsReachable ? "Memory reachable" : "Memory warning"}</span>
                      </div>
                    ) : (
                      <button type="button" onClick={() => void refreshOperatorConsole(selectedProjectKey)} disabled={operatorBusy || buildIntelBusy || deployHealthBusy}>Load briefing</button>
                    )}
                    {displayedOperatorBriefing?.recommendedNextAction && <small>Next: {displayedOperatorBriefing.recommendedNextAction.title}</small>}
                    {selectedBriefingProject?.warnings?.length ? <small>{selectedBriefingProject.label}: {selectedBriefingProject.warnings[0]}</small> : null}
                    {operatorBriefingStatus && <small>{operatorBriefingStatus}</small>}
                  </article>

                  <article className="operator-summary-card operator-summary-card--primary">
                    <span className="operator-card-label">App health</span>
                    <div className="operator-card-title-row">
                      <strong>{operatorHealth?.status ? operatorHealth.status.toUpperCase() : "Not checked"}</strong>
                      {operatorHealth?.status && <span className={`operator-status-pill operator-status-pill--${operatorHealthStatus}`}>{operatorHealth.status}</span>}
                    </div>
                    <p>{operatorHealth?.summary ?? "Refresh to pull the latest read-only app health snapshot."}</p>
                    {operatorHealth?.score !== undefined && <small>Score {operatorHealth.score}/100</small>}
                  </article>

                  <article className="operator-summary-card">
                    <span className="operator-card-label">Build</span>
                    <div className="operator-card-title-row">
                      <strong>{buildIntel?.github?.latestWorkflowRun?.conclusion ?? buildIntel?.github?.latestWorkflowRun?.status ?? "Unknown"}</strong>
                      {buildIntel?.github?.latestWorkflowRun?.status && (
                        <span className={`operator-status-pill operator-status-pill--${operatorBuildStatus}`}>
                          {buildIntel.github.latestWorkflowRun.conclusion ?? buildIntel.github.latestWorkflowRun.status}
                        </span>
                      )}
                    </div>
                    <p>{buildIntel?.github?.latestCommit?.message?.split("\n")[0] ?? "GitHub/Vercel build signals appear here."}</p>
                    {buildIntel?.github?.latestCommit?.sha && <small>{buildIntel.github.latestCommit.sha.slice(0, 7)}</small>}
                  </article>

                  <article className="operator-summary-card">
                    <span className="operator-card-label">Deploy gate</span>
                    <div className="operator-card-title-row">
                      <strong>{deployHealth?.overall ? deployHealth.overall.toUpperCase() : "Unknown"}</strong>
                      {deployHealth?.overall && <span className={`operator-status-pill operator-status-pill--${operatorDeployStatus}`}>{deployHealth.overall}</span>}
                    </div>
                    <p>{deployHealth?.checks?.find((check) => check.status !== "ok")?.detail ?? "Deployment checks are metadata-only until explicitly approved."}</p>
                    {deployHealth?.generatedAt && <small>{formatTimestamp(deployHealth.generatedAt)}</small>}
                  </article>

                  <article className="operator-summary-card">
                    <span className="operator-card-label">Tasks + runner</span>
                    <div className="operator-card-title-row">
                      <strong>{activeOperatorTaskCount} active</strong>
                      <span className={`operator-status-pill operator-status-pill--${activeOperatorTaskCount ? "running" : "idle"}`}>
                        {activeOperatorTaskCount ? "active" : "idle"}
                      </span>
                    </div>
                    <p>{tasks.find((task) => task.status === "queued" || task.status === "running")?.title ?? "No active queued/running tasks in this workspace."}</p>
                    <small>{tasks.length} recent task{tasks.length === 1 ? "" : "s"}</small>
                  </article>
                </div>

                <div className="operator-flow-strip">
                  <span>Proposal</span>
                  <span>Diff</span>
                  <span>Checks</span>
                  <span>PR</span>
                  <span>Handoff</span>
                  <span className="operator-flow-strip__locked">Approval required</span>
                </div>

                <div className="operator-console-lists">
                  <article ref={operatorProposalsRef} className="operator-list-card" data-testid="operator-proposals-section">
                    <div className="operator-list-header">
                      <span>Repo Control</span>
                      <small>{repoProposals.length} proposal{repoProposals.length === 1 ? "" : "s"}</small>
                    </div>
                    {repoProposals.slice(0, 4).map((proposal) => {
                      const metadata = proposal.draft_metadata ?? {};
                      const prReady = metadata.pr_overall_ready === true;
                      const deploymentPrep = metadata.deployment_prep as { ready?: boolean; required_approval_phrase?: string; pr_url?: string } | undefined;
                      const prUrl = (typeof metadata.pr_url === "string" ? metadata.pr_url : "") || deploymentPrep?.pr_url;
                      return (
                        <div key={proposal.id} className="operator-list-row">
                          <div className="operator-row-title">
                            <strong>{proposal.title}</strong>
                            <span className={`operator-status-pill operator-status-pill--${prReady ? "ready" : proposal.status}`}>{prReady ? "PR ready" : proposal.status}</span>
                          </div>
                          <span>{proposal.risk_level} risk · {prReady ? "checks passed" : "waiting on Repo Control ladder"}</span>
                          <div className="operator-row-actions">
                            <button type="button" onClick={() => setActiveCabinetDrawer("repo")}>Review</button>
                            {prUrl && <a href={prUrl} target="_blank" rel="noreferrer">PR</a>}
                          </div>
                          {deploymentPrep?.ready && <small>Handoff ready · {deploymentPrep.required_approval_phrase ?? "approval required"}</small>}
                        </div>
                      );
                    })}
                    {!repoProposals.length && <p className="operator-empty-copy">No repo proposals loaded yet. Refresh console or open Repo.</p>}
                  </article>

                  <article ref={operatorTasksRef} className="operator-list-card" data-testid="operator-tasks-section">
                    <div className="operator-list-header">
                      <span>Runner / tasks</span>
                      <small>{activeOperatorTaskCount} active</small>
                    </div>
                    {tasks.slice(0, 5).map((task) => (
                      <div key={task.id} className="operator-list-row">
                        <div className="operator-row-title">
                          <strong>{task.title}</strong>
                          <span className={`operator-status-pill operator-status-pill--${task.runnerStatus ?? task.status}`}>{task.runnerStatus ?? task.status}</span>
                        </div>
                        {task.runnerMetadata?.job_kind && <small>{getRunnerJobLabel(task.runnerMetadata.job_kind)} · {task.runnerStatus ?? "unclaimed"}</small>}
                        {task.runnerMetadata?.approval_text && <small>Gate: {task.runnerMetadata.approval_text}</small>}
                      </div>
                    ))}
                    {!tasks.length && <p className="operator-empty-copy">No recent workspace tasks loaded.</p>}
                  </article>
                </div>

                <div className="operator-safety-note">
                  Read-only operator view. This panel does not merge, deploy, redeploy, rollback, release, edit payments, or queue runner jobs.
                </div>
                {operatorStatus && <p className="memory-status">{operatorStatus}</p>}
              </section>
            )}

            {activeCabinetDrawer === "memory" && (
            <div className={toolsSectionClassName("context-panel-section memory-panel-section filing-cabinet-content")}>
              <div className="context-panel-header">
                <div>
                  <div className="side-section-label">Memory core</div>
                  <p className="side-section-copy">
                    View and save enduring project facts, rules, and decisions.
                  </p>
                </div>
              </div>

              <div className="memory-project-tabs" aria-label="Memory project filter">
                {PROJECT_MEMORY_OPTIONS.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    className={`memory-tab ${memoryProjectKey === option.key ? "memory-tab--active" : ""}`}
                    onClick={() => setMemoryProjectKey(option.key)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>

              <input
                className="workspace-field memory-search"
                value={memorySearch}
                onChange={(e) => setMemorySearch(e.target.value)}
                placeholder="Search memories…"
              />

              <form className="memory-save-form" onSubmit={handleSaveMemory}>
                <div className="memory-form-row">
                  <select
                    className="workspace-field memory-kind-select"
                    value={memoryKind}
                    onChange={(e) => setMemoryKind(e.target.value as AgentMemorySummary["kind"])}
                    aria-label="Memory type"
                  >
                    <option value="note">Note</option>
                    <option value="project">Project</option>
                    <option value="rule">Rule</option>
                    <option value="workflow">Workflow</option>
                    <option value="decision">Decision</option>
                    <option value="safety">Safety</option>
                  </select>
                  <input
                    className="workspace-field"
                    value={memoryTitle}
                    onChange={(e) => setMemoryTitle(e.target.value)}
                    placeholder="Memory title"
                  />
                </div>
                <textarea
                  className="workspace-field workspace-field--multiline"
                  value={memoryContent}
                  onChange={(e) => setMemoryContent(e.target.value)}
                  placeholder="What should Jarvis remember?"
                  rows={3}
                />
                <div className="memory-form-actions">
                  <button
                    type="submit"
                    className="workspace-create-button"
                    disabled={memoryBusy || !memoryTitle.trim() || !memoryContent.trim()}
                  >
                    {memoryBusy ? "Saving…" : editingMemoryId ? "Update memory" : "Save memory"}
                  </button>
                  {editingMemoryId && (
                    <button
                      type="button"
                      className="secondary-button memory-cancel-button"
                      onClick={cancelMemoryEdit}
                      disabled={memoryBusy}
                    >
                      Cancel
                    </button>
                  )}
                </div>
                {memoryStatus && <p className="memory-status">{memoryStatus}</p>}
              </form>

              <section className="memory-import-panel" data-testid="memory-import-panel">
                <div className="memory-import-header">
                  <div>
                    <span>Curated memory import</span>
                    <p>Paste reviewed JSON only. Dry run blocks secrets, raw chats, and duplicates before anything is saved.</p>
                  </div>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setMemoryImportText(JSON.stringify([
                      {
                        kind: "decision",
                        title: "Example curated memory",
                        content: "Replace this with a short, non-secret project fact or decision.",
                        project_key: memoryProjectKey,
                        tags: [memoryProjectKey, "curated"],
                        priority: 6
                      }
                    ], null, 2))}
                    disabled={memoryImportBusy}
                  >
                    Example
                  </button>
                </div>
                <textarea
                  className="workspace-field workspace-field--multiline memory-import-textarea"
                  value={memoryImportText}
                  onChange={(e) => setMemoryImportText(e.target.value)}
                  placeholder='[{"kind":"decision","title":"...","content":"...","project_key":"jarvis","tags":["curated"],"priority":8}]'
                  rows={6}
                />
                <label className="memory-import-approval">
                  <input
                    type="checkbox"
                    checked={memoryImportApproved}
                    onChange={(e) => setMemoryImportApproved(e.target.checked)}
                  />
                  I reviewed this dry run and approve importing only curated, non-secret memory items.
                </label>
                <div className="memory-import-actions">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => void runMemoryImport("dry_run")}
                    disabled={memoryImportBusy || !memoryImportText.trim()}
                  >
                    {memoryImportBusy ? "Checking…" : "Dry run"}
                  </button>
                  <button
                    type="button"
                    className="workspace-create-button"
                    onClick={() => void runMemoryImport("import")}
                    disabled={memoryImportBusy || !memoryImportApproved || !memoryImportText.trim()}
                  >
                    Import approved memories
                  </button>
                </div>
                {memoryImportStatus && <p className="memory-status">{memoryImportStatus}</p>}
                {memoryImportResult?.results?.length ? (
                  <div className="memory-import-results">
                    {memoryImportResult.results.slice(0, 12).map((result) => (
                      <div key={`${result.index}-${result.title}`} className={`memory-import-result memory-import-result--${result.action}`}>
                        <span>{result.action.replace(/_/g, " ")}</span>
                        <strong>{result.title}</strong>
                        <small>{result.projectKey}{result.reason ? ` · ${result.reason}` : ""}</small>
                      </div>
                    ))}
                  </div>
                ) : null}
              </section>

              {memories.length ? (
                <div className="memory-list">
                  {memories.slice(0, 8).map((memory) => (
                    <article key={memory.id} className="memory-card">
                      <div className="memory-card-header">
                        <span>{memory.title}</span>
                        <span className="document-kind-pill">{memory.kind}</span>
                      </div>
                      <p>{memory.content}</p>
                      <div className="memory-meta-row">
                        <span>{memory.project_key ?? "global"}</span>
                        <span>priority {memory.priority}</span>
                        <span>{memory.source ?? "manual"}</span>
                        <span>{formatTimestamp(memory.updated_at)}</span>
                      </div>
                      <div className="memory-card-actions">
                        <button
                          type="button"
                          className="memory-inline-action"
                          onClick={() => beginEditMemory(memory)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="memory-inline-action memory-inline-action--danger"
                          onClick={() => archiveExistingMemory(memory)}
                        >
                          Archive
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="context-empty">
                  No matching memories yet. Save one here, or ask Jarvis to remember an important decision.
                </div>
              )}
            </div>
            )}

            {activeCabinetDrawer === "health" && (
            <div className={toolsSectionClassName("context-panel-section deploy-health-section filing-cabinet-content")}>
              <div className="context-panel-header">
                <div>
                  <div className="side-section-label">Deploy health</div>
                  <p className="side-section-copy">
                    Checks env, Supabase tables, and deployment readiness without exposing secrets.
                  </p>
                </div>
                <button
                  type="button"
                  className="memory-inline-action"
                  onClick={refreshDeployHealth}
                  disabled={deployHealthBusy}
                >
                  {deployHealthBusy ? "Checking…" : "Refresh"}
                </button>
              </div>

              {deployHealth ? (
                <>
                  <div className={`deploy-health-summary deploy-health-summary--${deployHealth.overall}`}>
                    <span>{deployHealth.overall === "ok" ? "Ready" : deployHealth.overall === "warning" ? "Needs attention" : "Setup incomplete"}</span>
                    <small>{formatTimestamp(deployHealth.generatedAt)}</small>
                  </div>
                  <div className="deploy-health-list">
                    {deployHealth.checks.map((check) => (
                      <article key={check.key} className={`deploy-health-check deploy-health-check--${check.status}`}>
                        <div>
                          <strong>{check.label}</strong>
                          <span>{check.detail}</span>
                        </div>
                        <em>{check.required ? "Required" : "Optional"}</em>
                      </article>
                    ))}
                  </div>
                </>
              ) : (
                <div className="context-empty">
                  Refresh to check Jarvis setup health.
                </div>
              )}
              {deployHealthStatus && <p className="memory-status">{deployHealthStatus}</p>}
            </div>
            )}

            {activeCabinetDrawer === "repo" && (
            <div className={toolsSectionClassName("context-panel-section repo-control-section filing-cabinet-content")}>
              <div className="context-panel-header">
                <div>
                  <div className="side-section-label">Repo control</div>
                  <p className="side-section-copy">
                    Proposed repo actions for {selectedProject.label} must be reviewed and approved before execution.
                  </p>
                </div>
                <button
                  type="button"
                  className="memory-inline-action"
                  onClick={() => refreshRepoProposals(selectedProjectKey)}
                  disabled={repoProposalBusy}
                >
                  Refresh
                </button>
              </div>

              <div className="approval-flow-card">
                <span>Findings</span>
                <span>Plan</span>
                <span>Approval</span>
                <span>Execution</span>
              </div>

              <form className="repo-proposal-form" onSubmit={createRepoProposal}>
                <input
                  className="workspace-field"
                  value={repoProposalTitle}
                  onChange={(e) => setRepoProposalTitle(e.target.value)}
                  placeholder="Proposal title"
                />
                <textarea
                  className="workspace-field workspace-field--multiline"
                  value={repoProposalSummary}
                  onChange={(e) => setRepoProposalSummary(e.target.value)}
                  placeholder="What should Jarvis prepare, inspect, or change?"
                  rows={3}
                />
                <button
                  type="submit"
                  className="workspace-create-button"
                  disabled={repoProposalBusy || !repoProposalTitle.trim() || !repoProposalSummary.trim()}
                >
                  {repoProposalBusy ? "Saving…" : "Create proposal"}
                </button>
              </form>

              {repoProposalStatus && <p className="memory-status">{repoProposalStatus}</p>}
              {repoProposals.length ? (
                <div className="repo-proposal-list">
                  {repoProposals.slice(0, 8).map((proposal) => (
                    <article key={proposal.id} className="repo-proposal-card">
                      <div className="repo-proposal-header">
                        <span>{proposal.title}</span>
                        <span className={`action-status-pill action-status-pill--${proposal.status === "approved" ? "approved" : proposal.status === "rejected" || proposal.status === "blocked" ? "blocked" : proposal.status === "proposed" ? "proposed" : "info"}`}>
                          {proposal.status}
                        </span>
                      </div>
                      <p className="build-intel-copy">{proposal.summary}</p>
                      <div className="memory-meta-row">
                        <span>{proposal.repo}</span>
                        <span>{proposal.risk_level} risk</span>
                        <span>{formatTimestamp(proposal.updated_at)}</span>
                      </div>
                      {proposal.files?.length ? (
                        <div className="repo-file-targets">
                          {proposal.files.slice(0, 5).map((file) => (
                            <span key={`${proposal.id}-${file.path}`}>{file.operation ?? "inspect"}: {file.path}</span>
                          ))}
                        </div>
                      ) : null}
                      {proposal.diff_preview && (
                        <details className="repo-diff-preview">
                          <summary>Preview</summary>
                          <pre>{proposal.diff_preview}</pre>
                        </details>
                      )}
                      {(proposal.status === "proposed" || proposal.status === "draft" || proposal.status === "approved") && (
                        <div className="memory-card-actions">
                          <button
                            type="button"
                            className="memory-inline-action"
                            onClick={() => draftRepoProposalDiff(proposal)}
                            disabled={repoProposalBusy}
                          >
                            Draft diff
                          </button>
                          <button
                            type="button"
                            className="memory-inline-action"
                            onClick={() => inspectRepoProposalFiles(proposal)}
                            disabled={repoProposalBusy}
                          >
                            Inspect files
                          </button>
                          <button
                            type="button"
                            className="memory-inline-action"
                            onClick={() => generateRepoProposalDiff(proposal)}
                            disabled={repoProposalBusy}
                          >
                            Generate diff
                          </button>
                          <button
                            type="button"
                            className="memory-inline-action"
                            onClick={() => sandboxCheckRepoProposal(proposal)}
                            disabled={repoProposalBusy}
                          >
                            Sandbox check
                          </button>
                          <button
                            type="button"
                            className="memory-inline-action"
                            onClick={() => runTempWorkspaceCheck(proposal)}
                            disabled={repoProposalBusy}
                          >
                            Temp build
                          </button>
                          <button
                            type="button"
                            className="memory-inline-action"
                            onClick={() => openRepoProposalPr(proposal)}
                            disabled={repoProposalBusy || proposal.status !== "approved"}
                          >
                            Open PR
                          </button>
                          <button
                            type="button"
                            className="memory-inline-action"
                            onClick={() => trackRepoProposalPr(proposal)}
                            disabled={repoProposalBusy || !proposal.draft_metadata?.pr_url}
                          >
                            Track PR
                          </button>
                          {(proposal.status === "proposed" || proposal.status === "draft") && (
                          <button
                            type="button"
                            className="memory-inline-action"
                            onClick={() => updateRepoProposalStatus(proposal, "approved")}
                            disabled={repoProposalBusy}
                          >
                            Approve
                          </button>
                          )}
                          {(proposal.status === "proposed" || proposal.status === "draft") && (
                          <button
                            type="button"
                            className="memory-inline-action memory-inline-action--danger"
                            onClick={() => updateRepoProposalStatus(proposal, "rejected")}
                            disabled={repoProposalBusy}
                          >
                            Reject
                          </button>
                          )}
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              ) : (
                <div className="context-empty">
                  No repo proposals yet. Create one here, or let Jarvis propose one after an audit.
                </div>
              )}
            </div>
            )}

            {activeCabinetDrawer === "build" && (
            <div className={toolsSectionClassName("context-panel-section build-intel-section filing-cabinet-content")}>
              <div className="context-panel-header">
                <div>
                  <div className="side-section-label">Build intelligence</div>
                  <p className="side-section-copy">
                    Repo, workflow, and deployment signals for {selectedProject.label}.
                  </p>
                </div>
                <button
                  type="button"
                  className="memory-inline-action"
                  onClick={() => refreshBuildIntelligence(selectedProjectKey)}
                  disabled={buildIntelBusy}
                >
                  {buildIntelBusy ? "Checking…" : "Refresh"}
                </button>
              </div>

              {buildIntel ? (
                <div className="build-intel-grid">
                  <article className="build-intel-card">
                    <div className="build-intel-title-row">
                      <span>GitHub</span>
                      <span className={`action-status-pill ${buildIntel.github.error ? "action-status-pill--failed" : "action-status-pill--executed"}`}>
                        {buildIntel.github.error ? "Needs check" : "Connected"}
                      </span>
                    </div>
                    <p className="build-intel-main">{buildIntel.github.repo}</p>
                    {buildIntel.github.latestCommit && (
                      <p className="build-intel-copy">
                        Latest commit {buildIntel.github.latestCommit.sha.slice(0, 7)} · {buildIntel.github.latestCommit.message.split("\n")[0]}
                      </p>
                    )}
                    {buildIntel.github.latestWorkflowRun && (
                      <div className="memory-meta-row">
                        <span>{buildIntel.github.latestWorkflowRun.name ?? "workflow"}</span>
                        <span>{buildIntel.github.latestWorkflowRun.status ?? "unknown"}</span>
                        <span>{buildIntel.github.latestWorkflowRun.conclusion ?? "pending"}</span>
                      </div>
                    )}
                    {buildIntel.github.error && <p className="memory-status">{buildIntel.github.error}</p>}
                    {buildIntel.github.htmlUrl && (
                      <a className="github-link" href={buildIntel.github.htmlUrl} target="_blank" rel="noreferrer">
                        Open repo
                      </a>
                    )}
                  </article>

                  <article className="build-intel-card">
                    <div className="build-intel-title-row">
                      <span>Vercel</span>
                      <span className={`action-status-pill ${buildIntel.vercel.error ? "action-status-pill--proposed" : "action-status-pill--executed"}`}>
                        {buildIntel.vercel.configured ? "Configured" : "Optional"}
                      </span>
                    </div>
                    <p className="build-intel-main">{buildIntel.vercel.project ?? "Jarvis"}</p>
                    {buildIntel.vercel.latestDeployment ? (
                      <>
                        <p className="build-intel-copy">
                          Latest deployment: {buildIntel.vercel.latestDeployment.state ?? "unknown"}
                        </p>
                        <div className="memory-meta-row">
                          <span>{buildIntel.vercel.latestDeployment.target ?? "target unknown"}</span>
                          <span>{formatTimestamp(buildIntel.vercel.latestDeployment.readyAt ?? buildIntel.vercel.latestDeployment.createdAt ?? buildIntel.generatedAt)}</span>
                        </div>
                        {buildIntel.vercel.latestDeployment.url && (
                          <a className="github-link" href={buildIntel.vercel.latestDeployment.url} target="_blank" rel="noreferrer">
                            Open deployment
                          </a>
                        )}
                      </>
                    ) : (
                      <p className="build-intel-copy">{buildIntel.vercel.error ?? "No deployment signal yet."}</p>
                    )}
                  </article>

                  <article className="build-intel-card build-intel-card--wide external-services-card">
                    <div className="build-intel-title-row">
                      <span>External services</span>
                      <span className="action-status-pill action-status-pill--info">
                        Read-only
                      </span>
                    </div>
                    <p className="build-intel-copy">
                      RevenueCat, App Store Connect, and Google Play readiness without exposing secrets.
                    </p>
                    {buildIntel.externalServices ? (
                      <>
                        <div className="memory-meta-row">
                          <span>{buildIntel.externalServices.summary.configured} configured</span>
                          <span>{buildIntel.externalServices.summary.partial} partial</span>
                          <span>{buildIntel.externalServices.summary.missing} missing</span>
                        </div>
                        <div className="external-service-list">
                          {buildIntel.externalServices.services.map((service) => (
                            <div key={service.key} className="external-service-row">
                              <div>
                                <strong>{service.label}</strong>
                                <p>{service.summary}</p>
                                {service.configuredKeys.length > 0 && (
                                  <span>{service.configuredKeys.length} env key(s) present</span>
                                )}
                              </div>
                              <span className={`action-status-pill action-status-pill--${service.status === "configured" ? "executed" : service.status === "partial" ? "proposed" : "failed"}`}>
                                {service.status.replace(/_/g, " ")}
                              </span>
                            </div>
                          ))}
                        </div>
                      </>
                    ) : (
                      <p className="build-intel-copy">Refresh to inspect external service readiness.</p>
                    )}
                  </article>
                </div>
              ) : (
                <div className="context-empty">
                  Refresh to inspect the Jarvis repo and deployment signals.
                </div>
              )}
              {buildIntelStatus && <p className="memory-status">{buildIntelStatus}</p>}
            </div>
            )}

            {activeCabinetDrawer === "activity" && (
            <div className={toolsSectionClassName("context-panel-section action-log-section filing-cabinet-content")}>
              <div className="context-panel-header">
                <div>
                  <div className="side-section-label">Activity log</div>
                  <p className="side-section-copy">
                    A lightweight audit trail for meaningful Jarvis actions.
                  </p>
                </div>
                <button
                  type="button"
                  className="memory-inline-action"
                  onClick={() => refreshActionEvents(memoryProjectKey)}
                >
                  Refresh
                </button>
              </div>

              <div className="approval-flow-card">
                <span>Findings</span>
                <span>Plan</span>
                <span>Approval</span>
                <span>Action</span>
              </div>
              {actionLogStatus && <p className="memory-status">{actionLogStatus}</p>}
              {actionEvents.length ? (
                <div className="action-event-list">
                  {actionEvents.slice(0, 12).map((event) => (
                    <article key={event.id} className="action-event-card">
                      <div className="action-event-header">
                        <span>{event.summary}</span>
                        <span className={`action-status-pill action-status-pill--${event.status}`}>
                          {event.status}
                        </span>
                      </div>
                      <div className="memory-meta-row">
                        <span>{event.project_key}</span>
                        <span>{event.event_type}</span>
                        <span>{event.approval_stage}</span>
                        <span>{event.risk_level} risk</span>
                        <span>{formatTimestamp(event.created_at)}</span>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="context-empty">
                  Activity appears here after Jarvis saves, edits, archives, proposes, or executes important actions.
                </div>
              )}
            </div>
            )}

            {activeCabinetDrawer === "files" && (
            <>
            <div className="context-panel-section filing-cabinet-content">
              <div className="context-panel-header">
                <div>
                  <div className="side-section-label">Artifacts</div>
                  <p className="side-section-copy">
                    Generated files now persist per workspace and can be
                    downloaded later.
                  </p>
                </div>
              </div>

              {artifacts.length ? (
                <>
                  <div className="saved-artifact-list">
                    {artifacts.map((artifact) => (
                      <button
                        key={artifact.id}
                        type="button"
                        className={`saved-artifact-item ${
                          artifact.id === selectedArtifact?.id
                            ? "saved-artifact-item--active"
                            : ""
                        }`}
                        onClick={() => setArtifactPreviewId(artifact.id)}
                      >
                        <span className="saved-artifact-name">{artifact.name}</span>
                        <span className="saved-artifact-meta">
                          {artifact.mimeType} · {artifact.bytes} bytes
                        </span>
                      </button>
                    ))}
                  </div>
                  {selectedArtifact && (
                    <div className="artifact-preview-card">
                      <div className="artifact-card-header">
                        <span>{selectedArtifact.name}</span>
                        <a
                          className="artifact-link"
                          href={buildArtifactDownloadHref(selectedArtifact)}
                          download={selectedArtifact.name}
                        >
                          Download
                        </a>
                      </div>
                      <div className="artifact-meta">
                        Saved {formatTimestamp(selectedArtifact.createdAt)}
                      </div>
                      <pre className="execution-output">
                        <code>{selectedArtifact.content}</code>
                      </pre>
                    </div>
                  )}
                </>
              ) : (
                <div className="context-empty">
                  Run code that calls <code>createArtifact(...)</code> to keep a
                  downloadable record in this workspace.
                </div>
              )}
            </div>
            </>
            )}

            {activeCabinetDrawer === "tasks" && (
            <div className="context-panel-section filing-cabinet-content">
              <div className="context-panel-header">
                <div>
                  <div className="side-section-label">Task timeline</div>
                  <p className="side-section-copy">
                    Background task state persists, recovers after interruption, and can be resumed.
                  </p>
                </div>
              </div>

              {tasks.length ? (
                <div className="document-list">
                  {tasks.map((task) => (
                    <div key={task.id} className="document-card">
                      <div className="document-card-header">
                        <span>{task.title}</span>
                        <span className="document-kind-pill">
                          {getTaskStatusLabel(task.status)}
                        </span>
                      </div>
                      <div className="document-meta">
                        {task.progress}% · {formatTimestamp(task.updatedAt)}
                      </div>
                      {(task.runnerId || task.runnerStatus || task.runnerHeartbeatAt) && (
                        <div className="document-meta">
                          Runner: {task.runnerId ?? "unclaimed"} · {task.runnerStatus ?? task.status}
                          {task.runnerHeartbeatAt ? ` · heartbeat ${formatTimestamp(task.runnerHeartbeatAt)}` : ""}
                        </div>
                      )}
                      {(task.intent === "cli_runner" || task.runnerMetadata?.job_kind || task.runnerMetadata?.command) && (
                        <div className="runner-status-card">
                          <div className="runner-status-header">
                            <span>Runner job</span>
                            {task.runnerMetadata?.risk_level && (
                              <span className={`runner-risk-pill runner-risk-pill--${task.runnerMetadata.risk_level}`}>
                                {task.runnerMetadata.risk_level} risk
                              </span>
                            )}
                          </div>
                          <div className="runner-status-grid">
                            {getRunnerJobLabel(task.runnerMetadata?.job_kind) && (
                              <span><strong>Kind</strong>{getRunnerJobLabel(task.runnerMetadata?.job_kind)}</span>
                            )}
                            {task.runnerMetadata?.execution_mode && (
                              <span><strong>Mode</strong>{task.runnerMetadata.execution_mode.replace(/_/g, " ")}</span>
                            )}
                            {task.runnerMetadata?.approval_text && (
                              <span><strong>Approval</strong>{task.runnerMetadata.approval_text}</span>
                            )}
                            {task.runnerAttempts !== undefined && task.runnerAttempts > 0 && (
                              <span><strong>Attempts</strong>{task.runnerAttempts}</span>
                            )}
                          </div>
                          {getCommandPreview(task.runnerMetadata?.command) && (
                            <code className="runner-command-preview">{getCommandPreview(task.runnerMetadata?.command)}</code>
                          )}
                          {task.runnerMetadata?.reason && (
                            <p className="runner-reason">Reason: {task.runnerMetadata.reason}</p>
                          )}
                        </div>
                      )}
                      {task.runnerLogs?.length ? (
                        <p className="document-summary">
                          Latest runner log: {task.runnerLogs[task.runnerLogs.length - 1]?.message}
                        </p>
                      ) : null}
                      {task.runnerMetadata?.latest_checkpoint && (
                        <div className="task-checkpoint-card">
                          <div className="task-checkpoint-title">
                            Latest checkpoint: {task.runnerMetadata.latest_checkpoint.label}
                          </div>
                          <p>{task.runnerMetadata.latest_checkpoint.summary}</p>
                          {task.runnerMetadata.latest_checkpoint.completedStep && (
                            <span>Completed: {task.runnerMetadata.latest_checkpoint.completedStep}</span>
                          )}
                          {task.runnerMetadata.latest_checkpoint.nextStep && (
                            <span>Next: {task.runnerMetadata.latest_checkpoint.nextStep}</span>
                          )}
                          {task.runnerMetadata.latest_checkpoint.blocker && (
                            <span className="task-checkpoint-blocker">Blocked: {task.runnerMetadata.latest_checkpoint.blocker}</span>
                          )}
                        </div>
                      )}
                      {task.steps.length > 0 && (
                        <p className="document-summary">
                          {task.steps
                            .map((step) =>
                              step.status === "completed" ? `✓ ${step.label}` : `• ${step.label}`
                            )
                            .join(" · ")}
                        </p>
                      )}
                      {task.errorMessage && (
                        <p className="document-summary">{task.errorMessage}</p>
                      )}
                      {task.resultSummary && (
                        <p className="document-summary">{task.resultSummary}</p>
                      )}
                      <div className="memory-actions-row">
                        {task.status === "queued" && (
                          <button
                            type="button"
                            className="memory-inline-action"
                            onClick={() => runQueuedWorkspaceJob(task)}
                            disabled={jobBusy}
                          >
                            Run job
                          </button>
                        )}
                        {task.status === "failed" && (
                          <button
                            type="button"
                            className="memory-inline-action"
                            onClick={() => handleResumeTask(task)}
                          >
                            Resume
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="context-empty">
                  Task status will appear here for long-running or resumable work.
                </div>
              )}
            </div>
            )}

            {activeCabinetDrawer === "files" && (
            <>
            <div className="context-panel-section filing-cabinet-content">
              <div className="context-panel-header">
                <div>
                  <div className="side-section-label">Project files</div>
                  <p className="side-section-copy">
                    Uploaded files and generated artifacts are mapped into one workspace file model.
                  </p>
                </div>
              </div>

              {projectFiles.length ? (
                <div className="document-list">
                  {projectFiles.map((file) => (
                    <div key={file.id} className="document-card">
                      <div className="document-card-header">
                        <span>{file.displayName}</span>
                        <span className="document-kind-pill">
                          {getDocumentKindLabel(file.sourceKind)}
                        </span>
                      </div>
                      <div className="document-meta">
                        {file.path} · {file.mimeType} · {file.bytes} bytes
                      </div>
                      {file.storagePath && (
                        <div className="document-meta">Stored: {file.storageBucket ?? "storage"}/{file.storagePath}</div>
                      )}
                      {(file.storagePath || file.url) && (
                        <button
                          type="button"
                          className="memory-inline-action"
                          onClick={() => openStoredProjectFile(file)}
                        >
                          Open stored file
                        </button>
                      )}
                      {file.summary && (
                        <p className="document-summary">{file.summary}</p>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="context-empty">
                  Upload documents or generate artifacts to populate the project file map.
                </div>
              )}
            </div>

            <div className="context-panel-section">
              <div className="context-panel-header">
                <div>
                  <div className="side-section-label">Indexed files</div>
                  <p className="side-section-copy">
                    Uploaded text, code, markdown, CSV, and generated artifacts
                    feed workspace retrieval.
                  </p>
                </div>
              </div>

              {documents.length ? (
                <div className="document-list">
                  {documents.map((document) => (
                    <div key={document.id} className="document-card">
                      <div className="document-card-header">
                        <span>{document.name}</span>
                        <span className="document-kind-pill">
                          {getDocumentKindLabel(document.sourceKind)}
                        </span>
                      </div>
                      <div className="document-meta">
                        {document.contentType} · {formatTimestamp(document.createdAt)}
                      </div>
                      {document.summary && (
                        <p className="document-summary">{document.summary}</p>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="context-empty">
                  Upload a text/code document or generate an artifact to strengthen
                  future workspace retrieval.
                </div>
              )}
            </div>
            </>
            )}
          </div>
        </aside>
      )}
    </div>
  );
}
