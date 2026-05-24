import { getRuneRuntimeIdentity } from "@/lib/project-runtime";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";
import { Octokit } from "@octokit/rest";
import { getSupabaseClient } from "@/lib/supabase";
import { logError } from "@/lib/errors";
import { logActionEvent } from "@/lib/action-events";
import { inferRepoActionTargets, validateRepoActionTargets } from "@/lib/repo-targeting";

export type RepoActionRisk = "low" | "medium" | "high";
export type RepoActionStatus = "draft" | "proposed" | "approved" | "rejected" | "blocked" | "executed" | "cancelled";

export interface RepoActionFileTarget {
  path: string;
  operation?: "create" | "update" | "delete" | "inspect";
  note?: string;
}

export interface RepoActionProposalInput {
  title: string;
  summary: string;
  findings?: string;
  plan?: string;
  repo?: string | null;
  projectKey?: string | null;
  riskLevel?: RepoActionRisk;
  files?: RepoActionFileTarget[];
  diffPreview?: string;
  sessionId?: string | null;
  workspaceId?: string | null;
  conversationId?: string | null;
}

export interface RepoActionProposalRow {
  id: string;
  title: string;
  summary: string;
  findings: string;
  plan: string;
  repo: string;
  project_key: string;
  risk_level: RepoActionRisk;
  status: RepoActionStatus;
  files: RepoActionFileTarget[];
  diff_preview: string;
  approval_note: string | null;
  draft_metadata: Record<string, unknown>;
  session_id: string | null;
  workspace_id: string | null;
  conversation_id: string | null;
  created_at: string;
  updated_at: string;
  approved_at: string | null;
  executed_at: string | null;
}

const VALID_RISKS: RepoActionRisk[] = ["low", "medium", "high"];
const VALID_STATUSES: RepoActionStatus[] = ["draft", "proposed", "approved", "rejected", "blocked", "executed", "cancelled"];
const RUNE_RUNTIME = getRuneRuntimeIdentity();
const DEFAULT_REPO = RUNE_RUNTIME.repo;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NUMERIC_ID_RE = /^\d{8,}$/;

export function isRepoActionProposalId(value: string | null | undefined) {
  return UUID_RE.test(cleanText(value, 120));
}

export function repoActionProposalIdError(value: string | null | undefined) {
  const cleaned = cleanText(value, 120);
  if (!cleaned) return "Repo Control proposal ID is required.";
  if (NUMERIC_ID_RE.test(cleaned)) {
    return "That looks like a GitHub Actions run ID, not a Repo Control proposal ID. Use the proposal UUID from the Repo Control card, or inspect the workflow run with the build/app-health tools instead.";
  }
  return "Invalid Repo Control proposal ID. Proposal IDs must be UUIDs from a Repo Control proposal card.";
}

function normalizeRepoActionProposalId(value: string | null | undefined) {
  const id = cleanText(value, 120);
  return isRepoActionProposalId(id) ? id : null;
}

function invalidRepoActionProposalResult(value: string | null | undefined) {
  return { ok: false as const, error: repoActionProposalIdError(value), invalidProposalId: true as const };
}

function getRepoParts(repoSlug: string) {
  const raw = cleanText(repoSlug || DEFAULT_REPO, 180);
  const match = raw.match(/github\.com\/([^/\s]+\/[^/\s#?]+)|^([^/\s]+\/[^/\s#?]+)$/i);
  const slug = (match?.[1] || match?.[2] || DEFAULT_REPO).replace(/\.git$/i, "");
  const [owner, repo] = slug.split("/");
  return { owner, repo, slug };
}

function getGitHubClient() {
  const token = process.env.GITHUB_TOKEN || process.env.RUNE_GITHUB_TOKEN;
  return new Octokit({
    ...(token ? { auth: token } : {}),
    userAgent: "Rune-Repo-Inspector/1.0 (+https://github.com/Tanjiro-1122/Rune)",
  });
}

function decodeBase64Content(value: string) {
  return Buffer.from(value.replace(/\n/g, ""), "base64").toString("utf8");
}

function snippetContent(value: string, maxChars = 1800) {
  const cleaned = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g, "").trim();
  if (cleaned.length <= maxChars) return cleaned;
  return `${cleaned.slice(0, maxChars)}\n…`;
}

interface RepoFileSnapshot {
  path: string;
  operation: string;
  status: "found" | "missing" | "error" | "skipped";
  sha?: string;
  size?: number;
  content?: string;
  message?: string;
}

function limitFileForDiff(value: string, maxChars = 9000) {
  const cleaned = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g, "");
  if (cleaned.length <= maxChars) return cleaned;
  return `${cleaned.slice(0, maxChars)}\n/* …truncated for proposal generation… */`;
}

function sanitizeUnifiedDiff(value: string) {
  let text = cleanMultiline(value, 24000);
  text = text.replace(/^```(?:diff|patch)?\s*/i, "").replace(/```$/i, "").trim();
  if (!text.includes("diff --git") && !text.includes("--- ") && !text.includes("+++ ")) {
    text = `# Proposed change summary\n${text}`;
  }
  return text;
}

function cleanText(value: unknown, maxChars = 4000) {
  const text = String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
}

function cleanMultiline(value: unknown, maxChars = 8000) {
  const text = String(value ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g, "").trim();
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n…` : text;
}

function normalizeProjectKey(value: unknown) {
  const cleaned = cleanText(value, 80).toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned || "rune";
}

function normalizeRisk(value: unknown): RepoActionRisk {
  return VALID_RISKS.includes(value as RepoActionRisk) ? (value as RepoActionRisk) : "medium";
}

function normalizeStatus(value: unknown): RepoActionStatus {
  return VALID_STATUSES.includes(value as RepoActionStatus) ? (value as RepoActionStatus) : "proposed";
}

function cleanFiles(files: unknown): RepoActionFileTarget[] {
  if (!Array.isArray(files)) return [];
  return files.slice(0, 20).map((file) => {
    const item = file && typeof file === "object" ? file as Record<string, unknown> : {};
    const operation = ["create", "update", "delete", "inspect"].includes(String(item.operation))
      ? item.operation as RepoActionFileTarget["operation"]
      : "inspect";
    return {
      path: cleanText(item.path, 240),
      operation,
      note: item.note ? cleanText(item.note, 500) : undefined,
    };
  }).filter((file) => file.path);
}


interface ParsedDiffFile {
  oldPath: string;
  newPath: string;
  path: string;
  operation: "create" | "update" | "delete" | "unknown";
  additions: number;
  deletions: number;
}

function extractDiffBody(preview: string) {
  const fenced = preview.match(/```diff\s*([\s\S]*?)```/i) || preview.match(/```patch\s*([\s\S]*?)```/i);
  return (fenced?.[1] || preview).trim();
}

function parseUnifiedDiff(preview: string): ParsedDiffFile[] {
  const diff = extractDiffBody(preview);
  const lines = diff.split(/\r?\n/);
  const files: ParsedDiffFile[] = [];
  let current: ParsedDiffFile | null = null;

  for (const line of lines) {
    const gitMatch = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (gitMatch) {
      current = {
        oldPath: gitMatch[1],
        newPath: gitMatch[2],
        path: gitMatch[2],
        operation: "update",
        additions: 0,
        deletions: 0,
      };
      files.push(current);
      continue;
    }

    if (!current) continue;
    if (line.startsWith("new file mode")) current.operation = "create";
    if (line.startsWith("deleted file mode")) current.operation = "delete";
    if (line.startsWith("--- /dev/null")) current.operation = "create";
    if (line.startsWith("+++ /dev/null")) current.operation = "delete";
    if (line.startsWith("+++") && !line.startsWith("+++ /dev/null")) {
      const nextPath = line.replace(/^\+\+\+ b\//, "").replace(/^\+\+\+ /, "").trim();
      if (nextPath) {
        current.newPath = nextPath;
        current.path = nextPath;
      }
    }
    if (line.startsWith("+") && !line.startsWith("+++")) current.additions += 1;
    if (line.startsWith("-") && !line.startsWith("---")) current.deletions += 1;
  }

  return files;
}


export function getAllowedRepoSlugs() {
  const configured = (process.env.JARVIS_ALLOWED_REPOS || "")
    .split(",")
    .map((repo) => repo.trim())
    .filter(Boolean);
  return new Set([DEFAULT_REPO, process.env.RUNE_GITHUB_REPO || DEFAULT_REPO, process.env.JARVIS_GITHUB_REPO || DEFAULT_REPO, ...configured].map((repo) => getRepoParts(repo).slug.toLowerCase()));
}

export function isRepoAllowed(repoSlug: string) {
  return getAllowedRepoSlugs().has(getRepoParts(repoSlug).slug.toLowerCase());
}

function getAuthenticatedCloneUrl(slug: string) {
  const token = process.env.GITHUB_TOKEN || process.env.RUNE_GITHUB_TOKEN;
  if (token) return `https://x-access-token:${encodeURIComponent(token)}@github.com/${slug}.git`;
  return `https://github.com/${slug}.git`;
}


function slugifyBranchPart(value: string, maxChars = 60) {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxChars)
    .replace(/-+$/g, "");
  return cleaned || "repo-action";
}

function makeRepoActionBranchName(proposal: RepoActionProposalRow) {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const shortId = proposal.id.replace(/[^a-z0-9]/gi, "").slice(0, 8).toLowerCase() || "patch";
  return `rune/${proposal.project_key}/${date}-${slugifyBranchPart(proposal.title)}-${shortId}`;
}


function isoFromUnknownTimestamp(value: unknown) {
  if (typeof value === "number") return new Date(value < 10_000_000_000 ? value * 1000 : value).toISOString();
  if (typeof value === "string" && value) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return null;
}

async function getVercelDeploymentForBranch(branch?: string | null) {
  const token = process.env.VERCEL_TOKEN || process.env.RUNE_VERCEL_TOKEN;
  const project = RUNE_RUNTIME.vercelProjectId || process.env.VERCEL_PROJECT_NAME || process.env.JARVIS_VERCEL_PROJECT_NAME;
  const teamId = process.env.VERCEL_TEAM_ID || process.env.JARVIS_VERCEL_TEAM_ID;
  if (!token) return { configured: false, error: "Vercel token not configured." };

  try {
    const params = new URLSearchParams({ limit: "10" });
    if (project) params.set("projectId", project);
    if (teamId) params.set("teamId", teamId);
    if (branch) params.set("gitBranch", branch);

    const response = await fetch(`https://api.vercel.com/v6/deployments?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Vercel API ${response.status}: ${text.slice(0, 180)}`);
    }
    const payload = (await response.json()) as {
      deployments?: Array<{
        uid?: string;
        name?: string | null;
        state?: string | null;
        url?: string | null;
        createdAt?: number;
        ready?: number;
        readyAt?: number;
        target?: string | null;
        meta?: Record<string, unknown>;
      }>;
    };
    const deployment = payload.deployments?.[0] ?? null;
    return {
      configured: true,
      project: project || null,
      deployment: deployment ? {
        uid: deployment.uid,
        name: deployment.name,
        state: deployment.state,
        url: deployment.url ? `https://${deployment.url}` : null,
        createdAt: isoFromUnknownTimestamp(deployment.createdAt),
        readyAt: isoFromUnknownTimestamp(deployment.readyAt ?? deployment.ready),
        target: deployment.target,
        gitBranch: deployment.meta?.githubCommitRef || branch || null,
      } : null,
    };
  } catch (error) {
    logError("repoActions.getVercelDeploymentForBranch", error);
    return { configured: true, project: project || null, error: error instanceof Error ? error.message : "Unable to inspect Vercel deployment." };
  }
}

