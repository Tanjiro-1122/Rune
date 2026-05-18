/**
 * Orchestration helpers — intent detection, tool routing, and capability-aware
 * system-prompt formatting.
 *
 * Separating this from the route handler keeps the chat API thin and makes
 * routing logic testable in isolation.
 */

import type { UIMessage } from "ai";
import {
  SUPPORTED_ARTIFACT_MIME_TYPES,
  type ExecutionLimits,
} from "./code-execution";

// ─── Capability descriptor ────────────────────────────────────────────────────

export interface AgentCapabilities {
  codeExecution: { available: boolean; reason?: string | null; limits?: ExecutionLimits };
  webSearch: boolean;
  githubAnalysis: boolean;
}

// ─── Intent detection ─────────────────────────────────────────────────────────

export type DetectedIntent =
  | "self_audit"
  | "tool_lifecycle_diagnostic"
  | "capability_truth"
  | "approval_required"
  | "not_connected"
  | "repo_proposal"
  | "code_execution"
  | "web_search"
  | "github_analysis"
  | "datetime"
  | "calculate"
  | "plan"
  | "general";

export type ReasoningRoute =
  | "answer_only"
  | "truth_check"
  | "self_audit"
  | "inspect_first"
  | "plan_first"
  | "proposal_required"
  | "approval_required"
  | "not_connected";


const FROZEN_DIAGNOSTIC_PATTERN = /\b(why (are|were|did) (you )?(freeze|frozen|stuck|hang|hung|stall|stalled)|why (you|jarvis) (were|are|got|became) (frozen|stuck|hung|stalled)|why did i lose you|lost you (there )?(for )?(a )?(second|sec|moment)|why did you stop responding|why did you get stuck|why are you frozen|tool card (is|was) stuck|running .* forever|still running|response (is|was) delayed|temporary unresponsiveness|unresponsive issue|it freezes?( then)? when i (put|send|type) (like )?(a )?(question mark|\?)|freezes? until i (put|send|type) (a )?(question mark|\?)|answer (only )?(appears|shows up|comes through|comes back) after i (put|send|type) (a )?(question mark|\?)|question mark.*(answer|response).*(appears|shows up|comes through|comes back)|answer.*after.*question mark)\b/i;
const SELF_AUDIT_PATTERN = /\b(self\s*-?\s*audit|audit yourself|system health|are you ready|check your brain|brain check|readiness report|what should we patch next)\b/i;
const CAPABILITY_TRUTH_PATTERN = /\b(what can you actually do|what can you do|what is connected|what's connected|anything missing|what is missing|what's missing|setup missing|capabilities|capability|how far can we take you|fully set up)\b/i;
const SENSITIVE_ACTION_PATTERN = /\b(send email|email customer|reply to customer|grant free|grant credit|free month|refund|charge|bank transfer|bill payment|move money|delete production|push to production|open pr|pull request|commit|merge)\b/i;
const EXPLICIT_REPO_PROPOSAL_PATTERN = /\b(create|make|prepare|draft|open|run|start)\b[\s\S]{0,100}\b(repo control proposal|repo action proposal|repo control ladder|repo action ladder|safe repo control ladder|proposal)\b|\b(repo control proposal|repo action proposal|repo control ladder|repo action ladder|safe repo control ladder)\b/i;
const SAFE_REVIEW_ONLY_PATTERN = /\b(do not execute|don't execute|without executing|proposal only|review only|no execution|do not run|don't run)\b/i;
// Only route deployment as approval-required when the user is asking for an actual deployment mutation.
// Phrases like "deployment health wording" or "deployment summary" are repo/content work, not deploy actions.
const DEPLOY_ACTION_PATTERN = /\b(rollback|redeploy|deploy to production|trigger (a )?deploy|run (a )?deploy|start (a )?deployment|push to production)\b/i;
const NOT_CONNECTED_PATTERN = /\b(bank|banking|bank of america|gmail|outlook|customer inbox|revenuecat admin|app store connect|google play console|play console|send customer email)\b/i;
const REPO_CHANGE_VERB_PATTERN = /\b(fix|patch|change|modify|update|implement|add|remove|refactor|finish|build)\b/i;
const REPO_SCOPE_PATTERN = /\b(repo|repository|code|jarvis|unfiltr|swh|family|app|site|ui|router|agent|core|workflow)\b/i;
const EXPLICIT_CALC_PATTERN = /\b(calculate|compute|solve|math|arithmetic|percentage|percent|tip|total|sum|convert)\b/i;
const NUMERIC_EXPRESSION_PATTERN = /\d\s*[+\-*/^%]\s*\d|\(\s*\d[\d\s+\-*/^%.()]*\)/;

