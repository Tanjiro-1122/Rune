import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";
import { Octokit } from "@octokit/rest";
import { getSupabaseClient } from "@/lib/supabase";
import { logError } from "@/lib/errors";
import { logActionEvent } from "@/lib/action-events";

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
const DEFAULT_REPO = "Tanjiro-1122/Jarvis";

function getRepoParts(repoSlug: string) {
  const raw = cleanText(repoSlug || DEFAULT_REPO, 180);
  const match = raw.match(/github\.com\/([^/\s]+\/[^/\s#?]+)|^([^/\s]+\/[^/\s#?]+)$/i);
  const slug = (match?.[1] || match?.[2] || DEFAULT_REPO).replace(/\.git$/i, "");
  const [owner, repo] = slug.split("/");
  return { owner, repo, slug };
}

function getGitHubClient() {
  const token = process.env.GITHUB_TOKEN || process.env.JARVIS_GITHUB_TOKEN;
  return new Octokit({
    ...(token ? { auth: token } : {}),
    userAgent: "Jarvis-Repo-Inspector/1.0 (+https://github.com/Tanjiro-1122/Jarvis)",
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
  return cleaned || "jarvis";
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

  const payload = {
    title,
    summary,
    findings: cleanMultiline(input.findings, 6000),
    plan: cleanMultiline(input.plan, 6000),
    repo: cleanText(input.repo || process.env.JARVIS_GITHUB_REPO || DEFAULT_REPO, 160),
    project_key: normalizeProjectKey(input.projectKey),
    risk_level: normalizeRisk(input.riskLevel),
    status: "proposed" as RepoActionStatus,
    files: cleanFiles(input.files),
    diff_preview: cleanMultiline(input.diffPreview, 10000),
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
    "+ Proposed changes will appear here after Jarvis inspects the files and Javier approves execution scope.",
    "```",
    "",
    "Approval checkpoint: Javier must approve the real diff before commit/push.",
  ];
  return lines.join("\n");
}

export async function draftRepoActionDiff(options: { id: string }) {
  const supabase = getSupabaseClient();
  if (!supabase) return { ok: false, error: "Supabase is not configured." };

  const id = cleanText(options.id, 120);
  if (!id) return { ok: false, error: "Proposal id is required." };

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

  const id = cleanText(options.id, 120);
  if (!id) return { ok: false, error: "Proposal id is required." };

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
    "Jarvis can now prepare a real proposed code diff from these inspected files, but Javier must approve before any file change, commit, push, or deployment.",
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

  const id = cleanText(options.id, 120);
  if (!id) return { ok: false, error: "Proposal id is required." };

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

  const model = process.env.JARVIS_PATCH_MODEL || process.env.JARVIS_CHAT_MODEL || "gpt-4o-mini";
  const prompt = [
    "You are Jarvis, Javier's cautious private developer agent.",
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

  const id = cleanText(options.id, 120);
  if (!id) return { ok: false, error: "Proposal id is required." };

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
      ? "Javier can review and approve a future execution step. Jarvis still cannot commit/push from this checkpoint."
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

export async function updateRepoActionStatus(options: {
  id: string;
  status: RepoActionStatus;
  approvalNote?: string | null;
}) {
  const supabase = getSupabaseClient();
  if (!supabase) return { ok: false, error: "Supabase is not configured." };

  const id = cleanText(options.id, 120);
  const status = normalizeStatus(options.status);
  if (!id) return { ok: false, error: "Proposal id is required." };

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