function summarizeCheckConclusion(value?: string | null) {
  if (!value) return "pending";
  return value;
}

function buildPrBody(proposal: RepoActionProposalRow, metadata: Record<string, unknown>, diffBody: string) {
  const sandboxReady = metadata.sandbox_ready === true;
  const tempReady = metadata.temp_workspace_ready === true;
  return [
    "## Rune controlled repo action",
    "",
    proposal.summary,
    "",
    "## Safety ladder",
    "",
    `- Draft diff: ${metadata.draft_type ? "completed" : "not recorded"}`,
    `- File inspection: ${metadata.inspected_at ? "completed" : "not recorded"}`,
    `- Sandbox check: ${sandboxReady ? "passed" : "not passed"}`,
    `- Temporary workspace build: ${tempReady ? "passed" : "not passed"}`,
    "- Direct push to main: not used",
    "- Auto-merge: not used",
    "",
    "## Findings",
    "",
    proposal.findings || "No findings recorded.",
    "",
    "## Plan",
    "",
    proposal.plan || "No plan recorded.",
    "",
    "## Approval note",
    "",
    proposal.approval_note || "Approved in Rune Repo Control.",
    "",
    "## Diff preview",
    "",
    "```diff",
    cleanMultiline(diffBody, 10000),
    "```",
  ].join("\n");
}

function redactedCommandOutput(value: string, maxChars = 9000) {
  const secrets = [process.env.GITHUB_TOKEN, process.env.RUNE_GITHUB_TOKEN, process.env.OPENAI_API_KEY, process.env.SUPABASE_SERVICE_ROLE_KEY]
    .filter((item): item is string => Boolean(item));
  let text = value;
  for (const secret of secrets) text = text.split(secret).join("[redacted]");
  text = text.replace(/x-access-token:[^@\s]+@github\.com/gi, "x-access-token:[redacted]@github.com");
  return cleanMultiline(text, maxChars);
}

function runCommand(command: string, args: string[], cwd: string, timeoutMs = 120000): Promise<{ ok: boolean; code: number | null; output: string; durationMs: number }> {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(command, args, {
      cwd,
      env: {
        ...process.env,
        CI: "1",
        NEXT_TELEMETRY_DISABLED: "1",
      },
      shell: false,
    });
    let output = "";
    const timer = setTimeout(() => {
      output += `\n[Rune sandbox] Command timed out after ${timeoutMs}ms and was stopped.`;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout.on("data", (data) => { output += data.toString(); });
    child.stderr.on("data", (data) => { output += data.toString(); });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ ok: false, code: null, output: redactedCommandOutput(`${output}\n${error.message}`), durationMs: Date.now() - started });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, code, output: redactedCommandOutput(output), durationMs: Date.now() - started });
    });
  });
}

function detectSandboxRisks(files: ParsedDiffFile[], diffBody: string) {
  const risks: string[] = [];
  const warnings: string[] = [];
  const riskyPathPatterns = [
    /^\.env/i,
    /secret/i,
    /credential/i,
    /private[_-]?key/i,
    /node_modules\//i,
    /package-lock\.json$/i,
    /middleware\.ts$/i,
    /auth/i,
    /security/i,
    /supabase\/schema\.sql$/i,
  ];
  const riskyContentPatterns = [
    /OPENAI_API_KEY\s*=/i,
    /SUPABASE_SERVICE_ROLE_KEY\s*=/i,
    /PRIVATE KEY/i,
    /BEGIN RSA PRIVATE KEY/i,
    /password\s*[:=]/i,
    /api[_-]?key\s*[:=]/i,
  ];

  for (const file of files) {
    if (file.operation === "delete") risks.push(`Deletes ${file.path}`);
    if (file.additions + file.deletions > 400) warnings.push(`Large change in ${file.path}: ${file.additions + file.deletions} changed lines`);
    if (riskyPathPatterns.some((pattern) => pattern.test(file.path))) warnings.push(`Sensitive/risky path touched: ${file.path}`);
  }

  for (const pattern of riskyContentPatterns) {
    if (pattern.test(diffBody)) risks.push(`Potential secret-like content detected by pattern ${pattern}`);
  }

  if (!files.length) risks.push("No unified diff files could be parsed from the proposal preview.");
  return { risks, warnings };
}

function approvalStageFor(status: RepoActionStatus) {
  if (status === "proposed" || status === "draft") return "plan";
  if (status === "approved") return "approval";
  if (status === "executed") return "complete";
  if (status === "blocked" || status === "rejected" || status === "cancelled") return "approval";
  return "none";
}

