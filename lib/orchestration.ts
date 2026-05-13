/**
 * Orchestration helpers — intent detection, tool routing, and capability-aware
 * system-prompt formatting.
 *
 * Separating this from the route handler keeps the chat API thin and makes
 * routing logic testable in isolation.
 */

import type { UIMessage } from "ai";
import type { ExecutionLimits } from "./code-execution";

// ─── Capability descriptor ────────────────────────────────────────────────────

export interface AgentCapabilities {
  codeExecution: { available: boolean; reason?: string | null; limits?: ExecutionLimits };
  webSearch: boolean;
  githubAnalysis: boolean;
}

// ─── Intent detection ─────────────────────────────────────────────────────────

export type DetectedIntent =
  | "code_execution"
  | "web_search"
  | "github_analysis"
  | "datetime"
  | "calculate"
  | "plan"
  | "general";

/**
 * Detect the primary tool intent from the latest user message.
 *
 * The ordering of checks below is intentional — more specific patterns are
 * tested first so that a message containing both a code block and a search
 * keyword routes to code execution, not web search.
 */
export function detectToolIntent(
  input: string,
  capabilities: AgentCapabilities
): DetectedIntent {
  if (!input.trim()) return "general";

  const lower = input.toLowerCase();

  // ── Code execution ──────────────────────────────────────────────────────
  if (capabilities.codeExecution.available) {
    const hasCodeBlock = /```[\s\S]*?```/.test(input);
    const executionVerb =
      /\b(run|execute|test|simulate|debug|benchmark|profile|check|evaluate)\b/.test(lower);
    const executionNoun =
      /\b(code|snippet|script|function|algorithm|javascript|typescript|js|ts|loop)\b/.test(lower);
    const artifactIntent =
      /\b(create|generate|produce|build|export)\b/.test(lower) &&
      /\b(artifact|file|download|csv|json|report|output|svg|chart|diagram)\b/.test(lower) &&
      /\b(code|snippet|script|javascript|typescript|js|ts)\b/.test(lower);
    // Purely explanatory requests should not trigger execution
    const explainOnly =
      /\b(explain|review|summarize|understand|what does|why does)\b/.test(lower) &&
      !executionVerb;

    if (
      !explainOnly &&
      (hasCodeBlock || artifactIntent || (executionVerb && executionNoun))
    ) {
      return "code_execution";
    }
  }

  // ── GitHub analysis ─────────────────────────────────────────────────────
  if (capabilities.githubAnalysis) {
    const hasGitHubUrl = /github\.com\/[^\s/]+\/[^\s/]+/.test(input);
    const ownedRepo =
      /\b[a-z0-9_-]{1,39}\/[a-z0-9_.-]{1,100}\b/i.test(input);
    const analyzeVerb =
      /\b(analyze|analyse|look at|check|review|explore|inspect|fetch)\b/.test(lower);
    if (hasGitHubUrl || (ownedRepo && analyzeVerb)) {
      return "github_analysis";
    }
  }

  // ── Web search ──────────────────────────────────────────────────────────
  if (capabilities.webSearch) {
    const timeSignal =
      /\b(latest|recent|current|today|now|news|update|release|this week|this month)\b/.test(lower);
    const queryVerb =
      /\b(search|find|look up|what is|who is|when did|where is|tell me about)\b/.test(lower);
    // Require at least two independent search-like signals to reduce false positives
    if (
      (timeSignal && queryVerb) ||
      (timeSignal &&
        /\b(what|who|when|where|why|how)\b/.test(lower)) ||
      /\b(search the web|search for|google|look up)\b/.test(lower)
    ) {
      return "web_search";
    }
  }

  // ── Datetime ────────────────────────────────────────────────────────────
  if (
    /\b(what time|what date|today|day of week|current time|current date|right now|what day)\b/.test(
      lower
    )
  ) {
    return "datetime";
  }

  // ── Calculate ───────────────────────────────────────────────────────────
  if (
    /\b(calculate|compute|how much|how many|convert|what is)\b/.test(lower) &&
    /[\d+\-*/^%().]/.test(input)
  ) {
    return "calculate";
  }

  // ── Plan ────────────────────────────────────────────────────────────────
  if (
    /\b(plan|steps|roadmap|outline|approach|walk me through|how do i|how to)\b/.test(lower) &&
    input.trim().length > 30
  ) {
    return "plan";
  }

  return "general";
}

// ─── Message helpers ──────────────────────────────────────────────────────────

/**
 * Extract the plain-text content of the most recent user message.
 * Handles multi-part messages (text + attachments).
 */
export function getLatestUserText(messages: UIMessage[]): string {
  const lastUserMessage = messages.findLast((m) => m.role === "user");
  if (!lastUserMessage) return "";

  return lastUserMessage.parts
    .filter(
      (part): part is Extract<typeof part, { type: "text" }> =>
        part.type === "text"
    )
    .map((part) => part.text)
    .join("\n")
    .trim();
}

// ─── System-prompt formatters ─────────────────────────────────────────────────

/**
 * Format the code-execution capability block for the system prompt.
 */
export function formatCodeExecutionSummary(codeExecution: {
  available: boolean;
  reason?: string | null;
  limits?: ExecutionLimits;
}): string {
  if (!codeExecution.available) {
    const reason = codeExecution.reason ?? "it has been disabled in this deployment";
    return `- Sandboxed code execution is unavailable in this deployment because ${reason}.`;
  }

  const { limits } = codeExecution;
  if (!limits) {
    return "- `execute_code` — sandboxed JavaScript/TypeScript execution is available.";
  }

  return [
    "- `execute_code` — sandboxed JavaScript/TypeScript execution for short self-contained snippets only.",
    `Limits: ${limits.timeoutMs}ms timeout, ${limits.maxSourceLength} characters of source,`,
    `${limits.maxOutputChars} characters of combined logs,`,
    `up to ${limits.maxArtifacts} artifacts of ${limits.maxArtifactBytes} bytes each,`,
    `and an isolated worker memory ceiling of ~${limits.memoryLimitMb}MB.`,
    "No imports, filesystem, process, or network access.",
    "Supported artifact MIME types: text/plain, text/csv, text/markdown, text/html, application/json, image/svg+xml.",
  ].join(" ");
}

/**
 * Return guidance lines for the system prompt based on execution availability.
 */
export function getCodeExecutionGuidance(available: boolean): string {
  if (!available) {
    return (
      "- Do not claim you can run code in this deployment; explain precisely that sandboxed execution is " +
      "disabled here and offer static analysis or code review instead."
    );
  }

  return [
    "- Use `execute_code` for short self-contained JavaScript/TypeScript checks; include an explicit `return` to surface a final value.",
    "- If the user asks to run/evaluate code, call `execute_code` immediately rather than replying with prose alone.",
    "- For downloadable output use `createArtifact(name, content, mimeType?)` inside the snippet.",
    "  Supported MIME types: `text/plain`, `text/csv`, `text/markdown`, `text/html`, `application/json`, `image/svg+xml`.",
    "- You can generate SVG charts/diagrams as `image/svg+xml` artifacts for visual outputs.",
    "- For CSV exports: `createArtifact('data.csv', rows.join('\\n'), 'text/csv')`.",
  ].join("\n");
}