export function needsRepositoryInspection(input: string) {
  const lower = input.toLowerCase();
  return (
    EXPLICIT_REPO_PROPOSAL_PATTERN.test(lower) ||
    (REPO_CHANGE_VERB_PATTERN.test(lower) && REPO_SCOPE_PATTERN.test(lower)) ||
    /\b(error|bug|broken|not working|fails|failed|issue|problem)\b/i.test(lower) ||
    (/\b(inspect|review|audit|look at|check)\b/i.test(lower) && REPO_SCOPE_PATTERN.test(lower))
  );
}

const FROZEN_DIAGNOSTIC_FOLLOWUP_PATTERN = /^(\s*\?\s*)$|\b(fix it|go ahead|yes|proceed|continue|recheck|check again|same problem|findings are correct|optimize request processing|temporary unresponsiveness issue|question mark|answer appears|answer shows up|answer comes through)\b/i;

function recentUserText(messages: UIMessage[], count = 6) {
  return messages
    .filter((message) => message.role === "user")
    .slice(-count)
    .map((message) => {
      if (typeof message.content === "string") return message.content;
      return (message.parts ?? [])
        .filter((part) => part.type === "text")
        .map((part) => (part as { type: "text"; text: string }).text)
        .join("\n");
    })
    .join("\n");
}

export function isFrozenDiagnosticIntent(input: string, messages: UIMessage[] = []) {
  const lower = input.toLowerCase();
  return FROZEN_DIAGNOSTIC_PATTERN.test(lower) || isFrozenDiagnosticFollowup(input, messages);
}

export function isFrozenDiagnosticFollowup(input: string, messages: UIMessage[]) {
  const lower = input.toLowerCase();
  if (!FROZEN_DIAGNOSTIC_FOLLOWUP_PATTERN.test(lower)) return false;
  return FROZEN_DIAGNOSTIC_PATTERN.test(recentUserText(messages).toLowerCase());
}

/**
 * Detect the primary tool intent from the latest user message.
 *
 * Agent Core v1 uses defensive ordering: Brain/control-plane routes win over
 * search and calculator, and repo/app work defaults to inspection/proposal.
 */