export async function createRepoActionProposal(input: RepoActionProposalInput) {
  const supabase = getSupabaseClient();
  if (!supabase) return { ok: false, error: "Supabase is not configured." };

  const title = cleanText(input.title, 180);
  const summary = cleanText(input.summary, 900);
  if (!title || !summary) return { ok: false, error: "Proposal title and summary are required." };

  const inferredTargets = inferRepoActionTargets({
    title,
    summary,
    findings: input.findings,
    plan: input.plan,
    repo: input.repo || process.env.JARVIS_GITHUB_REPO || DEFAULT_REPO,
    projectKey: input.projectKey,
    riskLevel: input.riskLevel,
    files: input.files,
  });

  const validatedTargets = await validateRepoActionTargets({
    repo: inferredTargets.repo,
    files: inferredTargets.files,
  });
  const targetingNotes = [
    validatedTargets.verified ? `Repo-tree validation checked ${validatedTargets.defaultBranch || "default"} branch.` : "Repo-tree validation was not completed.",
    ...validatedTargets.notes,
  ].filter(Boolean);

  const payload = {
    title,
    summary,
    findings: cleanMultiline(input.findings, 6000),
    plan: cleanMultiline(input.plan, 6000),
    repo: cleanText(inferredTargets.repo, 160),
    project_key: normalizeProjectKey(inferredTargets.projectKey),
    risk_level: normalizeRisk(inferredTargets.riskLevel),
    status: "proposed" as RepoActionStatus,
    files: cleanFiles(validatedTargets.files),
    diff_preview: cleanMultiline(input.diffPreview, 10000),
    draft_metadata: {
      targeting: {
        inferred: true,
        repo_tree_verified: validatedTargets.verified,
        default_branch: validatedTargets.defaultBranch,
        notes: targetingNotes.slice(0, 20),
      },
    },
    session_id: input.sessionId ? cleanText(input.sessionId, 120) : null,
    workspace_id: input.workspaceId || null,
    conversation_id: input.conversationId || null,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("jarvis_repo_action_proposals")
    .insert(payload)
    .select("id, title, summary, findings, plan, repo, project_key, risk_level, status, files, diff_preview, approval_note, draft_metadata, session_id, workspace_id, conversation_id, created_at, updated_at, approved_at, executed_at")
    .single();

  if (error) {
    logError("repoActions.createRepoActionProposal", error);
    return { ok: false, error: error.message };
  }

  await logActionEvent({
    eventType: "repo_action.proposed",
    summary: `Repo action proposed: ${title}`,
    status: "proposed",
    approvalStage: "plan",
    riskLevel: payload.risk_level,
    projectKey: payload.project_key,
    sessionId: payload.session_id,
    workspaceId: payload.workspace_id,
    conversationId: payload.conversation_id,
    metadata: { proposalId: data.id, repo: payload.repo, files: payload.files },
  });

  return { ok: true, proposal: data as RepoActionProposalRow };
}

export async function listRepoActionProposals(options: { projectKey?: string | null; limit?: number } = {}) {
  const supabase = getSupabaseClient();
  if (!supabase) return [] as RepoActionProposalRow[];

  const limit = Math.min(Math.max(options.limit ?? 20, 1), 80);
  let request = supabase
    .from("jarvis_repo_action_proposals")
    .select("id, title, summary, findings, plan, repo, project_key, risk_level, status, files, diff_preview, approval_note, draft_metadata, session_id, workspace_id, conversation_id, created_at, updated_at, approved_at, executed_at")
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (options.projectKey) {
    request = request.in("project_key", ["global", normalizeProjectKey(options.projectKey)]);
  }

  const { data, error } = await request;
  if (error) {
    logError("repoActions.listRepoActionProposals", error);
    return [] as RepoActionProposalRow[];
  }

  return (data ?? []) as RepoActionProposalRow[];
}


function inferDraftFiles(proposal: RepoActionProposalRow): RepoActionFileTarget[] {
  if (proposal.files?.length) return proposal.files;
  const text = `${proposal.title}
${proposal.summary}
${proposal.findings}
${proposal.plan}`.toLowerCase();
  const files: RepoActionFileTarget[] = [];

  if (text.includes("ui") || text.includes("layout") || text.includes("panel") || text.includes("drawer") || text.includes("button")) {
    files.push({ path: "components/chat.tsx", operation: "update", note: "Likely UI logic/component changes." });
    files.push({ path: "app/globals.css", operation: "update", note: "Likely styling changes." });
  }
  if (text.includes("api") || text.includes("route") || text.includes("backend")) {
    files.push({ path: "app/api/<route>/route.ts", operation: "update", note: "API route to inspect or update." });
  }
  if (text.includes("memory")) {
    files.push({ path: "app/api/memory/route.ts", operation: "inspect", note: "Memory API may be relevant." });
  }
  if (text.includes("repo") || text.includes("proposal") || text.includes("diff")) {
    files.push({ path: "lib/repo-actions.ts", operation: "update", note: "Repo proposal logic may be relevant." });
    files.push({ path: "app/api/repo-actions/route.ts", operation: "update", note: "Repo proposal API may be relevant." });
  }
  if (text.includes("supabase") || text.includes("schema") || text.includes("table")) {
    files.push({ path: "supabase/schema.sql", operation: "update", note: "Schema may need an idempotent migration." });
  }
  if (text.includes("docs") || text.includes("setup")) {
    files.push({ path: "docs/setup.md", operation: "update", note: "Setup documentation may need updating." });
  }

  const deduped = new Map<string, RepoActionFileTarget>();
  for (const file of files) deduped.set(file.path, file);
  return Array.from(deduped.values()).slice(0, 10);
}


async function getRepoFileSnapshots(proposal: RepoActionProposalRow) {
  const inferred = inferDraftFiles(proposal).filter((file) => !file.path.includes("<"));
  const targets = (proposal.files?.length ? proposal.files : inferred).filter((file) => !file.path.includes("<")).slice(0, 6);
  if (!targets.length) {
    return { ok: false as const, error: "No concrete file targets found yet. Add file targets with Draft diff first or make the proposal more specific." };
  }

  const { owner, repo, slug } = getRepoParts(proposal.repo);
  const octokit = getGitHubClient();
  let defaultBranch = "main";

  try {
    const repository = await octokit.repos.get({ owner, repo });
    defaultBranch = repository.data.default_branch || "main";
  } catch (error) {
    logError("repoActions.getRepoFileSnapshots.repo", error);
    return { ok: false as const, error: error instanceof Error ? error.message : "Unable to read GitHub repo." };
  }

  const snapshots: RepoFileSnapshot[] = [];
  for (const target of targets) {
    const operation = target.operation ?? "inspect";
    if (operation === "create") {
      snapshots.push({ path: target.path, operation, status: "skipped", message: "Create target — no existing file expected." });
      continue;
    }

    try {
      const response = await octokit.repos.getContent({ owner, repo, path: target.path, ref: defaultBranch });
      const content = response.data;
      if (Array.isArray(content) || content.type !== "file" || !("content" in content)) {
        snapshots.push({ path: target.path, operation, status: "skipped", message: "Target is not a plain file." });
        continue;
      }
      const decoded = decodeBase64Content(content.content || "");
      snapshots.push({ path: target.path, operation, status: "found", sha: content.sha, size: content.size, content: decoded });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to read file.";
      snapshots.push({ path: target.path, operation, status: message.includes("Not Found") ? "missing" : "error", message });
    }
  }

  return { ok: true as const, slug, branch: defaultBranch, targets, snapshots };
}

function buildDraftPreview(proposal: RepoActionProposalRow, files: RepoActionFileTarget[]) {
  const lines = [
    `# Draft diff preview — ${proposal.title}`,
    `Repo: ${proposal.repo}`,
    `Project: ${proposal.project_key}`,
    `Risk: ${proposal.risk_level}`,
    "",
    "This is a review draft only. No files have been changed and no commit has been pushed.",
    "",
    "## Findings",
    proposal.findings || proposal.summary || "Findings need to be confirmed before execution.",
    "",
    "## Plan",
    proposal.plan || "1. Inspect the target files.\n2. Make the smallest safe change.\n3. Run build/checks.\n4. Show exact diff before commit.",
    "",
    "## Proposed file targets",
    ...(files.length ? files.map((file) => `- ${file.operation ?? "inspect"}: ${file.path}${file.note ? ` — ${file.note}` : ""}`) : ["- inspect: target files still need to be identified"]),
    "",
    "## Draft patch outline",
    "```diff",
    "diff --git a/<target-file> b/<target-file>",
    "--- a/<target-file>",
    "+++ b/<target-file>",
    "@@",
    "+ Proposed changes will appear here after Rune inspects the files and Javier approves execution scope.",
    "```",
    "",
    "Approval checkpoint: Javier must approve the real diff before commit/push.",
  ];
  return lines.join("\n");
}

export async function draftRepoActionDiff(options: { id: string }) {
  const supabase = getSupabaseClient();
  if (!supabase) return { ok: false, error: "Supabase is not configured." };

  const id = normalizeRepoActionProposalId(options.id);
  if (!id) return invalidRepoActionProposalResult(options.id);

  const { data: existing, error: fetchError } = await supabase
    .from("jarvis_repo_action_proposals")
    .select("id, title, summary, findings, plan, repo, project_key, risk_level, status, files, diff_preview, approval_note, draft_metadata, session_id, workspace_id, conversation_id, created_at, updated_at, approved_at, executed_at")
    .eq("id", id)
    .single();

  if (fetchError || !existing) {
    logError("repoActions.draftRepoActionDiff.fetch", fetchError);
    return { ok: false, error: fetchError?.message ?? "Proposal not found." };
  }

  const proposal = existing as RepoActionProposalRow;
  if (["rejected", "blocked", "cancelled", "executed"].includes(proposal.status)) {
    return { ok: false, error: `Cannot draft diff for a ${proposal.status} proposal.` };
  }

  const files = inferDraftFiles(proposal);
  const diffPreview = buildDraftPreview(proposal, files);
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("jarvis_repo_action_proposals")
    .update({
      files,
      diff_preview: diffPreview,
      draft_metadata: {
        drafted_at: now,
        draft_type: "review_preview",
        safety: "no_files_changed_no_commit_pushed",
      },
      updated_at: now,
    })
    .eq("id", id)
    .select("id, title, summary, findings, plan, repo, project_key, risk_level, status, files, diff_preview, approval_note, draft_metadata, session_id, workspace_id, conversation_id, created_at, updated_at, approved_at, executed_at")
    .single();

  if (error) {
    logError("repoActions.draftRepoActionDiff.update", error);
    return { ok: false, error: error.message };
  }

  const updated = data as RepoActionProposalRow;
  await logActionEvent({
    eventType: "repo_action.diff_drafted",
    summary: `Draft diff prepared: ${updated.title}`,
    status: "proposed",
    approvalStage: "plan",
    riskLevel: updated.risk_level,
    projectKey: updated.project_key,
    sessionId: updated.session_id,
    workspaceId: updated.workspace_id,
    conversationId: updated.conversation_id,
    metadata: { proposalId: updated.id, repo: updated.repo, files },
  });

  return { ok: true, proposal: updated };
}


export async function inspectRepoActionFiles(options: { id: string }) {
  const supabase = getSupabaseClient();
  if (!supabase) return { ok: false, error: "Supabase is not configured." };

  const id = normalizeRepoActionProposalId(options.id);
  if (!id) return invalidRepoActionProposalResult(options.id);

  const { data: existing, error: fetchError } = await supabase
    .from("jarvis_repo_action_proposals")
    .select("id, title, summary, findings, plan, repo, project_key, risk_level, status, files, diff_preview, approval_note, draft_metadata, session_id, workspace_id, conversation_id, created_at, updated_at, approved_at, executed_at")
    .eq("id", id)
    .single();

  if (fetchError || !existing) {
    logError("repoActions.inspectRepoActionFiles.fetch", fetchError);
    return { ok: false, error: fetchError?.message ?? "Proposal not found." };
  }

  const proposal = existing as RepoActionProposalRow;
  if (["rejected", "blocked", "cancelled", "executed"].includes(proposal.status)) {
    return { ok: false, error: `Cannot inspect repo files for a ${proposal.status} proposal.` };
  }

  const inferred = inferDraftFiles(proposal).filter((file) => !file.path.includes("<"));
  const targets = (proposal.files?.length ? proposal.files : inferred).filter((file) => !file.path.includes("<")).slice(0, 8);
  if (!targets.length) {
    return { ok: false, error: "No concrete file targets found yet. Add file targets with Draft diff first or make the proposal more specific." };
  }

  const { owner, repo, slug } = getRepoParts(proposal.repo);
  const octokit = getGitHubClient();
  const inspections: Array<{
    path: string;
    operation: string;
    status: "found" | "missing" | "error" | "skipped";
    sha?: string;
    size?: number;
    snippet?: string;
    message?: string;
  }> = [];

  let defaultBranch = "main";
  try {
    const repository = await octokit.repos.get({ owner, repo });
    defaultBranch = repository.data.default_branch || "main";
  } catch (error) {
    logError("repoActions.inspectRepoActionFiles.repo", error);
    return { ok: false, error: error instanceof Error ? error.message : "Unable to read GitHub repo." };
  }

  for (const target of targets) {
    const operation = target.operation ?? "inspect";
    if (operation === "create") {
      inspections.push({ path: target.path, operation, status: "skipped", message: "Create target — no existing file expected." });
      continue;
    }

    try {
      const response = await octokit.repos.getContent({ owner, repo, path: target.path, ref: defaultBranch });
      const content = response.data;
      if (Array.isArray(content) || content.type !== "file" || !("content" in content)) {
        inspections.push({ path: target.path, operation, status: "skipped", message: "Target is not a plain file." });
        continue;
      }
      const decoded = decodeBase64Content(content.content || "");
      inspections.push({ path: target.path, operation, status: "found", sha: content.sha, size: content.size, snippet: snippetContent(decoded) });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to read file.";
      inspections.push({ path: target.path, operation, status: message.includes("Not Found") ? "missing" : "error", message });
    }
  }

  const now = new Date().toISOString();
  const lines = [
    `# Real repo inspection — ${proposal.title}`,
    `Repo: ${slug}`,
    `Branch: ${defaultBranch}`,
    `Project: ${proposal.project_key}`,
    `Inspected: ${now}`,
    "",
    "This is a read-only inspection. No files were changed, no commit was created, and nothing was deployed.",
    "",
    "## File inspection results",
    ...inspections.flatMap((item) => [`- ${item.status.toUpperCase()} · ${item.operation}: ${item.path}${item.sha ? ` · ${item.sha.slice(0, 7)}` : ""}${item.size ? ` · ${item.size} bytes` : ""}`, item.message ? `  - ${item.message}` : ""].filter(Boolean)),
    "",
    "## Current file snippets",
    ...inspections.filter((item) => item.snippet).flatMap((item) => [`### ${item.path}`, "```", item.snippet ?? "", "```", ""]),
    "## Next checkpoint",
    "Rune can now prepare a real proposed code diff from these inspected files, but Javier must approve before any file change, commit, push, or deployment.",
  ];

  const { data, error } = await supabase
    .from("jarvis_repo_action_proposals")
    .update({
      files: targets,
      diff_preview: lines.join("\n"),
      draft_metadata: {
        inspected_at: now,
        inspect_type: "github_file_contents",
        repo: slug,
        branch: defaultBranch,
        files: inspections.map((item) => ({ path: item.path, operation: item.operation, status: item.status, sha: item.sha, size: item.size, message: item.message })),
        safety: "read_only_no_files_changed_no_commit_pushed",
      },
      updated_at: now,
    })
    .eq("id", id)
    .select("id, title, summary, findings, plan, repo, project_key, risk_level, status, files, diff_preview, approval_note, draft_metadata, session_id, workspace_id, conversation_id, created_at, updated_at, approved_at, executed_at")
    .single();

  if (error) {
    logError("repoActions.inspectRepoActionFiles.update", error);
    return { ok: false, error: error.message };
  }

  const updated = data as RepoActionProposalRow;
  await logActionEvent({
    eventType: "repo_action.files_inspected",
    summary: `Repo files inspected: ${updated.title}`,
    status: "proposed",
    approvalStage: "findings",
    riskLevel: updated.risk_level,
    projectKey: updated.project_key,
    sessionId: updated.session_id,
    workspaceId: updated.workspace_id,
    conversationId: updated.conversation_id,
    metadata: { proposalId: updated.id, repo: slug, branch: defaultBranch, files: inspections },
  });

  return { ok: true, proposal: updated };
}


export async function generateRepoActionProposedDiff(options: { id: string }) {
  const supabase = getSupabaseClient();
  if (!supabase) return { ok: false, error: "Supabase is not configured." };
  if (!process.env.OPENAI_API_KEY) return { ok: false, error: "OPENAI_API_KEY is not configured." };

  const id = normalizeRepoActionProposalId(options.id);
  if (!id) return invalidRepoActionProposalResult(options.id);

  const { data: existing, error: fetchError } = await supabase
    .from("jarvis_repo_action_proposals")
    .select("id, title, summary, findings, plan, repo, project_key, risk_level, status, files, diff_preview, approval_note, draft_metadata, session_id, workspace_id, conversation_id, created_at, updated_at, approved_at, executed_at")
    .eq("id", id)
    .single();

  if (fetchError || !existing) {
    logError("repoActions.generateRepoActionProposedDiff.fetch", fetchError);
    return { ok: false, error: fetchError?.message ?? "Proposal not found." };
  }

  const proposal = existing as RepoActionProposalRow;
  if (["rejected", "blocked", "cancelled", "executed"].includes(proposal.status)) {
    return { ok: false, error: `Cannot generate a proposed diff for a ${proposal.status} proposal.` };
  }

  const snapshotResult = await getRepoFileSnapshots(proposal);
  if (!snapshotResult.ok) return { ok: false, error: snapshotResult.error };

  const fileContext = snapshotResult.snapshots.map((file) => {
    if (file.status !== "found") {
      return `FILE: ${file.path}\nSTATUS: ${file.status}\nMESSAGE: ${file.message ?? "No content available."}`;
    }
    return [
      `FILE: ${file.path}`,
      `OPERATION: ${file.operation}`,
      `SHA: ${file.sha}`,
      `SIZE: ${file.size} bytes`,
      "CONTENT:",
      "```",
      limitFileForDiff(file.content ?? ""),
      "```",
    ].join("\n");
  }).join("\n\n---\n\n");

  const model = process.env.JARVIS_PATCH_MODEL || process.env.RUNE_CHAT_MODEL || "gpt-4o-mini";
  const prompt = [
    "You are Rune, Javier's cautious private developer agent.",
    "Create a focused review-only unified diff proposal from the repo files below.",
    "Rules:",
    "- Output ONLY the proposed diff and short inline comments inside the diff when needed.",
    "- Use unified diff format with diff --git headers when changing existing files.",
    "- Do not include secrets or credentials.",
    "- Do not invent unrelated files.",
    "- Keep the change minimal and directly tied to the proposal.",
    "- If the file context is insufficient, output a clear blocked note starting with '# BLOCKED'.",
    "- This is review-only; do not claim anything was committed or deployed.",
    "",
    `Repo: ${snapshotResult.slug}`,
    `Branch: ${snapshotResult.branch}`,
    `Project: ${proposal.project_key}`,
    `Risk: ${proposal.risk_level}`,
    "",
    "Proposal title:",
    proposal.title,
    "",
    "Summary:",
    proposal.summary,
    "",
    "Findings:",
    proposal.findings || "None recorded.",
    "",
    "Plan:",
    proposal.plan || "None recorded.",
    "",
    "File context:",
    fileContext,
  ].join("\n");

  let proposedDiff = "";
  try {
    const result = await generateText({
      model: openai(model),
      temperature: 0.1,
      maxTokens: 3500,
      prompt,
    });
    proposedDiff = sanitizeUnifiedDiff(result.text);
  } catch (error) {
    logError("repoActions.generateRepoActionProposedDiff.openai", error);
    return { ok: false, error: error instanceof Error ? error.message : "Unable to generate proposed diff." };
  }

  const now = new Date().toISOString();
  const preview = [
    `# Proposed real diff — ${proposal.title}`,
    `Repo: ${snapshotResult.slug}`,
    `Branch: ${snapshotResult.branch}`,
    `Generated: ${now}`,
    "",
    "This is a review-only proposed diff. No files were changed, no commit was created, and nothing was deployed.",
    "",
    "```diff",
    proposedDiff,
    "```",
    "",
    "Approval checkpoint: Javier must approve before any actual file change, commit, push, or deployment.",
  ].join("\n");

  const { data, error } = await supabase
    .from("jarvis_repo_action_proposals")
    .update({
      files: snapshotResult.targets,
      diff_preview: preview,
      draft_metadata: {
        generated_at: now,
        draft_type: "ai_unified_diff_proposal",
        model,
        repo: snapshotResult.slug,
        branch: snapshotResult.branch,
        source_files: snapshotResult.snapshots.map((item) => ({ path: item.path, status: item.status, sha: item.sha, size: item.size, message: item.message })),
        safety: "review_only_no_files_changed_no_commit_pushed",
      },
      updated_at: now,
    })
    .eq("id", id)
    .select("id, title, summary, findings, plan, repo, project_key, risk_level, status, files, diff_preview, approval_note, draft_metadata, session_id, workspace_id, conversation_id, created_at, updated_at, approved_at, executed_at")
    .single();

  if (error) {
    logError("repoActions.generateRepoActionProposedDiff.update", error);
    return { ok: false, error: error.message };
  }

  const updated = data as RepoActionProposalRow;
  await logActionEvent({
    eventType: "repo_action.diff_generated",
    summary: `Proposed diff generated: ${updated.title}`,
    status: "proposed",
    approvalStage: "plan",
    riskLevel: updated.risk_level,
    projectKey: updated.project_key,
    sessionId: updated.session_id,
    workspaceId: updated.workspace_id,
    conversationId: updated.conversation_id,
    metadata: { proposalId: updated.id, repo: snapshotResult.slug, branch: snapshotResult.branch, model, files: snapshotResult.targets },
  });

  return { ok: true, proposal: updated };
}


export async function sandboxCheckRepoActionDiff(options: { id: string }) {
  const supabase = getSupabaseClient();
  if (!supabase) return { ok: false, error: "Supabase is not configured." };

  const id = normalizeRepoActionProposalId(options.id);
  if (!id) return invalidRepoActionProposalResult(options.id);

  const { data: existing, error: fetchError } = await supabase
    .from("jarvis_repo_action_proposals")
    .select("id, title, summary, findings, plan, repo, project_key, risk_level, status, files, diff_preview, approval_note, draft_metadata, session_id, workspace_id, conversation_id, created_at, updated_at, approved_at, executed_at")
    .eq("id", id)
    .single();

  if (fetchError || !existing) {
    logError("repoActions.sandboxCheckRepoActionDiff.fetch", fetchError);
    return { ok: false, error: fetchError?.message ?? "Proposal not found." };
  }

  const proposal = existing as RepoActionProposalRow;
  if (["rejected", "blocked", "cancelled", "executed"].includes(proposal.status)) {
    return { ok: false, error: `Cannot sandbox check a ${proposal.status} proposal.` };
  }
  if (!proposal.diff_preview || !proposal.diff_preview.includes("diff")) {
    return { ok: false, error: "No generated diff preview found. Generate a diff before running the sandbox check." };
  }

  const diffBody = extractDiffBody(proposal.diff_preview);
  const parsedFiles = parseUnifiedDiff(proposal.diff_preview);
  const { risks, warnings } = detectSandboxRisks(parsedFiles, diffBody);
  const { owner, repo, slug } = getRepoParts(proposal.repo);
  const octokit = getGitHubClient();

  let defaultBranch = "main";
  try {
    const repository = await octokit.repos.get({ owner, repo });
    defaultBranch = repository.data.default_branch || "main";
  } catch (error) {
    logError("repoActions.sandboxCheckRepoActionDiff.repo", error);
    return { ok: false, error: error instanceof Error ? error.message : "Unable to read GitHub repo." };
  }

  const fileChecks: Array<{
    path: string;
    operation: ParsedDiffFile["operation"];
    status: "ok" | "missing" | "warning" | "error";
    sha?: string;
    message?: string;
    additions: number;
    deletions: number;
  }> = [];

  for (const file of parsedFiles.slice(0, 12)) {
    if (file.operation === "create") {
      fileChecks.push({ path: file.path, operation: file.operation, status: "ok", message: "Create operation does not require an existing file.", additions: file.additions, deletions: file.deletions });
      continue;
    }

    try {
      const response = await octokit.repos.getContent({ owner, repo, path: file.path, ref: defaultBranch });
      const content = response.data;
      if (Array.isArray(content) || content.type !== "file") {
        fileChecks.push({ path: file.path, operation: file.operation, status: "warning", message: "Target path exists but is not a plain file.", additions: file.additions, deletions: file.deletions });
      } else {
        fileChecks.push({ path: file.path, operation: file.operation, status: "ok", sha: content.sha, message: "Target file exists on GitHub.", additions: file.additions, deletions: file.deletions });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to read file.";
      fileChecks.push({ path: file.path, operation: file.operation, status: message.includes("Not Found") ? "missing" : "error", message, additions: file.additions, deletions: file.deletions });
      risks.push(`Target file missing or unreadable: ${file.path}`);
    }
  }

  const ready = risks.length === 0 && fileChecks.length > 0 && fileChecks.every((check) => check.status === "ok" || check.operation === "create");
  const now = new Date().toISOString();
  const report = [
    `# Controlled sandbox check — ${proposal.title}`,
    `Repo: ${slug}`,
    `Branch: ${defaultBranch}`,
    `Checked: ${now}`,
    `Result: ${ready ? "READY FOR APPROVAL REVIEW" : "NEEDS REVIEW / BLOCKED"}`,
    "",
    "This is a dry-run safety check. No files were changed, no build was run, no commit was created, and nothing was deployed.",
    "",
    "## Parsed diff files",
    ...(parsedFiles.length ? parsedFiles.map((file) => `- ${file.operation}: ${file.path} (+${file.additions}/-${file.deletions})`) : ["- No diff files parsed"]),
    "",
    "## GitHub target checks",
    ...(fileChecks.length ? fileChecks.map((check) => `- ${check.status.toUpperCase()} · ${check.operation}: ${check.path}${check.sha ? ` · ${check.sha.slice(0, 7)}` : ""}${check.message ? ` — ${check.message}` : ""}`) : ["- No file checks performed"]),
    "",
    "## Risks",
    ...(risks.length ? risks.map((risk) => `- ${risk}`) : ["- None detected"]),
    "",
    "## Warnings",
    ...(warnings.length ? warnings.map((warning) => `- ${warning}`) : ["- None detected"]),
    "",
    "## Next checkpoint",
    ready
      ? "Javier can review and approve a future execution step. Rune still cannot commit/push from this checkpoint."
      : "Resolve risks before approval or execution.",
    "",
    "## Proposed diff under review",
    "```diff",
    diffBody,
    "```",
  ].join("\n");

  const { data, error } = await supabase
    .from("jarvis_repo_action_proposals")
    .update({
      diff_preview: report,
      draft_metadata: {
        ...(proposal.draft_metadata || {}),
        sandbox_checked_at: now,
        sandbox_type: "dry_run_diff_validation",
        sandbox_ready: ready,
        repo: slug,
        branch: defaultBranch,
        parsed_files: parsedFiles,
        file_checks: fileChecks,
        risks,
        warnings,
        safety: "dry_run_no_files_changed_no_commit_pushed",
      },
      updated_at: now,
    })
    .eq("id", id)
    .select("id, title, summary, findings, plan, repo, project_key, risk_level, status, files, diff_preview, approval_note, draft_metadata, session_id, workspace_id, conversation_id, created_at, updated_at, approved_at, executed_at")
    .single();

  if (error) {
    logError("repoActions.sandboxCheckRepoActionDiff.update", error);
    return { ok: false, error: error.message };
  }

  const updated = data as RepoActionProposalRow;
  await logActionEvent({
    eventType: "repo_action.sandbox_checked",
    summary: `Sandbox check ${ready ? "ready" : "needs review"}: ${updated.title}`,
    status: ready ? "info" : "blocked",
    approvalStage: "plan",
    riskLevel: risks.length ? "high" : warnings.length ? "medium" : updated.risk_level,
    projectKey: updated.project_key,
    sessionId: updated.session_id,
    workspaceId: updated.workspace_id,
    conversationId: updated.conversation_id,
    metadata: { proposalId: updated.id, repo: slug, branch: defaultBranch, ready, risks, warnings, fileChecks },
  });

  return { ok: true, proposal: updated, ready, risks, warnings };
}


export async function runTemporaryWorkspaceBuildCheck(options: { id: string }) {
  const supabase = getSupabaseClient();
  if (!supabase) return { ok: false, error: "Supabase is not configured." };

  const id = normalizeRepoActionProposalId(options.id);
  if (!id) return invalidRepoActionProposalResult(options.id);

  const { data: existing, error: fetchError } = await supabase
    .from("jarvis_repo_action_proposals")
    .select("id, title, summary, findings, plan, repo, project_key, risk_level, status, files, diff_preview, approval_note, draft_metadata, session_id, workspace_id, conversation_id, created_at, updated_at, approved_at, executed_at")
    .eq("id", id)
    .single();

  if (fetchError || !existing) {
    logError("repoActions.runTemporaryWorkspaceBuildCheck.fetch", fetchError);
    return { ok: false, error: fetchError?.message ?? "Proposal not found." };
  }

  const proposal = existing as RepoActionProposalRow;
  if (["rejected", "blocked", "cancelled", "executed"].includes(proposal.status)) {
    return { ok: false, error: `Cannot run a temp workspace check for a ${proposal.status} proposal.` };
  }
  const metadata = proposal.draft_metadata || {};
  if (!metadata.sandbox_checked_at) {
    return { ok: false, error: "Run Sandbox check before the temporary workspace build check." };
  }
  if (!proposal.diff_preview || !proposal.diff_preview.includes("diff")) {
    return { ok: false, error: "No generated diff found. Generate a diff and run Sandbox check first." };
  }

  const { slug } = getRepoParts(proposal.repo);
  if (!isRepoAllowed(slug)) {
    return { ok: false, error: `Repo ${slug} is not allowlisted. Set JARVIS_ALLOWED_REPOS before sandbox execution.` };
  }

  const diffBody = extractDiffBody(proposal.diff_preview);
  const parsedFiles = parseUnifiedDiff(proposal.diff_preview);
  if (!parsedFiles.length) {
    return { ok: false, error: "No parseable unified diff files found." };
  }

  const now = new Date().toISOString();
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "jarvis-sandbox-"));
  const repoDir = path.join(tempRoot, "repo");
  const diffPath = path.join(tempRoot, "proposal.patch");
  const steps: Array<{ step: string; ok: boolean; code: number | null; durationMs: number; output: string }> = [];
  let ready = false;
  let cleanupOk = false;

  try {
    await writeFile(diffPath, diffBody, "utf8");

    const clone = await runCommand("git", ["clone", "--depth", "1", getAuthenticatedCloneUrl(slug), repoDir], tempRoot, 120000);
    steps.push({ step: "git clone", ...clone });
    if (!clone.ok) throw new Error("Temporary clone failed.");

    const applyCheck = await runCommand("git", ["apply", "--check", diffPath], repoDir, 60000);
    steps.push({ step: "git apply --check", ...applyCheck });
    if (!applyCheck.ok) throw new Error("Patch did not apply cleanly in the temporary workspace.");

    const apply = await runCommand("git", ["apply", diffPath], repoDir, 60000);
    steps.push({ step: "git apply", ...apply });
    if (!apply.ok) throw new Error("Patch apply failed in the temporary workspace.");

    const status = await runCommand("git", ["status", "--short"], repoDir, 30000);
    steps.push({ step: "git status --short", ...status });

    if (existsSync(path.join(repoDir, "package.json"))) {
      if (existsSync(path.join(repoDir, "package-lock.json"))) {
        const install = await runCommand("npm", ["ci", "--ignore-scripts"], repoDir, Number(process.env.JARVIS_SANDBOX_INSTALL_TIMEOUT_MS || 180000));
        steps.push({ step: "npm ci --ignore-scripts", ...install });
        if (!install.ok) throw new Error("Dependency install failed in the temporary workspace.");
      }

      const build = await runCommand("npm", ["run", "build", "--if-present"], repoDir, Number(process.env.JARVIS_SANDBOX_BUILD_TIMEOUT_MS || 180000));
      steps.push({ step: "npm run build --if-present", ...build });
      if (!build.ok) throw new Error("Build failed in the temporary workspace.");
    } else {
      steps.push({ step: "build detection", ok: true, code: 0, durationMs: 0, output: "No package.json found; build command skipped." });
    }

    ready = true;
  } catch (error) {
    steps.push({ step: "sandbox result", ok: false, code: null, durationMs: 0, output: error instanceof Error ? error.message : "Temporary workspace check failed." });
  } finally {
    try {
      await rm(tempRoot, { recursive: true, force: true });
      cleanupOk = true;
    } catch (error) {
      logError("repoActions.runTemporaryWorkspaceBuildCheck.cleanup", error);
    }
  }

  const report = [
    `# Temporary workspace build check — ${proposal.title}`,
    `Repo: ${slug}`,
    `Checked: ${now}`,
    `Result: ${ready ? "PASSED" : "FAILED / NEEDS REVIEW"}`,
    `Cleanup: ${cleanupOk ? "temporary workspace removed" : "cleanup warning logged"}`,
    "",
    "This check cloned the repo into a temporary server workspace, applied the proposed diff locally, ran validation/build commands, then removed the temporary folder.",
    "No GitHub files were changed, no commit was created, no push occurred, and nothing was deployed.",
    "",
    "## Files rehearsed",
    ...parsedFiles.map((file) => `- ${file.operation}: ${file.path} (+${file.additions}/-${file.deletions})`),
    "",
    "## Sandbox steps",
    ...steps.map((step) => [`### ${step.ok ? "PASS" : "FAIL"} · ${step.step}`, `Duration: ${step.durationMs}ms`, "```", step.output || "No output.", "```", ""].join("\n")),
    "## Proposed diff rehearsed",
    "```diff",
    diffBody,
    "```",
  ].join("\n");

  const { data, error } = await supabase
    .from("jarvis_repo_action_proposals")
    .update({
      diff_preview: report,
      draft_metadata: {
        ...metadata,
        temp_workspace_checked_at: now,
        temp_workspace_ready: ready,
        temp_workspace_cleanup_ok: cleanupOk,
        temp_workspace_steps: steps.map((step) => ({ step: step.step, ok: step.ok, code: step.code, durationMs: step.durationMs, output: redactedCommandOutput(step.output, 2500) })),
        safety: "temporary_workspace_only_no_commit_no_push_no_deploy",
      },
      updated_at: now,
    })
    .eq("id", id)
    .select("id, title, summary, findings, plan, repo, project_key, risk_level, status, files, diff_preview, approval_note, draft_metadata, session_id, workspace_id, conversation_id, created_at, updated_at, approved_at, executed_at")
    .single();

  if (error) {
    logError("repoActions.runTemporaryWorkspaceBuildCheck.update", error);
    return { ok: false, error: error.message };
  }

  const updated = data as RepoActionProposalRow;
  await logActionEvent({
    eventType: "repo_action.temp_workspace_checked",
    summary: `Temp workspace check ${ready ? "passed" : "failed"}: ${updated.title}`,
    status: ready ? "info" : "blocked",
    approvalStage: "plan",
    riskLevel: ready ? updated.risk_level : "high",
    projectKey: updated.project_key,
    sessionId: updated.session_id,
    workspaceId: updated.workspace_id,
    conversationId: updated.conversation_id,
    metadata: { proposalId: updated.id, repo: slug, ready, cleanupOk, steps: steps.map((step) => ({ step: step.step, ok: step.ok, code: step.code, durationMs: step.durationMs })) },
  });

  return { ok: true, proposal: updated, ready, cleanupOk };
}


