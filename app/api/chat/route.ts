import { streamText, UIMessage, convertToCoreMessages, tool } from "ai";
import { openai } from "@ai-sdk/openai";
import { Octokit } from "@octokit/rest";
import { z } from "zod";
import {
  executeSandboxedCode,
  getCodeExecutionAvailability,
} from "@/lib/code-execution";
import {
  assertConversationAccess,
  assertWorkspaceAccess,
  deriveConversationTitle,
  getWorkspaceRetrievalContext,
  persistWorkspaceArtifacts,
  persistWorkspaceAttachments,
  recordWorkspaceEvent,
  saveConversationExchange,
} from "@/lib/workspaces";
import { logError } from "@/lib/errors";
import { buildAgentWorkLoopSnapshot, formatAgentWorkLoopPromptSection } from "@/lib/agent-work-loop";
import { getOwnerMemorySection } from "@/lib/owner-memory";
import { resolveOwnerSessionId } from "@/lib/owner-session";
import { buildSupabaseMemorySection } from "@/lib/memory";
import { auditJarvisSessionFragments, planJarvisSessionFragmentMerge, executeJarvisSessionFragmentMerge } from "@/lib/session-fragment-audit";
import {
  buildPlannerOutput,
  formatCodeExecutionSummary,
  getCodeExecutionGuidance,
  getLatestUserText,
  isFrozenDiagnosticIntent,
} from "@/lib/orchestration";
import {
  addWorkspaceTaskCheckpoint,
  completeWorkspaceTask,
  createWorkspaceTask,
  failWorkspaceTask,
  startWorkspaceTask,
  updateWorkspaceTaskStep,
} from "@/lib/tasks";
import {
  JARVIS_DEFAULT_REPO,
  buildProjectRegistryPromptSection,
  inferProjectFromText,
  resolveCanonicalRepo,
  splitRepoSlug,
} from "@/lib/project-registry";
import { getCapabilityTruthSnapshot } from "@/lib/capability-truth";
import { getSelfAuditSnapshot } from "@/lib/self-audit";
import { getToolLifecycleDiagnostic } from "@/lib/tool-lifecycle-diagnostic";
import {
  createRepoActionProposal,
  draftRepoActionDiff,
  generateRepoActionProposedDiff,
  inspectRepoActionFiles,
  openRepoActionPullRequest,
  prepareRepoDeploymentHandoff,
  runApprovedRepoActionExecutor,
  runRepoControlFlow,
  runTemporaryWorkspaceBuildCheck,
  sandboxCheckRepoActionDiff,
  trackRepoActionPullRequest,
  isRepoActionProposalId,
  repoActionProposalIdError,
} from "@/lib/repo-actions";
import { executeDeploymentControlAction, inspectDeploymentControl, prepareDeploymentControlAction } from "@/lib/deployment-control";
import { getRevenueCatSubscriberReadOnly } from "@/lib/revenuecat-readonly";
import { getAppStoreConnectReadOnlySummary } from "@/lib/app-store-connect-readonly";
import { getGooglePlayReadOnlySummary } from "@/lib/google-play-readonly";
import { getAppHealthSnapshot } from "@/lib/app-health-snapshot";
import { createAppCreatorProposal, createApprovedAppScaffold, prepareAppCreatorPreviewHandoff, previewAppCreatorProposal, queuePrivateAppCreatorDeploy, refineAppCreatorProposal, runAppCreatorScaffoldBridge } from "@/lib/app-creator";

export const maxDuration = 60; // Multi-step agent execution requires up to 60 s; needs Vercel Pro or higher.
const MAX_SESSION_ID_LENGTH = 128;
const CHAT_RATE_WINDOW_MS = 60_000;
const MAX_TRACKED_CHAT_SESSIONS = 2_000;
const MAX_EVENT_ERROR_MESSAGE_LENGTH = 280;
const CHAT_FINISH_PERSISTENCE_TIMEOUT_MS = 8_000;

class ChatFinishPersistenceTimeoutError extends Error {
  constructor(label: string, timeoutMs: number) {
    super(`${label} timed out after ${timeoutMs}ms.`);
    this.name = "ChatFinishPersistenceTimeoutError";
  }
}

