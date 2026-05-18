"use client";

import ReactMarkdown from "react-markdown";

const CODE_PREVIEW_MAX_LENGTH = 220;
const CODE_PREVIEW_TRUNCATION_LENGTH = 2;

function formatTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

const TOOL_LABELS: Record<string, string> = {
  web_search: "Searching the web",
  execute_code: "Running code",
  analyze_github_repo: "Inspecting GitHub repository",
  searchRepositoryCode: "Searching real GitHub code",
  readRepositoryFile: "Reading real GitHub source file",
  listRepositoryTree: "Listing GitHub repository files",
  get_current_datetime: "Checking date and time",
  calculate: "Calculating",
  get_rune_capability_snapshot: "Checking Rune capabilities",
  get_rune_self_audit_snapshot: "Running Rune self-audit",
  get_tool_lifecycle_diagnostic: "Checking Rune response lifecycle",
  inspect_deployment_control: "Checking deployment control",
  prepare_deployment_control_action: "Preparing deployment approval",
  execute_deployment_control_action: "Running approved deployment action",
  lookup_revenuecat_subscriber: "Checking RevenueCat subscriber",
  lookup_app_store_connect_status: "Checking App Store Connect",
  lookup_google_play_status: "Checking Google Play Console",
  get_app_health_snapshot: "Checking app health",
};
function getToolLabel(name: string) {
  return TOOL_LABELS[name] ?? `Running ${name.replace(/_/g, " ")}`;
}

const REPO_STAGE_LABELS: Record<string, string> = {
  inspect_repo: "Inspecting repo files",
  draft_diff: "Drafting proposed diff",
  generate_diff: "Generating safe diff",
  sandbox_check: "Running sandbox safety check",
  temp_workspace_check: "Running temp workspace build",
  open_pr: "Opening pull request",
  track_pr: "Tracking PR checks",
  execute_approved: "Running approved executor",
};

const DEPLOYMENT_ACTION_LABELS: Record<string, string> = {
  inspect: "Inspecting deployments",
  prepare_redeploy: "Preparing redeploy approval",
  prepare_rollback: "Preparing rollback approval",
  execute_redeploy: "Checking redeploy approval gate",
  execute_rollback: "Checking rollback approval gate",
};