export async function openRepoActionPullRequest(options: { id: string }) {
  const supabase = getSupabaseClient();
  if (!supabase) return { ok: false, error: "Supabase is not configured." };

  const id = normalizeRepoActionProposalId(options.id);
  if (!id) return invalidRepoActionProposalResult(options.id);

  const { data: existing, error: fetchError } = await supabase
    .from("jarvis_repo_action_proposals")
    .select("id, title, summary, findings, plan, repo, project_key, risk_level, status, files, diff_preview, approval_note, draft_metadata, session_id, workspace_id, conversation_id, created_at, updated_at, approved_at, executed_at")
    .eq("id", id)
    .single();

  if (fetchError || !existing) {
    logError("repoActions.openRepoActionPullRequest.fetch", fetchError);
    return { ok: false, error: fetchError?.message ?? "Proposal not found." };
  }

  const proposal = existing as RepoActionProposalRow;
  const metadata = proposal.draft_metadata || {};
  if (proposal.status !== "approved") {
    return { ok: false, error: "Proposal must be approved before Rune can open a PR." };
  }
  if (metadata.temp_workspace_ready !== true) {
    return { ok: false, error: "Temporary workspace build must pass before opening a PR." };
  }
  if (metadata.pr_url) {
    return { ok: true, proposal, prUrl: String(metadata.pr_url), branch: String(metadata.pr_branch || "") };
  }

  const { owner, repo, slug } = getRepoParts(proposal.repo);
  if (!isRepoAllowed(slug)) {
    return { ok: false, error: `Repo ${slug} is not allowlisted. Set JARVIS_ALLOWED_REPOS before opening PRs.` };
  }

  const diffBody = extractDiffBody(proposal.diff_preview);
  const parsedFiles = parseUnifiedDiff(proposal.diff_preview);
  if (!parsedFiles.length) return { ok: false, error: "No parseable diff found for PR creation." };

  const octokit = getGitHubClient();
  let defaultBranch = "main";
  try {
    const repository = await octokit.repos.get({ owner, repo });
    defaultBranch = repository.data.default_branch || "main";
    await octokit.git.getRef({ owner, repo, ref: `heads/${defaultBranch}` });
  } catch (error) {
    logError("repoActions.openRepoActionPullRequest.baseRef", error);
    return { ok: false, error: error instanceof Error ? error.message : "Unable to read GitHub base branch." };
  }

  const branch = makeRepoActionBranchName(proposal);
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "jarvis-pr-"));
  const repoDir = path.join(tempRoot, "repo");
  const diffPath = path.join(tempRoot, "proposal.patch");
  const steps: Array<{ step: string; ok: boolean; code: number | null; durationMs: number; output: string }> = [];
  let cleanupOk = false;

  try {
    await writeFile(diffPath, diffBody, "utf8");
    const clone = await runCommand("git", ["clone", "--depth", "1", "--branch", defaultBranch, getAuthenticatedCloneUrl(slug), repoDir], tempRoot, 120000);
    steps.push({ step: "git clone", ...clone });
    if (!clone.ok) throw new Error("Temporary clone failed.");

    const checkout = await runCommand("git", ["checkout", "-b", branch], repoDir, 30000);
    steps.push({ step: "git checkout -b", ...checkout });
    if (!checkout.ok) throw new Error("Branch creation failed locally.");

    const applyCheck = await runCommand("git", ["apply", "--check", diffPath], repoDir, 60000);
    steps.push({ step: "git apply --check", ...applyCheck });
    if (!applyCheck.ok) throw new Error("Patch did not apply cleanly.");

    const apply = await runCommand("git", ["apply", diffPath], repoDir, 60000);
    steps.push({ step: "git apply", ...apply });
    if (!apply.ok) throw new Error("Patch apply failed.");

    const status = await runCommand("git", ["status", "--short"], repoDir, 30000);
    steps.push({ step: "git status --short", ...status });
    if (!status.output.trim()) throw new Error("Patch produced no local changes.");

    const add = await runCommand("git", ["add", "--all"], repoDir, 30000);
    steps.push({ step: "git add --all", ...add });
    if (!add.ok) throw new Error("Git add failed.");

    const commitMessage = `Rune: ${proposal.title}`.slice(0, 240);
    const commit = await runCommand("git", ["commit", "-m", commitMessage], repoDir, 60000);
    steps.push({ step: "git commit", ...commit });
    if (!commit.ok) throw new Error("Git commit failed.");

    const commitShaResult = await runCommand("git", ["rev-parse", "HEAD"], repoDir, 30000);
    steps.push({ step: "git rev-parse HEAD", ...commitShaResult });
    if (!commitShaResult.ok || !commitShaResult.output.trim()) throw new Error("Unable to read commit SHA.");
    const commitSha = commitShaResult.output.trim().split(/\s+/)[0] || "";

    const push = await runCommand("git", ["push", "origin", `HEAD:${branch}`], repoDir, 120000);
    steps.push({ step: "git push branch", ...push });
    if (!push.ok) throw new Error("Branch push failed.");

    const pr = await octokit.pulls.create({
      owner,
      repo,
      title: `Rune: ${proposal.title}`.slice(0, 240),
      head: branch,
      base: defaultBranch,
      body: buildPrBody(proposal, metadata, diffBody),
      maintainer_can_modify: true,
    });

    const now = new Date().toISOString();
    const report = [
      `# Pull request opened — ${proposal.title}`,
      `Repo: ${slug}`,
      `Base: ${defaultBranch}`,
      `Branch: ${branch}`,
      `Commit: ${commitSha}`,
      `PR: ${pr.data.html_url}`,
      `Opened: ${now}`,
      `Cleanup: pending`,
      "",
      "Rune created a branch and opened a pull request after approval and a passing temporary workspace build.",
      "No merge was performed. Nothing was deployed by Rune.",
      "",
      "## PR steps",
      ...steps.map((step) => [`### ${step.ok ? "PASS" : "FAIL"} · ${step.step}`, `Duration: ${step.durationMs}ms`, "```", step.output || "No output.", "```", ""].join("\n")),
      "## Proposed diff",
      "```diff",
      diffBody,
      "```",
    ].join("\n");

    let finalCleanupOk = false;
    try {
      await rm(tempRoot, { recursive: true, force: true });
      cleanupOk = true;
      finalCleanupOk = true;
    } catch (error) {
      logError("repoActions.openRepoActionPullRequest.cleanup", error);
    }

    const { data, error } = await supabase
      .from("jarvis_repo_action_proposals")
      .update({
        diff_preview: report.replace("Cleanup: pending", `Cleanup: ${finalCleanupOk ? "temporary workspace removed" : "cleanup warning logged"}`),
        draft_metadata: {
          ...metadata,
          pr_opened_at: now,
          pr_url: pr.data.html_url,
          pr_number: pr.data.number,
          pr_branch: branch,
          pr_base: defaultBranch,
          pr_commit_sha: commitSha,
          pr_cleanup_ok: finalCleanupOk,
          pr_steps: steps.map((step) => ({ step: step.step, ok: step.ok, code: step.code, durationMs: step.durationMs, output: redactedCommandOutput(step.output, 2500) })),
          safety: "branch_and_pr_only_no_merge_no_deploy",
        },
        updated_at: now,
      })
      .eq("id", id)
      .select("id, title, summary, findings, plan, repo, project_key, risk_level, status, files, diff_preview, approval_note, draft_metadata, session_id, workspace_id, conversation_id, created_at, updated_at, approved_at, executed_at")
      .single();

    if (error) {
      logError("repoActions.openRepoActionPullRequest.update", error);
      return { ok: false, error: error.message };
    }

    const updated = data as RepoActionProposalRow;
    await logActionEvent({
      eventType: "repo_action.pr_opened",
      summary: `PR opened: ${updated.title}`,
      status: "executed",
      approvalStage: "action",
      riskLevel: updated.risk_level,
      projectKey: updated.project_key,
      sessionId: updated.session_id,
      workspaceId: updated.workspace_id,
      conversationId: updated.conversation_id,
      metadata: { proposalId: updated.id, repo: slug, branch, commitSha, prUrl: pr.data.html_url, prNumber: pr.data.number, cleanupOk: finalCleanupOk },
    });

    return { ok: true, proposal: updated, prUrl: pr.data.html_url, branch, commitSha };
  } catch (error) {
    try {
      await rm(tempRoot, { recursive: true, force: true });
      cleanupOk = true;
    } catch (cleanupError) {
      logError("repoActions.openRepoActionPullRequest.cleanupAfterFail", cleanupError);
    }
    logError("repoActions.openRepoActionPullRequest", error);
    await logActionEvent({
      eventType: "repo_action.pr_open_failed",
      summary: `PR open failed: ${proposal.title}`,
      status: "failed",
      approvalStage: "action",
      riskLevel: "high",
      projectKey: proposal.project_key,
      sessionId: proposal.session_id,
      workspaceId: proposal.workspace_id,
      conversationId: proposal.conversation_id,
      metadata: { proposalId: proposal.id, repo: slug, branch, cleanupOk, steps: steps.map((step) => ({ step: step.step, ok: step.ok, code: step.code, durationMs: step.durationMs, output: redactedCommandOutput(step.output, 2500) })) },
    });
    return { ok: false, error: error instanceof Error ? error.message : "Failed to open pull request." };
  }
}


