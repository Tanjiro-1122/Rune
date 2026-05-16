"use client";

import { useChat } from "ai/react";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";

const MAX_FILE_SIZE_MB = 10;
const MAX_FILE_SIZE = MAX_FILE_SIZE_MB * 1024 * 1024;
const CODE_PREVIEW_MAX_LENGTH = 220;
const CODE_PREVIEW_TRUNCATION_LENGTH = 2;
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

// ─── Tool display helpers ────────────────────────────────────────────────────

const TOOL_LABELS: Record<string, string> = {
  get_current_datetime: "Checking date & time",
  calculate: "Calculating only because this is math",
  create_task_plan: "Building a work plan",
  web_search: "Checking current information",
  analyze_github_repo: "Inspecting GitHub repository",
  get_jarvis_capability_snapshot: "Checking Jarvis capabilities",
  get_jarvis_self_audit_snapshot: "Running Jarvis self-audit",
  execute_code: "Running a safe code check",
  listRepositoryTree: "Inspecting the repository structure",
  readRepositoryFile: "Reading the exact source file",
  create_repo_action_proposal: "Creating a Repo Control proposal",
  run_repo_action_stage: "Running a Repo Control stage",
  run_repo_action_ladder: "Running the Repo Control ladder",
  run_approved_repo_action: "Running approved Repo Control executor",
  deployment_control: "Checking deployment control",
  lookup_revenuecat_subscriber: "Checking RevenueCat subscriber",
  lookup_app_store_connect_status: "Checking App Store Connect",
  lookup_google_play_status: "Checking Google Play",
  get_app_health_snapshot: "Checking app health",
  commitChangesDirectly: "Writing approved code changes",
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
  if (name === "run_repo_action_ladder") return "Running safe Repo Control ladder";
  if (name === "run_approved_repo_action") return "Running approved PR executor";
  if (name === "deployment_control") {
    const action = typeof args?.action === "string" ? args.action : result?.action;
    return action ? DEPLOYMENT_ACTION_LABELS[action] ?? `Checking deployment ${humanizeToolName(action)}` : TOOL_LABELS[name];
  }
  return TOOL_LABELS[name] ?? `Running ${humanizeToolName(name)}`;
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

interface ToolInvocation {
  state: "partial-call" | "call" | "result";
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  result?: unknown;
}

type LightweightAttachment = {
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
        {result?.nextAction && <div className="repo-flow-next"><strong>Next:</strong> {result.nextAction}</div>}
        <div className="repo-flow-boundary">Safety: {result?.safety ?? "no merge, no deploy, no production mutation"}</div>
      </div>
    </div>
  );
}