function humanizeToolName(name: string) {
  return name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getToolDisplayLabel(name: string, args?: Record<string, unknown>, result?: RepoControlToolResult) {
  if (name === "run_repo_action_stage") {
    const stage = typeof args?.action === "string" ? args.action : result?.action;
    return stage ? REPO_STAGE_LABELS[stage] ?? `Running ${humanizeToolName(stage)}` : TOOL_LABELS[name];
  }
  if (name === "build_app") {
    const stg = typeof args?.stage === "string" ? args.stage : "plan";
    const labels: Record<string, string> = { plan: "Planning app", scaffold: "Scaffolding app", deploy: "Deploying app", status: "Checking pipeline" };
    return labels[stg] ?? "Building app";
  }
  if (name === "get_app_intelligence") return "Fetching app intelligence";
  if (name === "queue_private_app_creator_deploy") return "Queueing private deploy";
  if (name === "prepare_app_creator_preview_handoff") return "Preparing preview handoff";
  if (name === "preview_app_creator_proposal") return "Previewing app proposal";
  if (name === "refine_app_creator_proposal") return "Refining app proposal";
  if (name === "run_app_creator_scaffold_bridge") return "Running App Creator bridge";
  if (name === "approved_app_scaffold") return "Generating approved app scaffold";
  if (name === "create_app_proposal") return "Creating app blueprint";
  if (name === "run_repo_action_ladder") return "Running safe Repo Control ladder";
  if (name === "run_approved_repo_action") return "Running approved PR executor";
  if (name === "deployment_control") {
    const action = typeof args?.action === "string" ? args.action : result?.action;
    return action ? DEPLOYMENT_ACTION_LABELS[action] ?? `Checking deployment ${humanizeToolName(action)}` : TOOL_LABELS[name];
  }
  return TOOL_LABELS[name] ?? `Running ${humanizeToolName(name)}`;
}

const LONG_FORM_DIAGNOSTIC_TOOLS = new Set([
  "get_rune_self_audit_snapshot",
  "get_rune_capability_snapshot",
  "get_tool_lifecycle_diagnostic",
]);

function isLongFormDiagnosticTool(name: string) {
  return LONG_FORM_DIAGNOSTIC_TOOLS.has(name);
}

const EXECUTION_FAILURE_LABELS: Record<string, string> = {
  disabled: "Execution disabled in deployment",
  empty_snippet: "No executable snippet provided",
  snippet_too_large: "Snippet exceeds source limit",
  blocked_import_export: "Blocked: import/export",
  blocked_modules: "Blocked: external modules",
  blocked_host_global: "Blocked: host globals",
  blocked_network: "Blocked: network access",
  blocked_runtime_api: "Blocked: filesystem/process/runtime APIs",
  compilation_error: "TypeScript compilation error",
  timeout: "Timed out",
  worker_error: "Sandbox worker error",
  runtime_error: "Runtime error",
};

export interface ToolInvocation {
  state: "partial-call" | "call" | "result";
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  result?: unknown;
}

export type LightweightAttachment = {
  name: string;
  contentType: string;
  url: string;
};

function TaskPlanCard({
  result,
}: {
  result: { task: string; steps: string[] };
}) {
  return (
    <div className="tool-card tool-card--plan">
      <div className="tool-card-header">
        <span className="tool-card-icon">🗺️</span>
        <span className="tool-card-title">{result.task}</span>
      </div>
      <ol className="task-plan-steps">
        {result.steps.map((step, i) => (
          <li key={i} className="task-plan-step">
            {step}
          </li>
        ))}
      </ol>
    </div>
  );
}

function CalculateCard({
  args,
  result,
}: {
  args: { expression?: string };
  result?: { expression: string; result?: string; error?: string };
}) {
  return (
    <div className="tool-card tool-card--calc">
      <div className="tool-card-header">
        <span className="tool-card-icon">🧮</span>
        <span className="tool-card-title">Calculate</span>
      </div>
      <div className="tool-card-body">
        <code className="tool-expr">{args.expression}</code>
        {result && (
          <span className="tool-result-value">
            {result.error ? (
              <span className="tool-error">{result.error}</span>
            ) : (
              <>= {result.result}</>
            )}
          </span>
        )}
      </div>
    </div>
  );
}


type RepoDeploymentHandoffResult = {
  success?: boolean;
  ok?: boolean;
  proposalId?: string;
  ready?: boolean;
  prUrl?: string;
  prBranch?: string;
  readinessSummary?: string;
  readinessReasons?: string[];
  requiredApprovalPhrase?: string;
  nextAction?: string;
  safety?: string;
  message?: string;
  error?: string;
};

function DeploymentHandoffCard({
  state,
  result,
}: {
  state: ToolInvocation["state"];
  result?: RepoDeploymentHandoffResult;
}) {
  const isPending = state === "partial-call" || state === "call";
  const ready = Boolean(result?.ready ?? result?.success ?? result?.ok);
  const failed = !isPending && !ready;

  return (
    <div className={`tool-card tool-card--deployment-handoff ${isPending ? "tool-card--pending" : ""} ${failed ? "tool-card--failed" : ""}`}>
      <div className="tool-card-header">
        <span className="tool-card-icon">{isPending ? "📦" : ready ? "🚦" : "🛑"}</span>
        <span className="tool-card-title">Deployment handoff</span>
        {isPending && <span className="tool-spinner" />}
      </div>
      <div className="tool-card-body tool-card-body--stacked">
        <span className="repo-control-meta">Proposal: {result?.proposalId ?? "pending"}</span>
        <span className={ready ? "repo-control-status repo-control-status--safe" : "repo-control-status repo-control-status--warning"}>
          {isPending ? "Preparing metadata-only handoff" : ready ? "Ready for explicit deployment approval" : "Blocked until PR is ready"}
        </span>
        {result?.message && <p className="build-intel-copy">{result.message}</p>}
        {result?.readinessSummary && <div className="deployment-handoff-line"><strong>Readiness:</strong> {result.readinessSummary}</div>}
        {result?.prBranch && <div className="deployment-handoff-line"><strong>Branch:</strong> {result.prBranch}</div>}
        {result?.prUrl && <a className="repo-control-link" href={result.prUrl} target="_blank" rel="noreferrer">Open ready PR</a>}
        {result?.requiredApprovalPhrase && <div className="deployment-handoff-phrase"><strong>Required phrase:</strong> {result.requiredApprovalPhrase}</div>}
        {(result?.readinessReasons?.length ?? 0) > 0 && (
          <div className="deployment-handoff-reasons">
            {result!.readinessReasons!.slice(0, 5).map((reason, index) => <span key={`${reason}-${index}`}>{reason}</span>)}
          </div>
        )}
        {result?.nextAction && <div className="deployment-handoff-line"><strong>Next:</strong> {result.nextAction}</div>}
        <div className="deployment-handoff-boundary">Metadata-only · no merge, no deploy, no rollback, no runner job.</div>
      </div>
    </div>
  );
}


type AppCreatorToolResult = {
  success?: boolean;
  ok?: boolean;
  proposalId?: string;
  message?: string;
  safety?: string;
  nextAction?: string;
  error?: string;
  changedFields?: string[];
  revision?: number;
  preview?: { headline?: string; featureCount?: number; screenCount?: number; dataModelCount?: number; scaffoldReady?: boolean; iterationCount?: number };
  previewHandoff?: { intent?: string; appName?: string; slug?: string; targetUsers?: string; ready?: boolean; prUrl?: string; prBranch?: string; requiredApprovalPhrase?: string; generatedFiles?: string[]; preparedAt?: string };
  taskId?: string;
  commandPreview?: string;
  requiredApprovalPhrase?: string;
  changedFiles?: string[];
  prUrl?: string;
  repoFlow?: RepoControlFlowResult;
  scaffold?: AppCreatorToolResult;
  appPlan?: {
    appName?: string;
    slug?: string;
    platform?: string;
    complexity?: string;
    targetUsers?: string;
    coreFeatures?: string[];
    screens?: string[];
    dataModel?: string[];
    buildPlan?: string[];
  };
};

function AppCreatorCard({
  state,
  result,
}: {
  state: ToolInvocation["state"];
  result?: AppCreatorToolResult;
}) {
  const isPending = state === "partial-call" || state === "call";
  const ok = Boolean(result?.success ?? result?.ok);
  const failed = !isPending && !ok;
  const plan = result?.appPlan;

  return (
    <div className={`tool-card tool-card--app-creator ${isPending ? "tool-card--pending" : ""} ${failed ? "tool-card--failed" : ""}`}>
      <div className="tool-card-header">
        <span className="tool-card-icon">{isPending ? "✨" : ok ? "✅" : "🛑"}</span>
        <span className="tool-card-title">App Creator v1</span>
        {isPending && <span className="tool-spinner" />}
      </div>
      <div className="tool-card-body tool-card-body--stacked">
        <span className={ok ? "repo-control-status repo-control-status--safe" : "repo-control-status repo-control-status--warning"}>
          {isPending ? "Designing blueprint" : ok ? "Blueprint + proposal ready" : "Stopped safely"}
        </span>
        {plan?.appName && <span className="repo-control-meta">App: {plan.appName} · {plan.platform ?? "web"} · {plan.complexity ?? "standard"}</span>}
        {result?.proposalId && <span className="repo-control-meta">Proposal: {result.proposalId}</span>}
        {result?.preview && (
          <span className="repo-control-meta">Preview: {result.preview.featureCount ?? 0} features · {result.preview.screenCount ?? 0} screens · scaffold {result.preview.scaffoldReady ? "ready" : "not ready"}</span>
        )}
        {result?.revision && <span className="repo-control-meta">Revision: {result.revision}</span>}
        {result?.message && <p className="build-intel-copy">{result.message}</p>}
        {plan?.coreFeatures && plan.coreFeatures.length > 0 && (
          <div className="repo-flow-step-list">
            {plan.coreFeatures.slice(0, 6).map((feature, index) => (
              <span key={`${feature}-${index}`} className="repo-flow-step repo-flow-step--ok"><strong>✓ Feature</strong> · {feature}</span>
            ))}
          </div>
        )}
        {plan?.screens && plan.screens.length > 0 && <div className="deployment-handoff-line"><strong>Screens:</strong> {plan.screens.slice(0, 6).join(", ")}</div>}
        {plan?.dataModel && plan.dataModel.length > 0 && <div className="deployment-handoff-line"><strong>Data:</strong> {plan.dataModel.slice(0, 4).join(" · ")}</div>}
        {result?.changedFields && result.changedFields.length > 0 && <div className="deployment-handoff-line"><strong>Changed:</strong> {result.changedFields.slice(0, 6).join(" · ")}</div>}
        {result?.previewHandoff && (
          <div className="deployment-handoff-line"><strong>Preview handoff:</strong> {result.previewHandoff.ready ? "ready" : "blocked"} · approval phrase required before deployment</div>
        )}
        {result?.previewHandoff?.prUrl && <a className="repo-control-link" href={result.previewHandoff.prUrl} target="_blank" rel="noreferrer">Open preview PR</a>}
        {result?.previewHandoff?.generatedFiles && result.previewHandoff.generatedFiles.length > 0 && <div className="deployment-handoff-line"><strong>Preview files:</strong> {result.previewHandoff.generatedFiles.slice(0, 5).join(" · ")}</div>}
        {result?.taskId && <div className="deployment-handoff-line"><strong>Private job:</strong> queued · {result.taskId}</div>}
        {result?.commandPreview && <div className="runner-command-preview">{result.commandPreview}</div>}
        {result?.requiredApprovalPhrase && <div className="deployment-handoff-boundary">Private owner-only gate · requires {result.requiredApprovalPhrase} · no public launch.</div>}
        {result?.changedFiles && result.changedFiles.length > 0 && <div className="deployment-handoff-line"><strong>Files:</strong> {result.changedFiles.slice(0, 5).join(" · ")}</div>}
        {result?.repoFlow?.steps && result.repoFlow.steps.length > 0 && (
          <div className="repo-flow-step-list">
            {result.repoFlow.steps.map((step, index) => (
              <span key={`${step.action}-${index}`} className={step.ok ? "repo-flow-step repo-flow-step--ok" : "repo-flow-step repo-flow-step--blocked"}>
                <strong>{step.ok ? "✓" : "!"} {step.action}</strong> · {step.ok ? step.summary || "completed" : step.error || "blocked"}
              </span>
            ))}
          </div>
        )}
        {result?.prUrl && <a className="repo-control-link" href={result.prUrl} target="_blank" rel="noreferrer">Open PR</a>}
        {result?.nextAction && <div className="repo-flow-next"><strong>Next:</strong> {result.nextAction}</div>}
        <div className="repo-flow-boundary">Safety: {result?.safety ?? "blueprint only · no files, schema, PR, or deploy"}</div>
      </div>
    </div>
  );
}

type RepoControlFlowResult = {
  success?: boolean;
  ok?: boolean;
  proposalId?: string;
  mode?: string;
  steps?: Array<{ action: string; ok: boolean; status?: "completed" | "blocked" | "skipped"; error?: string; summary?: string }>;
  stoppedAt?: string;
  nextAction?: string;
  prUrl?: string;
  branch?: string;
  deploymentPrep?: RepoDeploymentHandoffResult;
  safety?: string;
  message?: string;
  error?: string;
};

function RepoControlFlowCard({
  state,
  result,
}: {
  state: ToolInvocation["state"];
  result?: RepoControlFlowResult;
}) {
  const isPending = state === "partial-call" || state === "call";
  const ok = Boolean(result?.success ?? result?.ok);
  const failed = !isPending && !ok;
  const steps = result?.steps ?? [];

  return (
    <div className={`tool-card tool-card--repo-flow ${isPending ? "tool-card--pending" : ""} ${failed ? "tool-card--failed" : ""}`}>
      <div className="tool-card-header">
        <span className="tool-card-icon">{isPending ? "🧭" : ok ? "✅" : "🛑"}</span>
        <span className="tool-card-title">Repo Control flow</span>
        {isPending && <span className="tool-spinner" />}
      </div>
      <div className="tool-card-body tool-card-body--stacked">
        <span className="repo-control-meta">Proposal: {result?.proposalId ?? "pending"}</span>
        <span className={ok ? "repo-control-status repo-control-status--safe" : "repo-control-status repo-control-status--warning"}>
          {isPending ? "Running safe staged flow" : ok ? "Completed through allowed gates" : `Stopped safely${result?.stoppedAt ? ` at ${result.stoppedAt}` : ""}`}
        </span>
        {result?.message && <p className="build-intel-copy">{result.message}</p>}
        {steps.length > 0 && (
          <div className="repo-flow-step-list">
            {steps.map((step, index) => (
              <span key={`${step.action}-${index}`} className={step.ok ? "repo-flow-step repo-flow-step--ok" : "repo-flow-step repo-flow-step--blocked"}>
                <strong>{step.ok ? "✓" : "!"} {step.action}</strong> · {step.ok ? step.summary || "completed" : step.error || "blocked"}
              </span>
            ))}
          </div>
        )}
        {result?.prUrl && <a className="repo-control-link" href={result.prUrl} target="_blank" rel="noreferrer">Open PR</a>}
        {result?.deploymentPrep && (
          <div className={result.deploymentPrep.ready ? "deployment-handoff-phrase" : "deployment-handoff-line"}>
            <strong>Deployment handoff:</strong> {result.deploymentPrep.ready ? `Ready · ${result.deploymentPrep.requiredApprovalPhrase ?? "approval required"}` : result.deploymentPrep.message ?? "not ready"}
          </div>
        )}
        {result?.nextAction && <div className="repo-flow-next"><strong>Next:</strong> {result.nextAction}</div>}
        <div className="repo-flow-boundary">Safety: {result?.safety ?? "no merge, no deploy, no production mutation"}</div>
      </div>
    </div>
  );
}


type SessionFragmentAuditResult = {
  success?: boolean;
  readOnly?: boolean;
  generatedAt?: string;
  ownerSessionId?: string;
  summary?: string;
  totals?: {
    sessions?: number;
    fragmentedSessions?: number;
    workspaces?: number;
    conversations?: number;
    messages?: number;
    fragmentedConversations?: number;
    fragmentedMessages?: number;
  };
  sessions?: Array<{
    sessionId: string;
    isOwnerSession?: boolean;
    workspaceCount?: number;
    conversationCount?: number;
    mappedConversationCount?: number;
    unmappedConversationCount?: number;
    messageCount?: number;
    firstSeenAt?: string | null;
    lastSeenAt?: string | null;
    sampleWorkspaceNames?: string[];
  }>;
  recommendedNextStep?: string;
  safeBoundaries?: string[];
  error?: string;
};

function SessionFragmentAuditCard({ state, result }: { state: ToolInvocation["state"]; result?: SessionFragmentAuditResult }) {
  const isPending = state === "partial-call" || state === "call";
  const failed = !isPending && result?.success === false;
  const fragments = result?.totals?.fragmentedSessions ?? 0;

  return (
    <div className={`tool-card tool-card--app-health ${isPending ? "tool-card--pending" : ""} ${failed ? "tool-card--failed" : ""}`}>
      <div className="tool-card-header">
        <span className="tool-card-icon">{isPending ? "🔎" : failed ? "🚧" : fragments > 0 ? "🧩" : "🟢"}</span>
        <span className="tool-card-title">Rune session fragmentation audit</span>
        {isPending && <span className="tool-spinner" />}
      </div>
      <div className="tool-card-body tool-card-body--stacked">
        <span className="repo-control-meta">Mode: read-only · no message content</span>
        <span className={fragments > 0 ? "repo-control-status repo-control-status--warning" : "repo-control-status repo-control-status--safe"}>
          {isPending ? "Counting saved sessions" : failed ? "Audit blocked" : `${fragments} old fragment${fragments === 1 ? "" : "s"} found`}
        </span>
        {result?.summary && <p className="build-intel-copy">{result.summary}</p>}
        {result?.totals && (
          <div className="memory-meta-row">
            <span>Sessions: {result.totals.sessions ?? 0}</span>
            <span>Chats: {result.totals.conversations ?? 0}</span>
            <span>Msgs: {result.totals.messages ?? 0}</span>
            <span>Workspaces: {result.totals.workspaces ?? 0}</span>
          </div>
        )}
        {(result?.sessions?.length ?? 0) > 0 && (
          <div className="app-health-mini-list">
            {result!.sessions!.slice(0, 6).map((session) => (
              <span key={session.sessionId}>
                <strong>{session.isOwnerSession ? "Owner" : "Fragment"}</strong> · {session.sessionId} · {session.conversationCount ?? 0} chats · {session.messageCount ?? 0} msgs
              </span>
            ))}
          </div>
        )}
        {result?.recommendedNextStep && <div className="repo-flow-next"><strong>Next:</strong> {result.recommendedNextStep}</div>}
        <div className="repo-flow-boundary">Safety: read-only counts only · no merge/update/delete/schema changes</div>
      </div>
    </div>
  );
}


type SessionFragmentMergePlanResult = {
  success?: boolean;
  dryRun?: boolean;
  readOnly?: boolean;
  generatedAt?: string;
  ownerSessionId?: string;
  summary?: string;
  sourceSessionIds?: string[];
  proposedChanges?: {
    conversationsToReassign?: number;
    workspaceMembershipsToAttach?: number;
    workspaceOwnersToNormalize?: number;
    messagesMadeVisibleViaConversationMove?: number;
    conversationWorkspaceLinksPreserved?: number;
    messageRowsUpdatedDirectly?: number;
    messageContentRead?: boolean;
  };
  sessions?: Array<{
    sessionId: string;
    conversationCount?: number;
    messageCount?: number;
    workspaceCount?: number;
  }>;
  approvalRequired?: {
    required?: boolean;
    phrase?: string;
    reason?: string;
  };
  executionBoundary?: string;
  safeBoundaries?: string[];
  nextStep?: string;
  error?: string;
};

function SessionFragmentMergePlanCard({ state, result }: { state: ToolInvocation["state"]; result?: SessionFragmentMergePlanResult }) {
  const isPending = state === "partial-call" || state === "call";
  const failed = !isPending && result?.success === false;
  const change = result?.proposedChanges;

  return (
    <div className={`tool-card tool-card--app-health ${isPending ? "tool-card--pending" : ""} ${failed ? "tool-card--failed" : ""}`}>
      <div className="tool-card-header">
        <span className="tool-card-icon">{isPending ? "🧭" : failed ? "🚧" : "🧩"}</span>
        <span className="tool-card-title">Rune fragmented session merge plan</span>
        {isPending && <span className="tool-spinner" />}
      </div>
      <div className="tool-card-body tool-card-body--stacked">
        <span className="repo-control-meta">Mode: planner-only dry run · no Supabase changes</span>
        <span className="repo-control-status repo-control-status--warning">
          {isPending ? "Preparing dry-run plan" : failed ? "Plan blocked" : `Approval required: ${result?.approvalRequired?.phrase ?? "separate approval"}`}
        </span>
        {result?.summary && <p className="build-intel-copy">{result.summary}</p>}
        {change && (
          <div className="memory-meta-row">
            <span>Chats: {change.conversationsToReassign ?? 0}</span>
            <span>Msgs visible: {change.messagesMadeVisibleViaConversationMove ?? 0}</span>
            <span>Workspaces: {change.workspaceOwnersToNormalize ?? 0}</span>
            <span>Direct msg edits: {change.messageRowsUpdatedDirectly ?? 0}</span>
          </div>
        )}
        {(result?.sourceSessionIds?.length ?? 0) > 0 && (
          <div className="app-health-mini-list">
            {result!.sourceSessionIds!.slice(0, 6).map((sessionId) => <span key={sessionId}><strong>Source</strong> · {sessionId}</span>)}
          </div>
        )}
        {result?.approvalRequired?.reason && <p className="build-intel-copy">{result.approvalRequired.reason}</p>}
        {result?.nextStep && <div className="repo-flow-next"><strong>Next:</strong> {result.nextStep}</div>}
        <div className="repo-flow-boundary">Safety: planner only · no merge/update/delete/insert/upsert/RPC/schema changes</div>
      </div>
    </div>
  );
}


type SessionFragmentMergeExecutionResult = {
  success?: boolean;
  executed?: boolean;
  ownerSessionId?: string;
  generatedAt?: string;
  summary?: string;
  requiredApprovalPhrase?: string;
  sourceSessionIds?: string[];
  mutations?: {
    conversationsReassigned?: number;
    workspacesReassigned?: number;
    workspaceMembershipsAttached?: number;
    workspaceEventsReassigned?: number;
    messageRowsUpdated?: number;
    messageContentRead?: boolean;
    deletesPerformed?: number;
    schemaMutationsPerformed?: number;
  };
  after?: SessionFragmentAuditResult;
  safeBoundaries?: string[];
  error?: string;
};

function SessionFragmentMergeExecutionCard({ state, result }: { state: ToolInvocation["state"]; result?: SessionFragmentMergeExecutionResult }) {
  const isPending = state === "partial-call" || state === "call";
  const failed = !isPending && result?.success === false;
  const mutation = result?.mutations;

  return (
    <div className={`tool-card tool-card--app-health ${isPending ? "tool-card--pending" : ""} ${failed ? "tool-card--failed" : ""}`}>
      <div className="tool-card-header">
        <span className="tool-card-icon">{isPending ? "🔐" : failed ? "🚧" : result?.executed ? "✅" : "🟢"}</span>
        <span className="tool-card-title">Rune approved session merge</span>
        {isPending && <span className="tool-spinner" />}
      </div>
      <div className="tool-card-body tool-card-body--stacked">
        <span className="repo-control-meta">Mode: approved metadata merge · no message row edits</span>
        <span className={failed ? "repo-control-status repo-control-status--warning" : "repo-control-status repo-control-status--safe"}>
          {isPending ? "Checking approval gate" : failed ? "Merge blocked" : result?.executed ? "Merge executed" : "Nothing to merge"}
        </span>
        {result?.summary && <p className="build-intel-copy">{result.summary}</p>}
        {mutation && (
          <div className="memory-meta-row">
            <span>Chats moved: {mutation.conversationsReassigned ?? 0}</span>
            <span>Workspaces: {mutation.workspacesReassigned ?? 0}</span>
            <span>Memberships: {mutation.workspaceMembershipsAttached ?? 0}</span>
            <span>Msg edits: {mutation.messageRowsUpdated ?? 0}</span>
          </div>
        )}
        {result?.after?.totals && (
          <div className="memory-meta-row">
            <span>Remaining fragments: {result.after.totals.fragmentedSessions ?? 0}</span>
            <span>Total chats: {result.after.totals.conversations ?? 0}</span>
            <span>Total msgs: {result.after.totals.messages ?? 0}</span>
          </div>
        )}
        <div className="repo-flow-boundary">Safety: exact approval only · no message content/message row edits/deletes/schema changes</div>
      </div>
    </div>
  );
}

export type AppHealthSnapshotResult = {
  success?: boolean;
  status?: "healthy" | "warning" | "blocked";
  score?: number;
  summary?: string;
  projectKey?: string;
  generatedAt?: string;
  findings?: string[];
  blockers?: string[];
  safeBoundaries?: string[];
  build?: {
    github?: { repo?: string; latestCommit?: { sha?: string; message?: string }; latestWorkflowRun?: { status?: string | null; conclusion?: string | null } | null; error?: string };
    vercel?: { latestDeployment?: { state?: string | null; url?: string | null } | null; error?: string };
  };
  appStoreConnect?: { ok?: boolean; configured?: boolean; summary?: { latestBuilds?: Array<{ version?: string | null; processingState?: string | null }>; latestVersions?: Array<{ versionString?: string | null; appStoreState?: string | null }> }; error?: string };
  googlePlay?: { ok?: boolean; configured?: boolean; summary?: { reviews?: unknown[]; subscriptions?: unknown[]; inAppProducts?: unknown[]; blockedCapabilities?: Array<{ name: string; reason: string }> }; error?: string };
  revenueCat?: { ok?: boolean; configured?: boolean; subscriber?: { entitlements?: unknown[]; subscriptions?: unknown[] }; error?: string };
};

function AppHealthSnapshotCard({
  state,
  result,
}: {
  state: ToolInvocation["state"];
  result?: AppHealthSnapshotResult;
}) {
  const isPending = state === "partial-call" || state === "call";
  const status = result?.status ?? "warning";
  const failed = !isPending && status === "blocked";
  const latestBuild = result?.appStoreConnect?.summary?.latestBuilds?.[0];
  const latestVersion = result?.appStoreConnect?.summary?.latestVersions?.[0];
  const latestCommit = result?.build?.github?.latestCommit;
  const deployment = result?.build?.vercel?.latestDeployment;

  return (
    <div className={`tool-card tool-card--app-health ${isPending ? "tool-card--pending" : ""} ${failed ? "tool-card--failed" : ""}`}>
      <div className="tool-card-header">
        <span className="tool-card-icon">{isPending ? "🔎" : failed ? "🚧" : status === "warning" ? "🟡" : "🟢"}</span>
        <span className="tool-card-title">App health snapshot</span>
        {isPending && <span className="tool-spinner" />}
      </div>
      <div className="tool-card-body tool-card-body--stacked">
        <span className="repo-control-meta">Project: {result?.projectKey ?? "checking"}</span>
        <span className={status === "healthy" ? "repo-control-status repo-control-status--safe" : "repo-control-status repo-control-status--warning"}>
          {isPending ? "Read-only inspection running" : `${status.toUpperCase()} · score ${result?.score ?? "—"}/100`}
        </span>
        {result?.summary && <p className="build-intel-copy">{result.summary}</p>}
        {result && (
          <>
            <div className="memory-meta-row">
              <span>GitHub: {result.build?.github?.error ? "issue" : result.build?.github?.repo ?? "visible"}</span>
              <span>Vercel: {result.build?.vercel?.error ? "issue" : deployment?.state ?? "visible"}</span>
              <span>ASC: {result.appStoreConnect?.ok ? "ok" : result.appStoreConnect?.configured ? "issue" : "not configured"}</span>
              <span>Play: {result.googlePlay?.ok ? "ok" : result.googlePlay?.configured ? "issue" : "not configured"}</span>
            </div>
            <div className="app-health-mini-list">
              {latestCommit?.sha && <span><strong>Latest commit</strong> · {latestCommit.sha.slice(0, 7)} · {latestCommit.message?.split("\n")[0]}</span>}
              {latestBuild && <span><strong>iOS build</strong> · {latestBuild.version ?? "version unknown"} · {latestBuild.processingState ?? "state unknown"}</span>}
              {latestVersion && <span><strong>iOS version</strong> · {latestVersion.versionString ?? "version unknown"} · {latestVersion.appStoreState ?? "state unknown"}</span>}
            </div>
            {(result.blockers?.length ?? 0) > 0 && (
              <div className="app-health-blockers">
                {result.blockers!.slice(0, 5).map((blocker, index) => <span key={`${blocker}-${index}`}>{blocker}</span>)}
              </div>
            )}
            <div className="app-health-boundary">Read-only only · no deploys, releases, payment changes, review replies, or repo mutations.</div>
          </>
        )}
      </div>
    </div>
  );
}

type GooglePlayLookupResult = {
  success?: boolean;
  configured?: boolean;
  readOnly?: boolean;
  error?: string;
  message?: string;
  summary?: {
    packageName: string;
    reviews: Array<{ reviewId: string; authorName?: string | null; lastModified?: string | null; starRating?: number | null; text?: string | null }>;
    subscriptions: Array<{ productId: string; basePlansCount?: number | null; listingsCount?: number | null; archived?: boolean | null }>;
    inAppProducts: Array<{ sku: string; status?: string | null; purchaseType?: string | null; defaultPrice?: string | null }>;
    blockedCapabilities: Array<{ name: string; reason: string }>;
  };
};

function GooglePlayLookupCard({
  state,
  args,
  result,
}: {
  state: ToolInvocation["state"];
  args: Record<string, unknown>;
  result?: GooglePlayLookupResult;
}) {
  const isPending = state === "partial-call" || state === "call";
  const failed = !isPending && result?.success === false;
  const summary = result?.summary;
  const latestReview = summary?.reviews?.[0];

  return (
    <div className={`tool-card tool-card--googleplay ${isPending ? "tool-card--pending" : ""} ${failed ? "tool-card--failed" : ""}`}>
      <div className="tool-card-header">
        <span className="tool-card-icon">{isPending ? "🔎" : failed ? "⚠️" : "▶️"}</span>
        <span className="tool-card-title">Google Play read-only lookup</span>
        {isPending && <span className="tool-spinner" />}
      </div>
      <div className="tool-card-body tool-card-body--stacked">
        <span className="repo-control-meta">Package: {summary?.packageName || (typeof args.packageName === "string" ? args.packageName : "configured package")}</span>
        <span className="repo-control-status repo-control-status--safe">Read-only · release tracks blocked</span>
        {failed && <span className="tool-error">{result?.error || result?.message || "Google Play lookup failed."}</span>}
        {summary && (
          <>
            <div className="memory-meta-row">
              <span>{summary.reviews.length} recent reviews</span>
              <span>{summary.subscriptions.length} subscriptions</span>
              <span>{summary.inAppProducts.length} in-app products</span>
            </div>
            {latestReview && (
              <div className="googleplay-mini-list">
                <span><strong>Latest review</strong> · {latestReview.starRating ? `${latestReview.starRating}★` : "rating unknown"}{latestReview.lastModified ? ` · ${formatTimestamp(latestReview.lastModified)}` : ""}</span>
              </div>
            )}
            {summary.subscriptions.length > 0 && (
              <div className="googleplay-mini-list">
                {summary.subscriptions.slice(0, 4).map((subscription) => (
                  <span key={subscription.productId}><strong>{subscription.productId}</strong> · {subscription.basePlansCount ?? 0} base plans</span>
                ))}
              </div>
            )}
            {summary.blockedCapabilities.length > 0 && (
              <div className="googleplay-blocked-list">
                {summary.blockedCapabilities.map((blocked) => (
                  <span key={blocked.name}><strong>{blocked.name} blocked:</strong> {blocked.reason}</span>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

type AppStoreConnectLookupResult = {
  success?: boolean;
  configured?: boolean;
  readOnly?: boolean;
  error?: string;
  message?: string;
  summary?: {
    appId: string;
    app?: { id: string; name?: string | null; bundleId?: string | null; sku?: string | null; primaryLocale?: string | null } | null;
    latestBuilds: Array<{ id: string; version?: string | null; uploadedDate?: string | null; processingState?: string | null; expired?: boolean | null; minOsVersion?: string | null }>;
    latestVersions: Array<{ id: string; versionString?: string | null; platform?: string | null; appStoreState?: string | null; appVersionState?: string | null; createdDate?: string | null }>;
  };
};

function AppStoreConnectLookupCard({
  state,
  args,
  result,
}: {
  state: ToolInvocation["state"];
  args: Record<string, unknown>;
  result?: AppStoreConnectLookupResult;
}) {
  const isPending = state === "partial-call" || state === "call";
  const failed = !isPending && result?.success === false;
  const summary = result?.summary;
  const latestBuild = summary?.latestBuilds?.[0];
  const latestVersion = summary?.latestVersions?.[0];

  return (
    <div className={`tool-card tool-card--appstore ${isPending ? "tool-card--pending" : ""} ${failed ? "tool-card--failed" : ""}`}>
      <div className="tool-card-header">
        <span className="tool-card-icon">{isPending ? "🔎" : failed ? "⚠️" : "🍎"}</span>
        <span className="tool-card-title">App Store Connect read-only lookup</span>
        {isPending && <span className="tool-spinner" />}
      </div>
      <div className="tool-card-body tool-card-body--stacked">
        <span className="repo-control-meta">App ID: {summary?.appId || (typeof args.appId === "string" ? args.appId : "configured app")}</span>
        <span className="repo-control-status repo-control-status--safe">Read-only · no release changes</span>
        {failed && <span className="tool-error">{result?.error || result?.message || "App Store Connect lookup failed."}</span>}
        {summary && (
          <>
            <p className="build-intel-copy">
              {summary.app?.name ?? "App"}{summary.app?.bundleId ? ` · ${summary.app.bundleId}` : ""}
            </p>
            <div className="memory-meta-row">
              <span>{summary.latestBuilds.length} recent builds</span>
              <span>{summary.latestVersions.length} app versions</span>
              {latestBuild?.processingState && <span>Latest build: {latestBuild.processingState}</span>}
            </div>
            {latestBuild && (
              <div className="appstore-mini-list">
                <span><strong>Latest build</strong> · {latestBuild.version ?? "version unknown"}{latestBuild.uploadedDate ? ` · ${formatTimestamp(latestBuild.uploadedDate)}` : ""}</span>
              </div>
            )}
            {latestVersion && (
              <div className="appstore-mini-list">
                <span><strong>Latest version</strong> · {latestVersion.versionString ?? "version unknown"}{latestVersion.appStoreState ? ` · ${latestVersion.appStoreState}` : ""}</span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

type RevenueCatLookupResult = {
  success?: boolean;
  configured?: boolean;
  readOnly?: boolean;
  error?: string;
  message?: string;
  subscriber?: {
    appUserId: string;
    originalAppUserId?: string | null;
    firstSeen?: string | null;
    lastSeen?: string | null;
    managementUrl?: string | null;
    entitlements: Array<{ id: string; productIdentifier?: string | null; expiresDate?: string | null; purchaseDate?: string | null; store?: string | null; isActive: boolean }>;
    subscriptions: Array<{ productIdentifier: string; store?: string | null; periodType?: string | null; purchaseDate?: string | null; expiresDate?: string | null; isSandbox?: boolean | null; isActive: boolean }>;
  };
};

function RevenueCatLookupCard({
  state,
  args,
  result,
}: {
  state: ToolInvocation["state"];
  args: Record<string, unknown>;
  result?: RevenueCatLookupResult;
}) {
  const isPending = state === "partial-call" || state === "call";
  const failed = !isPending && result?.success === false;
  const subscriber = result?.subscriber;
  const entitlements = subscriber?.entitlements ?? [];
  const subscriptions = subscriber?.subscriptions ?? [];
  const activeEntitlements = entitlements.filter((entitlement) => entitlement.isActive);
  const activeSubscriptions = subscriptions.filter((subscription) => subscription.isActive);

  return (
    <div className={`tool-card tool-card--revenuecat ${isPending ? "tool-card--pending" : ""} ${failed ? "tool-card--failed" : ""}`}>
      <div className="tool-card-header">
        <span className="tool-card-icon">{isPending ? "🔎" : failed ? "⚠️" : "💳"}</span>
        <span className="tool-card-title">RevenueCat read-only lookup</span>
        {isPending && <span className="tool-spinner" />}
      </div>
      <div className="tool-card-body tool-card-body--stacked">
        <span className="repo-control-meta">App user: {subscriber?.appUserId || (typeof args.appUserId === "string" ? args.appUserId : "pending")}</span>
        <span className="repo-control-status repo-control-status--safe">Read-only · no entitlement changes</span>
        {failed && <span className="tool-error">{result?.error || result?.message || "RevenueCat lookup failed."}</span>}
        {subscriber && (
          <>
            <div className="memory-meta-row">
              <span>{activeEntitlements.length}/{entitlements.length} active entitlements</span>
              <span>{activeSubscriptions.length}/{subscriptions.length} active subscriptions</span>
              {subscriber.lastSeen && <span>Last seen {formatTimestamp(subscriber.lastSeen)}</span>}
            </div>
            {entitlements.length > 0 && (
              <div className="revenuecat-mini-list">
                {entitlements.slice(0, 4).map((entitlement) => (
                  <span key={entitlement.id}>
                    <strong>{entitlement.id}</strong> · {entitlement.isActive ? "active" : "inactive"}
                    {entitlement.expiresDate ? ` · expires ${formatTimestamp(entitlement.expiresDate)}` : ""}
                  </span>
                ))}
              </div>
            )}
            {subscriptions.length > 0 && (
              <div className="revenuecat-mini-list">
                {subscriptions.slice(0, 4).map((subscription) => (
                  <span key={subscription.productIdentifier}>
                    <strong>{subscription.productIdentifier}</strong> · {subscription.isActive ? "active" : "inactive"}
                    {subscription.store ? ` · ${subscription.store}` : ""}
                  </span>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}


type RepoControlToolResult = {
  success?: boolean;
  proposalId?: string;
  action?: string;
  status?: string;
  repo?: string;
  projectKey?: string;
  riskLevel?: string;
  stoppedAt?: string;
  error?: string;
  message?: string;
  prUrl?: string;
  overallReady?: boolean;
  readinessSummary?: string;
  readinessReasons?: string[];
  blocked?: boolean;
  expectedApproval?: string;
  documentedCommand?: string;
  safety?: string;
  result?: {
    blocked?: boolean;
    expectedApproval?: string;
    documentedCommand?: string;
    safety?: string;
    error?: string;
    message?: string;
    overallReady?: boolean;
    readinessSummary?: string;
    readinessReasons?: string[];
  };
  steps?: Array<{ action?: string; step?: string; ok?: boolean; error?: string; summary?: string }>;
};

function RepoControlCard({
  name,
  state,
  args,
  result,
}: {
  name: string;
  state: ToolInvocation["state"];
  args: Record<string, unknown>;
  result?: RepoControlToolResult;
}) {
  const isPending = state === "partial-call" || state === "call";
  const failed = !isPending && result?.success === false;
  const title = getToolDisplayLabel(name, args, result);
  const proposalId = result?.proposalId || (typeof args.proposalId === "string" ? args.proposalId : undefined);
  const stage = result?.action || (typeof args.action === "string" ? args.action : undefined);
  const steps = Array.isArray(result?.steps) ? result.steps.slice(0, 7) : [];
  const nestedResult = result?.result;
  const readinessSummary = result?.readinessSummary || nestedResult?.readinessSummary;
  const readinessReasons = result?.readinessReasons || nestedResult?.readinessReasons || [];
  const expectedApproval = result?.expectedApproval || nestedResult?.expectedApproval;
  const documentedCommand = result?.documentedCommand || nestedResult?.documentedCommand;
  const safety = result?.safety || nestedResult?.safety;
  const blocked = Boolean(result?.blocked || nestedResult?.blocked || safety?.includes("blocked"));

  return (
    <div className={`tool-card tool-card--repo-control ${isPending ? "tool-card--pending" : ""} ${failed ? "tool-card--failed" : ""}`}>
      <div className="tool-card-header">
        <span className="tool-card-icon">{isPending ? "🛠️" : failed ? "⚠️" : "✅"}</span>
        <span className="tool-card-title">{title}</span>
        {isPending && <span className="tool-spinner" />}
      </div>
      <div className="tool-card-body tool-card-body--stacked">
        {proposalId && <span className="repo-control-meta">Proposal: {proposalId}</span>}
        {stage && <span className="repo-control-meta">Stage: {stage.replace(/_/g, " ")}</span>}
        {result?.repo && <span className="repo-control-meta">Repo: {result.repo}</span>}
        {result?.prUrl && (
          <a className="repo-control-link" href={result.prUrl} target="_blank" rel="noopener noreferrer">
            Open pull request ↗
          </a>
        )}
        {result?.message && <span>{result.message}</span>}
        {readinessSummary && (
          <div className={`repo-control-status ${result?.overallReady || nestedResult?.overallReady ? "repo-control-status--ready" : "repo-control-status--waiting"}`}>
            <strong>{result?.overallReady || nestedResult?.overallReady ? "Ready" : "Waiting"}</strong>
            <span>{readinessSummary}</span>
            {readinessReasons.length > 0 && (
              <ul>
                {readinessReasons.slice(0, 4).map((reason, index) => (
                  <li key={`${reason}-${index}`}>{reason}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        {(blocked || expectedApproval || documentedCommand) && (
          <div className="repo-control-status repo-control-status--blocked">
            <strong>{blocked ? "Blocked safely" : "Approval gate"}</strong>
            {expectedApproval && <span>Required phrase: {expectedApproval}</span>}
            {documentedCommand && <code>{documentedCommand}</code>}
            {safety && <span>Safety: {safety.replace(/_/g, " ")}</span>}
          </div>
        )}
        {result?.error && <span className="tool-error">{result.error}</span>}
        {nestedResult?.error && <span className="tool-error">{nestedResult.error}</span>}
        {steps.length > 0 && (
          <ol className="repo-control-steps">
            {steps.map((step, index) => (
              <li key={`${step.action || "step"}-${index}`} className={step.ok ? "repo-control-step--ok" : "repo-control-step--blocked"}>
                <span>{step.ok ? "✓" : "!"}</span>
                <span>{(step.action || step.step || "stage").replace(/_/g, " ")}</span>
                {step.error && <em>{step.error}</em>}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

function DatetimeCard({ result }: { result?: { readable: string } }) {
  return (
    <div className="tool-card tool-card--datetime">
      <div className="tool-card-header">
        <span className="tool-card-icon">🕐</span>
        <span className="tool-card-title">
          {result ? result.readable : "Fetching date & time…"}
        </span>
      </div>
    </div>
  );
}

interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

interface WebSearchToolResult {
  query: string;
  answer?: string | null;
  results?: WebSearchResult[];
  error?: string;
  configured?: boolean;
}

function WebSearchCard({
  args,
  result,
}: {
  args: { query?: string };
  result?: WebSearchToolResult;
}) {
  const isPending = !result;
  return (
    <div className={`tool-card tool-card--search ${isPending ? "tool-card--pending" : ""}`}>
      <div className="tool-card-header">
        <span className="tool-card-icon">🔍</span>
        <span className="tool-card-title">
          {isPending ? `Searching: ${args.query ?? "…"}` : `Search: ${result.query}`}
        </span>
        {isPending && <span className="tool-spinner" />}
      </div>
      {result && !result.error && (
        <div className="tool-card-body">
          {result.answer && (
            <p className="search-answer">{result.answer}</p>
          )}
          {result.results && result.results.length > 0 && (
            <ul className="search-results">
              {result.results.map((r, i) => (
                <li key={r.url || i} className="search-result-item">
                  <a
                    href={r.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="search-result-title"
                  >
                    {r.title}
                  </a>
                  <span className="search-result-url">{r.url}</span>
                  <span className="search-result-snippet">{r.snippet}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {result?.error && (
        <div className="tool-card-body">
          <span className="tool-error">{result.error}</span>
        </div>
      )}
    </div>
  );
}

interface GitHubRepoToolResult {
  name?: string;
  description?: string | null;
  primary_language?: string | null;
  stars?: number;
  forks?: number;
  open_issues?: number;
  topics?: string[];
  license?: string | null;
  url?: string;
  updated_at?: string;
  file_tree?: string[];
  file_tree_note?: string;
  error?: string;
  repo?: string;
}

interface CodeExecutionArtifact {
  name: string;
  mimeType: string;
  content: string;
  bytes: number;
}

interface CodeExecutionToolResult {
  available: boolean;
  language: "javascript" | "typescript";
  success: boolean;
  failureKind?: string;
  failureGuidance?: string;
  durationMs: number;
  logs: string[];
  errors: string[];
  artifacts: CodeExecutionArtifact[];
  result?: string;
  resultType?: string;
  error?: string;
  limits: {
    timeoutMs: number;
    maxSourceLength: number;
    maxOutputChars: number;
    maxArtifacts: number;
    maxArtifactBytes: number;
    memoryLimitMb: number;
  };
}


function GitHubRepoCard({
  args,
  result,
}: {
  args: { repo?: string };
  result?: GitHubRepoToolResult;
}) {
  const isPending = !result;
  const displayName = result?.name ?? args.repo ?? "repository";
  return (
    <div className={`tool-card tool-card--github ${isPending ? "tool-card--pending" : ""}`}>
      <div className="tool-card-header">
        <span className="tool-card-icon">🐙</span>
        <span className="tool-card-title">
          {isPending ? `Analyzing ${displayName}…` : displayName}
        </span>
        {isPending && <span className="tool-spinner" />}
      </div>
      {result && !result.error && (
        <div className="tool-card-body">
          {result.description && (
            <p className="github-description">{result.description}</p>
          )}
          <div className="github-meta">
            {result.primary_language && (
              <span className="github-badge">🔤 {result.primary_language}</span>
            )}
            {typeof result.stars === "number" && (
              <span className="github-badge">⭐ {result.stars.toLocaleString()}</span>
            )}
            {typeof result.forks === "number" && (
              <span className="github-badge">🍴 {result.forks.toLocaleString()}</span>
            )}
            {result.license && (
              <span className="github-badge">📄 {result.license}</span>
            )}
          </div>
          {result.topics && result.topics.length > 0 && (
            <div className="github-topics">
              {result.topics.slice(0, 8).map((t) => (
                <span key={t} className="github-topic">{t}</span>
              ))}
            </div>
          )}
          {result.file_tree && result.file_tree.length > 0 && (
            <details className="github-tree">
              <summary>File structure ({result.file_tree.length} entries)</summary>
              <ul className="github-tree-list">
                {result.file_tree.map((entry, i) => (
                  <li key={`${entry}-${i}`} className="github-tree-entry">{entry}</li>
                ))}
              </ul>
              {result.file_tree_note && (
                <p className="github-tree-note">{result.file_tree_note}</p>
              )}
            </details>
          )}
          {result.url && (
            <a
              href={result.url}
              target="_blank"
              rel="noopener noreferrer"
              className="github-link"
            >
              View on GitHub ↗
            </a>
          )}
        </div>
      )}
      {result?.error && (
        <div className="tool-card-body">
          <span className="tool-error">{result.error}</span>
        </div>
      )}
    </div>
  );
}

function CodeExecutionCard({
  args,
  result,
}: {
  args: { code?: string; language?: "javascript" | "typescript" };
  result?: CodeExecutionToolResult;
}) {
  const isPending = !result;
  const preview = args.code?.trim() || "";
  const codePreview =
    preview.length > CODE_PREVIEW_MAX_LENGTH
      ? `${preview.slice(0, Math.max(0, CODE_PREVIEW_MAX_LENGTH - CODE_PREVIEW_TRUNCATION_LENGTH))}\n…`
      : preview || "Preparing snippet…";
  const failureLabel =
    result && !result.success && result.failureKind
      ? EXECUTION_FAILURE_LABELS[result.failureKind] ?? result.failureKind
      : null;

  return (
    <div className={`tool-card tool-card--execution ${isPending ? "tool-card--pending" : ""}`}>
      <div className="tool-card-header">
        <span className="tool-card-icon">🧪</span>
        <span className="tool-card-title">
          {isPending
            ? `Running ${args.language ?? "typescript"} snippet…`
            : `${result.language} sandbox`}
        </span>
        {isPending && <span className="tool-spinner" />}
      </div>
      <div className="tool-card-body tool-card-body--stacked">
        <pre className="tool-code-block">
          <code>{codePreview}</code>
        </pre>
        {result && (
          <>
            <div className="execution-meta">
              <span className={`execution-badge ${result.success ? "execution-badge--success" : "execution-badge--error"}`}>
                {result.success ? "Completed" : "Failed"}
              </span>
              {!result.success && failureLabel && (
                <span className="execution-badge execution-badge--error">
                  {failureLabel}
                </span>
              )}
              <span className="execution-badge">{result.durationMs} ms</span>
              <span className="execution-badge">{result.limits.timeoutMs} ms timeout</span>
              <span className="execution-badge">{result.limits.memoryLimitMb} MB worker</span>
            </div>

            {!result.success && result.failureGuidance && (
              <p className="execution-guidance">{result.failureGuidance}</p>
            )}

            {result.result && (
              <div className="execution-section">
                <div className="execution-section-title">
                  Result{result.resultType ? ` · ${result.resultType}` : ""}
                </div>
                <pre className="execution-output">
                  <code>{result.result}</code>
                </pre>
              </div>
            )}

            {result.logs.length > 0 && (
              <div className="execution-section">
                <div className="execution-section-title">Logs</div>
                <pre className="execution-output">
                  <code>{result.logs.join("\n")}</code>
                </pre>
              </div>
            )}

            {(result.errors.length > 0 || result.error) && (
              <div className="execution-section">
                <div className="execution-section-title">Errors</div>
                <pre className="execution-output execution-output--error">
                  <code>{[...result.errors, result.error].filter(Boolean).join("\n")}</code>
                </pre>
              </div>
            )}

            {result.artifacts.length > 0 && (
              <div className="execution-section">
                <div className="execution-section-title">Artifacts</div>
                <div className="artifact-list">
                  {result.artifacts.map((artifact, index) => (
                    <div key={`${artifact.name}-${index}`} className="artifact-card">
                      <div className="artifact-card-header">
                        <span>{artifact.name}</span>
                        <a
                          className="artifact-link"
                          href={`data:${artifact.mimeType};charset=utf-8,${encodeURIComponent(artifact.content)}`}
                          download={artifact.name}
                        >
                          Download
                        </a>
                      </div>
                      <div className="artifact-meta">
                        {artifact.mimeType} · {artifact.bytes} bytes
                      </div>
                      <pre className="execution-output">
                        <code>{artifact.content}</code>
                      </pre>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function GithubActivityCard({
  name,
  state,
  args,
  result,
}: {
  name: string;
  state: "partial-call" | "call" | "result";
  args: any;
  result?: any;
}) {
  const isPending = state !== "result";
  const hasFailed = !isPending && result?.success === false;
  return (
    <div className={`tool-card tool-card--github ${isPending ? "tool-card--pending" : ""}`}>
      <div className="tool-card-header">
        <span className="tool-card-icon">
          {isPending ? "⚙️" : hasFailed ? "❌" : "✅"}
        </span>
        <span className="tool-card-title">{getToolLabel(name)}</span>
        {isPending && <span className="tool-spinner" />}
      </div>
      {args?.path && (
        <div className="tool-card-body">
          <code className="tool-expr">{args.path}</code>
        </div>
      )}
      {!isPending && result?.commitUrl && (
        <div className="tool-card-body">
          <a
            href={result.commitUrl.startsWith("http") ? result.commitUrl : `https://${result.commitUrl}`}
            target="_blank"
            rel="noopener noreferrer"
            className="search-result-title"
          >
            View Live Commit on GitHub ↗
          </a>
        </div>
      )}
    </div>
  );
}

export function ToolCallCard({
  invocation,
  assistantHasText = false,
}: {
  invocation: ToolInvocation;
  assistantHasText?: boolean;
}) {
  const isPending =
    invocation.state === "partial-call" || invocation.state === "call";
  const showAnswerFollows = isPending && assistantHasText && isLongFormDiagnosticTool(invocation.toolName);
  const showLifecycleFallback = isPending && invocation.toolName === "get_tool_lifecycle_diagnostic";

  if (
    invocation.toolName === "create_task_plan" &&
    invocation.state === "result"
  ) {
    return (
      <TaskPlanCard
        result={invocation.result as { task: string; steps: string[] }}
      />
    );
  }

  if (invocation.toolName === "calculate") {
    return (
      <CalculateCard
        args={invocation.args as { expression?: string }}
        result={
          invocation.state === "result"
            ? (invocation.result as {
                expression: string;
                result?: string;
                error?: string;
              })
            : undefined
        }
      />
    );
  }

  if (
    invocation.toolName === "create_app_proposal" ||
    invocation.toolName === "queue_private_app_creator_deploy" ||
    invocation.toolName === "prepare_app_creator_preview_handoff" ||
    invocation.toolName === "preview_app_creator_proposal" ||
    invocation.toolName === "refine_app_creator_proposal" ||
    invocation.toolName === "approved_app_scaffold" ||
    invocation.toolName === "run_app_creator_scaffold_bridge"
  ) {
    return (
      <AppCreatorCard
        state={invocation.state}
        result={invocation.state === "result" ? (invocation.result as AppCreatorToolResult) : undefined}
      />
    );
  }

  if (invocation.toolName === "prepare_repo_deployment_handoff") {
    return (
      <DeploymentHandoffCard
        state={invocation.state}
        result={invocation.state === "result" ? (invocation.result as RepoDeploymentHandoffResult) : undefined}
      />
    );
  }

  if (invocation.toolName === "run_repo_control_flow") {
    return (
      <RepoControlFlowCard
        state={invocation.state}
        result={invocation.state === "result" ? (invocation.result as RepoControlFlowResult) : undefined}
      />
    );
  }

  if (invocation.toolName === "get_app_health_snapshot") {
    return (
      <AppHealthSnapshotCard
        state={invocation.state}
        result={invocation.state === "result" ? (invocation.result as AppHealthSnapshotResult) : undefined}
      />
    );
  }


  if (invocation.toolName === "audit_rune_session_fragments") {
    return (
      <SessionFragmentAuditCard
        state={invocation.state}
        result={invocation.state === "result" ? (invocation.result as SessionFragmentAuditResult) : undefined}
      />
    );
  }


  if (invocation.toolName === "plan_rune_fragmented_session_merge") {
    return (
      <SessionFragmentMergePlanCard
        state={invocation.state}
        result={invocation.state === "result" ? (invocation.result as SessionFragmentMergePlanResult) : undefined}
      />
    );
  }


  if (invocation.toolName === "execute_rune_session_merge") {
    return (
      <SessionFragmentMergeExecutionCard
        state={invocation.state}
        result={invocation.state === "result" ? (invocation.result as SessionFragmentMergeExecutionResult) : undefined}
      />
    );
  }

  if (invocation.toolName === "lookup_google_play_status") {
    return (
      <GooglePlayLookupCard
        state={invocation.state}
        args={invocation.args}
        result={invocation.state === "result" ? (invocation.result as GooglePlayLookupResult) : undefined}
      />
    );
  }

  if (invocation.toolName === "lookup_app_store_connect_status") {
    return (
      <AppStoreConnectLookupCard
        state={invocation.state}
        args={invocation.args}
        result={invocation.state === "result" ? (invocation.result as AppStoreConnectLookupResult) : undefined}
      />
    );
  }

  if (invocation.toolName === "lookup_revenuecat_subscriber") {
    return (
      <RevenueCatLookupCard
        state={invocation.state}
        args={invocation.args}
        result={invocation.state === "result" ? (invocation.result as RevenueCatLookupResult) : undefined}
      />
    );
  }

  if (invocation.toolName === "get_current_datetime") {
    return (
      <DatetimeCard
        result={
          invocation.state === "result"
            ? (invocation.result as { readable: string })
            : undefined
        }
      />
    );
  }

  if (invocation.toolName === "web_search") {
    return (
      <WebSearchCard
        args={invocation.args as { query?: string }}
        result={
          invocation.state === "result"
            ? (invocation.result as WebSearchToolResult)
            : undefined
        }
      />
    );
  }

  if (invocation.toolName === "analyze_github_repo") {
    return (
      <GitHubRepoCard
        args={invocation.args as { repo?: string }}
        result={
          invocation.state === "result"
            ? (invocation.result as GitHubRepoToolResult)
            : undefined
        }
      />
    );
  }

  if (invocation.toolName === "execute_code") {
    return (
      <CodeExecutionCard
        args={invocation.args as {
          code?: string;
          language?: "javascript" | "typescript";
        }}
        result={
          invocation.state === "result"
            ? (invocation.result as CodeExecutionToolResult)
            : undefined
        }
      />
    );
  }

  if (
    invocation.toolName === "create_repo_action_proposal" ||
    invocation.toolName === "run_repo_action_stage" ||
    invocation.toolName === "run_repo_action_ladder" ||
    invocation.toolName === "run_approved_repo_action" ||
    invocation.toolName === "deployment_control"
  ) {
    return (
      <RepoControlCard
        name={invocation.toolName}
        state={invocation.state}
        args={invocation.args}
        result={invocation.state === "result" ? (invocation.result as RepoControlToolResult) : undefined}
      />
    );
  }

  if (
    invocation.toolName === "listRepositoryTree" ||
    invocation.toolName === "readRepositoryFile" ||
    invocation.toolName === "commitChangesDirectly"
  ) {
    return (
      <GithubActivityCard
        name={invocation.toolName}
        state={invocation.state}
        args={invocation.args}
        result={invocation.state === "result" ? invocation.result : undefined}
      />
    );
  }

  const label = getToolDisplayLabel(invocation.toolName, invocation.args as Record<string, unknown>);

  // Generic fallback card
  return (
    <div className={`tool-card ${isPending && !showLifecycleFallback ? "tool-card--pending" : ""} ${showAnswerFollows || showLifecycleFallback ? "tool-card--answer-follows" : ""}`}>
      <div className="tool-card-header">
        <span className="tool-card-icon">{showAnswerFollows || showLifecycleFallback ? "✅" : isPending ? "⚙️" : "✅"}</span>
        <span className="tool-card-title">{showAnswerFollows || showLifecycleFallback ? `${label} — answer follows` : label}</span>
        {isPending && !showAnswerFollows && !showLifecycleFallback && <span className="tool-spinner" />}
      </div>
      {(showAnswerFollows || showLifecycleFallback) && (
        <div className="tool-card-body">
          <p className="tool-card-note">
            {showLifecycleFallback
              ? "Rune is using the lightweight response-lifecycle diagnostic instead of the full self-audit, so this card will not spin indefinitely."
              : "Rune finished the diagnostic tool call and is summarizing the result below."}
          </p>
        </div>
      )}
    </div>
  );
}


// ── Build App Pipeline Card ───────────────────────────────────────────────

interface BuildAppResult {
  ok?: boolean;
  stage?: string;
  status?: string;
  proposalId?: string;
  appName?: string;
  plan?: {
    appName?: string;
    platform?: string;
    complexity?: string;
    targetUsers?: string;
    coreFeatures?: string[];
    screens?: string[];
    dataModel?: string[];
  };
  prUrl?: string;
  prNumber?: number;
  previewUrl?: string;
  changedFiles?: string[];
  message?: string;
  nextAction?: string;
  error?: string;
}

function BuildAppPipelineCard({
  state,
  args,
  result,
}: {
  state: string;
  args?: Record<string, unknown>;
  result?: BuildAppResult;
}) {
  const stage = (result?.stage ?? args?.stage ?? "plan") as string;
  const status = result?.status ?? (state === "result" ? "done" : "running");
  const isPending = state !== "result";

  const stageLabel: Record<string, string> = {
    plan: "Planning app",
    scaffold: "Scaffolding files",
    deploy: "Deploying app",
    status: "Pipeline status",
  };
  const statusColor: Record<string, string> = {
    planned: "#7c3aed",
    scaffolded: "#2563eb",
    pr_open: "#2563eb",
    deploying: "#d97706",
    deployed: "#16a34a",
    failed: "#dc2626",
    awaiting_approval: "#d97706",
  };
  const color = statusColor[status] ?? "#6b7280";
  const icon = isPending ? "⚙️" : result?.ok ? "✅" : "❌";

  return (
    <div className="tool-card" style={{ borderLeft: `3px solid ${color}` }}>
      <div className="tool-card-header">
        <span className="tool-card-icon">{icon}</span>
        <span className="tool-card-title">
          {stageLabel[stage] ?? "App Creator Pipeline"}
          {!isPending && result?.appName ? ` — ${result.appName}` : ""}
        </span>
        {isPending && <span className="tool-spinner" />}
      </div>
      {!isPending && result && (
        <div className="tool-card-body" style={{ fontSize: "0.82rem", lineHeight: 1.6 }}>
          {result.status && (
            <div style={{ marginBottom: 4 }}>
              <span style={{ color, fontWeight: 600 }}>{result.status.replace(/_/g, " ").toUpperCase()}</span>
              {result.proposalId && (
                <span style={{ color: "#6b7280", marginLeft: 8, fontSize: "0.75rem" }}>
                  ID: {result.proposalId.slice(0, 8)}…
                </span>
              )}
            </div>
          )}
          {result.plan && (
            <div style={{ marginTop: 6 }}>
              {result.plan.coreFeatures?.length ? (
                <div style={{ marginBottom: 4 }}>
                  <span style={{ fontWeight: 500 }}>Features: </span>
                  {result.plan.coreFeatures.slice(0, 4).join(", ")}
                  {result.plan.coreFeatures.length > 4 ? ` +${result.plan.coreFeatures.length - 4} more` : ""}
                </div>
              ) : null}
              {result.plan.screens?.length ? (
                <div style={{ marginBottom: 4 }}>
                  <span style={{ fontWeight: 500 }}>Screens: </span>
                  {result.plan.screens.slice(0, 4).join(", ")}
                  {result.plan.screens.length > 4 ? ` +${result.plan.screens.length - 4} more` : ""}
                </div>
              ) : null}
              {result.plan.platform && (
                <div>
                  <span style={{ fontWeight: 500 }}>Platform: </span>
                  {result.plan.platform} · <span style={{ fontWeight: 500 }}>Complexity: </span>{result.plan.complexity}
                </div>
              )}
            </div>
          )}
          {result.prUrl && (
            <div style={{ marginTop: 6 }}>
              <a href={result.prUrl} target="_blank" rel="noopener noreferrer"
                style={{ color: "#2563eb", textDecoration: "underline" }}>
                View PR {result.prNumber ? `#${result.prNumber}` : ""}
              </a>
            </div>
          )}
          {result.changedFiles?.length ? (
            <div style={{ marginTop: 4, color: "#6b7280", fontSize: "0.75rem" }}>
              {result.changedFiles.length} file{result.changedFiles.length !== 1 ? "s" : ""} generated
            </div>
          ) : null}
          {result.nextAction && (
            <div style={{ marginTop: 6, color: "#6b7280", fontSize: "0.78rem", fontStyle: "italic" }}>
              Next: {result.nextAction}
            </div>
          )}
          {result.error && (
            <div style={{ marginTop: 6, color: "#dc2626", fontSize: "0.78rem" }}>
              Error: {result.error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Chat component ─────────────────────────────────────────────────────

