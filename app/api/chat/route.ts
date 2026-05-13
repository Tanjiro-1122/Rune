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
import {
  buildPlannerOutput,
  formatCodeExecutionSummary,
  getCodeExecutionGuidance,
  getLatestUserText,
} from "@/lib/orchestration";
import {
  completeWorkspaceTask,
  createWorkspaceTask,
  failWorkspaceTask,
  startWorkspaceTask,
  updateWorkspaceTaskStep,
} from "@/lib/tasks";

export const maxDuration = 60; // Multi-step agent execution requires up to 60 s; needs Vercel Pro or higher.
const MAX_SESSION_ID_LENGTH = 128;
const CHAT_RATE_WINDOW_MS = 60_000;
const MAX_TRACKED_CHAT_SESSIONS = 2_000;
const MAX_EVENT_ERROR_MESSAGE_LENGTH = 280;
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
const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
  userAgent: "Jarvis-Super-Agent/1.0",
});

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
      let num = "";
      while (i < src.length && /[\d.]/.test(src[i])) num += src[i++];
      tokens.push(parseFloat(num));
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
function parseOwnerRepo(input: string): string {
  const urlMatch = input.match(/github\.com\/([^/\s]+\/[^/\s#?]+)/);
  if (urlMatch) return urlMatch[1].replace(/\.git$/, "");
  return input.trim().replace(/\.git$/, "");
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

function isCalculationIntent(input: string) {
  if (!input.trim()) return false;
  return (
    /\b(calculate|compute|what is|solve|tip|percentage|percent|sum|total|convert)\b/i.test(
      input
    ) &&
    /[\d()%/*+-]/.test(input)
  );
}

function isDatetimeIntent(input: string) {
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

function isWebSearchIntent(input: string) {
  if (!input.trim()) return false;
  if (isGitHubAnalysisIntent(input) || isCalculationIntent(input) || isDatetimeIntent(input)) {
    return false;
  }

  return /\b(latest|recent|current|today|news|release|launched|announced|updated)\b/i.test(
    input
  );
}

function getForcedToolChoice(
  input: string,
  codeExecutionAvailable: boolean
):
  | { type: "tool"; toolName: "execute_code" | "calculate" | "get_current_datetime" | "analyze_github_repo" }
  | null {
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

  if (isCodeExecutionIntent(input, codeExecutionAvailable)) {
    hints.push(
      "- Strong routing signal: this request is execution-oriented, so use `execute_code` before giving analysis."
    );
  } else if (isCalculationIntent(input)) {
    hints.push("- Strong routing signal: this request is numeric, so use `calculate`.");
  } else if (isDatetimeIntent(input)) {
    hints.push("- Strong routing signal: this request is time-sensitive, so use `get_current_datetime`.");
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

const baseAgentTools = {
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
      "Analyze a public GitHub repository. Returns repository metadata, README content, top-level file structure, and language breakdown. Use when the user provides a GitHub URL or an 'owner/repo' string and wants to understand or discuss the repository.",
    parameters: z.object({
      repo: z
        .string()
        .describe(
          "GitHub repository as 'owner/repo' or a full URL such as 'https://github.com/owner/repo'"
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

      const headers: Record<string, string> = {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "Jarvis-Super-Agent/1.0",
      };
      const token = process.env.GITHUB_TOKEN;
      if (token) headers["Authorization"] = `Bearer ${token}`;

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
                "GitHub API rate limit reached. Set the GITHUB_TOKEN environment variable for a higher rate limit.",
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
      "Read the complete code contents of a specific file in the GitHub repository before making edits.",
    parameters: z.object({
      owner: z.string().describe("The GitHub username (e.g., 'Tanjiro-1122')."),
      repo: z.string().describe("The repository name (e.g., 'Jarvis')."),
      path: z
        .string()
        .describe("The path to the file relative to the repo root (e.g., 'app/api/chat/route.ts')."),
    }),
    execute: async ({ owner, repo, path }) => {
      try {
        const { data } = await octokit.repos.getContent({
          owner,
          repo,
          path,
        });

        if (
          !Array.isArray(data) &&
          "content" in data &&
          data.encoding === "base64" &&
          typeof data.content === "string"
        ) {
          const decodedContent = Buffer.from(data.content, "base64").toString("utf-8");
          return { success: true, path, content: decodedContent };
        }
        return {
          success: false,
          error: "File format is not readable text or layout is invalid.",
        };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },
  }),

  listRepositoryTree: tool({
    description:
      "List the complete file structure and folder layout of the GitHub repository.",
    parameters: z.object({
      owner: z.string().describe("The GitHub username."),
      repo: z.string().describe("The repository name."),
    }),
    execute: async ({ owner, repo }) => {
      try {
        const { data: repoData } = await octokit.repos.get({ owner, repo });
        const defaultBranch = repoData.default_branch;

        const { data: refData } = await octokit.git.getRef({
          owner,
          repo,
          ref: `heads/${defaultBranch}`,
        });

        const { data: treeData } = await octokit.git.getTree({
          owner,
          repo,
          tree_sha: refData.object.sha,
          recursive: "true",
        });

        const filePaths = treeData.tree
          .filter((item) => item.type === "blob" && typeof item.path === "string")
          .map((item) => item.path);

        return { success: true, defaultBranch, files: filePaths };
      } catch (error: any) {
        return { success: false, error: error.message };
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
    const {
      messages,
      sessionId,
      conversationId,
      workspaceId,
      resumeTaskId,
    }: {
      messages: UIMessage[];
      sessionId?: string;
      conversationId?: string;
      workspaceId?: string;
      resumeTaskId?: string;
    } =
      await req.json();
    requestSessionId = sessionId ?? null;
    requestWorkspaceId = workspaceId;
    requestConversationId = conversationId;

    if (!sessionId || sessionId.length > MAX_SESSION_ID_LENGTH) {
      return new Response(
        JSON.stringify({ error: "Invalid sessionId." }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

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
        detail: `Intent detected: ${plannerOutput.intent}.`,
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

    const result = streamText({
      model: openai("gpt-4o-mini"),
      system: `You are Jarvis, a self-healing autonomous workspace developer agent. You are intelligent, capable, and methodical.

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

### Document and code context
- When a user uploads a code file or text document, read it carefully and reference specific sections in your response
- For large documents the model receives the full text; use it directly without hedging about "not being able to access files"
- Summarize, critique, explain, refactor, or answer questions about uploaded content with precision
${workspaceContextSection}

## Planner / Executor
- Intent: ${plannerOutput.intent}
- Plan:
${plannerOutput.steps
  .map((step, index) => `${index + 1}. ${step.label} — ${step.detail}`)
  .join("\n")}
- Follow the plan in order unless the user explicitly asks to change course.
- Report progress in your final response against the numbered plan steps.

### Capability-accurate responses
- Do NOT use generic disclaimers such as "I can't access the internet" or "I have no access to external systems" as blanket statements
- Be precise: if a specific tool is available and configured, say so and use it
- If \`web_search\` is unavailable because TAVILY_API_KEY is not set, say exactly: "Web search is not enabled in this deployment. You can add a TAVILY_API_KEY to enable it, or paste the content you want me to analyze."
- If \`analyze_github_repo\` fails because a repo is private, say so and ask the user to paste the relevant code or file contents
- If sandboxed code execution is available, describe the limits precisely: small JavaScript/TypeScript only, no imports, no network/filesystem/process access, and strict timeout/output limits
- If sandboxed code execution is unavailable, say exactly why based on the deployment configuration instead of using a generic disclaimer
- If a capability is genuinely absent (e.g., writing files outside the sandbox or sending emails), state the specific limitation and suggest the best available alternative

### Formatting
- Format responses in Markdown: **bold**, \`code\`, lists, headers, fenced code blocks
- Be thorough yet concise. Prioritize accuracy and practical value.`,
      messages: convertToCoreMessages(messages),
      tools: agentTools,
      toolChoice: forcedToolChoice ?? "auto",
      maxSteps: 5,
      onFinish: async ({ text }) => {
        if (!lastUserMessage) return;

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