export async function trackRepoActionPullRequest(options: { id: string }) {
  const supabase = getSupabaseClient();
  if (!supabase) return { ok: false, error: "Supabase is not configured." };

  const id = normalizeRepoActionProposalId(options.id);
  if (!id) return invalidRepoActionProposalResult(options.id);

  const { data: existing, error: fetchError } = await supabase
    .from("jarvis_repo_action_proposals")
    .select("id, title, summary, findings, plan, repo, project_key, risk_level, status, files, diff_preview, approval_note, draft_metadata, session_id, workspace_id, conversation_id, created_at, updated_at, approved_at, executed_at")
    .eq("id", id)
    .single();

  if (fetchError || !existing) {
    logError("repoActions.trackRepoActionPullRequest.fetch", fetchError);
    return { ok: false, error: fetchError?.message ?? "Proposal not found." };
  }

  const proposal = existing as RepoActionProposalRow;
  const metadata = proposal.draft_metadata || {};
  const prNumber = Number(metadata.pr_number || 0);
  const prBranch = metadata.pr_branch ? String(metadata.pr_branch) : "";
  const prUrl = metadata.pr_url ? String(metadata.pr_url) : "";
  if (!prNumber || !prBranch || !prUrl) {
    return { ok: false, error: "No PR metadata found. Open a PR before tracking it." };
  }

  const { owner, repo, slug } = getRepoParts(proposal.repo);
  const octokit = getGitHubClient();
  let prData: Awaited<ReturnType<typeof octokit.pulls.get>>["data"];
  let checks: Awaited<ReturnType<typeof octokit.checks.listForRef>>["data"]["check_runs"] = [];
  let statuses: Awaited<ReturnType<typeof octokit.repos.listCommitStatusesForRef>>["data"] = [];

  try {
    const prResponse = await octokit.pulls.get({ owner, repo, pull_number: prNumber });
    prData = prResponse.data;
    const sha = prData.head.sha;
    try {
      const checkResponse = await octokit.checks.listForRef({ owner, repo, ref: sha, per_page: 20 });
      checks = checkResponse.data.check_runs ?? [];
    } catch (error) {
      logError("repoActions.trackRepoActionPullRequest.checks", error);
      checks = [];
    }

    try {
      const statusResponse = await octokit.repos.listCommitStatusesForRef({ owner, repo, ref: sha, per_page: 20 });
      statuses = statusResponse.data ?? [];
    } catch (error) {
      logError("repoActions.trackRepoActionPullRequest.statuses", error);
      statuses = [];
    }
  } catch (error) {
    logError("repoActions.trackRepoActionPullRequest.github", error);
    return { ok: false, error: error instanceof Error ? error.message : "Unable to inspect pull request." };
  }

  const vercel = await getVercelDeploymentForBranch(prBranch);
  const checkSummary = checks.map((check) => ({
    name: check.name,
    status: check.status,
    conclusion: summarizeCheckConclusion(check.conclusion),
    url: check.html_url,
    startedAt: check.started_at,
    completedAt: check.completed_at,
  }));
  const statusSummary = statuses.map((status) => ({
    context: status.context,
    state: status.state,
    description: status.description,
    url: status.target_url,
    updatedAt: status.updated_at,
  }));
  const checksComplete = checks.length ? checks.every((check) => check.status === "completed") : false;
  const checksPassed = checks.length ? checks.every((check) => ["success", "neutral", "skipped"].includes(String(check.conclusion))) : false;
  const statusesPassed = statuses.length ? statuses.every((status) => status.state === "success") : true;
  const vercelDeployment = "deployment" in vercel ? vercel.deployment : null;
  const vercelReady = vercelDeployment?.state ? ["READY", "ready"].includes(vercelDeployment.state) : false;
  const readinessReasons = [
    prData.state !== "open" ? `PR is ${prData.state}, not open.` : null,
    prData.draft ? "PR is still marked as draft." : null,
    prData.mergeable === false ? "GitHub reports the PR is not mergeable." : null,
    checks.length && !checksComplete ? "GitHub check runs are still running." : null,
    checks.length && checksComplete && !checksPassed ? "One or more GitHub check runs failed." : null,
    !checks.length ? "No GitHub check runs have reported yet." : null,
    !statusesPassed ? "One or more commit statuses failed." : null,
    vercel.configured && vercelDeployment && !vercelReady ? `Vercel preview is ${vercelDeployment.state ?? "not ready"}.` : null,
    vercel.configured && !vercelDeployment ? "No Vercel preview deployment was found for the PR branch yet." : null,
  ].filter(Boolean) as string[];
  const overallReady = prData.state === "open" && !prData.draft && prData.mergeable !== false && checksPassed && statusesPassed && (!vercel.configured || vercelReady || !vercelDeployment);
  const readinessSummary = overallReady
    ? "PR is ready for Javier's manual review. Rune did not merge or deploy anything."
    : `PR is not ready yet: ${readinessReasons.join(" ") || "waiting for GitHub/Vercel signals."}`;
  const now = new Date().toISOString();

  const report = [
    `# PR status tracked — ${proposal.title}`,
    `Repo: ${slug}`,
    `PR: ${prUrl}`,
    `Branch: ${prBranch}`,
    `Tracked: ${now}`,
    `Overall: ${overallReady ? "READY FOR HUMAN REVIEW" : "NEEDS REVIEW / WAITING"}`,
    `Summary: ${readinessSummary}`,
    "",
    "Rune inspected the pull request, GitHub checks/statuses, and optional Vercel preview deployment. No branch, merge, deployment, or repo change was made.",
    "",
    "## Pull request",
    `- State: ${prData.state}`,
    `- Draft: ${prData.draft ? "yes" : "no"}`,
    `- Mergeable: ${String(prData.mergeable)}`,
    `- Mergeable state: ${prData.mergeable_state ?? "unknown"}`,
    `- Head SHA: ${prData.head.sha}`,
    `- Updated: ${prData.updated_at}`,
    "",
    "## GitHub check runs",
    ...(checkSummary.length ? checkSummary.map((check) => `- ${check.name}: ${check.status}/${check.conclusion}${check.url ? ` — ${check.url}` : ""}`) : ["- No check runs found yet."]),
    "",
    "## GitHub commit statuses",
    ...(statusSummary.length ? statusSummary.map((status) => `- ${status.context}: ${status.state}${status.description ? ` — ${status.description}` : ""}${status.url ? ` — ${status.url}` : ""}`) : ["- No commit statuses found."]),
    "",
    "## Vercel preview",
    vercel.configured
      ? vercelDeployment
        ? `- ${vercelDeployment.state ?? "unknown"}: ${vercelDeployment.url ?? "no URL yet"}`
        : `- Configured, but no deployment found for ${prBranch} yet.`
      : `- Optional: ${vercel.error ?? "Vercel token not configured."}`,
    "",
    "## Next checkpoint",
    overallReady
      ? "Review the PR and preview manually. Rune still will not merge or deploy automatically."
      : "Wait for checks/preview or inspect failures before merging.",
  ].join("\n");

  const { data, error } = await supabase
    .from("jarvis_repo_action_proposals")
    .update({
      diff_preview: report,
      draft_metadata: {
        ...metadata,
        pr_tracked_at: now,
        pr_state: prData.state,
        pr_draft: prData.draft,
        pr_mergeable: prData.mergeable,
        pr_mergeable_state: prData.mergeable_state,
        pr_head_sha: prData.head.sha,
        pr_checks_complete: checksComplete,
        pr_checks_passed: checksPassed,
        pr_statuses_passed: statusesPassed,
        pr_overall_ready: overallReady,
        pr_readiness_summary: readinessSummary,
        pr_readiness_reasons: readinessReasons,
        pr_check_counts: {
          total: checks.length,
          completed: checks.filter((check) => check.status === "completed").length,
          passed: checks.filter((check) => ["success", "neutral", "skipped"].includes(String(check.conclusion))).length,
          statuses: statuses.length,
        },
        github_checks: checkSummary,
        github_statuses: statusSummary,
        vercel_preview: vercel,
        safety: "tracking_only_no_merge_no_deploy_no_repo_change",
      },
      updated_at: now,
    })
    .eq("id", id)
    .select("id, title, summary, findings, plan, repo, project_key, risk_level, status, files, diff_preview, approval_note, draft_metadata, session_id, workspace_id, conversation_id, created_at, updated_at, approved_at, executed_at")
    .single();

  if (error) {
    logError("repoActions.trackRepoActionPullRequest.update", error);
    return { ok: false, error: error.message };
  }

  const updated = data as RepoActionProposalRow;
  await logActionEvent({
    eventType: "repo_action.pr_tracked",
    summary: `PR tracked: ${updated.title}`,
    status: overallReady ? "info" : "proposed",
    approvalStage: "action",
    riskLevel: overallReady ? updated.risk_level : "medium",
    projectKey: updated.project_key,
    sessionId: updated.session_id,
    workspaceId: updated.workspace_id,
    conversationId: updated.conversation_id,
    metadata: { proposalId: updated.id, repo: slug, prUrl, prBranch, overallReady, readinessSummary, readinessReasons, checksPassed, statusesPassed, vercel },
  });

  return { ok: true, proposal: updated, overallReady, readinessSummary, readinessReasons, prUrl, vercel };
}


