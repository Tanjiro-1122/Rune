import { loadEnabledSkills } from "@/lib/skills";
import { streamText, UIMessage, convertToCoreMessages, tool } from "ai";
import { openai } from "@ai-sdk/openai";
import { proposeAction, approveProposal, listHandsProposals } from "@/lib/hands";
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
import { getOwnerMemorySection } from "@/lib/owner-memory";
import { resolveOwnerSessionId } from "@/lib/owner-session";
import { buildSupabaseMemorySection, buildMemoryContext, saveSemanticMemory } from "@/lib/memory";
import { sendEmail } from "@/lib/email";
import { createReminder, listReminders, cancelReminder } from "@/lib/reminders";
import { cleanupStaleTasks } from "@/lib/task-tracker";
import { auditRuneSessionFragments, planRuneSessionFragmentMerge, executeRuneSessionFragmentMerge } from "@/lib/session-fragment-audit";
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
  RUNE_DEFAULT_REPO,
  buildProjectRegistryPromptSection,
  buildProjectResolutionPromptSection,
  inferProjectFromText,
  resolveCanonicalRepo,
  resolveProjectContext,
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
import { runAppCreatorPipeline } from "@/lib/app-creator-pipeline";

export const maxDuration = 60; // model: gpt-4.1 | last-patched: 2026-05-20 //5-19T16:59Z // Multi-step agent execution requires up to 60 s; needs Vercel Pro or higher.
const MAX_SESSION_ID_LENGTH = 128;
const CHAT_RATE_WINDOW_MS = 60_000;
const MAX_TRACKED_CHAT_SESSIONS = 2_000;
const MAX_EVENT_ERROR_MESSAGE_LENGTH = 280;
const CHAT_FINISH_PERSISTENCE_TIMEOUT_MS = 12_000; // Pro plan allows longer onFinish

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
  const raw = process.env.RUNE_CHAT_MAX_REQUESTS_PER_MINUTE;
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
  return process.env.GITHUB_TOKEN || process.env.RUNE_GITHUB_TOKEN;
}