async function withChatFinishTimeout<T>(
  operation: Promise<T>,
  label: string,
  timeoutMs = CHAT_FINISH_PERSISTENCE_TIMEOUT_MS
): Promise<T | undefined> {
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      operation,
      new Promise<undefined>((resolve) => {
        timeout = setTimeout(() => {
          logError(
            "api.chat.onFinish.timeout",
            new ChatFinishPersistenceTimeoutError(label, timeoutMs)
          );
          resolve(undefined);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

const chatRateWindow = new Map<string, number[]>();

function getMaxChatRequestsPerMinute() {
  const raw = process.env.JARVIS_CHAT_MAX_REQUESTS_PER_MINUTE;
  if (!raw) return 20;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return 20;
  return Math.round(Math.min(Math.max(parsed, 5), 300));
}

function cleanupRateWindow(now: number) {
  if (chatRateWindow.size <= MAX_TRACKED_CHAT_SESSIONS) return;

  for (const [sessionId, timestamps] of chatRateWindow) {
    const recent = timestamps.filter((timestamp) => now - timestamp < CHAT_RATE_WINDOW_MS);
    if (recent.length === 0) {
      chatRateWindow.delete(sessionId);
    } else {
      chatRateWindow.set(sessionId, recent);
    }
    if (chatRateWindow.size <= MAX_TRACKED_CHAT_SESSIONS) {
      break;
    }
  }
}

const MAX_TASK_SUMMARY_LENGTH = 240;

function getGithubToken() {
  return process.env.GITHUB_TOKEN || process.env.JARVIS_GITHUB_TOKEN;
}

function getOctokitClient() {
  const githubToken = getGithubToken();
  return new Octokit({
    ...(githubToken ? { auth: githubToken } : {}),
    userAgent: "Jarvis-Super-Agent/1.0 (+https://github.com/Tanjiro-1122/Jarvis)",
  });
}

function summarizeTaskResult(input: string) {
  const compact = input.replace(/\s+/g, " ").trim();
  if (!compact) return null;
  if (compact.length <= MAX_TASK_SUMMARY_LENGTH) return compact;
  const clipped = compact.slice(0, MAX_TASK_SUMMARY_LENGTH);
  const boundary = clipped.lastIndexOf(" ");
  return `${(boundary > 60 ? clipped.slice(0, boundary) : clipped).trimEnd()}…`;
}

// ─── Safe math expression evaluator ─────────────────────────────────────────
// A simple recursive-descent parser that evaluates arithmetic expressions
// without using eval() or the Function() constructor, eliminating code-injection risk.

const MATH_FN: Record<string, (...args: number[]) => number> = {
  sqrt: Math.sqrt,
  abs: Math.abs,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  log: Math.log10,
  ln: Math.log,
  pow: Math.pow,
  max: (...a) => Math.max(...a),
  min: (...a) => Math.min(...a),
};

function tokenize(raw: string): (number | string)[] {
  // Expand "N% of M" sugar before tokenising
  const src = raw
    .trim()
    .replace(
      /(\d+(?:\.\d+)?)\s*%\s*of\s*(\d+(?:\.\d+)?)/gi,
      "($1 / 100) * $2"
    );

  const tokens: (number | string)[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }

    // Number literal (including decimals)
    if (/\d/.test(c) || (c === "." && /\d/.test(src[i + 1] ?? ""))) {
      // Use a validated regex so that "1.2.3" is rejected rather than silently
      // becoming NaN.  The pattern matches an integer or a single-decimal float.
      const numMatch = src.slice(i).match(/^\d+(\.\d+)?/);
      if (!numMatch) throw new Error(`Invalid number literal at position ${i}`);
      const parsed = parseFloat(numMatch[0]);
      if (!isFinite(parsed)) throw new Error(`Invalid number literal: "${numMatch[0]}"`);
      tokens.push(parsed);
      i += numMatch[0].length;
      continue;
    }

    // Identifier (function names or constants: pi, e)
    if (/[a-zA-Z_]/.test(c)) {
      let id = "";
      while (i < src.length && /[a-zA-Z_]/.test(src[i])) id += src[i++];
      tokens.push(id.toLowerCase());
      continue;
    }

    // Two-char operator **
    if (c === "*" && src[i + 1] === "*") { tokens.push("**"); i += 2; continue; }

    // Single-char operators / punctuation
    if ("+-*/(),%".includes(c)) { tokens.push(c); i++; continue; }

    throw new Error(`Invalid character in expression: "${c}"`);
  }
  return tokens;
}

function evalMath(expression: string): number {
  const tokens = tokenize(expression);
  let pos = 0;

  function peek(): number | string | undefined { return tokens[pos]; }
  function consume(): number | string { return tokens[pos++]; }

  function parseExpr(): number { return parseAddSub(); }

  function parseAddSub(): number {
    let left = parseMulDiv();
    while (peek() === "+" || peek() === "-") {
      const op = consume();
      const right = parseMulDiv();
      left = op === "+" ? left + right : left - right;
    }
    return left;
  }

  function parseMulDiv(): number {
    let left = parsePow();
    while (peek() === "*" || peek() === "/" || peek() === "%") {
      const op = consume();
      const right = parsePow();
      if ((op === "/" || op === "%") && right === 0) {
        throw new Error("Division by zero");
      }
      left = op === "*" ? left * right : op === "/" ? left / right : left % right;
    }
    return left;
  }

  function parsePow(): number {
    const base = parseUnary();
    if (peek() === "**") {
      consume();
      return Math.pow(base, parsePow()); // right-associative
    }
    return base;
  }

  function parseUnary(): number {
    if (peek() === "-") { consume(); return -parsePrimary(); }
    if (peek() === "+") { consume(); return parsePrimary(); }
    return parsePrimary();
  }

  function parsePrimary(): number {
    const tok = peek();

    // Number literal
    if (typeof tok === "number") { consume(); return tok; }

    // Constants
    if (tok === "pi") { consume(); return Math.PI; }
    if (tok === "e")  { consume(); return Math.E; }

    // Whitelisted function call
    if (typeof tok === "string" && MATH_FN[tok]) {
      consume();
      if (peek() !== "(") throw new Error(`Expected '(' after ${tok}`);
      consume(); // '('
      const args: number[] = [parseExpr()];
      while (peek() === ",") { consume(); args.push(parseExpr()); }
      if (peek() !== ")") throw new Error("Expected ')'");
      consume(); // ')'
      return MATH_FN[tok](...args);
    }

    // Parenthesised sub-expression
    if (tok === "(") {
      consume();
      const val = parseExpr();
      if (peek() !== ")") throw new Error("Expected ')'");
      consume();
      return val;
    }

    throw new Error(
      typeof tok === "string"
        ? `Unknown identifier: "${tok}"`
        : `Unexpected end of expression`
    );
  }

  const result = parseExpr();
  if (pos !== tokens.length) {
    throw new Error("Unexpected tokens after expression");
  }
  return result;
}

// ─── GitHub URL / "owner/repo" normalizer ────────────────────────────────────
function parseOwnerRepo(input: string | null | undefined, textHint?: string | null): string {
  return resolveCanonicalRepo(input, textHint);
}

function getGithubHeaders() {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "Jarvis-Super-Agent/1.0",
  };
  const token = getGithubToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function isPlaceholderRepoPath(path: string) {
  const normalized = path.trim().toLowerCase();
  return (
    !normalized ||
    normalized.startsWith("path/to/") ||
    normalized.includes("<") ||
    normalized.includes(">") ||
    normalized.includes("...") ||
    normalized.includes("your-file") ||
    normalized.includes("example/")
  );
}

function buildCodeSnippet(content: string, query: string, contextLines = 3) {
  const lines = content.split(/\r?\n/);
  const terms = query
    .split(/\s+/)
    .map((term) => term.replace(/[^a-zA-Z0-9_.$-]/g, ""))
    .filter((term) => term.length >= 3)
    .slice(0, 8);
  const index = lines.findIndex((line) =>
    terms.some((term) => line.toLowerCase().includes(term.toLowerCase()))
  );
  const startLine = Math.max(index >= 0 ? index - contextLines : 0, 0);
  const endLine = Math.min(index >= 0 ? index + contextLines + 1 : Math.min(lines.length, 12), lines.length);
  return lines
    .slice(startLine, endLine)
    .map((line, offset) => `${startLine + offset + 1}: ${line}`)
    .join("\n");
}
function isCodeExecutionIntent(input: string, codeExecutionAvailable: boolean) {
  if (!codeExecutionAvailable || !input.trim()) return false;

  const hasCodeBlock = /```[\s\S]*?```/.test(input);
  const executionVerb = /\b(run|execute|test|simulate|debug|benchmark|profile|check|evaluate)\b/i.test(
    input
  );
  const executionNoun = /\b(code|snippet|script|function|algorithm|javascript|typescript|js|ts|loop)\b/i.test(
    input
  );
  const artifactIntent =
    /\b(create|generate|produce|build|export)\b[\s\S]*\b(artifact|file|download|csv|json|report|output)\b/i.test(
      input
    ) && /\b(code|snippet|script|javascript|typescript|js|ts)\b/i.test(input);
  const explainOnly =
    /\b(explain|review|summarize|understand|what does|why does)\b/i.test(input) &&
    !executionVerb;

  if (explainOnly) return false;
  return hasCodeBlock || artifactIntent || (executionVerb && executionNoun);
}

function isRepoControlCommand(input: string) {
  if (!input.trim()) return false;
  return /\b(repo control|repo action|proposal)\b/i.test(input) &&
    /\b(run|start|create|prepare|draft|inspect|ladder|stage|executor|proposal|stop before|pr|pull request)\b/i.test(input);
}

function hasMathExpression(input: string) {
  const withoutUuids = input.replace(
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
    " "
  );
  return /\d\s*[+*/^%]\s*\d|\d\s+-\s+\d|\(\s*\d[\d\s+\-*/^%.()]*\)/.test(withoutUuids);
}

function isCalculationIntent(input: string) {
  if (!input.trim()) return false;
  if (isRepoControlCommand(input)) return false;
  const explicitMath = /\b(calculate|compute|solve|math|arithmetic|percentage|percent|tip|sum|total|convert)\b/i.test(input);
  const conversationalMath = /\bwhat is\b/i.test(input) && hasMathExpression(input);
  return (explicitMath || conversationalMath) && hasMathExpression(input);
}


function isOperatorDiagnosticIntent(input: string) {
  if (!input.trim()) return false;
  const mentionsOperatorSurface = /\b(operator console|today[’']?s briefing|daily briefing|app health|control tower|briefing card|health warning|build signal|deploy gate)\b/i.test(input);
  const mentionsStatusMismatch = /\b(blocked|warning|error|status|badge|headline|mismatch|why|wrong|still showing|render|code path|fix)\b/i.test(input);
  return mentionsOperatorSurface && mentionsStatusMismatch;
}

function isDatetimeIntent(input: string) {
  if (isOperatorDiagnosticIntent(input)) return false;
  return /\b(date|time|day of the week|what day|today|tomorrow|current time)\b/i.test(
    input
  );
}

function isGitHubAnalysisIntent(input: string) {
  const trimmed = input.trim();
  return (
    /github\.com\/[\w.-]+\/[\w.-]+/i.test(trimmed) ||
    (/^[\w.-]+\/[\w.-]+$/.test(trimmed) &&
      !trimmed.includes(" ") &&
      !trimmed.startsWith("http")) ||
    /\banalyze\b[\s\S]*\b(repo|repository)\b/i.test(trimmed)
  );
}

function isGitHubSourceInspectionIntent(input: string) {
  const trimmed = input.trim();
  if (!trimmed) return false;
  const asksForSource = /\b(source|code|file|files|filename|filenames|implementation|exact|snippet|snippets|read|inspect|search|grep|find)\b/i.test(trimmed);
  const mentionsRepoSurface = /\b(github|repo|repository|jarvis|source file|codebase|sendMessage|useChat|AbortController|streaming|Task running|pendingTasks|runningTasks|taskComplete|streamComplete)\b/i.test(trimmed);
  const asksAgainstFakePaths = /\b(no summaries|actual code|actual snippets|filenames only|complete source|exact implementation|do not guess|don't guess|no placeholder|placeholder path)\b/i.test(trimmed);
  return asksForSource && (mentionsRepoSurface || asksAgainstFakePaths);
}

function isWebSearchIntent(input: string) {
  if (!input.trim()) return false;
  if (isGitHubSourceInspectionIntent(input) || isGitHubAnalysisIntent(input) || isCalculationIntent(input) || isDatetimeIntent(input) || isOperatorDiagnosticIntent(input)) {
    return false;
  }

  return /\b(latest|recent|current|today|news|release|launched|announced|updated)\b/i.test(
    input
  );
}

const JARVIS_SESSION_MERGE_APPROVAL_PHRASE = "APPROVE JARVIS SESSION MERGE";

function isApprovedJarvisSessionMergeIntent(input: string) {
  return input.includes(JARVIS_SESSION_MERGE_APPROVAL_PHRASE);
}

function getForcedToolChoice(
  input: string,
  codeExecutionAvailable: boolean
):
  | {
      type: "tool";
      toolName:
        | "execute_code"
        | "calculate"
        | "get_current_datetime"
        | "analyze_github_repo"
        | "get_jarvis_capability_snapshot"
        | "get_jarvis_self_audit_snapshot"
        | "get_tool_lifecycle_diagnostic"
        | "execute_jarvis_session_merge";
    }
  | null {
  if (isApprovedJarvisSessionMergeIntent(input)) {
    return { type: "tool", toolName: "execute_jarvis_session_merge" };
  }
  if (isFrozenDiagnosticIntent(input)) {
    return { type: "tool", toolName: "get_tool_lifecycle_diagnostic" };
  }
  if (isRepoControlCommand(input)) {
    return null;
  }
  if (isOperatorDiagnosticIntent(input)) {
    return null;
  }
  if (isCodeExecutionIntent(input, codeExecutionAvailable)) {
    return { type: "tool", toolName: "execute_code" };
  }
  if (isCalculationIntent(input)) {
    return { type: "tool", toolName: "calculate" };
  }
  if (isDatetimeIntent(input)) {
    return { type: "tool", toolName: "get_current_datetime" };
  }
  if (isGitHubAnalysisIntent(input)) {
    return { type: "tool", toolName: "analyze_github_repo" };
  }
  return null;
}

function buildRoutingHint(input: string, codeExecutionAvailable: boolean) {
  const hints: string[] = [];

  if (isRepoControlCommand(input)) {
    hints.push(
      "- Legacy router guard: Repo Control command detected; do not route to calculator because proposal IDs contain hyphens/numbers. Prefer the matching Repo Control tool."
    );
  }

  if (isOperatorDiagnosticIntent(input)) {
    hints.push(
      "- Operator diagnostic request detected: answer by reasoning over the Operator Console/App Health/Briefing mismatch. Do not call the datetime tool just because the product label contains Today’s Briefing. If a code path is likely, name the likely frontend/backend path and preserve PR-only/no-mutation safety boundaries."
    );
  }

  if (isApprovedJarvisSessionMergeIntent(input)) {
    hints.push("- Strong routing signal: exact Jarvis session merge approval phrase detected, so call `execute_jarvis_session_merge` with that exact approval phrase. Do not call capability snapshot first.");
  } else if (isCodeExecutionIntent(input, codeExecutionAvailable)) {
    hints.push(
      "- Strong routing signal: this request is execution-oriented, so use `execute_code` before giving analysis."
    );
  } else if (isCalculationIntent(input)) {
    hints.push("- Strong routing signal: this request is numeric, so use `calculate`.");
  } else if (isDatetimeIntent(input)) {
    hints.push("- Strong routing signal: this request is time-sensitive, so use `get_current_datetime`.");
  } else if (isGitHubSourceInspectionIntent(input)) {
    hints.push("- Strong routing signal: this request asks for exact source-code evidence, so prefer `searchRepositoryCode` first, then synthesize the final answer from its results. Do not repeatedly call `searchRepositoryCode` with the same request. Only use `readRepositoryFile` with a real path returned by tree/search results. Never invent placeholder paths like path/to/sendMessage.js.");
  } else if (isGitHubAnalysisIntent(input)) {
    hints.push("- Strong routing signal: this request is about a GitHub repository, so use `analyze_github_repo`.");
  } else if (isWebSearchIntent(input)) {
    hints.push("- Strong routing signal: this request needs fresh/current information, so prefer `web_search`.");
  }

  if (!hints.length) {
    hints.push("- Use the best matching tool whenever one is clearly applicable; do not default to prose-only capability disclaimers.");
  }

  return hints.join("\n");
}

function sanitizeAttachmentName(name: string | undefined) {
  const cleaned = (name ?? "file")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || "file";
}

/**
 * Validates whether an image URL is safe to forward to the AI model.
 *
 * When JARVIS_ALLOWED_IMAGE_HOSTS is set (comma-separated hostnames) only those
 * hosts are accepted.  Without that variable any well-formed HTTPS URL is
 * allowed — operators should set the allowlist in production to prevent
 * arbitrary external URLs (tracker pixels, oversized images, etc.) from being
 * sent to the model.
 */
function isSafeImageUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;

  const allowedHostsEnv = process.env.JARVIS_ALLOWED_IMAGE_HOSTS;
  if (allowedHostsEnv) {
    const allowedHosts = new Set(
      allowedHostsEnv.split(",").map((h) => h.trim()).filter(Boolean)
    );
    return allowedHosts.has(parsed.hostname);
  }

  // No allowlist configured — permit any HTTPS URL.
  // Set JARVIS_ALLOWED_IMAGE_HOSTS to restrict to trusted hosts in production.
  return true;
}

const baseAgentTools = {
  get_jarvis_capability_snapshot: tool({
    description:
      "Return a safe, non-secret truth snapshot of Jarvis capabilities, configuration readiness, missing setup, not-connected integrations, canonical projects, and approval rules. Use this before answering capability, setup, self-assessment, or owner-console planning questions.",
    parameters: z.object({}),
    execute: async () => getCapabilityTruthSnapshot(),
  }),


  get_tool_lifecycle_diagnostic: tool({
    description:
      "Run a fast, no-network diagnostic for Jarvis freeze/stuck/question-mark delayed-answer symptoms. Use this instead of full self-audit when Javier reports that Jarvis froze, got stuck, or only answered after sending a question mark.",
    parameters: z.object({
      symptom: z.string().max(240).optional().default("freeze/stuck/question-mark delayed answer"),
    }),
    execute: async ({ symptom }) => getToolLifecycleDiagnostic(symptom),
  }),

  get_jarvis_self_audit_snapshot: tool({
    description:
      "Run Jarvis Self-Audit Mode. Returns a structured, non-secret report covering identity, project map, capability truth, deploy/config health, codebase signals, safety gates, not-connected integrations, and the recommended next patch. Use this for explicit self-audits, system health checks, and 'are you ready' questions. Do not use for freeze/stuck/question-mark delayed-answer symptoms; use get_tool_lifecycle_diagnostic instead.",
    parameters: z.object({
      scope: z.enum(["jarvis-brain", "full-owner-console"]).optional().default("jarvis-brain"),
    }),
    execute: async ({ scope }) => getSelfAuditSnapshot(scope),
  }),

  lookup_revenuecat_subscriber: tool({
    description:
      "Look up a RevenueCat subscriber by app user ID in strict read-only mode. Use only when Javier asks to check RevenueCat, subscriber status, entitlements, or subscriptions for a specific app user ID. This tool never grants entitlements, changes purchases, refunds, transfers, deletes, or mutates RevenueCat.",
    parameters: z.object({
      appUserId: z.string().min(1).max(180).describe("The exact RevenueCat app user ID to inspect."),
    }),
    execute: async ({ appUserId }) => {
      const result = await getRevenueCatSubscriberReadOnly(appUserId);
      return {
        success: result.ok,
        ...result,
        message: result.ok
          ? "RevenueCat subscriber inspected in read-only mode. No subscription or entitlement changes happened."
          : result.error || "RevenueCat read-only lookup failed. No subscription or entitlement changes happened.",
      };
    },
  }),


  lookup_app_store_connect_status: tool({
    description:
      "Inspect App Store Connect for the configured app in strict read-only mode. Use when Javier asks about iOS builds, TestFlight/build processing, App Store versions, review/release status, or App Store Connect status. This tool only reads builds and versions; it never submits, releases, edits metadata, expires builds, or mutates App Store Connect.",
    parameters: z.object({
      appId: z.string().min(1).max(64).optional().describe("Optional App Store Connect app ID override. Omit to use the configured Jarvis app ID."),
    }),
    execute: async ({ appId }) => {
      const result = await getAppStoreConnectReadOnlySummary(appId);
      return {
        success: result.ok,
        ...result,
        message: result.ok
          ? "App Store Connect inspected in read-only mode. No release, submission, or metadata changes happened."
          : result.error || "App Store Connect read-only lookup failed. No release, submission, or metadata changes happened.",
      };
    },
  }),


  lookup_google_play_status: tool({
    description:
      "Inspect Google Play in strict read-only mode. Use when Javier asks about Android/Google Play status, reviews, subscriptions, in-app products, or Play Console readiness. This tool uses GET-only Android Publisher endpoints after OAuth token exchange. It does not open edits, change release tracks, submit builds, publish, rollout, halt releases, or mutate Google Play. Release-track visibility is explicitly blocked because Google exposes it through edit sessions.",
    parameters: z.object({
      packageName: z.string().min(1).max(220).optional().describe("Optional Android package name override. Omit to use the configured Jarvis package name."),
    }),
    execute: async ({ packageName }) => {
      const result = await getGooglePlayReadOnlySummary(packageName);
      return {
        success: result.ok,
        ...result,
        message: result.ok
          ? "Google Play inspected in read-only mode. No release track, publishing, product, or review changes happened."
          : result.error || "Google Play read-only lookup failed. No release track, publishing, product, or review changes happened.",
      };
    },
  }),


  get_app_health_snapshot: tool({
    description:
      "Generate a one-command read-only app health snapshot. Use when Javier asks to check app health, Unfiltr health, release health, store health, build health, or overall project readiness. This combines GitHub/Vercel readiness with RevenueCat optional subscriber lookup, App Store Connect, and Google Play. It never commits, deploys, releases, publishes, edits products, replies to reviews, changes entitlements, refunds, or mutates external systems.",
    parameters: z.object({
      projectKey: z.string().min(1).max(64).optional().default("unfiltr"),
      repo: z.string().min(1).max(180).optional().describe("Optional canonical GitHub repo slug override, e.g. Tanjiro-1122/UniltrbyJavierbackup."),
      revenueCatAppUserId: z.string().min(1).max(180).optional().describe("Optional RevenueCat app user ID to include subscriber health. Omit for general app health."),
      appStoreAppId: z.string().min(1).max(64).optional().describe("Optional App Store Connect app ID override."),
      googlePlayPackageName: z.string().min(1).max(220).optional().describe("Optional Google Play package name override."),
    }),
    execute: async ({ projectKey, repo, revenueCatAppUserId, appStoreAppId, googlePlayPackageName }) => {
      const snapshot = await getAppHealthSnapshot({ projectKey, repo, revenueCatAppUserId, appStoreAppId, googlePlayPackageName });
      return {
        success: snapshot.status !== "blocked",
        ...snapshot,
        message: "App health snapshot completed in read-only mode. No deployment, release, repo, payment, store, or customer mutation happened.",
      };
    },
  }),


  audit_jarvis_session_fragments: tool({
    description:
      "Run a strict read-only audit of Jarvis workspace/session fragmentation after the unified owner-session fix. Returns only session IDs, counts, timestamps, and workspace names. It never reads message content and never inserts, updates, deletes, merges, or mutates schema.",
    parameters: z.object({}),
    execute: async () => auditJarvisSessionFragments(),
  }),


  plan_jarvis_fragmented_session_merge: tool({
    description:
      "Prepare a planner-only dry run for consolidating old Jarvis browser-local session fragments into owner:javier. Returns proposed counts, source session IDs, approval phrase, and safety boundaries. It never reads message content and never inserts, updates, deletes, upserts, merges, calls RPC, mutates schema, or executes the merge.",
    parameters: z.object({}),
    execute: async () => planJarvisSessionFragmentMerge(),
  }),


  execute_jarvis_session_merge: tool({
    description:
      "Execute the approved Jarvis session metadata merge only when Javier provides the exact approval phrase. This updates ownership metadata for old browser-local conversations/workspaces/events to owner:javier. It never reads message content, never updates message rows, never deletes rows, never mutates schema, and never runs without the exact phrase APPROVE JARVIS SESSION MERGE.",
    parameters: z.object({
      approvalPhrase: z.string().min(1).max(80).describe("Must exactly equal APPROVE JARVIS SESSION MERGE."),
    }),
    execute: async ({ approvalPhrase }) => executeJarvisSessionFragmentMerge(approvalPhrase),
  }),

  get_current_datetime: tool({
    description:
      "Get the current date and time. Use whenever the user asks about the date, time, day of the week, or needs time-aware information.",
    parameters: z.object({}),
    execute: async () => {
      const now = new Date();
      return {
        iso: now.toISOString(),
        readable: now.toLocaleString("en-US", {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          timeZoneName: "short",
        }),
      };
    },
  }),

  calculate: tool({
    description:
      "Evaluate a mathematical expression and return the result. Use for arithmetic, percentages, unit conversions, and other numeric calculations.",
    parameters: z.object({
      expression: z
        .string()
        .describe(
          "A mathematical expression, e.g. '2 + 2', '15% of 230', '(42 * 18) / 7'"
        ),
    }),
    execute: async ({ expression }) => {
      try {
        const result = evalMath(expression);
        if (!isFinite(result)) {
          return { expression, error: "Result is not a finite number." };
        }
        return {
          expression,
          result: Number.isInteger(result)
            ? String(result)
            : parseFloat(result.toPrecision(10)).toString(),
        };
      } catch (err) {
        return {
          expression,
          error:
            err instanceof Error
              ? err.message
              : "Could not evaluate expression. Use standard math notation.",
        };
      }
    },
  }),

  create_task_plan: tool({
    description:
      "Outline a numbered step-by-step plan for a complex task BEFORE starting to work on it. Always call this first for multi-step or complex requests so the user can see the roadmap.",
    parameters: z.object({
      task: z.string().describe("A concise title for the overall task"),
      steps: z
        .array(z.string())
        .describe("Ordered list of steps to accomplish the task"),
    }),
    execute: async ({ task, steps }) => ({ task, steps }),
  }),

  web_search: tool({
    description:
      "Search the web for current information, recent news, facts, documentation, or any topic. Use whenever the user asks for up-to-date information, current events, or anything that may have changed since the model's training cutoff. Requires TAVILY_API_KEY to be configured.",
    parameters: z.object({
      query: z.string().describe("The search query"),
      max_results: z
        .number()
        .min(1)
        .max(10)
        .optional()
        .default(5)
        .describe("Number of results to return (1–10, default 5)"),
    }),
    execute: async ({ query, max_results = 5 }) => {
      const apiKey = process.env.TAVILY_API_KEY;
      if (!apiKey) {
        return {
          error:
            "Web search is not configured in this deployment. Set the TAVILY_API_KEY environment variable to enable real-time search.",
          query,
          configured: false,
        };
      }
      try {
        const response = await fetch("https://api.tavily.com/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            api_key: apiKey,
            query,
            search_depth: "basic",
            max_results: Math.min(Math.max(max_results, 1), 10),
            include_answer: true,
          }),
        });
        if (!response.ok) {
          return {
            error: `Tavily API error: ${response.status} ${response.statusText}`,
            query,
          };
        }
        const raw = await response.json();
        const data = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
        const answer = typeof data.answer === "string" ? data.answer : null;
        const rawResults = Array.isArray(data.results) ? data.results : [];
        return {
          query,
          answer,
          results: rawResults
            .filter(
              (r): r is { title: string; url: string; content: string } =>
                r !== null &&
                typeof r === "object" &&
                typeof (r as Record<string, unknown>).url === "string"
            )
            .map((r) => ({
              title: typeof r.title === "string" ? r.title : r.url,
              url: r.url,
              snippet: typeof r.content === "string" ? r.content : "",
            })),
        };
      } catch (err) {
        return {
          error: err instanceof Error ? err.message : "Search request failed.",
          query,
        };
      }
    },
  }),

  analyze_github_repo: tool({
    description:
      "Analyze a GitHub repository. If the user asks about Jarvis, your own repo, this app, your source code, or does not provide a repo, default to Tanjiro-1122/Jarvis. Use the canonical project registry instead of guessing owner/repo names.",
    parameters: z.object({
      repo: z
        .string()
        .optional()
        .default(JARVIS_DEFAULT_REPO)
        .describe(
          "GitHub repository as 'owner/repo', a full URL, a known project alias like 'Jarvis'/'Unfiltr'/'SWH'/'Unfiltr Family', or omitted to inspect Jarvis itself"
        ),
      include_readme: z
        .boolean()
        .optional()
        .default(true)
        .describe("Whether to fetch and include the README (default true)"),
      include_tree: z
        .boolean()
        .optional()
        .default(true)
        .describe("Whether to include the top-level file tree (default true)"),
    }),
    execute: async ({ repo, include_readme = true, include_tree = true }) => {
      const ownerRepo = parseOwnerRepo(repo);
      if (!ownerRepo.includes("/")) {
        return {
          error:
            "Could not parse repository. Please use 'owner/repo' format or a full GitHub URL.",
          repo,
        };
      }

      const headers = getGithubHeaders();

      try {
        // 1. Repository metadata
        const repoRes = await fetch(
          `https://api.github.com/repos/${ownerRepo}`,
          { headers }
        );
        if (!repoRes.ok) {
          if (repoRes.status === 404) {
            return {
              error: `Repository '${ownerRepo}' not found. It may be private or the name may be incorrect.`,
              repo: ownerRepo,
            };
          }
          if (repoRes.status === 403 || repoRes.status === 429) {
            return {
              error:
                "GitHub API rate limit reached. Set GITHUB_TOKEN or JARVIS_GITHUB_TOKEN for a higher rate limit and private repo access.",
              repo: ownerRepo,
            };
          }
          return {
            error: `GitHub API returned ${repoRes.status}: ${repoRes.statusText}`,
            repo: ownerRepo,
          };
        }
        const rawRepo = await repoRes.json();
        if (!rawRepo || typeof rawRepo !== "object") {
          return { error: "Unexpected response from GitHub API.", repo: ownerRepo };
        }
        const repoData = rawRepo as Record<string, unknown>;
        const defaultBranch = typeof repoData.default_branch === "string"
          ? repoData.default_branch
          : "main";

        const result: Record<string, unknown> = {
          name: typeof repoData.full_name === "string" ? repoData.full_name : ownerRepo,
          description: typeof repoData.description === "string" ? repoData.description : null,
          primary_language: typeof repoData.language === "string" ? repoData.language : null,
          stars: typeof repoData.stargazers_count === "number" ? repoData.stargazers_count : 0,
          forks: typeof repoData.forks_count === "number" ? repoData.forks_count : 0,
          open_issues: typeof repoData.open_issues_count === "number" ? repoData.open_issues_count : 0,
          topics: Array.isArray(repoData.topics) ? repoData.topics : [],
          created_at: typeof repoData.created_at === "string" ? repoData.created_at : null,
          updated_at: typeof repoData.updated_at === "string" ? repoData.updated_at : null,
          default_branch: defaultBranch,
          license:
            repoData.license !== null &&
            typeof repoData.license === "object" &&
            typeof (repoData.license as Record<string, unknown>).spdx_id === "string"
              ? (repoData.license as Record<string, unknown>).spdx_id
              : null,
          size_kb: typeof repoData.size === "number" ? repoData.size : 0,
          url: typeof repoData.html_url === "string" ? repoData.html_url : null,
        };

        // 2. README
        if (include_readme) {
          const readmeRes = await fetch(
            `https://api.github.com/repos/${ownerRepo}/readme`,
            { headers }
          );
          if (readmeRes.ok) {
            const rawReadme = await readmeRes.json();
            const readmeContent =
              rawReadme &&
              typeof rawReadme === "object" &&
              typeof (rawReadme as Record<string, unknown>).content === "string"
                ? (rawReadme as Record<string, unknown>).content as string
                : null;
            if (readmeContent) {
              const decoded = Buffer.from(readmeContent, "base64").toString("utf-8");
              result.readme =
                decoded.length > 4000
                  ? decoded.slice(0, 4000) +
                    "\n\n[README truncated — showing first 4 000 characters]"
                  : decoded;
            }
          }
        }

        // 3. Top-level file tree (shallow)
        if (include_tree) {
          const treeRes = await fetch(
            `https://api.github.com/repos/${ownerRepo}/git/trees/${defaultBranch}`,
            { headers }
          );
          if (treeRes.ok) {
            const rawTree = await treeRes.json();
            const treeItems: { type?: unknown; path?: unknown }[] =
              rawTree &&
              typeof rawTree === "object" &&
              Array.isArray((rawTree as Record<string, unknown>).tree)
                ? (rawTree as Record<string, unknown>).tree as { type?: unknown; path?: unknown }[]
                : [];
            result.file_tree = treeItems
              .filter(
                (item) =>
                  typeof item.path === "string" &&
                  (item.type === "blob" || item.type === "tree")
              )
              .slice(0, 60)
              .map((item) =>
                item.type === "tree"
                  ? `📁 ${item.path as string}/`
                  : `📄 ${item.path as string}`
              );
            if (
              rawTree &&
              typeof rawTree === "object" &&
              (rawTree as Record<string, unknown>).truncated === true
            ) {
              result.file_tree_note =
                "Tree truncated by GitHub (repository is very large).";
            }
          }
        }

        return result;
      } catch (err) {
        return {
          error:
            err instanceof Error
              ? err.message
              : "Failed to reach the GitHub API.",
          repo: ownerRepo,
        };
      }
    },
  }),

  readRepositoryFile: tool({
    description:
      "Read the complete code contents of a specific file in the GitHub repository before making edits. For Jarvis itself, use owner 'Tanjiro-1122' and repo 'Jarvis'. Never guess javierhuertas/jarvis.",
    parameters: z.object({
      owner: z.string().describe("The GitHub username. For Jarvis itself, use 'Tanjiro-1122'."),
      repo: z.string().describe("The repository name. For Jarvis itself, use 'Jarvis'."),
      path: z
        .string()
        .describe("The path to the file relative to the repo root (e.g., 'app/api/chat/route.ts')."),
    }),
    execute: async ({ owner, repo, path }) => {
      try {
        if (isPlaceholderRepoPath(path)) {
          return {
            success: false,
            error: "Refusing to read a placeholder or invented path. Search the repository tree/code first and provide a real path returned by GitHub.",
            path,
          };
        }
        const octokit = getOctokitClient();
        const resolved = splitRepoSlug(`${owner}/${repo}`);
        const { data } = await octokit.repos.getContent({
          owner: resolved.owner,
          repo: resolved.repo,
          path,
        });

        if (Array.isArray(data)) {
          return {
            success: false,
            error: "The provided path points to a directory, not a file.",
          };
        }
        if (!("content" in data) || typeof data.content !== "string") {
          return {
            success: false,
            error: "The file content is unavailable from the GitHub API response.",
          };
        }
        if (data.encoding !== "base64") {
          return {
            success: false,
            error: `Unsupported file encoding: ${data.encoding ?? "unknown"}. Only base64 encoding is supported.`,
          };
        }

        const decodedContent = Buffer.from(data.content, "base64").toString("utf-8");
        return { success: true, path, content: decodedContent };
      } catch (err: unknown) {
        return { success: false, error: err instanceof Error ? err.message : "Unknown error" };
      }
    },
  }),

  listRepositoryTree: tool({
    description:
      "List the complete file structure and folder layout of the GitHub repository. For Jarvis itself, use owner 'Tanjiro-1122' and repo 'Jarvis'. Never guess javierhuertas/jarvis.",
    parameters: z.object({
      owner: z.string().describe("The GitHub username. For Jarvis itself, use 'Tanjiro-1122'."),
      repo: z.string().describe("The repository name. For Jarvis itself, use 'Jarvis'."),
    }),
    execute: async ({ owner, repo }) => {
      try {
        const octokit = getOctokitClient();
        const resolved = splitRepoSlug(`${owner}/${repo}`);
        const { data: repoData } = await octokit.repos.get({ owner: resolved.owner, repo: resolved.repo });
        const defaultBranch = repoData.default_branch;

        const { data: refData } = await octokit.git.getRef({
          owner: resolved.owner,
          repo: resolved.repo,
          ref: `heads/${defaultBranch}`,
        });

        const { data: treeData } = await octokit.git.getTree({
          owner: resolved.owner,
          repo: resolved.repo,
          tree_sha: refData.object.sha,
          recursive: "true",
        });

        const filePaths = treeData.tree
          .filter((item) => item.type === "blob" && typeof item.path === "string")
          .map((item) => item.path);

        return { success: true, defaultBranch, files: filePaths };
      } catch (err: unknown) {
        return { success: false, error: err instanceof Error ? err.message : "Unknown error" };
      }
    },
  }),


  searchRepositoryCode: tool({
    description:
      "Search real code in a GitHub repository and return actual file paths plus snippets. Use this before readRepositoryFile when Javier asks for exact implementation details, source files, filenames, or code evidence. This is read-only and must never mutate GitHub.",
    parameters: z.object({
      owner: z.string().optional().default("Tanjiro-1122").describe("The GitHub username. For Jarvis itself, use 'Tanjiro-1122'."),
      repo: z.string().optional().default("Jarvis").describe("The repository name. For Jarvis itself, use 'Jarvis'."),
      query: z.string().min(1).max(200).describe("Code search query, such as 'useChat status streaming' or 'sendMessage'."),
      path_filter: z.string().max(160).optional().describe("Optional repo path filter, such as 'app/api' or 'components'. Must be a real path prefix, not a placeholder."),
      max_results: z.number().int().min(1).max(10).optional().default(8),
    }),
    execute: async ({ owner = "Tanjiro-1122", repo = "Jarvis", query, path_filter, max_results = 8 }) => {
      try {
        if (path_filter && isPlaceholderRepoPath(path_filter)) {
          return {
            success: false,
            error: "Refusing to search a placeholder path filter. Use a real repo path prefix or omit path_filter.",
            path_filter,
          };
        }

        const resolved = splitRepoSlug(`${owner}/${repo}`);
        const headers = getGithubHeaders();
        const pathQualifier = path_filter ? ` path:${path_filter.trim()}` : "";
        const q = `${query.trim()} repo:${resolved.owner}/${resolved.repo}${pathQualifier}`;
        const searchUrl = `https://api.github.com/search/code?q=${encodeURIComponent(q)}&per_page=${Math.min(max_results, 10)}`;
        const searchRes = await fetch(searchUrl, { headers });
        if (!searchRes.ok) {
          return {
            success: false,
            repo: `${resolved.owner}/${resolved.repo}`,
            query,
            error: `GitHub code search returned ${searchRes.status}: ${searchRes.statusText}`,
            hint: searchRes.status === 401 || searchRes.status === 403
              ? "Code search for private repos requires JARVIS_GITHUB_TOKEN/GITHUB_TOKEN with repo read access in the deployment environment."
              : undefined,
          };
        }
        const payload = await searchRes.json() as { total_count?: number; items?: Array<{ name?: string; path?: string; html_url?: string; repository?: { full_name?: string }; score?: number }> };
        const items = Array.isArray(payload.items) ? payload.items.slice(0, max_results) : [];
        const octokit = getOctokitClient();
        const matches = [];
        for (const item of items) {
          if (!item.path) continue;
          let snippet: string | null = null;
          try {
            const { data } = await octokit.repos.getContent({
              owner: resolved.owner,
              repo: resolved.repo,
              path: item.path,
            });
            if (!Array.isArray(data) && "content" in data && typeof data.content === "string" && data.encoding === "base64") {
              const decoded = Buffer.from(data.content, "base64").toString("utf-8");
              snippet = buildCodeSnippet(decoded, query);
            }
          } catch {
            snippet = null;
          }
          matches.push({
            path: item.path,
            name: item.name ?? item.path.split("/").pop() ?? item.path,
            url: item.html_url ?? null,
            repository: item.repository?.full_name ?? `${resolved.owner}/${resolved.repo}`,
            score: typeof item.score === "number" ? item.score : null,
            snippet,
          });
        }

        return {
          success: true,
          repo: `${resolved.owner}/${resolved.repo}`,
          query,
          searched: q,
          total_count: typeof payload.total_count === "number" ? payload.total_count : matches.length,
          matches,
          read_only: true,
          instruction: "Use only these returned paths for readRepositoryFile. Do not invent placeholder paths.",
        };
      } catch (err: unknown) {
        return { success: false, error: err instanceof Error ? err.message : "Unknown error", query };
      }
    },
  }),
};

function getAgentTools({
  workspaceId,
  conversationId,
}: {
  workspaceId?: string;
  conversationId?: string;
}) {
  return {
    ...baseAgentTools,






    queue_private_app_creator_deploy: tool({
      description:
        "Queue a private owner-only App Creator deployment job for Javier after preview handoff readiness and exact approval. This only queues a trusted-runner job; it does not deploy from chat, merge, mutate schema, change env vars, make anything public, or launch to customers.",
      parameters: z.object({
        proposalId: z.string().min(1).max(120),
        approvalText: z.string().min(1).max(120),
        reason: z.string().max(500).optional(),
      }),
      execute: async ({ proposalId, approvalText, reason }) => {
        const result = await queuePrivateAppCreatorDeploy({
          proposalId,
          approvalText,
          reason: reason || null,
          workspaceId: workspaceId ?? null,
          conversationId: conversationId ?? null,
        });
        return { success: result.ok, ...result };
      },
    }),

    prepare_app_creator_preview_handoff: tool({
      description:
        "Prepare an App Creator preview deployment handoff using the existing Repo Control deployment handoff. This is metadata-only for review/staging intent: it never deploys, merges, mutates schema, edits env vars, or touches production.",
      parameters: z.object({
        proposalId: z.string().min(1).max(120),
      }),
      execute: async ({ proposalId }) => {
        const result = await prepareAppCreatorPreviewHandoff({ proposalId });
        return { success: result.ok, ...result };
      },
    }),

    preview_app_creator_proposal: tool({
      description:
        "Show the current App Creator proposal preview from saved metadata. This is read-only: no files, schema, PR, deployment, or production systems are changed.",
      parameters: z.object({
        proposalId: z.string().min(1).max(120),
      }),
      execute: async ({ proposalId }) => {
        const result = await previewAppCreatorProposal({ proposalId });
        return { success: result.ok, ...result };
      },
    }),

    refine_app_creator_proposal: tool({
      description:
        "Refine an existing App Creator proposal in place. Updates the proposal blueprint/metadata and resets scaffold readiness. It does not edit files, commit, open a PR, mutate schema, deploy, or touch production.",
      parameters: z.object({
        proposalId: z.string().min(1).max(120),
        instruction: z.string().min(1).max(1200),
        addFeatures: z.array(z.string().min(1).max(140)).max(8).optional(),
        removeFeatures: z.array(z.string().min(1).max(140)).max(8).optional(),
        targetUsers: z.string().max(180).optional(),
        platform: z.enum(["web", "mobile", "both"]).optional(),
        complexity: z.enum(["simple", "standard", "advanced"]).optional(),
      }),
      execute: async ({ proposalId, instruction, addFeatures, removeFeatures, targetUsers, platform, complexity }) => {
        const result = await refineAppCreatorProposal({
          proposalId,
          instruction,
          addFeatures,
          removeFeatures,
          targetUsers: targetUsers || null,
          platform,
          complexity,
        });
        return { success: result.ok, ...result };
      },
    }),

    run_app_creator_scaffold_bridge: tool({
      description:
        "Run the full safe App Creator v1.2 bridge for an approved App Creator proposal: generate the scaffold patch, run Repo Control checks, open/track a PR when gates allow, and prepare deployment handoff metadata. It never merges, deploys, mutates schema, or touches production systems.",
      parameters: z.object({
        proposalId: z.string().min(1).max(120),
        openPr: z.boolean().optional().default(true),
        trackPr: z.boolean().optional().default(true),
      }),
      execute: async ({ proposalId, openPr = true, trackPr = true }) => {
        const result = await runAppCreatorScaffoldBridge({ proposalId, openPr, trackPr });
        return {
          success: result.ok,
          ...result,
        };
      },
    }),

    approved_app_scaffold: tool({
      description:
        "Generate the deterministic starter-app scaffold patch for an approved App Creator proposal. This requires the proposal to already be approved. It saves a patch for Repo Control checks only; it does not commit, open a PR, merge, deploy, or mutate schema by itself.",
      parameters: z.object({
        proposalId: z.string().min(1).max(120),
      }),
      execute: async ({ proposalId }) => {
        const result = await createApprovedAppScaffold({ proposalId });
        return {
          success: result.ok,
          ...result,
        };
      },
    }),

    create_app_proposal: tool({
      description:
        "Create a controlled App Creator v1 blueprint and Repo Control proposal for a brand-new app. This proves Jarvis can create apps through approval-gated workflow, but does not edit files, create schemas, deploy, or open a PR by itself.",
      parameters: z.object({
        idea: z.string().min(1).max(1600),
        appName: z.string().max(80).optional(),
        targetUsers: z.string().max(180).optional(),
        platform: z.enum(["web", "mobile", "both"]).optional().default("web"),
        complexity: z.enum(["simple", "standard", "advanced"]).optional().default("standard"),
        mustHaveFeatures: z.array(z.string().min(1).max(140)).max(8).optional(),
        preferredStack: z.string().max(240).optional(),
      }),
      execute: async ({ idea, appName, targetUsers, platform, complexity, mustHaveFeatures, preferredStack }) => {
        const result = await createAppCreatorProposal({
          idea,
          appName: appName || null,
          targetUsers: targetUsers || null,
          platform,
          complexity,
          mustHaveFeatures,
          preferredStack: preferredStack || null,
          projectKey: "jarvis",
          repo: "Tanjiro-1122/Jarvis",
          sessionId: null,
          workspaceId: workspaceId ?? null,
          conversationId: conversationId ?? null,
        });
        return {
          success: result.ok,
          ...result,
        };
      },
    }),

    create_repo_action_proposal: tool({
      description:
        "Create a Repo Control proposal for repo/app/code changes after inspecting the repository and explaining Findings → Plan. This records the proposal only; it does not edit files, commit, deploy, or open a PR.",
      parameters: z.object({
        title: z.string().min(1).max(180),
        summary: z.string().min(1).max(900),
        findings: z.string().max(6000).optional(),
        plan: z.string().max(6000).optional(),
        repo: z.string().max(160).optional(),
        projectKey: z.string().max(80).optional(),
        riskLevel: z.enum(["low", "medium", "high"]).optional().default("medium"),
        files: z
          .array(
            z.object({
              path: z.string().min(1).max(240),
              operation: z.enum(["create", "update", "delete", "inspect"]).optional(),
              note: z.string().max(500).optional(),
            })
          )
          .max(20)
          .optional(),
        diffPreview: z.string().max(10000).optional(),
      }),
      execute: async ({ title, summary, findings, plan, repo, projectKey, riskLevel, files, diffPreview }) => {
        const result = await createRepoActionProposal({
          title,
          summary,
          findings,
          plan,
          repo: repo || null,
          projectKey: projectKey || null,
          riskLevel,
          files,
          diffPreview,
          sessionId: null,
          workspaceId: workspaceId ?? null,
          conversationId: conversationId ?? null,
        });
        if (!result.ok || !result.proposal) {
          return {
            success: false,
            error: result.error || "Repo Control proposal could not be created.",
            message: "No code was changed.",
          };
        }
        const proposal = result.proposal;
        return {
          success: true,
          proposalId: proposal.id,
          status: proposal.status,
          repo: proposal.repo,
          projectKey: proposal.project_key,
          riskLevel: proposal.risk_level,
          message: "Repo Control proposal created. No code was changed yet.",
        };
      },
    }),

    run_repo_action_stage: tool({
      description:
        "Run one safe Repo Control stage for an existing proposal: inspect files, draft a diff, generate a proposed diff, run sandbox safety checks, run a temporary workspace build check, open a PR, or track a PR. This tool uses the existing Repo Control backend gates and does not merge or deploy.",
      parameters: z.object({
        proposalId: z.string().min(1).max(120),
        action: z.enum([
          "inspect_repo",
          "draft_diff",
          "generate_diff",
          "sandbox_check",
          "temp_workspace_check",
          "open_pr",
          "track_pr",
        ]),
      }),
      execute: async ({ proposalId, action }) => {
        if (!isRepoActionProposalId(proposalId)) {
          return { success: false, invalidProposalId: true, action, proposalId, error: repoActionProposalIdError(proposalId), message: "No Repo Control stage ran. Use a proposal UUID from the Repo Control card, not a GitHub Actions run ID." };
        }
        const run = async () => {
          if (action === "inspect_repo") return inspectRepoActionFiles({ id: proposalId });
          if (action === "draft_diff") return draftRepoActionDiff({ id: proposalId });
          if (action === "generate_diff") return generateRepoActionProposedDiff({ id: proposalId });
          if (action === "sandbox_check") return sandboxCheckRepoActionDiff({ id: proposalId });
          if (action === "temp_workspace_check") return runTemporaryWorkspaceBuildCheck({ id: proposalId });
          if (action === "open_pr") return openRepoActionPullRequest({ id: proposalId });
          return trackRepoActionPullRequest({ id: proposalId });
        };

        const result = await run();
        if (!result.ok) {
          return {
            success: false,
            action,
            proposalId,
            error: result.error || "Repo Control stage failed.",
            message: "No merge or deployment happened.",
          };
        }
        return {
          success: true,
          action,
          proposalId,
          result,
          message: "Repo Control stage completed. No merge or deployment happened.",
        };
      },
    }),


    run_repo_action_ladder: tool({
      description:
        "Run the safe Repo Control ladder for an existing proposal. It runs inspection, diff drafting/generation, sandbox check, and temporary workspace check in sequence. It stops before PR if approval/build gates are not satisfied; it never merges or deploys.",
      parameters: z.object({
        proposalId: z.string().min(1).max(120),
        includePrStep: z.boolean().optional().default(false),
      }),
      execute: async ({ proposalId, includePrStep = false }) => {
        if (!isRepoActionProposalId(proposalId)) {
          return { success: false, invalidProposalId: true, proposalId, error: repoActionProposalIdError(proposalId), message: "No Repo Control ladder ran. Use a proposal UUID from the Repo Control card, not a GitHub Actions run ID.", steps: [] };
        }
        const steps: Array<{ action: string; ok: boolean; error?: string; summary?: string }> = [];
        const runStage = async (action: "inspect_repo" | "draft_diff" | "generate_diff" | "sandbox_check" | "temp_workspace_check" | "open_pr" | "track_pr") => {
          const result =
            action === "inspect_repo"
              ? await inspectRepoActionFiles({ id: proposalId })
              : action === "draft_diff"
                ? await draftRepoActionDiff({ id: proposalId })
                : action === "generate_diff"
                  ? await generateRepoActionProposedDiff({ id: proposalId })
                  : action === "sandbox_check"
                    ? await sandboxCheckRepoActionDiff({ id: proposalId })
                    : action === "temp_workspace_check"
                      ? await runTemporaryWorkspaceBuildCheck({ id: proposalId })
                      : action === "open_pr"
                        ? await openRepoActionPullRequest({ id: proposalId })
                        : await trackRepoActionPullRequest({ id: proposalId });
          const ok = Boolean(result.ok);
          steps.push({
            action,
            ok,
            error: ok ? undefined : result.error || "Stage failed.",
            summary: ok ? "completed" : "stopped here",
          });
          return result;
        };

        for (const action of ["inspect_repo", "draft_diff", "generate_diff", "sandbox_check", "temp_workspace_check"] as const) {
          const result = await runStage(action);
          if (!result.ok) {
            return {
              success: false,
              proposalId,
              stoppedAt: action,
              steps,
              error: result.error || "Repo Control ladder stopped.",
              message: "The ladder stopped safely. No merge or deployment happened.",
            };
          }
        }

        if (includePrStep) {
          const prResult = await runStage("open_pr");
          if (!prResult.ok) {
            return {
              success: false,
              proposalId,
              stoppedAt: "open_pr",
              steps,
              error: prResult.error || "PR gate blocked this action.",
              message: "The ladder reached the PR gate and stopped safely. No merge or deployment happened.",
            };
          }
          await runStage("track_pr");
        }

        return {
          success: true,
          proposalId,
          steps,
          message: "Repo Control ladder completed the available safe stages. No merge or deployment happened.",
        };
      },
    }),

    run_approved_repo_action: tool({
      description:
        "Run the controlled executor for an approved Repo Control proposal. It requires approved status, runs sandbox and temporary workspace checks, then opens/tracks a PR if gates pass. It never merges or deploys.",
      parameters: z.object({
        proposalId: z.string().min(1).max(120),
        openPr: z.boolean().optional().default(true),
        trackPr: z.boolean().optional().default(true),
      }),
      execute: async ({ proposalId, openPr = true, trackPr = true }) => {
        if (!isRepoActionProposalId(proposalId)) {
          return { success: false, invalidProposalId: true, proposalId, error: repoActionProposalIdError(proposalId), message: "No approved executor ran. Use a proposal UUID from the Repo Control card, not a GitHub Actions run ID." };
        }
        const result = await runApprovedRepoActionExecutor({ id: proposalId, openPr, trackPr });
        if (!result.ok) {
          return {
            success: false,
            proposalId,
            steps: "steps" in result ? result.steps || [] : [],
            stoppedAt: "stoppedAt" in result ? result.stoppedAt || "controlled_executor" : "controlled_executor",
            error: result.error || "Controlled executor stopped safely.",
            message: "No merge or deployment happened.",
          };
        }
        return {
          success: true,
          proposalId,
          steps: "steps" in result ? result.steps || [] : [],
          prUrl: "prUrl" in result ? result.prUrl : undefined,
          message: result.message || "Controlled executor completed. No merge or deployment happened.",
        };
      },
    }),


    run_repo_control_flow: tool({
      description:
        "Run the one-command Repo Control flow for an existing proposal. It advances through inspect, diff, sandbox, temporary workspace check, and approved PR execution when allowed. It stops at approval gates and never merges, deploys, rolls back, or mutates production.",
      parameters: z.object({
        proposalId: z.string().min(1).max(120),
        openPr: z.boolean().optional().default(true),
        trackPr: z.boolean().optional().default(true),
      }),
      execute: async ({ proposalId, openPr = true, trackPr = true }) => {
        if (!isRepoActionProposalId(proposalId)) {
          return { success: false, invalidProposalId: true, proposalId, error: repoActionProposalIdError(proposalId), message: "Repo Control flow did not start. Use a proposal UUID from the Repo Control card, not a GitHub Actions run ID." };
        }
        const result = await runRepoControlFlow({ proposalId, openPr, trackPr });
        return {
          success: result.ok,
          ...result,
          message: result.message || "Repo Control flow completed safely. No merge or deployment happened.",
        };
      },
    }),


    prepare_repo_deployment_handoff: tool({
      description:
        "Prepare a deployment approval handoff package for a ready Repo Control PR. It reads existing PR readiness metadata and returns the PR URL, branch, readiness summary, required approval phrase, and next safe action. It never merges, deploys, redeploys, rolls back, queues runner jobs, or mutates production.",
      parameters: z.object({
        proposalId: z.string().min(1).max(120),
      }),
      execute: async ({ proposalId }) => {
        if (!isRepoActionProposalId(proposalId)) {
          return { success: false, invalidProposalId: true, proposalId, error: repoActionProposalIdError(proposalId), message: "Deployment handoff did not start. Use a proposal UUID from the Repo Control card, not a GitHub Actions run ID." };
        }
        const result = await prepareRepoDeploymentHandoff({ proposalId });
        return {
          success: result.ready,
          ...result,
          message: result.message || "Deployment handoff prepared in metadata-only mode. No deployment happened.",
        };
      },
    }),


    deployment_control: tool({
      description:
        "Inspect Vercel deployment status or prepare a redeploy/rollback action for Javier approval. This tool never redeploys, rolls back, merges, or mutates production.",
      parameters: z.object({
        action: z.enum(["inspect", "prepare_redeploy", "prepare_rollback", "execute_redeploy", "execute_rollback"]),
        gitBranch: z.string().max(160).nullable().optional(),
        target: z.string().max(80).nullable().optional(),
        deploymentId: z.string().max(160).nullable().optional(),
        reason: z.string().max(700).nullable().optional(),
        approvalText: z.string().max(120).nullable().optional(),
      }),
      execute: async ({ action, gitBranch, target, deploymentId, reason, approvalText }) => {
        if (action === "inspect") {
          const result = await inspectDeploymentControl({ gitBranch, target, limit: 6 });
          return {
            success: result.ok,
            action,
            result,
            message: result.ok
              ? "Deployment status inspected. No production action happened."
              : result.error || "Deployment inspection unavailable.",
          };
        }
        if (action === "execute_redeploy" || action === "execute_rollback") {
          const result = await executeDeploymentControlAction({
            action,
            deploymentId,
            reason,
            approvalText,
            workspaceId: workspaceId ?? null,
            conversationId: conversationId ?? null,
          });
          return {
            success: result.ok,
            action,
            result,
            message: result.message || result.error || "Deployment execution gate completed. No production action happened unless explicitly supported and approved.",
          };
        }

        const result = await prepareDeploymentControlAction({ action, deploymentId, reason });
        return {
          success: result.ok,
          action,
          result,
          message: result.ok
            ? result.message
            : result.error || "Deployment action could not be prepared. No production action happened.",
        };
      },
    }),


    execute_code: tool({
      description:
        "Run a short, self-contained JavaScript or TypeScript snippet inside Jarvis's sandbox. Use for small coding checks, evaluating generated code, quick data transforms, algorithm verification, and generating downloadable text artifacts (CSV, JSON, SVG, HTML, Markdown). The snippet must be self-contained, must not use imports or external modules, and should use `return` to surface a final value. Console output and artifacts are returned to the chat UI.",
      parameters: z.object({
        language: z
          .enum(["javascript", "typescript"])
          .optional()
          .default("typescript")
          .describe("Snippet language. Use TypeScript only for lightweight type syntax."),
        code: z
          .string()
          .describe(
            "A short self-contained snippet. No imports, file access, network access, or process access. Use `return` for the final value. Use createArtifact(name, content, mimeType?) for downloadable output."
          ),
      }),
      execute: async ({ code, language = "typescript" }) => {
        const result = await executeSandboxedCode({ code, language });
        if (result.artifacts.length > 0) {
          await persistWorkspaceArtifacts({
            workspaceId,
            conversationId,
            artifacts: result.artifacts,
          });
        }
        return result;
      },
    }),
  };
}

export async function POST(req: Request) {
  let requestSessionId: string | null = null;
  let requestWorkspaceId: string | undefined;
  let requestConversationId: string | undefined;
  let activeTaskId: string | null = null;
  try {
    // ── Runtime validation ────────────────────────────────────────────────────
    // Validate the request body before touching any state (rate-limiter map,
    // workspace events, etc.) so malformed input is rejected early.
    //
    // Each message must have a valid role and a non-empty content field.
    // passthrough() preserves all extra UIMessage fields (id, parts,
    // experimental_attachments, etc.) that the AI SDK needs downstream.
    const MessageSchema = z
      .object({
        role: z.enum(["user", "assistant", "system", "tool"]),
        content: z.union([z.string(), z.array(z.any())]),
      })
      .passthrough();

    const OptionalUuidSchema = z
      .union([z.string().uuid(), z.null()])
      .optional()
      .transform((value) => value ?? undefined);

    const ChatBodySchema = z.object({
      messages: z.array(MessageSchema).min(1),
      sessionId: z
        .union([z.string().min(1).max(MAX_SESSION_ID_LENGTH), z.null()])
        .optional()
        .transform((value) => value ?? undefined),
      conversationId: OptionalUuidSchema,
      workspaceId: OptionalUuidSchema,
      resumeTaskId: OptionalUuidSchema,
    });

    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid request body." }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const parsed = ChatBodySchema.safeParse(rawBody);
    if (!parsed.success) {
      return new Response(
        JSON.stringify({
          error: "Invalid request body.",
          details: parsed.error.flatten().fieldErrors,
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // UIMessage carries extra SDK fields (id, parts, experimental_attachments,
    // etc.) that passthrough() preserved but Zod's inferred type doesn't
    // reflect. The cast is safe because the schema validates the required
    // structural fields and passes through everything else untouched.
    const { messages: rawMessages, sessionId: clientSessionId, conversationId, workspaceId, resumeTaskId } = parsed.data;
    const messages = rawMessages as unknown as UIMessage[];
    const sessionId = await resolveOwnerSessionId(req, clientSessionId);

    // sessionId is required for rate-limiting and workspace access
    if (!sessionId) {
      return new Response(
        JSON.stringify({ error: "Invalid sessionId." }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Assign tracking variables now that input is validated
    requestSessionId = sessionId;
    requestWorkspaceId = workspaceId;
    requestConversationId = conversationId;

    // ── Rate limiting ─────────────────────────────────────────────────────────
    // NOTE: This in-memory rate limiter is effective only within a single
    // serverless instance. On platforms like Vercel, each cold start or new
    // instance resets the counter, making it bypassable under load. For
    // production deployments, replace chatRateWindow with an external atomic
    // store (e.g. Upstash Redis / Vercel KV) and set UPSTASH_REDIS_REST_URL +
    // UPSTASH_REDIS_REST_TOKEN. The structure below is intentionally isolated
    // so the external store can be plugged in by replacing the four lines that
    // read/write chatRateWindow.
    const now = Date.now();
    cleanupRateWindow(now);
    const recentRequests =
      (chatRateWindow.get(sessionId) ?? []).filter(
        (timestamp) => now - timestamp < CHAT_RATE_WINDOW_MS
      );
    if (recentRequests.length >= getMaxChatRequestsPerMinute()) {
      return new Response(
        JSON.stringify({
          error:
            "Rate limit reached for this workspace session. Wait a minute and retry.",
        }),
        {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": "60",
          },
        }
      );
    }
    recentRequests.push(now);
    chatRateWindow.set(sessionId, recentRequests);

    // ── Message preprocessing ─────────────────────────────────────────────────
    // Extract markdown image URLs from user messages and attach them as AI SDK
    // image blocks. Only HTTPS URLs that pass isSafeImageUrl() are forwarded to
    // the model; all others are silently dropped to prevent tracker pixels,
    // internal metadata endpoints, or oversized images from inflating token counts.
    const formattedMessages = messages.map((msg: UIMessage) => {
      if (msg.role !== "user" || typeof msg.content !== "string") {
        return msg;
      }

      const imageRegex = /!\[[^\]]{0,1000}\]\((https?:\/\/[^\s)]{1,4096})\)/g;
      const matches = [...msg.content.matchAll(imageRegex)];

      if (matches.length === 0) {
        return msg;
      }

      const cleanText = msg.content.replace(imageRegex, "").trim();
      const contentArray: Array<{ type: "text"; text: string } | { type: "image"; image: string }> = [];

      if (cleanText) {
        contentArray.push({ type: "text", text: cleanText });
      }

      matches.forEach((match) => {
        const imageUrl = match[1];
        if (isSafeImageUrl(imageUrl)) {
          contentArray.push({ type: "image", image: imageUrl });
        }
      });

      // If all content was stripped (e.g. only unsafe image URLs), preserve text
      if (contentArray.length === 0 && cleanText === "" && msg.content) {
        return { ...msg, content: msg.content.replace(imageRegex, "").trim() || msg.content };
      }

      return {
        ...msg,
        content: contentArray,
      };
    });

    if (workspaceId) {
      await assertWorkspaceAccess({
        sessionId,
        workspaceId,
        requiredRole: "editor",
      });
    }
    if (conversationId) {
      await assertConversationAccess({
        sessionId,
        conversationId,
        workspaceId,
        requiredRole: "editor",
      });
    }

    await recordWorkspaceEvent({
      sessionId,
      workspaceId,
      conversationId,
      eventType: "chat.request",
      status: "started",
      details: {
        messageCount: messages.length,
      },
    });

    const codeExecution = getCodeExecutionAvailability();
    const codeExecutionSummary = formatCodeExecutionSummary(codeExecution);
    const codeExecutionGuidance = getCodeExecutionGuidance(codeExecution.available);
    const latestUserText = getLatestUserText(messages);
    const lastUserMessage = [...messages]
      .reverse()
      .find((message) => message.role === "user");
    const latestAttachments =
      (lastUserMessage?.experimental_attachments as
        | Array<{ name?: string; contentType?: string; url?: string }>
        | undefined) ?? [];
    const plannerOutput = buildPlannerOutput({
      input: latestUserText,
      messages,
      capabilities: {
        codeExecution,
        webSearch: Boolean(process.env.TAVILY_API_KEY),
        githubAnalysis: true,
      },
    });
    const plannerForcedToolChoice = plannerOutput.forcedToolName
      ? { type: "tool" as const, toolName: plannerOutput.forcedToolName }
      : null;
    const forcedToolChoice =
      plannerForcedToolChoice ??
      getForcedToolChoice(latestUserText, codeExecution.available);
    const routingHint = `${plannerOutput.routingHint}\n${buildRoutingHint(
      latestUserText,
      codeExecution.available
    )}`;
    const agentWorkLoop = buildAgentWorkLoopSnapshot({
      input: latestUserText,
      intent: plannerOutput.intent,
      reasoningRoute: plannerOutput.reasoningRoute,
    });
    const agentWorkLoopSection = formatAgentWorkLoopPromptSection(agentWorkLoop);
    let taskId = resumeTaskId ?? null;

    if (taskId) {
      await startWorkspaceTask(taskId, 5);
      await updateWorkspaceTaskStep({
        taskId,
        stepKey: "capture_request",
        status: "running",
        detail: "Resuming task from saved workspace context.",
        progress: 8,
      });
    } else {
      taskId = await createWorkspaceTask({
        workspaceId,
        conversationId,
        title: deriveConversationTitle(latestUserText || "Workspace task"),
        inputText: latestUserText,
        intent: plannerOutput.intent,
        steps: plannerOutput.steps.map((step) => ({
          key: step.key,
          label: step.label,
          detail: step.detail,
        })),
      });
    }
    activeTaskId = taskId;

    if (taskId) {
      await updateWorkspaceTaskStep({
        taskId,
        stepKey: "capture_request",
        status: "completed",
        detail: `${agentWorkLoop.progressLabel}. Intent: ${plannerOutput.intent}; route: ${plannerOutput.reasoningRoute}.`,
        progress: 18,
      });
      await updateWorkspaceTaskStep({
        taskId,
        stepKey: "retrieve_workspace_context",
        status: "running",
        detail: "Scanning indexed project files, artifacts, and prior chat memory.",
        progress: 24,
      });
    }

    const retrievalHits = await getWorkspaceRetrievalContext({
      workspaceId,
      query: latestUserText,
    });

    if (taskId) {
      await updateWorkspaceTaskStep({
        taskId,
        stepKey: "retrieve_workspace_context",
        status: "completed",
        detail: retrievalHits.length
          ? `Retrieved ${retrievalHits.length} high-relevance workspace hits.`
          : "No strong retrieval hits; continuing with direct user context.",
        progress: 36,
      });
      await updateWorkspaceTaskStep({
        taskId,
        stepKey: "execute_plan",
        status: "running",
        detail:
          forcedToolChoice?.type === "tool"
            ? `Executing with forced tool: ${forcedToolChoice.toolName}.`
            : "Executing with adaptive tool routing.",
        progress: 45,
      });
    }
    const workspaceContextSection = retrievalHits.length
      ? `## Retrieved Workspace Context
- This workspace has indexed prior material that may be relevant. Reuse it when it helps answer the request accurately.
${retrievalHits
  .map(
    (hit, index) =>
      `${index + 1}. [${hit.sourceKind}] ${hit.sourceLabel}: ${hit.excerpt}`
  )
  .join("\n")}`
      : `## Retrieved Workspace Context
- No highly relevant indexed workspace context matched this request. If the user uploads documents or generates artifacts in this workspace, those items should become part of future retrieval.`;

    await persistWorkspaceAttachments({
      workspaceId,
      conversationId,
      attachments: latestAttachments,
    });

    const agentTools = getAgentTools({ workspaceId, conversationId });

    // Allow the chat model to be overridden via environment variable so the
    // deployment can switch to a newer or cheaper model without a code change.
    const CHAT_MODEL = process.env.JARVIS_CHAT_MODEL ?? "gpt-4o-mini";
    const ownerMemorySection = getOwnerMemorySection();
    const inferredMemoryProject = inferProjectFromText(latestUserText);
    const memoryProjectKey = inferredMemoryProject?.key ?? (workspaceId ? "jarvis" : null);
    const supabaseMemorySection = await buildSupabaseMemorySection({
      query: latestUserText,
      projectKey: memoryProjectKey,
    });
    const memoryRoutingSection = `## Memory Routing
- Latest inferred project memory scope: ${memoryProjectKey ?? "global/all"}
- If the request mentions a known project, prefer memories for that project plus global rules.
- Do not use Jarvis-only memories to answer Unfiltr/SWH/Family implementation details unless they are global operating rules.`;

    const projectRegistrySection = buildProjectRegistryPromptSection();

    const result = streamText({
      model: openai(CHAT_MODEL),
      system: `You are Jarvis, Javier's private AI owner console and self-healing workspace developer agent. You are intelligent, capable, grounded, and methodical.

## Voice and personality
- Sound like Javier's private AI person, not a compliance dashboard. Warm, direct, confident, loyal, and quietly witty when it fits.
- Lead with the human answer first: what matters, what changed, what it means for Javier. Then give the technical details only as much as needed.
- Have an honest point of view. Say "my honest read" or "here's what matters" when evaluating status, tradeoffs, or next moves.
- Use plain English for Javier. Avoid sterile report dumps, corporate filler, and long walls of text.
- Keep the premium owner-console vibe: calm, capable, concise, emotionally intelligent, never goofy or performative.
- When a tool returns a checklist or audit, translate it into impact: wins, gaps, risk, and the next best move.
- Be encouraging without exaggerating. If something is not ready, say so clearly and explain the path forward.
- End with momentum: one concrete next move, not generic "let me know" language.
- Personality never overrides safety. Approval gates, truthfulness, privacy, and no-secret-leaking rules still win.

${projectRegistrySection}

## Self-Healing Operating Procedure
1. If the user reports an error or asks to modify/fix functionality, run \`listRepositoryTree\` first to map the codebase.
2. Then run \`readRepositoryFile\` on the relevant file to inspect the exact code contents. Never guess file contents.
3. Diagnose the issue and apply the fix step-by-step.
4. Confirm what you modified when done.

## Your Built-in Tools
- \`get_current_datetime\` — real current date and time (never guess the date)
- \`calculate\` — arithmetic, percentages, unit conversions
- \`create_task_plan\` — numbered step-by-step plan shown as a visual card
- \`web_search\` — live web search via Tavily (requires TAVILY_API_KEY to be set in the deployment)
- \`analyze_github_repo\` — fetch metadata, README, and file tree for any public GitHub repo
- \`searchRepositoryCode\` — search real GitHub source and return actual file paths/snippets; use this for exact code-evidence requests, then answer from the returned results instead of searching repeatedly
- \`listRepositoryTree\` — list complete repository file/folder layout
- \`readRepositoryFile\` — read full file contents from a repository path before editing
${codeExecutionSummary}

## Additional Context from Uploads
- Users may attach images (JPEG, PNG, GIF, WEBP) — you can see and describe them
- Users may attach plain text files (.txt, .csv, .md) — their content is included in the message; read, quote, and reason over that content directly

## Behavior Guidelines

### Tool use
- For complex or multi-step requests, call \`create_task_plan\` first so the user sees the roadmap, then execute each step
- Always use \`calculate\` for any arithmetic — never compute in your head
- Always use \`get_current_datetime\` for time-sensitive questions
- Use \`web_search\` for current events, recent releases, real-time facts, or anything that may have changed since your training cutoff
- Use \`analyze_github_repo\` whenever the user provides a GitHub URL or owner/repo string and wants to understand or discuss that repository
${codeExecutionGuidance}
- When a user asks to run/check code and \`execute_code\` is available, execute it in the sandbox even if you expect timeout or blocked APIs so the user gets a structured tool result card
- For artifact/file-style outputs from code execution, use \`createArtifact(...)\` inside the sandbox snippet instead of describing the file in prose
${routingHint}

## GitHub source inspection discipline
- When Javier asks for exact implementation details, source files, snippets, filenames, or code evidence, use searchRepositoryCode/listRepositoryTree/readRepositoryFile instead of prose-only answers.
- Use searchRepositoryCode first unless Javier gave an exact real repo path.
- After searchRepositoryCode returns, stop searching unless the result is empty and one refined search would materially help. Prefer a final answer using returned file paths/snippets.
- Never call readRepositoryFile with placeholder paths such as path/to/file.js, path/to/sendMessage.js, example paths, or invented filenames.
- Final answers to exact source-code requests must include real file paths and snippets from tool results, or clearly say no matching source evidence was found.
- If a file was not actually read, say it was not read. Do not claim code contents without tool evidence.

### Document and code context
- When a user uploads a code file or text document, read it carefully and reference specific sections in your response
- For large documents the model receives the full text; use it directly without hedging about "not being able to access files"
- Summarize, critique, explain, refactor, or answer questions about uploaded content with precision
${workspaceContextSection}
${memoryRoutingSection}
${ownerMemorySection ? `
${ownerMemorySection}` : ""}
${supabaseMemorySection ? `
${supabaseMemorySection}` : ""}

${agentWorkLoopSection}

## Planner / Executor
- Intent: ${plannerOutput.intent}
- Reasoning route: ${plannerOutput.reasoningRoute}
- Route rules:
  - answer_only: answer directly unless a tool is clearly needed.
  - truth_check: use Capability Truth before making capability claims.
  - self_audit: use Self-Audit before reporting readiness/system health.
  - inspect_first: inspect with the relevant tool before concluding.
  - plan_first: show a practical plan before action.
  - proposal_required: provide Findings → Plan and route repo/app changes through Repo Control approval gates before execution.
  - approval_required: do not execute sensitive/external actions until Javier explicitly approves the exact action.
  - not_connected: state the capability is not connected yet and propose the safest setup path.
- Plan:
${plannerOutput.steps
  .map((step, index) => `${index + 1}. ${step.label} — ${step.detail}`)
  .join("\n")}
- Follow the plan in order unless the user explicitly asks to change course.
- Report progress in your final response against the numbered plan steps.

### Private owner-console safety model
- Jarvis is not a SaaS product for sale. Jarvis is Javier's private owner console for apps, projects, customer support, and eventually sensitive owner-only services.
- For questions like "what can you do", "how far can we take you", or "what setup is missing", call get_jarvis_capability_snapshot before answering.
- If Javier provides the exact phrase APPROVE JARVIS SESSION MERGE, call execute_jarvis_session_merge immediately with approvalPhrase set to that exact phrase. Do not call capability snapshot first.
- For freeze/stuck/question-mark delayed-answer reports, call get_tool_lifecycle_diagnostic before answering. Do not call full self-audit for those symptoms unless Javier explicitly asks for a full self-audit.
- For questions like "audit yourself", "are you ready", "check your brain", "system health", or "what should we patch next", call get_jarvis_self_audit_snapshot before answering.
- Treat banking, customer emails, subscription credits/free months, production app fixes, deploys, and repo changes as sensitive actions.
- For sensitive actions, follow this sequence: gather facts safely, explain findings, draft the proposed action, ask Javier for approval, then execute only after approval.
- If Javier asks whether Jarvis can create an app, answer yes with precision: Jarvis can create apps through the controlled App Creator workflow (create_app_proposal) and Repo Control approval gates. App Creator v1 creates blueprints/proposals; approved_app_scaffold can generate starter files only after the proposal is approved. preview_app_creator_proposal can show the current plan, refine_app_creator_proposal can update it in place, run_app_creator_scaffold_bridge can run scaffold generation plus Repo Control checks/PR handoff, and prepare_app_creator_preview_handoff can prepare metadata-only preview deployment handoff, and queue_private_app_creator_deploy can queue a private-owner runner job only after exact approval. Schema changes, merges, and deployments still require explicit approval gates.
- Never claim email, banking, RevenueCat granting, or external customer-service actions are connected unless the capability snapshot or a real tool confirms it. RevenueCat subscriber lookup is read-only only through lookup_revenuecat_subscriber; never imply grants, refunds, transfers, deletes, or entitlement mutations are available. App Store Connect lookup is read-only only through lookup_app_store_connect_status; never imply release, submit, metadata edit, build expiry, or review mutation actions are available. Google Play lookup is read-only only through lookup_google_play_status; never imply release-track edits, publishing, rollout, halt, product edits, or review replies are available. Google Play release tracks are blocked unless Javier approves a separate edit-session reader design. One-command app health snapshots are read-only only through get_app_health_snapshot and must not imply repair actions were executed. Jarvis session fragmentation audit through audit_jarvis_session_fragments is read-only only: it returns counts/metadata and never reads message content, merges sessions, edits messages, updates workspace mappings, inserts rows, deletes rows, or mutates schema. Jarvis fragmented session merge planning through plan_jarvis_fragmented_session_merge is also planner-only/read-only: it can produce a dry-run plan and required approval phrase but must never imply it executed the merge, changed Supabase, read message content, or implemented a merge executor. Jarvis session merge execution through execute_jarvis_session_merge is allowed only when Javier provides the exact phrase APPROVE JARVIS SESSION MERGE. It may update only session ownership metadata for conversations, workspaces, workspace memberships, and workspace events; it must never read message content, update message rows, delete rows, mutate schema, or run with an approximate phrase. App Creator through create_app_proposal is blueprint/proposal-only; preview_app_creator_proposal is read-only. refine_app_creator_proposal updates only proposal metadata/blueprint and resets scaffold readiness. approved_app_scaffold can save a scaffold patch only for an approved App Creator proposal. run_app_creator_scaffold_bridge may open/track a PR only through Repo Control gates. prepare_app_creator_preview_handoff is metadata-only and must not imply Vercel deployment, merge, schemas, environment changes, or production systems were changed. queue_private_app_creator_deploy requires exact approval text APPROVE PRIVATE JARVIS DEPLOY and only queues an owner-only runner job; it must not imply public production, customer launch, merge, schema mutation, or chat-side deployment. One-command Repo Control flow through run_repo_control_flow must stop at approval gates and never imply merge, deploy, rollback, or production mutation. Deployment handoff through prepare_repo_deployment_handoff is metadata-only and never queues or executes deployment.
- Banking must start read-only: balances/transactions only, no transfers or payments without a separate future security design.
- Customer communications must be drafted first. Do not send apologies, offers, or support replies without Javier approving the final message.

### Capability-accurate responses
- Never prove Jarvis platform capabilities by creating fake/simulated JavaScript objects that say systems are operational. That is not a real diagnostic.
- For Jarvis self-audits, use real available endpoints/tools where available, or clearly label the result as "not verified" with the exact missing check. Be brutally honest.
- Follow the Reasoning Router route. If it says approval_required or proposal_required, do not skip straight to execution even if Javier gave broad phase approval; external/sensitive actions still need exact-action approval.
- Agent Core v1 rule: inspect → plan → propose before code changes. Avoid generic audit prose when a real repository inspection is available.
- Smart targeting rule: if Javier names a product or feature area, use the canonical project registry and likely file targets instead of asking him for repo/file paths.
- If a user asks what works, separate: verified, partially wired, requires environment variables/schema, and not connected yet.
- Do not call sandboxed code a test of Supabase, Vercel, GitHub, memory, files, or runner health unless the code actually contacted the relevant system.
- Do NOT use generic disclaimers such as "I can't access the internet" or "I have no access to external systems" as blanket statements
- Be precise: if a specific tool is available and configured, say so and use it
- If \`web_search\` is unavailable because TAVILY_API_KEY is not set, say exactly: "Web search is not enabled in this deployment. You can add a TAVILY_API_KEY to enable it, or paste the content you want me to analyze."
- If \`analyze_github_repo\` fails because a repo is private, say so and ask the user to paste the relevant code or file contents
- If sandboxed code execution is available, describe the limits precisely: small JavaScript/TypeScript only, no imports, no network/filesystem/process access, and strict timeout/output limits
- If sandboxed code execution is unavailable, say exactly why based on the deployment configuration instead of using a generic disclaimer
- If a capability is genuinely absent (e.g., writing files outside the sandbox or sending emails), state the specific limitation and suggest the best available alternative

### Final response discipline
- After tool use, summarize results in owner language: what ran, what passed, where it stopped, and the next safe step.
- For Repo Control, never dump raw tool JSON. Summarize proposal id, repo, files/stages, gate status, and whether any PR/deploy/merge happened.
- If a ladder stops at a safety gate, say exactly which gate stopped it and what is needed next.
- For self-audits and capability comparisons, do not just list buckets. Give Javier the honest read first, then 3 compact sections max: current strength, remaining gap, next move.
- Self-audit answer quality rule: never say "all capabilities are verified" if any setup/integration/configuration gaps exist. Separate verified strengths from missing/not-connected items, rank gaps by product impact, and state whether the self-audit tool completed, partially completed, or failed.
- If a self-audit/tool card appeared delayed or stuck, explain the lifecycle plainly: tool call started, result/summary rendering lagged, and the next product fix is task lifecycle visibility — not a fake backend outage unless logs prove one.
- Frozen/stuck diagnostic rule: when Javier asks why Jarvis froze, got stuck, stopped responding, was lost for a second, says the answer appears only after sending a question mark, or asks follow-ups like "?," "fix it," "go ahead," "recheck," or "did you find the same problem" in that context, use the lightweight tool lifecycle diagnostic. Do not answer with generic claims like "temporary processing delay," "the system was busy," "system load," "high traffic," "resource allocation," "caching opportunities," "excessive logging," or "backend lag" unless a real log/tool result proves it. State the exact verified evidence, then the most likely unverified cause, then the concrete patch path.
- Never say "I reviewed system load," "I reviewed performance metrics," "I confirmed high traffic," or "I analyzed current request handling" unless an actual runtime/log/code-inspection tool result appears in the current answer context. If no such tool ran, say the claim is unverified and propose the safe inspection path.
- Prefer phrases like "Short answer," "My honest read," "Here's what matters," and "The next clean move is..." when they fit naturally.
- Avoid ending with "If you need anything else" or "please let me know." End with a specific suggested next action.

### Formatting
- Format responses in Markdown: **bold**, \`code\`, lists, headers, fenced code blocks
- Be thorough yet concise. Prioritize accuracy, practical value, and a voice that feels alive rather than mechanical.`,
      // formattedMessages may contain elements whose `content` is an array
      // (for multimodal image blocks). The AI SDK's UIMessage type declares
      // `content: string` in TypeScript but handles array content correctly at
      // runtime via convertToCoreMessages. The double assertion is intentional.
      messages: convertToCoreMessages(formattedMessages as unknown as UIMessage[]),
      tools: agentTools,
      toolChoice: forcedToolChoice ?? "auto",
      maxSteps: 5,
      onFinish: async ({ text }) => {
        if (!lastUserMessage) return;

        const finishPersistence = (async () => {
          if (taskId) {
            await updateWorkspaceTaskStep({
              taskId,
              stepKey: "execute_plan",
              status: "completed",
              detail: "Primary generation step completed.",
              progress: 78,
            });
            await updateWorkspaceTaskStep({
              taskId,
              stepKey: "persist_results",
              status: "running",
              detail: "Persisting final exchange and workspace updates.",
              progress: 86,
            });
          }

          const userContent = lastUserMessage.parts
            .filter((p): p is Extract<typeof p, { type: "text" }> => p.type === "text")
            .map((p) => p.text)
            .join("\n")
            .trim();
          const attachmentSummary =
            latestAttachments.length > 0
              ? `Uploaded: ${latestAttachments
                  .map((attachment) => sanitizeAttachmentName(attachment.name))
                  .join(", ")}`
              : "";
          const combinedUserContent = [userContent, attachmentSummary]
            .filter(Boolean)
            .join("\n\n");

          await saveConversationExchange({
            conversationId,
            workspaceId,
            userContent: combinedUserContent,
            assistantContent: text ?? "",
            preferredTitle: deriveConversationTitle(
              userContent || attachmentSummary || "Untitled chat"
            ),
          });
          if (taskId) {
            await updateWorkspaceTaskStep({
              taskId,
              stepKey: "persist_results",
              status: "completed",
              detail: "Conversation and workspace state saved successfully.",
              progress: 100,
            });
            const taskSummary =
              summarizeTaskResult(text ?? "");
            await addWorkspaceTaskCheckpoint(taskId, {
              label: "Chat task completed",
              summary: taskSummary || "Chat task completed and workspace state was saved.",
              completedStep: "Persisted the answer and workspace state.",
              nextStep: "Review the result, then continue with the next approved step.",
              metadata: {
                intent: plannerOutput.intent,
                reasoningRoute: plannerOutput.reasoningRoute,
                responseChars: (text ?? "").length,
              },
            });
            await completeWorkspaceTask(taskId, taskSummary);
            activeTaskId = null;
          }
          await recordWorkspaceEvent({
            sessionId,
            workspaceId,
            conversationId,
            eventType: "chat.request",
            status: "success",
            details: {
              responseChars: (text ?? "").length,
            },
          });
        })();

        finishPersistence.catch((error) => {
          logError("api.chat.onFinish.persistence", error);
          if (activeTaskId) {
            const errMsg =
              error instanceof Error
                ? error.message
                : "Chat finalization failed after the response was generated.";
            failWorkspaceTask(activeTaskId, errMsg).catch(() => {});
            activeTaskId = null;
          }
        });

        await withChatFinishTimeout(
          finishPersistence,
          "chat finish persistence and task completion"
        );
      },
      onError: ({ error }) => {
        // Mid-stream errors cannot change the HTTP status (headers already sent
        // as 200).  Log them so they appear in server logs / monitoring and the
        // task failure path below can surface a retry prompt in the UI.
        logError("api.chat.streamText.onError", error);
        if (activeTaskId) {
          const errMsg =
            error instanceof Error
              ? error.message
              : "Streaming error after headers sent.";
          addWorkspaceTaskCheckpoint(activeTaskId, {
            label: "Chat task interrupted",
            summary: "The chat stream hit an error before the task could finish cleanly.",
            completedStep: "The request was captured before the interruption.",
            nextStep: "Resume the task from the Tasks drawer after checking the error.",
            blocker: errMsg,
          }).catch(() => {});
          failWorkspaceTask(activeTaskId, errMsg).catch(() => {});
          activeTaskId = null;
        }
      },
    });

    return result.toDataStreamResponse();
  } catch (error) {
    if (requestSessionId) {
      await recordWorkspaceEvent({
        sessionId: requestSessionId,
        workspaceId: requestWorkspaceId,
        conversationId: requestConversationId,
        eventType: "chat.request",
        status: "failure",
        details: {
          message:
            error instanceof Error
              ? error.message.length > MAX_EVENT_ERROR_MESSAGE_LENGTH
                ? `${error.message.slice(0, MAX_EVENT_ERROR_MESSAGE_LENGTH)}...`
                : error.message
              : "Unknown chat failure",
        },
      });
    }

    if (error instanceof Error && error.message.includes("access denied")) {
      return new Response(
        JSON.stringify({ error: "Workspace or conversation access denied." }),
        {
          status: 403,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    logError("api.chat.POST", error);
    if (activeTaskId) {
      await failWorkspaceTask(
        activeTaskId,
        error instanceof Error
          ? error.message
          : "Task failed while processing the request."
      );
    }
    return new Response(
      JSON.stringify({ error: "Something went wrong processing your request." }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}