export async function runApprovedRepoActionExecutor(options: { id: string; openPr?: boolean; trackPr?: boolean }) {
  const id = normalizeRepoActionProposalId(options.id);
  if (!id) return invalidRepoActionProposalResult(options.id);

  const steps: Array<{ step: string; ok: boolean; error?: string }> = [];
  const record = (step: string, result: { ok: boolean; error?: string }) => {
    steps.push({ step, ok: Boolean(result.ok), error: result.ok ? undefined : result.error || "Stage failed." });
    return result;
  };

  const supabase = getSupabaseClient();
  if (!supabase) return { ok: false, error: "Supabase is not configured." };
  const { data: existing, error: fetchError } = await supabase
    .from("jarvis_repo_action_proposals")
    .select("id, title, summary, findings, plan, repo, project_key, risk_level, status, files, diff_preview, approval_note, draft_metadata, session_id, workspace_id, conversation_id, created_at, updated_at, approved_at, executed_at")
    .eq("id", id)
    .single();

  if (fetchError || !existing) {
    logError("repoActions.runApprovedRepoActionExecutor.fetch", fetchError);
    return { ok: false, error: fetchError?.message ?? "Proposal not found.", steps };
  }

  const proposal = existing as RepoActionProposalRow;
  if (proposal.status !== "approved") {
    await logActionEvent({
      eventType: "repo_action.executor_blocked",
      summary: `Executor blocked before PR: ${proposal.title}`,
      status: "blocked",
      approvalStage: "approval",
      riskLevel: proposal.risk_level,
      projectKey: proposal.project_key,
      sessionId: proposal.session_id,
      workspaceId: proposal.workspace_id,
      conversationId: proposal.conversation_id,
      metadata: { proposalId: proposal.id, repo: proposal.repo, status: proposal.status, reason: "proposal_not_approved" },
    });
    return {
      ok: false,
      error: "Proposal must be approved before the controlled executor can open a PR.",
      steps,
      stoppedAt: "approval_gate",
    };
  }

  const diffPresent = Boolean(proposal.diff_preview && proposal.diff_preview.includes("diff"));
  if (!diffPresent) {
    const result = record("generate_diff", await generateRepoActionProposedDiff({ id }));
    if (!result.ok) return { ok: false, error: result.error, steps, stoppedAt: "generate_diff" };
  }

  const sandbox = record("sandbox_check", await sandboxCheckRepoActionDiff({ id }));
  if (!sandbox.ok) return { ok: false, error: sandbox.error, steps, stoppedAt: "sandbox_check" };

  const tempWorkspace = record("temp_workspace_check", await runTemporaryWorkspaceBuildCheck({ id }));
  if (!tempWorkspace.ok) return { ok: false, error: tempWorkspace.error, steps, stoppedAt: "temp_workspace_check" };

  if (options.openPr === false) {
    await logActionEvent({
      eventType: "repo_action.executor_checked",
      summary: `Controlled executor checks passed without PR: ${proposal.title}`,
      status: "approved",
      approvalStage: "action",
      riskLevel: proposal.risk_level,
      projectKey: proposal.project_key,
      sessionId: proposal.session_id,
      workspaceId: proposal.workspace_id,
      conversationId: proposal.conversation_id,
      metadata: { proposalId: proposal.id, repo: proposal.repo, steps, safety: "no_pr_no_merge_no_deploy" },
    });
    return {
      ok: true,
      proposal,
      steps,
      message: "Controlled executor checks passed. PR creation was skipped by request. No merge or deployment happened.",
    };
  }

  const pr = record("open_pr", await openRepoActionPullRequest({ id }));
  if (!pr.ok) return { ok: false, error: pr.error, steps, stoppedAt: "open_pr" };

  let tracked: Awaited<ReturnType<typeof trackRepoActionPullRequest>> | null = null;
  if (options.trackPr !== false) {
    tracked = record("track_pr", await trackRepoActionPullRequest({ id })) as Awaited<ReturnType<typeof trackRepoActionPullRequest>>;
    if (!tracked.ok) {
      return { ok: false, error: tracked.error, steps, stoppedAt: "track_pr", prUrl: "prUrl" in pr ? pr.prUrl : undefined };
    }
  }

  await logActionEvent({
    eventType: "repo_action.executor_completed",
    summary: `Controlled executor completed PR path: ${proposal.title}`,
    status: "executed",
    approvalStage: "action",
    riskLevel: proposal.risk_level,
    projectKey: proposal.project_key,
    sessionId: proposal.session_id,
    workspaceId: proposal.workspace_id,
    conversationId: proposal.conversation_id,
    metadata: {
      proposalId: proposal.id,
      repo: proposal.repo,
      steps,
      prUrl: "prUrl" in pr ? pr.prUrl : undefined,
      safety: "opened_pr_only_no_merge_no_deploy",
    },
  });

  return {
    ok: true,
    proposal,
    steps,
    prUrl: "prUrl" in pr ? pr.prUrl : undefined,
    tracked,
    message: "Controlled executor completed. A PR may have been opened/tracked, but no merge or deployment happened.",
  };
}