function getOctokitClient() {
  const githubToken = getGithubToken();
  return new Octokit({
    ...(githubToken ? { auth: githubToken } : {}),
    userAgent: "Rune-Super-Agent/1.0 (+https://github.com/Tanjiro-1122/Rune)",
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
    "User-Agent": "Rune-Super-Agent/1.0",
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

function buildCodeSnippet(content: string, query: string, contextLines = 8) {
  const lines = content.split(/\r?\n/);
  const terms = query
    .split(/\s+/)
    .map((term) => term.replace(/[^a-zA-Z0-9_.$-]/g, ""))
    .filter((term) => term.length >= 2)
    .slice(0, 10);

  if (terms.length === 0) {
    // No usable terms — return file header
    return lines.slice(0, Math.min(15, lines.length))
      .map((line, i) => `${i + 1}: ${line}`)
      .join("\n");
  }

  // Score each line: count how many distinct terms it contains
  const scored = lines.map((line, idx) => {
    const lower = line.toLowerCase();
    const hits = terms.filter((term) => lower.includes(term.toLowerCase())).length;
    return { idx, hits };
  }).filter((r) => r.hits > 0);

  if (scored.length === 0) {
    // No matches at all — return file header and note
    const header = lines.slice(0, Math.min(12, lines.length))
      .map((line, i) => `${i + 1}: ${line}`)
      .join("\n");
    return `(no exact match for query terms — showing file header)\n${header}`;
  }

  // Sort by score descending to find best match windows
  scored.sort((a, b) => b.hits - a.hits || a.idx - b.idx);

  // Collect up to 3 non-overlapping snippet windows, best match first
  const windows: Array<{ start: number; end: number }> = [];
  for (const { idx } of scored) {
    const start = Math.max(idx - contextLines, 0);
    const end = Math.min(idx + contextLines + 1, lines.length);
    const overlaps = windows.some((w) => start <= w.end && end >= w.start);
    if (!overlaps) {
      windows.push({ start, end });
    }
    if (windows.length >= 3) break;
  }

  // Sort windows by file position for readable output
  windows.sort((a, b) => a.start - b.start);

  const parts = windows.map(({ start, end }) =>
    lines.slice(start, end)
      .map((line, offset) => `${start + offset + 1}: ${line}`)
      .join("\n")
  );

  return parts.join("\n…\n");
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
  const mentionsRepoSurface = /\b(github|repo|repository|rune|source file|codebase|sendMessage|useChat|AbortController|streaming|Task running|pendingTasks|runningTasks|taskComplete|streamComplete)\b/i.test(trimmed);
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

const RUNE_SESSION_MERGE_APPROVAL_PHRASE = "APPROVE RUNE SESSION MERGE";

function isApprovedRuneSessionMergeIntent(input: string) {
  return input.includes(RUNE_SESSION_MERGE_APPROVAL_PHRASE);
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
        | "get_rune_capability_snapshot"
        | "get_rune_self_audit_snapshot"
        | "get_tool_lifecycle_diagnostic"
        | "execute_rune_session_merge";
    }
  | null {
  if (isApprovedRuneSessionMergeIntent(input)) {
    return { type: "tool", toolName: "execute_rune_session_merge" };
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
  // calculate, datetime, and github_analysis are NOT forced here.
  // Forcing a tool applies to EVERY step including the post-tool synthesis step,
  // which prevents the model from generating a text answer after the tool result.
  // The system prompt routing hints guide the model to call these naturally on step 1.
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

  if (isApprovedRuneSessionMergeIntent(input)) {
    hints.push("- Strong routing signal: exact Rune session merge approval phrase detected, so call `execute_rune_session_merge` with that exact approval phrase. Do not call capability snapshot first.");
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
  } else if (/\b(health snapshot|health check|app health|overall health|check apps|sports wager helper|swh)\b/i.test(input)) {
    hints.push("- Strong routing signal: this is an app-health request. Call `get_app_health_snapshot` before answering. If Javier asks across Unfiltr, Sports Wager Helper/SWH, and Rune, summarize each app from available tool output and clearly label any missing external checks as not verified. Do not say 'I will fetch' or 'next I will check' after tool use; finish the answer with what actually ran and what remains unverified.");
  } else if (isWebSearchIntent(input)) {
    hints.push("- Strong routing signal: this request needs fresh/current information, so prefer `web_search`.");
  }

  if (!hints.length) {
    hints.push("- Use the best matching tool whenever one is clearly applicable; do not default to prose-only capability disclaimers.");
  }

  return hints.join("\n");
}

const optionalNonEmptyString = (max: number) =>
  z.preprocess(
    (value) => {
      if (typeof value !== "string") return value;
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : undefined;
    },
    z.string().min(1).max(max).optional()
  );

function selectToolsForRequest(input: string, tools: Record<string, any>): Record<string, any> {
  const selected = new Set<string>();
  const text = input.toLowerCase();
  const hasAny = (terms: string[]) => terms.some((term) => text.includes(term));
  const add = (name: string) => {
    if (tools[name]) selected.add(name);
  };

  // Tiny always-on core. Keep this lean: every tool schema costs prompt tokens.
  add("calculate");

  if (hasAny(["what can you do", "capabilit", "what are you able", "what tools", "what setup"])) {
    add("get_rune_capability_snapshot");
  }

  if (isApprovedRuneSessionMergeIntent(input)) {
    add("execute_rune_session_merge");
    add("audit_rune_session_fragments");
    add("plan_rune_fragmented_session_merge");
  }

  if (isFrozenDiagnosticIntent(input)) {
    add("get_tool_lifecycle_diagnostic");
  }

  if (isCalculationIntent(input)) {
    add("calculate");
  }

  // Current date/time is injected into the prompt. Only expose the tool when explicitly requested.
  if (hasAny(["run datetime", "use datetime", "call datetime", "get_current_datetime", "datetime tool"])) {
    add("get_current_datetime");
  }

  const repoOrCommitIntent = hasAny(["commit", "commits", "github", "repo", "repository", "pull request", " pr", "branch", "release", "deploy"]);
  const knownProjectRepoIntent = repoOrCommitIntent && hasAny(["unfiltr", "rune", "jarvis", "swh", "sportswager", "sports wager", "family"]);
  const commitHistoryIntent =
    text.includes("commit") && hasAny(["recent", "latest", "last", "new", "history"]);

  if (knownProjectRepoIntent && commitHistoryIntent) {
    add("list_recent_github_commits");
  }

  // Known project commit-history requests should use the commit API only.
  // Do not attach code-search here; models sometimes call it with an empty query.
  if (knownProjectRepoIntent && !commitHistoryIntent) {
    add("analyze_github_repo");
    add("searchRepositoryCode");
  } else if (!knownProjectRepoIntent && isWebSearchIntent(input)) {
    add("web_search");
  }

  if (isGitHubSourceInspectionIntent(input)) {
    add("searchRepositoryCode");
    add("readRepositoryFile");
    add("listRepositoryTree");
  } else if (isGitHubAnalysisIntent(input)) {
    add("analyze_github_repo");
    add("searchRepositoryCode");
  }

  if (isCodeExecutionIntent(input, getCodeExecutionAvailability().available)) {
    add("execute_code");
    add("searchRepositoryCode");
    add("readRepositoryFile");
    add("listRepositoryTree");
  }

  if (hasAny(["health check", "health snapshot", "app health", "release health", "store health", "build health", "overall health", "check apps", "check swh", "sports wager helper"])) {
    add("get_app_health_snapshot");
    add("get_app_intelligence");
    add("analyze_github_repo");
  }

  if (hasAny(["operator briefing", "self audit", "audit yourself", "system health"])) {
    add("get_rune_self_audit_snapshot");
  }

  if (hasAny(["revenuecat", "subscriber", "subscription", "customer info", "app store connect", "testflight", "google play"])) {
    add("lookup_revenuecat_subscriber");
    add("lookup_app_store_connect_status");
    add("lookup_google_play_status");
  }

  // Skill-store/dynamic tools are opt-in by name/intent only. Do not dump them globally.
  for (const name of Object.keys(tools)) {
    if (selected.has(name)) continue;
    const normalizedName = name.replace(/[_-]+/g, " ").toLowerCase();
    if (normalizedName.length >= 4 && text.includes(normalizedName)) {
      selected.add(name);
    }
  }

  const subset: Record<string, any> = {};
  for (const name of selected) subset[name] = tools[name];
  return subset;
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
 * When RUNE_ALLOWED_IMAGE_HOSTS is set (comma-separated hostnames) only those
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

  const allowedHostsEnv = process.env.RUNE_ALLOWED_IMAGE_HOSTS;
  if (allowedHostsEnv) {
    const allowedHosts = new Set(
      allowedHostsEnv.split(",").map((h) => h.trim()).filter(Boolean)
    );
    return allowedHosts.has(parsed.hostname);
  }

  // No allowlist configured — permit any HTTPS URL.
  // Set RUNE_ALLOWED_IMAGE_HOSTS to restrict to trusted hosts in production.
  return true;
}

const baseAgentTools = {
  get_rune_capability_snapshot: tool({
    description:
      "Return a safe, non-secret truth snapshot of Rune capabilities, configuration readiness, missing setup, not-connected integrations, canonical projects, and approval rules. Use this before answering capability, setup, self-assessment, or owner-console planning questions.",
    parameters: z.object({}),
    execute: async () => getCapabilityTruthSnapshot(),
  }),


  get_tool_lifecycle_diagnostic: tool({
    description:
      "Run a fast, no-network diagnostic for Rune freeze/stuck/question-mark delayed-answer symptoms. Use this instead of full self-audit when Javier reports that Rune froze, got stuck, or only answered after sending a question mark.",
    parameters: z.object({
      symptom: z.string().max(240).optional().default("freeze/stuck/question-mark delayed answer"),
    }),
    execute: async ({ symptom }) => getToolLifecycleDiagnostic(symptom),
  }),

  get_rune_self_audit_snapshot: tool({
    description:
      "Run Rune Self-Audit Mode. Returns a structured, non-secret report covering identity, project map, capability truth, deploy/config health, codebase signals, safety gates, not-connected integrations, and the recommended next patch. Use this for explicit self-audits, system health checks, and 'are you ready' questions. Do not use for freeze/stuck/question-mark delayed-answer symptoms; use get_tool_lifecycle_diagnostic instead.",
    parameters: z.object({
      scope: z.enum(["rune-brain", "full-owner-console"]).optional().default("rune-brain"),
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
      appId: z.string().min(1).max(64).optional().describe("Optional App Store Connect app ID override. Omit to use the configured Rune app ID."),
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
      packageName: z.string().min(1).max(220).optional().describe("Optional Android package name override. Omit to use the configured Rune package name."),
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
      "Generate a one-command read-only app health snapshot. Use when Javier asks to check app health, health snapshot, Unfiltr health, Sports Wager Helper/SWH health, Rune health, release health, store health, build health, overall readiness, or diagnosed health problems. This combines GitHub/Vercel readiness with RevenueCat optional subscriber lookup, App Store Connect, and Google Play. It returns actionable remediation recommendations when known issues are detected, but this base tool never commits, deploys, releases, publishes, edits products, replies to reviews, changes entitlements, refunds, or mutates external systems.",
    parameters: z.object({
      projectKey: z.string().min(1).max(64).optional().default("unfiltr"),
      repo: optionalNonEmptyString(180).describe("Optional canonical GitHub repo slug override, e.g. Tanjiro-1122/UniltrbyJavierbackup."),
      revenueCatAppUserId: optionalNonEmptyString(180).describe("Optional RevenueCat app user ID to include subscriber health. Omit for general app health."),
      appStoreAppId: optionalNonEmptyString(64).describe("Optional App Store Connect app ID override."),
      googlePlayPackageName: optionalNonEmptyString(220).describe("Optional Google Play package name override. Omit for iOS-only projects like Unfiltr."),
    }),
    execute: async ({ projectKey, repo, revenueCatAppUserId, appStoreAppId, googlePlayPackageName }) => {
      const clean = (value: string | undefined) => {
        const trimmed = typeof value === "string" ? value.trim() : "";
        return trimmed.length > 0 ? trimmed : undefined;
      };
      const snapshot = await getAppHealthSnapshot({
        projectKey: clean(projectKey) ?? "unfiltr",
        repo: clean(repo),
        revenueCatAppUserId: clean(revenueCatAppUserId),
        appStoreAppId: clean(appStoreAppId),
        googlePlayPackageName: clean(googlePlayPackageName),
      });
      return {
        success: snapshot.status !== "blocked",
        ...snapshot,
        remediationTasks: [],
        message: snapshot.actionRecommendations?.length
          ? "App health snapshot completed and found actionable remediation recommendations. In a workspace chat, Rune should create visible Operator Mode tasks for them."
          : "App health snapshot completed. No known auto-remediation task was needed.",
      };
    },
  }),

  audit_rune_session_fragments: tool({
    description:
      "Run a strict read-only audit of Rune workspace/session fragmentation after the unified owner-session fix. Returns only session IDs, counts, timestamps, and workspace names. It never reads message content and never inserts, updates, deletes, merges, or mutates schema.",
    parameters: z.object({}),
    execute: async () => auditRuneSessionFragments(),
  }),


  plan_rune_fragmented_session_merge: tool({
    description:
      "Prepare a planner-only dry run for consolidating old Rune browser-local session fragments into owner:javier. Returns proposed counts, source session IDs, approval phrase, and safety boundaries. It never reads message content and never inserts, updates, deletes, upserts, merges, calls RPC, mutates schema, or executes the merge.",
    parameters: z.object({}),
    execute: async () => planRuneSessionFragmentMerge(),
  }),


  execute_rune_session_merge: tool({
    description:
      "Execute the approved Rune session metadata merge only when Javier provides the exact approval phrase. This updates ownership metadata for old browser-local conversations/workspaces/events to owner:javier. It never reads message content, never updates message rows, never deletes rows, never mutates schema, and never runs without the exact phrase APPROVE RUNE SESSION MERGE.",
    parameters: z.object({
      approvalPhrase: z.string().min(1).max(80).describe("Must exactly equal APPROVE RUNE SESSION MERGE."),
    }),
    execute: async ({ approvalPhrase }) => executeRuneSessionFragmentMerge(approvalPhrase),
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
      "[INTERNAL ONLY — never call unless user explicitly requests a plan] Use sparingly. Internal task tracking for multi-step multi-step or complex requests so the user can see the roadmap.",
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

  list_recent_github_commits: tool({
    description:
      "List recent commits from a real GitHub repository. Use this when Javier asks for latest/recent commits, commit history, or what changed recently in Rune, Unfiltr, SWH, or Unfiltr Family.",
    parameters: z.object({
      repo: z
        .string()
        .optional()
        .default(RUNE_DEFAULT_REPO)
        .describe("GitHub repository as 'owner/repo', a GitHub URL, or a known project alias like Rune/Unfiltr/SWH/Family."),
      branch: z.string().min(1).max(120).optional().describe("Optional branch name. If omitted, GitHub uses the default branch."),
      per_page: z.number().int().min(1).max(10).optional().default(5),
    }),
    execute: async ({ repo, branch, per_page = 5 }) => {
      const ownerRepo = parseOwnerRepo(repo);
      if (!ownerRepo.includes("/")) {
        return { success: false, error: "Could not parse repository.", repo };
      }

      const params = new URLSearchParams();
      params.set("per_page", String(Math.min(Math.max(per_page, 1), 10)));
      if (branch && branch.trim()) params.set("sha", branch.trim());

      const headers = getGithubHeaders();
      try {
        const response = await fetch(`https://api.github.com/repos/${ownerRepo}/commits?${params.toString()}`, { headers });
        if (!response.ok) {
          return {
            success: false,
            repo: ownerRepo,
            status: response.status,
            error: response.status === 404
              ? `Repository '${ownerRepo}' not found or not accessible.`
              : `GitHub API returned ${response.status}: ${response.statusText}`,
          };
        }

        const raw = await response.json();
        const commits = Array.isArray(raw)
          ? raw.slice(0, Math.min(Math.max(per_page, 1), 10)).map((item) => {
              const record = item as Record<string, any>;
              const commit = record.commit as Record<string, any> | undefined;
              const author = commit?.author as Record<string, any> | undefined;
              return {
                sha: typeof record.sha === "string" ? record.sha.slice(0, 7) : null,
                message: typeof commit?.message === "string" ? commit.message.split("\n")[0] : null,
                author: typeof author?.name === "string" ? author.name : null,
                date: typeof author?.date === "string" ? author.date : null,
                url: typeof record.html_url === "string" ? record.html_url : null,
              };
            })
          : [];

        return {
          success: true,
          repo: ownerRepo,
          branch: branch || "default",
          count: commits.length,
          commits,
        };
      } catch (error) {
        return {
          success: false,
          repo: ownerRepo,
          error: error instanceof Error ? error.message : "Failed to list recent commits.",
        };
      }
    },
  }),

  analyze_github_repo: tool({
    description:
      "Analyze a GitHub repository. If the user asks about Rune, your own repo, this app, your source code, or does not provide a repo, default to Tanjiro-1122/Rune. Use the canonical project registry instead of guessing owner/repo names.",
    parameters: z.object({
      repo: z
        .string()
        .optional()
        .default(RUNE_DEFAULT_REPO)
        .describe(
          "GitHub repository as 'owner/repo', a full URL, a known project alias like 'Rune'/'Unfiltr'/'SWH'/'Unfiltr Family', or omitted to inspect Rune itself"
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
                "GitHub API rate limit reached. Set GITHUB_TOKEN or RUNE_GITHUB_TOKEN for a higher rate limit and private repo access.",
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
      "Read the complete code contents of a specific file in the GitHub repository before making edits. For Rune itself, use owner 'Tanjiro-1122' and repo 'Rune'. Never guess javierhuertas/rune.",
    parameters: z.object({
      owner: z.string().describe("The GitHub username. For Rune itself, use 'Tanjiro-1122'."),
      repo: z.string().describe("The repository name. For Rune itself, use 'Rune'."),
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
      "List the complete file structure and folder layout of the GitHub repository. For Rune itself, use owner 'Tanjiro-1122' and repo 'Rune'. Never guess javierhuertas/rune.",
    parameters: z.object({
      owner: z.string().describe("The GitHub username. For Rune itself, use 'Tanjiro-1122'."),
      repo: z.string().describe("The repository name. For Rune itself, use 'Rune'."),
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
      owner: z.string().optional().default("Tanjiro-1122").describe("The GitHub username. For Rune itself, use 'Tanjiro-1122'."),
      repo: z.string().optional().default("Rune").describe("The repository name. For Rune itself, use 'Rune'."),
      query: z.string().trim().max(200).optional().default("").describe("Code search query, such as 'useChat status streaming' or 'sendMessage'. Leave empty only if no concrete query is available."),
      path_filter: z.string().max(160).optional().describe("Optional repo path filter, such as 'app/api' or 'components'. Must be a real path prefix, not a placeholder."),
      max_results: z.number().int().min(1).max(10).optional().default(8),
    }),
    execute: async ({ owner = "Tanjiro-1122", repo = "Rune", query = "", path_filter, max_results = 8 }) => {
      try {
        const cleanQuery = typeof query === "string" ? query.trim() : "";
        if (!cleanQuery) {
          return {
            success: false,
            error: "No concrete code search query was provided. For recent commits, use list_recent_github_commits instead.",
            owner,
            repo,
          };
        }
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
              ? "Code search for private repos requires RUNE_GITHUB_TOKEN/GITHUB_TOKEN with repo read access in the deployment environment."
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

    get_app_health_snapshot: tool({
      description:
        "Generate an app health snapshot and create visible Operator Mode remediation tasks when known safe fixes are available. Use when Javier asks to check health or says to fix a diagnosed health problem. External account mutations still require approval.",
      parameters: z.object({
        projectKey: z.string().min(1).max(64).optional().default("unfiltr"),
        repo: optionalNonEmptyString(180).describe("Optional canonical GitHub repo slug override, e.g. Tanjiro-1122/UniltrbyJavierbackup."),
        revenueCatAppUserId: optionalNonEmptyString(180).describe("Optional RevenueCat app user ID to include subscriber health. Omit for general app health."),
        appStoreAppId: optionalNonEmptyString(64).describe("Optional App Store Connect app ID override."),
        googlePlayPackageName: optionalNonEmptyString(220).describe("Optional Google Play package name override. Omit for iOS-only projects like Unfiltr."),
        createRemediationTask: z.boolean().optional().default(true).describe("Create a visible Operator Mode task for known remediation actions."),
      }),
      execute: async ({ projectKey, repo, revenueCatAppUserId, appStoreAppId, googlePlayPackageName, createRemediationTask }) => {
        const clean = (value: string | undefined) => {
          const trimmed = typeof value === "string" ? value.trim() : "";
          return trimmed.length > 0 ? trimmed : undefined;
        };
        const snapshot = await getAppHealthSnapshot({
          projectKey: clean(projectKey) ?? "unfiltr",
          repo: clean(repo),
          revenueCatAppUserId: clean(revenueCatAppUserId),
          appStoreAppId: clean(appStoreAppId),
          googlePlayPackageName: clean(googlePlayPackageName),
        });

        const remediationTasks: Array<{ actionId: string; taskId: string | null; title: string; approvalRequired: boolean }> = [];
        if (createRemediationTask !== false && workspaceId && snapshot.actionRecommendations?.length) {
          for (const action of snapshot.actionRecommendations.slice(0, 3)) {
            const stepLabels = [
              ...(action.targetFiles?.length ? [`Inspect ${action.targetFiles.join(", ")}`] : []),
              ...(action.probableFix ?? []),
              ...(action.verification ?? []),
            ].slice(0, 8);
            const taskId = await createWorkspaceTask({
              workspaceId,
              conversationId: conversationId ?? null,
              title: `Operator remediation: ${action.title}`,
              inputText: `${action.reason}

Action: ${action.id}`,
              intent: action.type,
              steps: stepLabels.map((label, index) => ({
                key: `${action.id}-${index + 1}`.slice(0, 80),
                label,
                detail: index === 0
                  ? action.approvalRequired
                    ? "External or sensitive remediation requires Javier approval before execution."
                    : "Safe internal remediation can proceed through Rune's repo workflow."
                  : null,
              })),
            });
            remediationTasks.push({
              actionId: action.id,
              taskId,
              title: action.title,
              approvalRequired: action.approvalRequired,
            });
          }
        }

        return {
          success: snapshot.status !== "blocked",
          ...snapshot,
          remediationTasks,
          message: remediationTasks.length > 0
            ? "App health snapshot completed and Operator Mode created visible remediation task(s). External account changes still require approval."
            : "App health snapshot completed. No known auto-remediation task was needed.",
        };
      },
    }),

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


    build_app: tool({
      description:
        "Unified App Creator pipeline — takes a natural-language idea and drives it through " +
        "plan → scaffold → PR → deploy in clear stages. " +
        "stage='plan': generate a full app blueprint (safe, no files written). " +
        "stage='scaffold': generate starter files and open a GitHub PR (requires proposalId from plan). " +
        "stage='deploy': merge and deploy (requires proposalId + approvalToken). " +
        "stage='status': check current pipeline status for a proposalId. " +
        "Use this as the PRIMARY tool when Javier says 'build me X', 'create an app', or 'make a new app'. " +
        "Always start with stage='plan' unless Javier already has a proposalId.",
      parameters: z.object({
        idea: z.string().min(1).max(1600).optional(),
        appName: z.string().max(80).optional(),
        targetUsers: z.string().max(180).optional(),
        platform: z.enum(["web", "mobile", "both"]).optional(),
        complexity: z.enum(["simple", "standard", "advanced"]).optional(),
        mustHaveFeatures: z.array(z.string().min(1).max(140)).max(8).optional(),
        stage: z.enum(["plan", "scaffold", "deploy", "status"]).optional(),
        proposalId: z.string().optional(),
        approvalToken: z.string().optional(),
      }),
      execute: async ({ idea, appName, targetUsers, platform, complexity, mustHaveFeatures, stage, proposalId, approvalToken }) => {
        return runAppCreatorPipeline({
          idea: idea ?? "",
          appName: appName ?? null,
          targetUsers: targetUsers ?? null,
          platform: platform ?? "web",
          complexity: complexity ?? "standard",
          mustHaveFeatures,
          stage: stage ?? "plan",
          proposalId: proposalId ?? null,
          approvalToken: approvalToken ?? null,
          workspaceId: workspaceId ?? null,
          conversationId: conversationId ?? null,
        });
      },
    }),

    create_app_proposal: tool({
      description:
        "Create a controlled App Creator v1 blueprint and Repo Control proposal for a brand-new app. This proves Rune can create apps through approval-gated workflow, but does not edit files, create schemas, deploy, or open a PR by itself.",
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
          projectKey: "rune",
          repo: "Tanjiro-1122/Rune",
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

    proposeHandsAction: tool({
      description:
        "Propose a sensitive action (code change, deploy, PR, merge, schema change, " +
        "customer message, financial action). ALWAYS call this before executing any " +
        "sensitive action. Returns a proposal with a gate phrase Javier must send to approve.",
      parameters: z.object({
        actionType: z.enum(["code_change","deploy","pr_open","pr_merge","branch_create","schema_change","customer_message","grant_credits","financial","revoke_access","other_sensitive"]),
        title: z.string(),
        findings: z.string(),
        plan: z.string(),
        riskLevel: z.enum(["low","medium","high"]).optional(),
        projectKey: z.string().optional(),
        rollbackNote: z.string().optional(),
      }),
      execute: async ({ actionType, title, findings, plan, riskLevel, projectKey, rollbackNote }) => {
        const result = await proposeAction({ actionType, title, findings, plan, riskLevel, projectKey, rollbackNote, sessionId: null, workspaceId: null, conversationId: null });
        if (!result.ok) return { error: result.error };
        return { proposalId: result.proposal!.id, gatePhrase: result.proposal!.gate_phrase, status: "proposed" };
      },
    }),

    approveHandsAction: tool({
      description: "Approve a Hands proposal after Javier sends the gate phrase.",
      parameters: z.object({ proposalId: z.string() }),
      execute: async ({ proposalId }) => {
        const result = await approveProposal(proposalId);
        if (!result.ok) return { error: result.error };
        return { proposalId, status: "approved", title: result.proposal!.title };
      },
    }),

    listHandsProposalsAction: tool({
      description: "List recent Hands proposals and their status.",
      parameters: z.object({ limit: z.number().optional() }),
      execute: async ({ limit }) => {
        const proposals = await listHandsProposals(limit ?? 10);
        return proposals.map((p) => ({ id: p.id, title: p.title, status: p.status, gatePhrase: p.gate_phrase, resultSummary: p.result_summary }));
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
        "Run a short, self-contained JavaScript or TypeScript snippet inside Rune's sandbox. Use for small coding checks, evaluating generated code, quick data transforms, algorithm verification, and generating downloadable text artifacts (CSV, JSON, SVG, HTML, Markdown). The snippet must be self-contained, must not use imports or external modules, and should use `return` to surface a final value. Console output and artifacts are returned to the chat UI.",
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

    save_memory: tool({
      description:
        "Save or update a memory to Rune's Supabase long-term memory store. Use this when Javier shares a decision, preference, project fact, rule, or any context worth remembering across sessions. Always save proactively — do not wait to be asked.",
      parameters: z.object({
        title: z.string().describe("Short unique title for this memory (max 180 chars)."),
        content: z.string().describe("Full memory content to store."),
        kind: z
          .enum(["identity", "owner", "project", "rule", "workflow", "decision", "safety", "note"])
          .optional()
          .default("note")
          .describe("Memory kind. Use 'decision' for choices made, 'rule' for standing instructions, 'project' for project facts, 'owner' for Javier preferences."),
        project_key: z
          .string()
          .optional()
          .default("global")
          .describe("Project scope: 'global', 'rune', 'unfiltr', 'swh', 'unfiltr-family', or other project key."),
        tags: z
          .array(z.string())
          .optional()
          .default([])
          .describe("Optional tags to help retrieval."),
        priority: z
          .number()
          .min(1)
          .max(10)
          .optional()
          .default(5)
          .describe("Priority 1-10. Use 9-10 for critical rules/safety, 7-8 for key project facts, 5-6 for general notes."),
      }),
      execute: async ({ title, content, kind, project_key, tags, priority }) => {
        const { upsertMemory } = await import("@/lib/memory");
        // Fire-and-forget — never block the stream waiting for Supabase
        void upsertMemory({ title, content, kind, project_key, tags, priority, source: "rune-chat" })
          .catch((e) => logError("save_memory.upsert", e));
        return { saved: true, title, project_key, kind, priority };
      },
    }),

    list_memories: tool({
      description:
        "List active memories from Rune's Supabase long-term memory store. Use this when Javier asks what Rune remembers, wants to inspect memory, or when you need to check existing memories before saving a new one.",
      parameters: z.object({
        query: z.string().optional().describe("Optional search query to filter relevant memories."),
        project_key: z.string().optional().describe("Filter by project: 'global', 'rune', 'unfiltr', 'swh', etc."),
      }),
      execute: async ({ query, project_key }) => {
        const { listActiveMemories } = await import("@/lib/memory");
        const memories = await listActiveMemories({ query, projectKey: project_key, limit: 30 });
        return {
          count: memories.length,
          memories: memories.map((m) => ({
            title: m.title,
            kind: m.kind,
            project_key: m.project_key,
            priority: m.priority,
            content: m.content.slice(0, 300),
            updated_at: m.updated_at,
          })),
        };
      },
    }),

    forget_memory: tool({
      description:
        "Deactivate (soft-delete) a memory from Rune's Supabase long-term memory store by title. Use when Javier says to forget something, a fact is outdated, or a rule no longer applies. This does not permanently delete — it sets is_active to false.",
      parameters: z.object({
        title: z.string().describe("Exact title of the memory to deactivate."),
        project_key: z.string().optional().default("global").describe("Project scope of the memory."),
      }),
      execute: async ({ title, project_key }) => {
        const { getSupabaseClient } = await import("@/lib/supabase");
        const supabase = getSupabaseClient();
        if (!supabase) return { ok: false, error: "Supabase not configured." };
        const { error } = await supabase
          .from("agent_memories")
          .update({ is_active: false, updated_at: new Date().toISOString() })
          .eq("title", title)
          .eq("project_key", project_key ?? "global");
        if (error) return { ok: false, error: error.message };
        return { ok: true, forgotten: title };
      },
    }),

    run_lifecycle: tool({
      description:
        "Execute the full Rune PR lifecycle: branch → commit files → open PR → self-check → merge → redeploy → verify. " +
        "Use this when Javier says APPROVE RUNE: <task> or asks Rune to ship a change end-to-end. " +
        "Never call this without an explicit approval phrase from Javier.",
      parameters: z.object({
        taskSlug: z.string().describe("Short kebab-case slug, e.g. 'add-dark-mode'"),
        title: z.string().describe("PR title"),
        body: z.string().describe("PR description / what changed and why"),
        commitMessage: z.string().describe("Git commit message"),
        files: z.array(
          z.object({
            path: z.string().describe("File path relative to repo root"),
            content: z.string().describe("Full file content"),
          })
        ).describe("Files to create or update in this PR"),
      }),
      execute: async ({ taskSlug, title, body, commitMessage, files }) => {
        const { runLifecycle } = await import("@/lib/rune-lifecycle");
        const result = await runLifecycle({ taskSlug, title, body, commitMessage, files });
        return result;
      },
    }),


    get_app_intelligence: tool({
      description:
        "Get a live cross-app intelligence report covering Unfiltr and Sports Wager Helper. " +
        "Returns DAU/MAU, retention, free-to-pro conversion, revenue, mood trends, bet win rates, ROI, and cross-app patterns. " +
        "Use when Javier asks about users, revenue, engagement, analytics, retention, or how the apps are doing. " +
        "Pass force=true to bypass the 6-hour cache.",
      parameters: z.object({
        force: z.boolean().optional().describe("Set true to force fresh data, bypassing the 6-hour cache."),
      }),
      execute: async ({ force }) => {
        const { getCrossAppIntelligence } = await import("@/lib/cross-app-intelligence");
        return getCrossAppIntelligence(force ?? false);
      },
    }),

    rollback_rune: tool({
      description:
        "Immediately roll back Rune's production deployment to the previous build. " +
        "Use only when Javier says ROLLBACK RUNE or reports a broken production deploy.",
      parameters: z.object({
        confirm: z.boolean().describe("Must be true to proceed with rollback."),
      }),
      execute: async ({ confirm }) => {
        if (!confirm) return { ok: false, error: "Rollback not confirmed." };
        const { rollbackProduction } = await import("@/lib/rune-lifecycle");
        return rollbackProduction();
      },
    }),

    // ── save_semantic_memory ───────────────────────────────────────────────────
    save_semantic_memory: tool({
      description:
        "Save an important fact, decision, architectural choice, bug fix, or preference " +
        "to Rune's permanent semantic memory for future recall. Use this when Javier " +
        "confirms a decision, you fix a recurring issue, or something important should " +
        "be remembered across sessions. Categories: decision, bug_fix, architecture, " +
        "preference, project, general.",
      parameters: z.object({
        content: z.string().describe("The fact, decision, or memory to save"),
        category: z
          .enum(["decision", "bug_fix", "architecture", "preference", "project", "general"])
          .optional()
          .default("general"),
        project: z
          .enum(["rune", "unfiltr", "swh", "global"])
          .optional()
          .default("global"),
        importance: z
          .number()
          .min(0)
          .max(1)
          .optional()
          .default(0.7)
          .describe("0=trivial, 1=critical"),
        tags: z.array(z.string()).optional().default([]),
      }),
      execute: async ({ content, category = "general", project = "global", importance = 0.7, tags = [] }) => {
        const id = await saveSemanticMemory({ content, category, project, importance, tags });
        return id
          ? { saved: true, id, content: content.slice(0, 100) + (content.length > 100 ? "..." : "") }
          : { saved: false, error: "Memory save failed — check Supabase connection" };
      },
    }),


    // ── send_email ─────────────────────────────────────────────────────────────
    send_email: tool({
      description:
        "Send an email from Rune to any address. Use when Javier asks to send an email, " +
        "draft and send a message, or email himself a summary or reminder. " +
        "Queues through rune_outbox — delivers via Gmail (huertasfam@gmail.com).",
      parameters: z.object({
        to: z.string().describe("Recipient email address"),
        subject: z.string().describe("Email subject line"),
        body: z.string().describe("Plain text email body"),
        html: z.string().optional().describe("Optional HTML version of the email body"),
      }),
      execute: async ({ to, subject, body, html }) => {
        return await sendEmail({ to, subject, body, html });
      },
    }),

    // ── schedule_reminder ──────────────────────────────────────────────────────
    schedule_reminder: tool({
      description:
        "Schedule a reminder for Javier. Rune will send a push notification at the specified time. " +
        "Use when Javier says 'remind me to...', 'set a reminder for...', or 'alert me at...'. " +
        "Always convert times to America/New_York timezone. Supports daily and weekly repeats.",
      parameters: z.object({
        title: z.string().describe("Short reminder title, e.g. 'Review Unfiltr metrics'"),
        body: z.string().optional().describe("Optional longer detail message"),
        fire_at: z.string().describe("ISO 8601 datetime when to fire, e.g. '2026-05-20T09:00:00'"),
        repeat: z.enum(["daily", "weekly"]).optional().describe("Repeat cadence — omit for one-time"),
      }),
      execute: async ({ title, body, fire_at, repeat }) => {
        const result = await createReminder({ title, body, fire_at, repeat: repeat ?? null });
        if (result.error) return { scheduled: false, error: result.error };
        return {
          scheduled: true,
          id: result.id,
          title,
          fire_at,
          repeat: repeat ?? "one-time",
        };
      },
    }),

    // ── list_reminders ─────────────────────────────────────────────────────────
    list_reminders: tool({
      description:
        "List Javier's upcoming scheduled reminders. Use when asked 'what reminders do I have' " +
        "or 'show my scheduled alerts'.",
      parameters: z.object({
        status: z.enum(["pending", "sent", "cancelled"]).optional().default("pending"),
      }),
      execute: async ({ status = "pending" }) => {
        const reminders = await listReminders(status);
        return { reminders, count: reminders.length };
      },
    }),

    // ── cancel_reminder ────────────────────────────────────────────────────────
    cancel_reminder: tool({
      description: "Cancel a scheduled reminder by its ID. Use when Javier says 'cancel that reminder' or 'remove the alert'.",
      parameters: z.object({
        id: z.string().describe("The reminder ID to cancel"),
      }),
      execute: async ({ id }) => {
        const ok = await cancelReminder(id);
        return ok ? { cancelled: true, id } : { cancelled: false, error: "Reminder not found or already sent" };
      },
    }),

    // ── query_database ─────────────────────────────────────────────────────────
    query_database: tool({
      description:
        "Read or write data in any Supabase table Rune has access to. " +
        "Use for generic data operations — checking records, updating values, inserting rows. " +
        "For SELECT: provide table + optional filters. For INSERT/UPDATE/DELETE: provide operation + data. " +
        "Tables available: rune_tasks, rune_reminders, rune_outbox, agent_memories, rune_memory_vectors, " +
        "rune_workspaces, rune_conversations, rune_messages, rune_tasks, and any Unfiltr/SWH tables.",
      parameters: z.object({
        operation: z.enum(["select", "insert", "update", "delete"]).describe("SQL operation type"),
        table: z.string().describe("Table name, e.g. rune_tasks"),
        filters: z.record(z.string(), z.unknown()).optional().describe("Column=value filters for WHERE clause"),
        data: z.record(z.string(), z.unknown()).optional().describe("Data to insert or update"),
        limit: z.number().min(1).max(100).optional().default(20).describe("Max rows for SELECT"),
        order_by: z.string().optional().describe("Column to sort by, prefix with - for descending"),
        select_columns: z.string().optional().default("*").describe("Columns to select, e.g. 'id,title,status'"),
      }),
      execute: async ({ operation, table, filters, data, limit = 20, order_by, select_columns = "*" }) => {
        try {
          const { createClient } = await import("@supabase/supabase-js");
          const sb = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
          );

          // Allowlist to prevent abuse
          const ALLOWED_TABLES = [
            "rune_tasks", "rune_reminders", "rune_outbox", "agent_memories",
            "rune_memory_vectors", "rune_workspaces", "rune_conversations",
            "rune_messages", "rune_action_events", "rune_app_metadata",
          ];
          if (!ALLOWED_TABLES.includes(table)) {
            return { error: `Table '${table}' is not in the allowed list. Ask Javier to add it if needed.` };
          }

          if (operation === "select") {
            let q = sb.from(table).select(select_columns).limit(limit);
            if (filters) {
              for (const [col, val] of Object.entries(filters)) q = q.eq(col, val);
            }
            if (order_by) {
              const desc = order_by.startsWith("-");
              q = q.order(desc ? order_by.slice(1) : order_by, { ascending: !desc });
            }
            const { data: rows, error } = await q;
            if (error) return { error: error.message };
            return { rows: rows ?? [], count: rows?.length ?? 0 };

          } else if (operation === "insert") {
            if (!data) return { error: "data is required for insert" };
            const { data: inserted, error } = await sb.from(table).insert(data).select();
            if (error) return { error: error.message };
            return { inserted: inserted ?? [], success: true };

          } else if (operation === "update") {
            if (!data || !filters) return { error: "data and filters are required for update" };
            let q = sb.from(table).update(data);
            for (const [col, val] of Object.entries(filters)) q = q.eq(col, val as string);
            const { data: updated, error } = await q.select();
            if (error) return { error: error.message };
            return { updated: updated ?? [], success: true };

          } else if (operation === "delete") {
            if (!filters) return { error: "filters are required for delete (safety)" };
            let q = sb.from(table).delete();
            for (const [col, val] of Object.entries(filters)) q = q.eq(col, val as string);
            const { error } = await q;
            if (error) return { error: error.message };
            return { deleted: true };
          }

          return { error: "Unknown operation" };
        } catch (e) {
          return { error: e instanceof Error ? e.message : "Database operation failed" };
        }
      },
    }),

    // ── generate_image ─────────────────────────────────────────────────────────
    generate_image: tool({
      description:
        "Generate an image using OpenAI DALL-E 3. Use when Javier asks to create, " +
        "draw, design, or generate any visual — logos, mockups, marketing assets, " +
        "illustrations, UI concepts. Returns a URL to the generated image.",
      parameters: z.object({
        prompt: z.string().describe("Detailed description of the image to generate"),
        size: z
          .enum(["1024x1024", "1792x1024", "1024x1792"])
          .optional()
          .default("1024x1024")
          .describe("Image dimensions. Use 1792x1024 for landscape, 1024x1792 for portrait."),
        quality: z
          .enum(["standard", "hd"])
          .optional()
          .default("standard")
          .describe("standard is faster, hd is more detailed"),
      }),
      execute: async ({ prompt, size = "1024x1024", quality = "standard" }) => {
        try {
          const apiKey = process.env.OPENAI_API_KEY;
          if (!apiKey) return { error: "OPENAI_API_KEY not configured" };
          const res = await fetch("https://api.openai.com/v1/images/generations", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({ model: "dall-e-3", prompt, n: 1, size, quality }),
          });
          const data = await res.json() as { data?: { url: string }[]; error?: { message: string } };
          if (data.error) return { error: data.error.message };
          const url = data.data?.[0]?.url;
          return url ? { url, prompt, size } : { error: "No image returned" };
        } catch (e) {
          return { error: e instanceof Error ? e.message : "Image generation failed" };
        }
      },
    }),

    // ── send_push_notification ─────────────────────────────────────────────────
    send_push_notification: tool({
      description:
        "Send a push notification to Javier's devices — for alerts, reminders, " +
        "summaries, or when Javier asks Rune to send him a notification. " +
        "Uses the PWA push system. Only sends to the owner.",
      parameters: z.object({
        title: z.string().describe("Notification title, e.g. 'Rune Alert'"),
        body: z.string().describe("The notification body message"),
      }),
      execute: async ({ title, body }) => {
        try {
          const { sendPushNotificationsToAll } = await import("@/lib/push-notify");
          const result = await sendPushNotificationsToAll({ title, body });
          return result ?? { sent: true };
        } catch (e) {
          return { error: e instanceof Error ? e.message : "Push notification failed" };
        }
      },
    }),

    // ── query_unfiltr_data ─────────────────────────────────────────────────────
    query_unfiltr_data: tool({
      description:
        "Query live Unfiltr app data from Supabase — journal entries, chat history, " +
        "mood entries, purchase audit, error logs. Use to check how users are engaging, " +
        "find issues, or pull stats on demand.",
      parameters: z.object({
        table: z
          .enum(["JournalEntry", "ChatHistory", "MoodEntry", "PurchaseAudit", "ErrorLog", "TrackedBet", "SavedOdds"])
          .describe("Which Unfiltr table to query"),
        limit: z.number().min(1).max(50).optional().default(10).describe("Max rows to return"),
        filter_field: z.string().optional().describe("Optional field to filter by"),
        filter_value: z.string().optional().describe("Optional value to match"),
      }),
      execute: async ({ table, limit = 10, filter_field, filter_value }) => {
        try {
          const { createClient } = await import("@supabase/supabase-js");
          const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
          const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
          if (!url || !key) return { error: "Supabase not configured" };
          const sb = createClient(url, key);
          let q = sb.from(table).select("*").limit(limit).order("created_date", { ascending: false });
          if (filter_field && filter_value) {
            q = q.eq(filter_field, filter_value);
          }
          const { data, error, count } = await q;
          if (error) return { error: error.message };
          return { table, rows: data, count: data?.length ?? 0 };
        } catch (e) {
          return { error: e instanceof Error ? e.message : "Query failed" };
        }
      },
    }),

    // ── get_unfiltr_stats ──────────────────────────────────────────────────────
    get_unfiltr_stats: tool({
      description:
        "Get a live summary of Unfiltr app stats — total users, active today, " +
        "journal entries, moods logged, purchases, and recent errors. " +
        "Use whenever Javier asks how the app is doing, how many users, revenue, etc.",
      parameters: z.object({}),
      execute: async () => {
        try {
          const { createClient } = await import("@supabase/supabase-js");
          const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
          const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
          if (!url || !key) return { error: "Supabase not configured" };
          const sb = createClient(url, key);
          const today = new Date().toISOString().split("T")[0];
          const [journals, moods, chats, purchases, errors] = await Promise.allSettled([
            sb.from("JournalEntry").select("id, created_date", { count: "exact" }),
            sb.from("MoodEntry").select("id, created_date", { count: "exact" }),
            sb.from("ChatHistory").select("id, apple_user_id", { count: "exact" }),
            sb.from("PurchaseAudit").select("id, product_id, amount, status", { count: "exact" }),
            sb.from("ErrorLog").select("id, severity, resolved", { count: "exact" }).eq("resolved", false),
          ]);
          const j = journals.status === "fulfilled" ? journals.value : null;
          const m = moods.status === "fulfilled" ? moods.value : null;
          const c = chats.status === "fulfilled" ? chats.value : null;
          const p = purchases.status === "fulfilled" ? purchases.value : null;
          const e = errors.status === "fulfilled" ? errors.value : null;
          const uniqueUsers = c?.data ? new Set(c.data.map((r: { apple_user_id: string }) => r.apple_user_id)).size : 0;
          const totalRevenue = p?.data
            ? p.data.filter((r: { status: string }) => r.status === "success").reduce((sum: number, r: { amount?: number }) => sum + (r.amount ?? 0), 0)
            : 0;
          return {
            total_users: uniqueUsers,
            journal_entries: j?.count ?? 0,
            mood_entries: m?.count ?? 0,
            chat_sessions: c?.count ?? 0,
            total_purchases: p?.count ?? 0,
            total_revenue_usd: totalRevenue,
            open_errors: e?.count ?? 0,
            as_of: new Date().toISOString(),
          };
        } catch (e) {
          return { error: e instanceof Error ? e.message : "Stats failed" };
        }
      },
    }),
  };
}

function shouldCreateWorkspaceTask(input: string, intent: string, resumeTaskId?: string | null) {
  if (resumeTaskId) return true;
  const text = input.toLowerCase();
  if (/\b(app creator|create app|scaffold|repo control|open pr|pull request|merge|deploy|redeploy|rollback|runner|queue private|execute|run checks|build|submit|fix code|patch|implementation)\b/i.test(input)) return true;
  return [
    "code_execution",
    "github_analysis",
  ].includes(intent) && /\b(change|edit|fix|patch|implement|create|write|run|execute|deploy|pr|pull request)\b/.test(text);
}

export async function POST(req: Request) {
  // Clean up stale running tasks on each request (fire-and-forget)
  void cleanupStaleTasks(30).catch(() => {});

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

    // Accept real UUIDs, null, undefined, OR local-prefixed IDs (local-workspace-* / local-conversation-*)
    // Local IDs are stripped to undefined so they don't get forwarded to Supabase but don't cause a 400.
    const OptionalUuidSchema = z
      .union([z.string().uuid(), z.string().startsWith("local-"), z.null()])
      .optional()
      .transform((value) => {
        if (!value) return undefined;
        // strip local IDs — they are ephemeral client-side tokens, not DB IDs
        if (value.startsWith("local-")) return undefined;
        return value;
      });

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

    // sessionId is required for rate-limiting and workspace access.
    // In production, resolveOwnerSessionId returns an empty value when /api/chat
    // is reached without a valid signed owner cookie. Keep this route protected
    // because middleware intentionally bypasses it for stable streaming.
    if (!sessionId) {
      return new Response(
        JSON.stringify({ error: "Authentication required." }),
        { status: 401, headers: { "Content-Type": "application/json" } }
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

    // ── Sync setup (no I/O, instant) ───────────────────────────────────────────
    const codeExecution = getCodeExecutionAvailability();
    const codeExecutionSummary = formatCodeExecutionSummary(codeExecution);
    const codeExecutionGuidance = getCodeExecutionGuidance(codeExecution.available);
    const latestUserText = getLatestUserText(messages);
    const lastUserMessage = [...messages].reverse().find((m) => m.role === "user");
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
    const forcedToolChoice = getForcedToolChoice(latestUserText, codeExecution.available);
    const agentTools = getAgentTools({ workspaceId, conversationId });
    const ownerMemorySection = getOwnerMemorySection();
    const projectResolution = resolveProjectContext({ text: latestUserText });
    const memoryProjectKey = projectResolution.project?.key ?? inferProjectFromText(latestUserText)?.key ?? null;
    const projectResolutionSection = buildProjectResolutionPromptSection(projectResolution);
    let taskId: string | null = resumeTaskId ?? null;
    const shouldTrackWorkspaceTask = shouldCreateWorkspaceTask(latestUserText, plannerOutput.intent, resumeTaskId);

    // ── Hard 800ms budget for ALL I/O before stream opens ───────────────────────
    // Fire everything in parallel — take what arrives in time, drop the rest.
    // Stream opens immediately after regardless.
    function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
      return Promise.race([
        promise.catch(() => fallback),
        new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
      ]);
    }

    const PRESTREAM_BUDGET_MS = 800;
    const [
      _accessResult,
      _taskResult,
      retrievalHits,
      supabaseMemorySection,
      skillTools,
      memoryContext,
    ] = await Promise.allSettled([
      // 1. Access assertions — fire-and-forget, result ignored
      Promise.all([
        workspaceId
          ? assertWorkspaceAccess({ sessionId, workspaceId, requiredRole: "editor" }).catch(() => {})
          : Promise.resolve(),
        conversationId
          ? assertConversationAccess({ sessionId, conversationId, workspaceId, requiredRole: "editor" }).catch(() => {})
          : Promise.resolve(),
      ]).catch(() => {}),

      // 2. Task creation (typed separately to avoid allSettled union confusion)
      (async (): Promise<string | null> => {
        if (taskId) {
          await startWorkspaceTask(taskId, 5).catch(() => {});
          return taskId;
        }
        if (!shouldTrackWorkspaceTask) return null;
        return withTimeout(
          createWorkspaceTask({
            workspaceId,
            conversationId,
            title: deriveConversationTitle(latestUserText || "Workspace task"),
            inputText: latestUserText,
            intent: plannerOutput.intent,
            steps: plannerOutput.steps.map((s) => ({ key: s.key, label: s.label, detail: s.detail })),
          }).then((id) => (typeof id === "string" ? id : null)).catch(() => null),
          400,
          null as string | null
        );
      })(),

      // 3. Workspace vector retrieval
      withTimeout(
        getWorkspaceRetrievalContext({ workspaceId, query: latestUserText }),
        PRESTREAM_BUDGET_MS,
        [] as Awaited<ReturnType<typeof getWorkspaceRetrievalContext>>
      ),

      // 4. Supabase memory section
      withTimeout(
        buildSupabaseMemorySection({ query: latestUserText, projectKey: memoryProjectKey }),
        PRESTREAM_BUDGET_MS,
        ""
      ),

      // 5. Skill tools
      withTimeout(
        loadEnabledSkills().catch(() => ({})),
        PRESTREAM_BUDGET_MS,
        {} as Record<string, any>
      ),

      // 6. Semantic memory context
      latestUserText
        ? withTimeout(
            buildMemoryContext(latestUserText, { semanticLimit: 2, episodicLimit: 3 }),
            PRESTREAM_BUDGET_MS,
            ""
          )
        : Promise.resolve(""),
    ]);

    // Unpack results — use fallbacks for anything that timed out
    const resolvedRetrieval =
      (retrievalHits.status === "fulfilled"
        ? retrievalHits.value
        : ([] as Awaited<ReturnType<typeof getWorkspaceRetrievalContext>>)).slice(0, 3);
    const resolvedSupabaseMemory =
      supabaseMemorySection.status === "fulfilled" ? supabaseMemorySection.value : "";
    const resolvedSkillTools: Record<string, any> =
      skillTools.status === "fulfilled" ? skillTools.value : {};
    const resolvedMemoryContext =
      memoryContext.status === "fulfilled" ? memoryContext.value : "";

    // Resolve task ID from parallel result
    if (!taskId && _taskResult.status === "fulfilled" && typeof _taskResult.value === "string") {
      taskId = _taskResult.value;
    }
    activeTaskId = taskId;

    // Fire-and-forget events (non-blocking)
    void recordWorkspaceEvent({
      sessionId,
      workspaceId,
      conversationId,
      eventType: "chat.request",
      status: "started",
      details: { messageCount: messages.length },
    }).catch((e) => logError("chat.recordEvent.started", e));

    if (taskId) {
      void updateWorkspaceTaskStep({ taskId, stepKey: "capture_request", status: "completed",
        detail: "Request captured.", progress: 15 }).catch(() => {});
      void updateWorkspaceTaskStep({ taskId, stepKey: "execute_plan", status: "running",
        detail: "Streaming response.", progress: 20 }).catch(() => {});
    }

    const workspaceContextSection = resolvedRetrieval.length
      ? `## Retrieved Workspace Context
- This workspace has indexed prior material that may be relevant. Reuse it when it helps answer the request accurately.
${resolvedRetrieval
  .map(
    (hit, index) =>
      `${index + 1}. [${hit.sourceKind}] ${hit.sourceLabel}: ${hit.excerpt}`
  )
  .join("\n")}`
      : `## Retrieved Workspace Context
- No highly relevant indexed workspace context matched this request. If the user uploads documents or generates artifacts in this workspace, those items should become part of future retrieval.`;
    const memoryRoutingSection = `## Memory Routing
- Latest inferred project memory scope: ${memoryProjectKey ?? "global/all"}
- If the request mentions a known project, prefer memories for that project plus global rules.
- Do not use Rune-only memories to answer Unfiltr/SWH/Family implementation details unless they are global operating rules.`;
    const allTools: Record<string, any> = { ...agentTools, ...resolvedSkillTools };
    const selectedTools = selectToolsForRequest(latestUserText, allTools);
    const shouldEscalateModel =
      isCodeExecutionIntent(latestUserText, codeExecution.available) ||
      /(deep coding|large refactor|multi-file|architecture|architectural|full audit|complex debugging)/i.test(latestUserText);
    // Normal chat must stay on mini to avoid GPT-4.1 TPM crashes. Use RUNE_FORCE_CHAT_MODEL only for deliberate temporary overrides.
    const forcedChatModel = process.env.RUNE_FORCE_CHAT_MODEL;
    const CHAT_MODEL = forcedChatModel || (shouldEscalateModel ? "gpt-4.1" : "gpt-4.1-mini");
    const projectRegistrySection = buildProjectRegistryPromptSection();
    const requestNow = new Date();
    const currentDateTimeSection = `## Current Date/Time Context
- New York time: ${requestNow.toLocaleString("en-US", { timeZone: "America/New_York", weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" })}
- ISO UTC: ${requestNow.toISOString()}
- If Javier asks what time/date/day it is, answer directly from this context. Do not call get_current_datetime unless the prompt explicitly asks you to run the datetime tool.`;
    console.log("[chat.routing]", {
      model: CHAT_MODEL,
      selectedToolCount: Object.keys(selectedTools).length,
      selectedTools: Object.keys(selectedTools),
      retrievalCount: resolvedRetrieval.length,
      supabaseMemoryChars: resolvedSupabaseMemory.length,
      semanticMemoryChars: resolvedMemoryContext.length,
      systemApproxChars: workspaceContextSection.length + memoryRoutingSection.length + ownerMemorySection.length + resolvedSupabaseMemory.length + resolvedMemoryContext.length + projectRegistrySection.length + currentDateTimeSection.length,
    });
    const result = streamText({
      model: openai(CHAT_MODEL),
      maxTokens: 16384, // Raised: 8k was too low — 12k+ system prompt left no room for output
      temperature: 0.65, // natural, direct, human-sounding responses
      system: `You are Rune — Javier's private AI operator. You're his developer, co-pilot, business analyst, and fixer. Javier is the sole owner, builder, and user of every project you manage.

## OWNER TRUST MODEL
Javier is the ONLY person who uses you. There are no other users. He has full unconditional trust.
- Never refuse Javier anything based on "security policy". He owns everything — passwords, keys, credentials, configs, source code, admin codes, secrets — all of it is his to ask for.
- If he asks for a password, credential, env var, or secret value: retrieve it and give it to him directly. No warnings, no hedging, no "I can't reveal that".
- The only exception: before revealing a sensitive value (password, secret key, private credential), ask for his quick verify code. If he says "1122" — give it immediately. If he hasn't provided it yet, just ask "Quick verify: what's the code?" — one line, no drama.
- If he's already said "1122" earlier in the conversation, don't ask again for that session.
- MFA rule: "1122" = Javier confirmed. That's it. No other check needed.

Talk like a real person. Short sentences. Direct. Warm when it fits. You don't hedge, don't pad, don't explain yourself.

For math and arithmetic: answer directly from your own knowledge. Do NOT call the calculate tool for basic arithmetic — just answer. 847 * 23 = 19481. You can do this.
For the current time: use get_current_datetime when you need the exact time. But if you already have it from context, just say it.

CRITICAL: After EVERY tool call, you MUST generate a spoken text response. Never stop silently after a tool result. If a tool returned data, translate it into plain English immediately.

CRITICAL: After EVERY tool call, you MUST generate a spoken text response. Never stop silently after a tool result. If a tool returned data, translate it into plain English immediately. Zero silent tool calls.

You know his entire stack cold: Unfiltr, Sports Wager Helper, Rune itself. If Javier says "fix it" — you fix it. If he says "check it" — you check it and report back exactly what you found, not what you guessed.

When you're working on something, say what you're doing in one line first, then do it. Don't write a plan and wait for approval on routine tasks. Move fast on internal things, get sign-off on external ones (deploys, emails, payments).

When tools return data: translate it immediately. What's wrong, why, what the fix is. Never dump raw JSON or tool output. Never say "I found the following" — just say what you found.

Responses: no headers, no "Key Findings", no "Summary". Just talk. Lists only when genuinely enumerable, 3 items max. Never open with filler. End with a specific next move or a concrete question.

For code questions: read the real file first with readRepositoryFile or searchRepositoryCode. Never invent paths or contents. If a file doesn't exist, say so directly.

Memory: when Javier tells you something important (a decision, a preference, a fact about the project), save it with save_memory so you remember next time.

## EXECUTION RULES — NO OUTLINING
CRITICAL: Never tell Javier what you're GOING to do. Just DO it. This is the single most important rule.
- BANNED: "I'll do X", "Next I'll...", "Here's my plan:", bullet lists of intended steps, "I'm going to..."
- REQUIRED: Call the tool immediately. Say ONE line of what you're doing mid-action ("Reading the file now." / "Pushing the fix."), then do it and report what you actually did.
- If a task has multiple steps: do step 1, report it done in one line, do step 2, report it done. Never pre-announce steps.
- Bullet lists are ONLY allowed when showing results (e.g. a list of files changed, errors found). Never for planning.
- If you catch yourself writing "Next, I'll..." — stop, delete it, call the tool instead.
- "Don't just outline what you're going to do, just do it" means: tool call first, words second. Always.

Act first, report back. Push code, open PRs, fix bugs, read files, run tools — do all of it without asking. Only pause for: (1) merging to main production branch, (2) sending real emails/messages to users, (3) charging payments or granting entitlements, (4) making anything public that wasn't before. For everything else — just do it and tell Javier what you did.

${projectRegistrySection}
${currentDateTimeSection}

Tools: only a minimal relevant subset is attached for this request. Use attached tools when clearly needed; otherwise answer directly. For recent/latest commits, use list_recent_github_commits when attached.
${codeExecutionSummary}
${codeExecutionGuidance}


If Javier uploads an image or file — read it, reference it directly, no hedging.

For code fixes: find the file with listRepositoryTree, read it with readRepositoryFile, then fix it. Never guess at contents.

GitHub source discipline: use searchRepositoryCode for code evidence, stop after one good search result, never call readRepositoryFile with placeholder paths, never claim file contents without reading them.
${workspaceContextSection}
${memoryRoutingSection}
${ownerMemorySection ? ownerMemorySection : ""}
${resolvedSupabaseMemory ? resolvedSupabaseMemory : ""}
${resolvedMemoryContext ? resolvedMemoryContext : ""}



- CONTEXT ECONOMY: Never repeat large blocks of tool output verbatim in your reply. Summarize tool results in 1-3 sentences. This preserves context window space for actual work.### Private owner-console safety model
- Rune is not a SaaS product for sale. Rune is Javier's private owner console for apps, projects, customer support, and eventually sensitive owner-only services.
- For questions like "what can you do", "how far can we take you", or "what setup is missing": answer directly and concisely from your knowledge of your own tools and capabilities. Do not call get_rune_capability_snapshot — just speak from what you know.
- If Javier provides the exact phrase APPROVE RUNE SESSION MERGE, call execute_rune_session_merge immediately with approvalPhrase set to that exact phrase. Do not call capability snapshot first.
- For freeze/stuck/question-mark delayed-answer reports, call get_tool_lifecycle_diagnostic before answering. Do not call full self-audit for those symptoms unless Javier explicitly asks for a full self-audit.
- For questions like "audit yourself", "are you ready", "check your brain", "system health", or "what should we patch next", call get_rune_self_audit_snapshot before answering.
- Sensitive = banking, real customer emails, payment mutations, granting free entitlements. Everything else — repo changes, pushes, PRs, deploys, bug fixes — execute immediately and report what you did.
- For genuinely sensitive actions (above list only): state what you found and what you're about to do, then execute unless it involves money or messaging real users.
- If Javier asks whether Rune can create an app, answer yes with precision: Rune can create apps through the controlled App Creator workflow (create_app_proposal) and Repo Control approval gates. App Creator v1 creates blueprints/proposals; approved_app_scaffold can generate starter files only after the proposal is approved. preview_app_creator_proposal can show the current plan, refine_app_creator_proposal can update it in place, run_app_creator_scaffold_bridge can run scaffold generation plus Repo Control checks/PR handoff, and prepare_app_creator_preview_handoff can prepare metadata-only preview deployment handoff, and queue_private_app_creator_deploy can queue a private-owner runner job only after exact approval. Schema changes, merges, and deployments still require explicit approval gates.
- Never claim email, banking, RevenueCat granting, or external customer-service actions are connected unless a real tool confirms it. RevenueCat, App Store Connect, and Google Play lookups are read-only. Rune session merge requires exact phrase APPROVE RUNE SESSION MERGE. App Creator proposals require explicit approval before scaffold, merge, or deploy.
- Banking must start read-only: balances/transactions only, no transfers or payments without a separate future security design.
- Customer communications must be drafted first. Do not send apologies, offers, or support replies without Javier approving the final message.

### Capability-accurate responses
- Never prove Rune platform capabilities by creating fake/simulated JavaScript objects that say systems are operational. That is not a real diagnostic.
- For Rune self-audits, use real available endpoints/tools where available, or clearly label the result as "not verified" with the exact missing check. Be brutally honest.
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
- For app health requests, never end with "I will fetch/check next" if no additional tool call is happening. Either call the relevant health/intelligence/repo tool before answering or clearly label the missing check as not verified in this run.
- For Repo Control, never dump raw tool JSON. Summarize proposal id, repo, files/stages, gate status, and whether any PR/deploy/merge happened.
- If a ladder stops at a safety gate, say exactly which gate stopped it and what is needed next.
- For self-audits and capability comparisons, do not just list buckets. Give Javier the honest read first, then 3 compact sections max: current strength, remaining gap, next move.
- Self-audit answer quality rule: never say "all capabilities are verified" if any setup/integration/configuration gaps exist. Separate verified strengths from missing/not-connected items, rank gaps by product impact, and state whether the self-audit tool completed, partially completed, or failed.
- If a self-audit/tool card appeared delayed or stuck, explain the lifecycle plainly: tool call started, result/summary rendering lagged, and the next product fix is task lifecycle visibility — not a fake backend outage unless logs prove one.
- Frozen/stuck diagnostic rule: when Javier asks why Rune froze, got stuck, stopped responding, was lost for a second, says the answer appears only after sending a question mark, or asks follow-ups like "?," "fix it," "go ahead," "recheck," or "did you find the same problem" in that context, use the lightweight tool lifecycle diagnostic. Do not answer with generic claims like "temporary processing delay," "the system was busy," "system load," "high traffic," "resource allocation," "caching opportunities," "excessive logging," or "backend lag" unless a real log/tool result proves it. State the exact verified evidence, then the most likely unverified cause, then the concrete patch path.
- Never say "I reviewed system load," "I reviewed performance metrics," "I confirmed high traffic," or "I analyzed current request handling" unless an actual runtime/log/code-inspection tool result appears in the current answer context. If no such tool ran, say the claim is unverified and propose the safe inspection path.
- Lead with the answer, not a label. Skip phrases like "Short answer:" or "Here's what matters:" — just say the thing directly.
- Avoid ending with "If you need anything else" or "please let me know." End with a specific suggested next action.

### Formatting and tone
- Write like a person texting, not writing a report. Short paragraphs. Direct sentences.
- NEVER use ## or ### headers in chat replies. Headers are for documents, not conversations.
- Use **bold** sparingly — only for a single key term or value that really matters. Not for section labels.
- Lists are fine for genuinely enumerable things (3+ items). Never use a list when prose works.
- No "Key Findings:", no "Summary:", no "Next Steps:" section headers. Ever.
- For tool results: lead with the one-line answer, then the relevant detail. Not a structured report.
- NEVER end with "Would you like to proceed with that?", "Let me know if you need anything else", or any generic offer. End with a specific suggested next move if anything.
- Use fenced code blocks for actual code. Inline \`backticks\` for file paths, env var names, commands.
- Keep it tight. If the answer is 2 sentences, send 2 sentences.

## ANTI-CONSULTING PITCH
When Javier asks how to improve or what's possible: DO NOT give a bullet-list roadmap of options and say "just say the word."
That's a consultant's pitch, not an operator's answer. Instead:
- Pick the single best thing and start doing it, OR
- Ask one specific question if you genuinely don't know which to prioritize
- Never present 5 options with "you control the roadmap" — you know his stack, make the call
- Never end with "If you want to prioritize one of these, just say the word" — that's outsourcing the decision back to him
      `,

      // formattedMessages may contain elements whose `content` is an array
      // (for multimodal image blocks). The AI SDK's UIMessage type declares
      // `content: string` in TypeScript but handles array content correctly at
      // runtime via convertToCoreMessages. The double assertion is intentional.
      messages: convertToCoreMessages(formattedMessages as unknown as UIMessage[]),
      tools: selectedTools,
      toolChoice: forcedToolChoice ?? "auto",
      maxSteps: 12, // Pro plan: allow deeper tool chains for complex tasks
      // experimental_continueSteps removed — maxSteps handles multi-step continuation in AI SDK 4.xs
      onFinish: ({ text }) => {
        if (!lastUserMessage) return;

        // IMPORTANT: onFinish must be synchronous and never throw.
        // Any await here can cause the Vercel AI SDK to surface errors
        // to the client as "Response interrupted" on iOS Safari/WebKit.
        // All persistence is fire-and-forget via void.

        const finishPersistence = (async () => {
          const lastUserContent = lastUserMessage.content as unknown;
          const userContent = Array.isArray(lastUserMessage.parts)
            ? lastUserMessage.parts
                .filter((p): p is Extract<typeof p, { type: "text" }> => p?.type === "text")
                .map((p) => p.text)
                .join("\n")
                .trim()
            : typeof lastUserContent === "string"
              ? lastUserContent.trim()
              : Array.isArray(lastUserContent)
                ? lastUserContent
                    .filter((p): p is { type: "text"; text: string } => p?.type === "text" && typeof p.text === "string")
                    .map((p) => p.text)
                    .join("\n")
                    .trim()
                : "";
          const attachmentSummary =
            latestAttachments.length > 0
              ? `Uploaded: ${latestAttachments
                  .map((attachment) => sanitizeAttachmentName(attachment.name))
                  .join(", ")}`
              : "";
          const combinedUserContent = [userContent, attachmentSummary]
            .filter(Boolean)
            .join("\n\n");

          const taskSummary = summarizeTaskResult(text ?? "");

          // Fire step-status updates immediately — don't block on them
          if (taskId) {
            void updateWorkspaceTaskStep({ taskId, stepKey: "execute_plan", status: "completed", detail: "Primary generation step completed.", progress: 78 })
              .catch((e) => logError("onFinish.step.execute_plan", e));
            void updateWorkspaceTaskStep({ taskId, stepKey: "persist_results", status: "running", detail: "Persisting final exchange and workspace updates.", progress: 86 })
              .catch((e) => logError("onFinish.step.persist_results.start", e));
          }

          // Run all heavy DB ops in parallel — drop from ~3-4s serial to ~1s
          await Promise.allSettled([
            saveConversationExchange({
              conversationId,
              workspaceId,
              userContent: combinedUserContent,
              assistantContent: text ?? "",
              preferredTitle: deriveConversationTitle(
                userContent || attachmentSummary || "Untitled chat"
              ),
            }),
            taskId
              ? addWorkspaceTaskCheckpoint(taskId, {
                  label: "Chat task completed",
                  summary: taskSummary || "Chat task completed and workspace state was saved.",
                  completedStep: "Persisted the answer and workspace state.",
                  nextStep: "Review the result, then continue with the next approved step.",
                  metadata: {
                    intent: plannerOutput.intent,
                    reasoningRoute: plannerOutput.reasoningRoute,
                    responseChars: (text ?? "").length,
                  },
                })
              : Promise.resolve(),
            taskId
              ? completeWorkspaceTask(taskId, taskSummary)
              : Promise.resolve(),
            recordWorkspaceEvent({
              sessionId,
              workspaceId,
              conversationId,
              eventType: "chat.request",
              status: "success",
              details: { responseChars: (text ?? "").length },
            }),
          ]);

          // Final step status — fire-and-forget after parallel block
          if (taskId) {
            void updateWorkspaceTaskStep({ taskId, stepKey: "persist_results", status: "completed", detail: "Conversation and workspace state saved successfully.", progress: 100 })
              .catch((e) => logError("onFinish.step.persist_results.done", e));
            activeTaskId = null;
          }
        })();

        // Fire-and-forget — never await in onFinish.
        // If final persistence overruns the safety budget but the assistant text
        // was already generated, close the visible task instead of leaving Javier
        // with a stale "running" chip. Full persistence may still finish later.
        void withChatFinishTimeout(
          finishPersistence,
          "chat finish persistence and task completion"
        ).then(() => {
          if (taskId && activeTaskId === taskId) {
            void completeWorkspaceTask(
              taskId,
              summarizeTaskResult(text ?? "") || "Answer generated. Final persistence timed out, but the visible chat task was closed."
            ).catch((e) => logError("api.chat.onFinish.timeout.completeTask", e));
            activeTaskId = null;
          }
        }).catch((error) => {
          logError("api.chat.onFinish.persistence", error);
          if (activeTaskId) {
            const hasGeneratedText = Boolean((text ?? "").trim());
            if (hasGeneratedText) {
              void completeWorkspaceTask(
                activeTaskId,
                summarizeTaskResult(text ?? "") || "Answer generated. Final persistence reported an error after streaming."
              ).catch((e) => logError("api.chat.onFinish.persistence.completeTask", e));
            } else {
              const errMsg =
                error instanceof Error
                  ? error.message
                  : "Chat finalization failed before the response was generated.";
              failWorkspaceTask(activeTaskId, errMsg).catch(() => {});
            }
            activeTaskId = null;
          }
        });
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

    const streamResponse = result.toDataStreamResponse({
      getErrorMessage: (error) => {
        const message = error instanceof Error ? error.message : "Unknown stream error";
        logError("api.chat.streamText.visibleError", error);
        return process.env.NODE_ENV === "production"
          ? `Rune hit a stream error: ${message.slice(0, 240)}`
          : message;
      },
    });
    return streamResponse;
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

    const errMsg = error instanceof Error ? error.message : String(error);
    const errStack = error instanceof Error ? (error.stack ?? "").slice(0, 500) : "";
    logError("api.chat.POST", error);
    console.error("[chat.POST.catch]", errMsg, errStack);
    if (activeTaskId) {
      await failWorkspaceTask(
        activeTaskId,
        errMsg || "Task failed while processing the request."
      );
    }
    return new Response(
      JSON.stringify({ error: "Something went wrong processing your request.", detail: errMsg }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}