type AppHealthSnapshotResult = {
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

const PROJECT_SWITCHBOARD_OPTIONS = [
  {
    key: "jarvis",
    label: "Jarvis",
    subtitle: "Private AI workspace",
    repo: "Tanjiro-1122/Jarvis",
    accent: "#7dd3fc",
  },
  {
    key: "unfiltr",
    label: "Unfiltr",
    subtitle: "AI companion app",
    repo: "Tanjiro-1122/UniltrbyJavierbackup",
    accent: "#c084fc",
  },
  {
    key: "swh",
    label: "SWH",
    subtitle: "SportsWager Helper",
    repo: "Tanjiro-1122/swhmobile",
    accent: "#34d399",
  },
  {
    key: "unfiltr-family",
    label: "Unfiltr Family",
    subtitle: "Elderly-care companion",
    repo: "Tanjiro-1122/UnfiltrFamily",
    accent: "#fbbf24",
  },
] as const;

const PROJECT_MEMORY_OPTIONS = [
  { key: "global", label: "General" },
  ...PROJECT_SWITCHBOARD_OPTIONS.map((project) => ({ key: project.key, label: project.label })),
];


type CabinetDrawerKey = "memory" | "health" | "repo" | "build" | "activity" | "files" | "tasks";

const CABINET_DRAWERS: Array<{ key: CabinetDrawerKey; label: string; hint: string }> = [
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

function buildArtifactDownloadHref(artifact: WorkspaceArtifactSummary | CodeExecutionArtifact) {
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

function ToolCallCard({ invocation }: { invocation: ToolInvocation }) {
  const isPending =
    invocation.state === "partial-call" || invocation.state === "call";

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

  // Generic fallback card
  return (
    <div className={`tool-card ${isPending ? "tool-card--pending" : ""}`}>
      <div className="tool-card-header">
        <span className="tool-card-icon">{isPending ? "⚙️" : "✅"}</span>
        <span className="tool-card-title">{getToolDisplayLabel(invocation.toolName, invocation.args as Record<string, unknown>)}</span>
        {isPending && <span className="tool-spinner" />}
      </div>
    </div>
  );
}

// ─── Main Chat component ─────────────────────────────────────────────────────

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
  const [actionEvents, setActionEvents] = useState<ActionEventSummary[]>([]);
  const [actionLogStatus, setActionLogStatus] = useState("");
  const [buildIntel, setBuildIntel] = useState<BuildIntelligenceSnapshot | null>(null);
  const [buildIntelStatus, setBuildIntelStatus] = useState("");
  const [buildIntelBusy, setBuildIntelBusy] = useState(false);
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
  const [activeCabinetDrawer, setActiveCabinetDrawer] = useState<CabinetDrawerKey>("memory");

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
  const taskRefreshInFlightRef = useRef(false);
  const selectedWorkspace =
    workspaces.find((workspace) => workspace.id === workspaceId) ?? null;
  const selectedArtifact =
    artifacts.find((artifact) => artifact.id === artifactPreviewId) ?? artifacts[0] ?? null;
  const selectedProject =
    PROJECT_SWITCHBOARD_OPTIONS.find((project) => project.key === selectedProjectKey) ?? PROJECT_SWITCHBOARD_OPTIONS[0];
  const canManageWorkspaces = persistenceEnabled && schemaReady;

  function selectProject(projectKey: (typeof PROJECT_SWITCHBOARD_OPTIONS)[number]["key"]) {
    setSelectedProjectKey(projectKey);
    setMemoryProjectKey(projectKey);
    setRepoProposalStatus("");
    setActionLogStatus("");
    setBuildIntelStatus("");
    setDeployHealthStatus("");
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

  // Scroll to bottom when a response finishes or a new message is added.
  useEffect(() => {
    if (status === "ready" || status === "error") {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [status, messages.length]);

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

  const isLoading = status === "submitted" || status === "streaming" || isUploadingAttachment;

  // Determine the active tool name while streaming
  const activeToolName = isLoading
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
        return getToolLabel(
          (
            pending as {
              type: string;
              toolInvocation: ToolInvocation;
            }
          ).toolInvocation.toolName
        );
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
    isLoading && messages[messages.length - 1]?.role !== "assistant";

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
              {isLoading ? " · thinking" : ""}
            </p>
          </div>
          <div className="chat-header-right">
            {isLoading && (
              <span className="status-badge">
                <span className="status-dot" />
                {activeToolName ?? "Thinking…"}
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
                        invocation.toolName === "get_jarvis_capability_snapshot" || invocation.toolName === "get_jarvis_self_audit_snapshot"
                          ? invocation.toolName
                          : "";
                      const toolSignature = capabilityDedupeKey || `${invocation.toolName}:${stageKey}:${proposalKey}:${invocation.state === "result" ? JSON.stringify(invocation.result ?? {}) : invocation.state}`;
                      if (seenToolCards.has(toolSignature)) return null;
                      seenToolCards.add(toolSignature);
                      return (
                        <ToolCallCard
                          key={`${message.id}-${index}`}
                          invocation={invocation}
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
            {isUploadingAttachment ? "Uploading…" : status === "submitted" || status === "streaming" ? "Working…" : "Send"}
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
        <aside className="context-sidebar context-sidebar--open" aria-label="Jarvis tools and controls">
          <div className="context-panel">
            <div className="glass-drawer-titlebar">
              <div>
                <span>Jarvis tools</span>
                <small>{selectedProject.label}</small>
              </div>
              <button type="button" onClick={() => setShowInfoSidebar(false)} aria-label="Close tools">Close</button>
            </div>
            <div className="context-panel-section project-switchboard-section">
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
                  </button>
                ))}
              </div>

              <div className="project-switchboard-current">
                <span>Active</span>
                <strong>{selectedProject.label}</strong>
                <small>{selectedProject.repo}</small>
              </div>
            </div>

            <div className="filing-cabinet-drawers" aria-label="Jarvis filing cabinet sections">
              {CABINET_DRAWERS.map((drawer) => (
                <button
                  key={drawer.key}
                  type="button"
                  className={`filing-cabinet-tab ${activeCabinetDrawer === drawer.key ? "filing-cabinet-tab--active" : ""}`}
                  onClick={() => setActiveCabinetDrawer(drawer.key)}
                >
                  <span>{drawer.label}</span>
                  <small>{drawer.hint}</small>
                </button>
              ))}
            </div>

            <div className="filing-cabinet-active-label">
              <span>Open drawer</span>
              <strong>{CABINET_DRAWERS.find((drawer) => drawer.key === activeCabinetDrawer)?.label}</strong>
            </div>

            {activeCabinetDrawer === "memory" && (
            <div className="context-panel-section memory-panel-section filing-cabinet-content">
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
            <div className="context-panel-section deploy-health-section filing-cabinet-content">
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
            <div className="context-panel-section repo-control-section filing-cabinet-content">
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
            <div className="context-panel-section build-intel-section filing-cabinet-content">
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
            <div className="context-panel-section action-log-section filing-cabinet-content">
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