export interface RepoDeploymentPrepResult {
  ok: boolean;
  proposalId: string;
  ready: boolean;
  prUrl?: string;
  prBranch?: string;
  readinessSummary?: string;
  readinessReasons?: string[];
  vercel?: unknown;
  requiredApprovalPhrase: string;
  nextAction: string;
  safety: string;
  message: string;
  error?: string;
}

function metadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export async function prepareRepoDeploymentHandoff(options: { id: string } | { proposalId: string }): Promise<RepoDeploymentPrepResult> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return {
      ok: false,
      proposalId: "id" in options ? options.id : options.proposalId,
      ready: false,
      requiredApprovalPhrase: "APPROVE RUNE REDEPLOY",
      nextAction: "Configure Supabase so Rune can read proposal metadata.",
      safety: "metadata_only_no_deploy",
      message: "Deployment handoff could not be prepared because Supabase is not configured.",
      error: "Supabase is not configured.",
    };
  }

  const rawProposalId = "id" in options ? options.id : options.proposalId;
  const proposalId = normalizeRepoActionProposalId(rawProposalId);
  if (!proposalId) {
    return {
      ok: false,
      proposalId: cleanText(rawProposalId, 120),
      ready: false,
      requiredApprovalPhrase: "APPROVE RUNE REDEPLOY",
      nextAction: "Use a Repo Control proposal UUID from the proposal card, not a GitHub Actions run ID.",
      safety: "metadata_only_no_deploy",
      message: "Deployment handoff could not start because the proposal ID was invalid.",
      error: repoActionProposalIdError(rawProposalId),
    };
  }

  const { data: existing, error: fetchError } = await supabase
    .from("jarvis_repo_action_proposals")
    .select("id, title, summary, repo, project_key, risk_level, status, draft_metadata, session_id, workspace_id, conversation_id, updated_at")
    .eq("id", proposalId)
    .single();

  if (fetchError || !existing) {
    logError("repoActions.prepareRepoDeploymentHandoff.fetch", fetchError);
    return {
      ok: false,
      proposalId,
      ready: false,
      requiredApprovalPhrase: "APPROVE RUNE REDEPLOY",
      nextAction: "Confirm the proposal ID and rerun deployment handoff prep.",
      safety: "metadata_only_no_deploy",
      message: "Deployment handoff could not find the proposal.",
      error: fetchError?.message ?? "Proposal not found.",
    };
  }

  const proposal = existing as Pick<RepoActionProposalRow, "id" | "title" | "summary" | "repo" | "project_key" | "risk_level" | "status" | "draft_metadata" | "session_id" | "workspace_id" | "conversation_id" | "updated_at">;
  const metadata = metadataRecord(proposal.draft_metadata);
  const prReady = metadata.pr_overall_ready === true;
  const prUrl = typeof metadata.pr_url === "string" ? metadata.pr_url : undefined;
  const prBranch = typeof metadata.pr_branch === "string" ? metadata.pr_branch : undefined;
  const readinessSummary = typeof metadata.pr_readiness_summary === "string" ? metadata.pr_readiness_summary : undefined;
  const readinessReasons = Array.isArray(metadata.pr_readiness_reasons) ? metadata.pr_readiness_reasons.filter((item): item is string => typeof item === "string") : [];
  const vercel = metadata.vercel;

  const ready = Boolean(prReady && prUrl);
  const nextAction = ready
    ? "Review the ready PR and preview. If Javier wants production movement, use the separate deployment approval flow with the required phrase."
    : "Wait for PR checks/preview readiness or rerun PR tracking before preparing deployment approval.";
  const message = ready
    ? "Deployment handoff is prepared for review only. No redeploy, rollback, merge, or production mutation happened."
    : "Deployment handoff is blocked until the PR is ready. No redeploy, rollback, merge, or production mutation happened.";

  const updatedMetadata = {
    ...metadata,
    deployment_prep: {
      prepared_at: new Date().toISOString(),
      ready,
      pr_url: prUrl,
      pr_branch: prBranch,
      readiness_summary: readinessSummary,
      readiness_reasons: readinessReasons,
      required_approval_phrase: "APPROVE RUNE REDEPLOY",
      safety: "metadata_only_no_deploy",
    },
  };

  await supabase
    .from("jarvis_repo_action_proposals")
    .update({ draft_metadata: updatedMetadata, updated_at: new Date().toISOString() })
    .eq("id", proposalId);

  await logActionEvent({
    eventType: ready ? "repo_action.deployment_handoff_prepared" : "repo_action.deployment_handoff_blocked",
    summary: ready ? `Deployment handoff prepared: ${proposal.title}` : `Deployment handoff blocked: ${proposal.title}`,
    status: ready ? "proposed" : "blocked",
    approvalStage: ready ? "approval" : "findings",
    riskLevel: proposal.risk_level,
    projectKey: proposal.project_key,
    sessionId: proposal.session_id,
    workspaceId: proposal.workspace_id,
    conversationId: proposal.conversation_id,
    metadata: {
      proposalId,
      repo: proposal.repo,
      prUrl,
      prBranch,
      ready,
      readinessSummary,
      readinessReasons,
      safety: "metadata_only_no_deploy",
      requiredApprovalPhrase: "APPROVE RUNE REDEPLOY",
    },
  });

  return {
    ok: ready,
    proposalId,
    ready,
    prUrl,
    prBranch,
    readinessSummary,
    readinessReasons,
    vercel,
    requiredApprovalPhrase: "APPROVE RUNE REDEPLOY",
    nextAction,
    safety: "metadata_only_no_deploy",
    message,
  };
}

