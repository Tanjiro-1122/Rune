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