export function detectToolIntent(
  input: string,
  capabilities: AgentCapabilities
): DetectedIntent {
  if (!input.trim()) return "general";

  const lower = input.toLowerCase();

  // ── Brain/control-plane routing ─────────────────────────────────────────
  if (SELF_AUDIT_PATTERN.test(lower) || FROZEN_DIAGNOSTIC_PATTERN.test(lower)) return "self_audit";
  if (CAPABILITY_TRUTH_PATTERN.test(lower)) return "capability_truth";

  // Explicit review-only Repo Control requests should route to proposal creation,
  // even when they mention words like "deployment" as content being edited.
  if (EXPLICIT_REPO_PROPOSAL_PATTERN.test(lower) || (SAFE_REVIEW_ONLY_PATTERN.test(lower) && needsRepositoryInspection(input))) {
    return "repo_proposal";
  }

  if (SENSITIVE_ACTION_PATTERN.test(lower) || DEPLOY_ACTION_PATTERN.test(lower)) return "approval_required";
  if (NOT_CONNECTED_PATTERN.test(lower)) return "not_connected";
  if (needsRepositoryInspection(input)) return "repo_proposal";

  // ── Code execution ──────────────────────────────────────────────────────
  if (capabilities.codeExecution.available) {
    const hasCodeBlock = /```[\s\S]*?```/.test(input);
    const executionVerb = /\b(run|execute|test|simulate|debug|benchmark|profile|check|evaluate)\b/.test(lower);
    const executionNoun = /\b(code|snippet|script|function|algorithm|javascript|typescript|js|ts|loop)\b/.test(lower);
    const artifactIntent =
      /\b(create|generate|produce|build|export)\b/.test(lower) &&
      /\b(artifact|file|download|csv|json|report|output|svg|chart|diagram)\b/.test(lower) &&
      /\b(code|snippet|script|javascript|typescript|js|ts)\b/.test(lower);
    const explainOnly = /\b(explain|review|summarize|understand|what does|why does)\b/.test(lower) && !executionVerb;

    if (!explainOnly && (hasCodeBlock || artifactIntent || (executionVerb && executionNoun))) {
      return "code_execution";
    }
  }

  // ── GitHub analysis ─────────────────────────────────────────────────────
  if (capabilities.githubAnalysis) {
    const hasGitHubUrl = /github\.com\/[^\s/]+\/[^\s/]+/.test(input);
    const ownedRepo = /\b[a-z0-9_-]{1,39}\/[a-z0-9_.-]{1,100}\b/i.test(input);
    const analyzeVerb = /\b(analyze|analyse|look at|check|review|explore|inspect|fetch)\b/.test(lower);
    if (hasGitHubUrl || (ownedRepo && analyzeVerb)) return "github_analysis";
  }

  // ── Web search ──────────────────────────────────────────────────────────
  if (capabilities.webSearch) {
    const timeSignal = /\b(latest|recent|current|today|now|news|update|release|this week|this month)\b/.test(lower);
    const queryVerb = /\b(search|find|look up|what is|who is|when did|where is|tell me about)\b/.test(lower);
    if ((timeSignal && queryVerb) || (timeSignal && /\b(what|who|when|where|why|how)\b/.test(lower)) || /\b(search the web|search for|google|look up)\b/.test(lower)) {
      return "web_search";
    }
  }

  // ── Datetime ────────────────────────────────────────────────────────────
  if (/\b(what time|what date|today|day of week|current time|current date|right now|what day)\b/.test(lower)) {
    return "datetime";
  }

  // ── Calculate ───────────────────────────────────────────────────────────
  // Require explicit math language or an actual numeric expression. This avoids
  // routing "what is missing" / self-audit prompts to calculator.
  if ((EXPLICIT_CALC_PATTERN.test(lower) || NUMERIC_EXPRESSION_PATTERN.test(input)) && /\d/.test(input)) {
    return "calculate";
  }

  // ── Plan ────────────────────────────────────────────────────────────────
  if (/\b(plan|steps|roadmap|outline|approach|walk me through|how do i|how to)\b/.test(lower) && input.trim().length > 30) {
    return "plan";
  }

  return "general";
}

export interface PlannerStep {
  key: string;
  label: string;
  detail: string;
}

export interface PlannerOutput {
  intent: DetectedIntent;
  forcedToolName:
    | "execute_code"
    | "calculate"
    | "get_current_datetime"
    | "analyze_github_repo"
    | "get_rune_capability_snapshot"
    | "get_rune_self_audit_snapshot"
    | "get_tool_lifecycle_diagnostic"
    | null;
  reasoningRoute: ReasoningRoute;
  routingHint: string;
  steps: PlannerStep[];
}