export interface RepoControlFlowStep {
  action: string;
  ok: boolean;
  status: "completed" | "blocked" | "skipped";
  error?: string;
  summary?: string;
}

export interface RepoControlFlowResult {
  ok: boolean;
  proposalId: string;
  mode: "safe_ladder" | "approved_executor";
  steps: RepoControlFlowStep[];
  stoppedAt?: string;
  nextAction: string;
  prUrl?: string;
  branch?: string;
  deploymentPrep?: RepoDeploymentPrepResult;
  safety: string;
  message: string;
}

function flowStep(action: string, result: { ok?: boolean; error?: string }, summary?: string): RepoControlFlowStep {
  const ok = Boolean(result.ok);
  return {
    action,
    ok,
    status: ok ? "completed" : "blocked",
    error: ok ? undefined : result.error || `${action} failed.`,
    summary: ok ? summary || "completed" : "stopped here",
  };
}

export async function runRepoControlFlow(options: { id: string; openPr?: boolean; trackPr?: boolean } | { proposalId: string; openPr?: boolean; trackPr?: boolean }): Promise<RepoControlFlowResult> {
  const rawProposalId = "id" in options ? options.id : options.proposalId;
  const proposalId = normalizeRepoActionProposalId(rawProposalId);
  const openPr = options.openPr ?? true;
  const trackPr = options.trackPr ?? true;
  const steps: RepoControlFlowStep[] = [];

  if (!proposalId) {
    return {
      ok: false,
      proposalId: cleanText(rawProposalId, 120),
      mode: "safe_ladder",
      steps,
      stoppedAt: "proposal_id_validation",
      nextAction: "Use a Repo Control proposal UUID from the proposal card, not a GitHub Actions run ID.",
      safety: "no_repo_mutation_no_merge_no_deploy",
      message: "Repo Control flow could not start because the supplied ID was not a proposal UUID.",
    };
  }

  const runSafeStage = async (action: "inspect_repo" | "draft_diff" | "generate_diff" | "sandbox_check" | "temp_workspace_check") => {
    const result =
      action === "inspect_repo"
        ? await inspectRepoActionFiles({ id: proposalId })
        : action === "draft_diff"
          ? await draftRepoActionDiff({ id: proposalId })
          : action === "generate_diff"
            ? await generateRepoActionProposedDiff({ id: proposalId })
            : action === "sandbox_check"
              ? await sandboxCheckRepoActionDiff({ id: proposalId })
              : await runTemporaryWorkspaceBuildCheck({ id: proposalId });
    const step = flowStep(action, result, "safe stage completed");
    steps.push(step);
    return { result, step };
  };

  for (const action of ["inspect_repo", "draft_diff", "generate_diff", "sandbox_check", "temp_workspace_check"] as const) {
    const { result, step } = await runSafeStage(action);
    if (!result.ok) {
      const nextAction = action === "generate_diff" && /OpenAI/i.test(result.error || "")
        ? "Configure OpenAI or use the draft preview path, then rerun the flow."
        : "Review the stopped stage, adjust the proposal or credentials, then rerun the flow.";
      await logActionEvent({
        eventType: "repo_action.flow_stopped",
        summary: `Repo Control flow stopped at ${action}`,
        status: "blocked",
        approvalStage: "approval",
        riskLevel: "medium",
        metadata: { proposalId, action, error: step.error, safety: "no_merge_no_deploy" },
      });
      return {
        ok: false,
        proposalId,
        mode: "safe_ladder",
        steps,
        stoppedAt: action,
        nextAction,
        safety: "no_repo_mutation_no_merge_no_deploy",
        message: "Repo Control flow stopped safely before PR/deployment gates.",
      };
    }
  }

  const executor = await runApprovedRepoActionExecutor({ id: proposalId, openPr, trackPr });
  const executorStep = flowStep("approved_executor", executor, executor.ok ? "approved executor completed" : "approval/PR gate blocked");
  steps.push(executorStep);

  if (!executor.ok) {
    await logActionEvent({
      eventType: "repo_action.flow_approval_gate",
      summary: "Repo Control flow reached approval/PR gate",
      status: "blocked",
      approvalStage: "approval",
      riskLevel: "medium",
      metadata: {
        proposalId,
        stoppedAt: "stoppedAt" in executor ? executor.stoppedAt || "approved_executor" : "approved_executor",
        error: executor.error,
        safety: "no_merge_no_deploy",
      },
    });
    return {
      ok: false,
      proposalId,
      mode: "safe_ladder",
      steps,
      stoppedAt: "stoppedAt" in executor ? executor.stoppedAt || "approved_executor" : "approved_executor",
      nextAction: "Approve the proposal in Repo Control, then rerun this flow to open/track a PR. Rune still will not merge or deploy.",
      safety: "approval_required_no_merge_no_deploy",
      message: "Safe ladder completed, then stopped at the approval/PR gate. No merge or deployment happened.",
    };
  }

  const prUrl = typeof executor.prUrl === "string" ? executor.prUrl : undefined;
  const branch = "branch" in executor && typeof executor.branch === "string" ? executor.branch : undefined;
  const executorMessage = typeof executor.message === "string" ? executor.message : undefined;

  await logActionEvent({
    eventType: "repo_action.flow_completed",
    summary: "Repo Control flow completed through PR readiness",
    status: "executed",
    approvalStage: "approval",
    riskLevel: "medium",
    metadata: { proposalId, prUrl, branch, safety: "pr_only_no_merge_no_deploy" },
  });

  const deploymentPrep = await prepareRepoDeploymentHandoff({ id: proposalId });
  steps.push({
    action: "deployment_handoff",
    ok: deploymentPrep.ready,
    status: deploymentPrep.ready ? "completed" : "blocked",
    error: deploymentPrep.ready ? undefined : deploymentPrep.message,
    summary: deploymentPrep.ready ? "deployment approval package prepared" : "deployment handoff not ready",
  });

  return {
    ok: true,
    proposalId,
    mode: "approved_executor",
    steps,
    prUrl,
    branch,
    deploymentPrep,
    nextAction: deploymentPrep.nextAction,
    safety: "pr_only_no_merge_no_deploy",
    message: executorMessage || "Repo Control flow completed through PR readiness. No merge or deployment happened.",
  };
}

export async function updateRepoActionStatus(options: {
  id: string;
  status: RepoActionStatus;
  approvalNote?: string | null;
}) {
  const supabase = getSupabaseClient();
  if (!supabase) return { ok: false, error: "Supabase is not configured." };

  const id = normalizeRepoActionProposalId(options.id);
  const status = normalizeStatus(options.status);
  if (!id) return invalidRepoActionProposalResult(options.id);

  const now = new Date().toISOString();
  const payload: Record<string, unknown> = {
    status,
    approval_note: options.approvalNote ? cleanText(options.approvalNote, 700) : null,
    updated_at: now,
  };
  if (status === "approved") payload.approved_at = now;
  if (status === "executed") payload.executed_at = now;

  const { data, error } = await supabase
    .from("jarvis_repo_action_proposals")
    .update(payload)
    .eq("id", id)
    .select("id, title, summary, findings, plan, repo, project_key, risk_level, status, files, diff_preview, approval_note, draft_metadata, session_id, workspace_id, conversation_id, created_at, updated_at, approved_at, executed_at")
    .single();

  if (error) {
    logError("repoActions.updateRepoActionStatus", error);
    return { ok: false, error: error.message };
  }

  const proposal = data as RepoActionProposalRow;
  await logActionEvent({
    eventType: `repo_action.${status}`,
    summary: `Repo action ${status}: ${proposal.title}`,
    status: status === "approved" ? "approved" : status === "rejected" || status === "blocked" || status === "cancelled" ? "blocked" : status === "executed" ? "executed" : "info",
    approvalStage: approvalStageFor(status),
    riskLevel: proposal.risk_level,
    projectKey: proposal.project_key,
    sessionId: proposal.session_id,
    workspaceId: proposal.workspace_id,
    conversationId: proposal.conversation_id,
    metadata: { proposalId: proposal.id, repo: proposal.repo, approvalNote: payload.approval_note },
  });

  return { ok: true, proposal };
}