export function buildPlannerOutput(options: {
  input: string;
  capabilities: AgentCapabilities;
  messages?: UIMessage[];
}): PlannerOutput {
  const intent = isFrozenDiagnosticIntent(options.input, options.messages ?? [])
    ? "tool_lifecycle_diagnostic"
    : detectToolIntent(options.input, options.capabilities);

  const baseSteps: PlannerStep[] = [
    {
      key: "capture_request",
      label: "Capture request",
      detail: "Normalize user intent and validate task scope/capability fit.",
    },
    {
      key: "retrieve_workspace_context",
      label: "Retrieve workspace context",
      detail: "Load relevant files, artifacts, and chat memory for grounding.",
    },
    {
      key: "execute_plan",
      label: "Execute plan",
      detail: "Run the best matching tools with explicit step discipline.",
    },
    {
      key: "persist_results",
      label: "Persist results",
      detail: "Save exchange/task outcome and refresh workspace state.",
    },
  ];

  if (intent === "tool_lifecycle_diagnostic") {
    return {
      intent,
      forcedToolName: "get_tool_lifecycle_diagnostic",
      reasoningRoute: "self_audit",
      routingHint:
        "- Reasoning Router: run the lightweight Tool Lifecycle Diagnostic before answering freeze/stuck/question-mark reports. Do not launch the full self-audit for this symptom. Do not guess generic load/lag. Explain verified client/tool lifecycle evidence, what remains unverified without runtime logs, and the concrete product fix path.",
      steps: baseSteps,
    };
  }
  if (intent === "self_audit") {
    return {
      intent,
      forcedToolName: "get_rune_self_audit_snapshot",
      reasoningRoute: "self_audit",
      routingHint: "- Reasoning Router: run Self-Audit Mode before answering. Report verified, partial, missing, not connected, and next patch.",
      steps: baseSteps,
    };
  }
  if (intent === "capability_truth") {
    return {
      intent,
      forcedToolName: "get_rune_capability_snapshot",
      reasoningRoute: "truth_check",
      routingHint:
        "- Reasoning Router: use the Capability Truth Layer before answering. Separate verified/configured/partial/missing/not connected/approval-required.",
      steps: baseSteps,
    };
  }
  if (intent === "approval_required") {
    return {
      intent,
      forcedToolName: "get_rune_capability_snapshot",
      reasoningRoute: "approval_required",
      routingHint:
        "- Reasoning Router: sensitive action detected. Gather facts only, explain findings/plan, and ask Javier for explicit approval before execution. Do not perform the action yet.",
      steps: baseSteps,
    };
  }
  if (intent === "not_connected") {
    return {
      intent,
      forcedToolName: "get_rune_capability_snapshot",
      reasoningRoute: "not_connected",
      routingHint:
        "- Reasoning Router: requested capability may not be connected. Check truth layer, state the limitation plainly, and suggest the safest next setup path.",
      steps: baseSteps,
    };
  }
  if (intent === "repo_proposal") {
    return {
      intent,
      forcedToolName: null,
      reasoningRoute: "proposal_required",
      routingHint:
        "- Reasoning Router: repo/app change requested. Provide Findings → Plan first and route actual changes through Repo Control approval gates before execution.",
      steps: baseSteps,
    };
  }
  if (intent === "code_execution") {
    return {
      intent,
      forcedToolName: "execute_code",
      reasoningRoute: "inspect_first",
      routingHint:
        "- Planner decision: this is execution-heavy; prioritize execute_code with observable outputs.",
      steps: baseSteps,
    };
  }
  if (intent === "calculate") {
    return {
      intent,
      forcedToolName: "calculate",
      reasoningRoute: "answer_only",
      routingHint:
        "- Planner decision: this is numeric; use calculate for deterministic math.",
      steps: baseSteps,
    };
  }
  if (intent === "datetime") {
    return {
      intent,
      forcedToolName: "get_current_datetime",
      reasoningRoute: "answer_only",
      routingHint:
        "- Planner decision: this is time-sensitive; use get_current_datetime.",
      steps: baseSteps,
    };
  }
  if (intent === "github_analysis") {
    return {
      intent,
      forcedToolName: "analyze_github_repo",
      reasoningRoute: "inspect_first",
      routingHint:
        "- Planner decision: this targets a GitHub repo; use analyze_github_repo first.",
      steps: baseSteps,
    };
  }
  if (intent === "web_search") {
    return {
      intent,
      forcedToolName: null,
      reasoningRoute: "inspect_first",
      routingHint:
        "- Planner decision: this likely needs fresh information; prefer web_search early.",
      steps: baseSteps,
    };
  }

  return {
    intent,
    forcedToolName: null,
    reasoningRoute: intent === "plan" ? "plan_first" : "answer_only",
    routingHint:
      "- Planner decision: no hard route override; pick tools opportunistically based on concrete sub-steps.",
    steps: baseSteps,
  };
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
    const reason = codeExecution.reason ?? "no specific reason was provided";
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
    `Supported artifact MIME types: ${SUPPORTED_ARTIFACT_MIME_TYPES.join(", ")}.`,
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
    `  Supported MIME types: ${SUPPORTED_ARTIFACT_MIME_TYPES.map((mimeType) => `\`${mimeType}\``).join(", ")}.`,
    "- You can generate SVG charts/diagrams as `image/svg+xml` artifacts for visual outputs.",
    "- For CSV exports: `createArtifact('data.csv', rows.join('\\n'), 'text/csv')`.",
  ].join("\n");
}
