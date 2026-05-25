import { Octokit } from "@octokit/rest";
import { createRepoActionProposal, runRepoControlFlow, updateRepoActionStatus, isRepoAllowed } from "@/lib/repo-actions";
import { getRuneRuntimeIdentity } from "@/lib/project-runtime";
import { logError } from "@/lib/errors";
import { verifyPullRequestProof } from "@/lib/repo-action-completion-verifier";

const APPROVAL_PHRASE = "APPROVE SAFE TEXT EDIT";
const MAX_FILE_BYTES = 120_000;
const MAX_REPLACEMENTS = 50;

export interface SafeTextEditInput {
  repo?: string | null;
  path: string;
  search: string;
  replace: string;
  projectKey?: string | null;
  approvalText?: string | null;
  workspaceId?: string | null;
  conversationId?: string | null;
}

export type SafeTextEditCompletionState =
  | "proposal_created_not_applied"
  | "pr_opened_not_merged"
  | "failed";

export interface SafeTextEditResult {
  ok: boolean;
  approved: boolean;
  completed: boolean;
  completionState: SafeTextEditCompletionState;
  completionProof?: string | null;
  proposalId?: string;
  prUrl?: string;
  replacements?: number;
  message: string;
  error?: string;
  approvalPhrase: string;
}

function getGitHubClient() {
  const token = process.env.GITHUB_TOKEN || process.env.RUNE_GITHUB_TOKEN;
  return new Octokit({
    ...(token ? { auth: token } : {}),
    userAgent: "Rune-Safe-Text-Edit/1.0 (+https://github.com/Tanjiro-1122/Rune)",
  });
}

function repoParts(repoSlug?: string | null) {
  const fallback = getRuneRuntimeIdentity().repo;
  const raw = String(repoSlug || fallback).replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/i, "");
  const [owner, repo] = raw.split("/");
  return { owner, repo, slug: `${owner}/${repo}` };
}

function assertSafePath(path: string) {
  if (!path || path.includes("..") || path.startsWith("/") || /[\u0000-\u001f]/.test(path)) {
    throw new Error("Unsafe file path for safe text edit.");
  }
  const lc = path.toLowerCase();
  const blocked = [".exe",".dll",".bin",".so",".dylib",".sh",".bash",".zsh",".ps1",".bat",".cmd"];
  if (blocked.some(ext => lc.endsWith(ext))) {
    throw new Error(`Safe text edit blocked for executable/binary file type: ${path}`);
  }
}

function countMatches(content: string, search: string) {
  if (!search) return 0;
  return content.split(search).length - 1;
}

function escapeHunkLine(line: string) {
  return line.length ? line : "";
}

function fullFileUnifiedDiff(path: string, before: string, after: string) {
  const beforeLines = before.replace(/\n?$/, "\n").split("\n");
  const afterLines = after.replace(/\n?$/, "\n").split("\n");
  if (beforeLines.at(-1) === "") beforeLines.pop();
  if (afterLines.at(-1) === "") afterLines.pop();
  const rawDiff = [
    `diff --git a/${path} b/${path}`,
    "index 0000000..0000000 100644",
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -1,${Math.max(beforeLines.length, 1)} +1,${Math.max(afterLines.length, 1)} @@`,
    ...beforeLines.map((line) => `-${escapeHunkLine(line)}`),
    ...afterLines.map((line) => `+${escapeHunkLine(line)}`),
    "",
  ].join("\n");
  // Wrap in fenced block for reliable extractDiffBody parsing
  return `\`\`\`diff\n${rawDiff}\n\`\`\``;
}

export async function runSafeTextEditFlow(input: SafeTextEditInput): Promise<SafeTextEditResult> {
  const { owner, repo, slug } = repoParts(input.repo);
  const path = input.path.trim();
  const search = input.search;
  const replace = input.replace;
  const approved = String(input.approvalText || "").trim() === APPROVAL_PHRASE;

  try {
    assertSafePath(path);
    if (!isRepoAllowed(slug)) throw new Error(`Repo ${slug} is not allowlisted for safe text edits.`);
    if (!search || search.length > 500 || replace.length > 500) throw new Error("Safe text edit requires small exact search/replace strings.");
    if (/BEGIN .*PRIVATE KEY|api[_-]?key\s*[:=]|password\s*[:=]/i.test(`${search}\n${replace}`)) throw new Error("Safe text edit blocked because replacement text looks secret-like.");

    const octokit = getGitHubClient();
    const repository = await octokit.repos.get({ owner, repo });
    const branch = repository.data.default_branch || "main";
    const file = await octokit.repos.getContent({ owner, repo, path, ref: branch });
    if (Array.isArray(file.data) || file.data.type !== "file" || !("content" in file.data)) throw new Error("Target is not a plain file.");
    if ((file.data.size || 0) > MAX_FILE_BYTES) throw new Error("Target file is too large for safe text edit.");
    const before = Buffer.from(String(file.data.content || "").replace(/\n/g, ""), "base64").toString("utf8");
    const replacements = countMatches(before, search);
    if (replacements < 1) throw new Error("Exact search text was not found in the target file.");
    if (replacements > MAX_REPLACEMENTS) throw new Error(`Safe text edit blocked because it would replace ${replacements} matches.`);
    const after = before.split(search).join(replace);
    const diff = fullFileUnifiedDiff(path, before, after);

    const proposalResult = await createRepoActionProposal({
      title: `Safe text edit: ${path}`,
      summary: `Replace ${replacements} exact occurrence${replacements === 1 ? "" : "s"} of requested text in ${path}.`,
      findings: [`Repo: ${slug}`, `File: ${path}`, `Default branch: ${branch}`, `Exact matches found: ${replacements}`, "Safe edit mode: exact text replacement only."].join("\n"),
      plan: ["1. Use exact inspected file content from GitHub.", "2. Apply only the requested text replacement.", "3. Run Repo Control sandbox/temp workspace checks.", "4. Open a PR only after approval; do not merge or deploy."].join("\n"),
      repo: slug,
      projectKey: input.projectKey || "rune",
      riskLevel: "low",
      files: [{ path, operation: "update", note: `Safe exact text replacement (${replacements} matches).` }],
      diffPreview: diff,
      workspaceId: input.workspaceId || null,
      conversationId: input.conversationId || null,
    });
    if (!proposalResult.ok || !proposalResult.proposal) throw new Error(proposalResult.error || "Could not create Repo Control proposal.");
    const proposalId = proposalResult.proposal.id;

    if (!approved) {
      return {
        ok: true,
        approved: false,
        completed: false,
        completionState: "proposal_created_not_applied",
        completionProof: `Repo Control proposal ${proposalId} created; no file was changed on the default branch.`,
        proposalId,
        replacements,
        approvalPhrase: APPROVAL_PHRASE,
        message: `Safe text edit proposal created, but the file is not changed yet. To run checks and open a PR, approve with: ${APPROVAL_PHRASE}`,
      };
    }

    // Use /api/approve directly — avoids in-stream Supabase write races
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL
      ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
    const approveRes = await fetch(`${baseUrl}/api/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: proposalId, code: "1122" }),
    });
    if (!approveRes.ok) {
      const errText = await approveRes.text().catch(() => "");
      throw new Error(`Could not approve safe text edit proposal (${approveRes.status}): ${errText.slice(0,120)}`);
    }
    const approveJson = await approveRes.json().catch(() => ({}));
    if (!approveJson.ok) throw new Error(approveJson.error || "Approval API returned not-ok.");
    const flow = await runRepoControlFlow({ id: proposalId, openPr: true, trackPr: true });
    if (!flow.ok) throw new Error("message" in flow ? String(flow.message) : "Repo Control flow failed for safe text edit.");
    const prUrl = "prUrl" in flow ? flow.prUrl : undefined;
    return {
      ok: true,
      approved: true,
      completed: false,
      completionState: "pr_opened_not_merged",
      completionProof: prUrl ? `PR opened: ${prUrl}. Default branch is not changed until merge.` : `Repo Control flow completed for proposal ${proposalId}, but no PR URL was returned.`,
      proposalId,
      prUrl,
      replacements,
      approvalPhrase: APPROVAL_PHRASE,
      message: "Safe text edit checks passed and a PR was opened, but the requested file is not changed on the default branch until the PR is merged. No merge or deploy happened.",
    };
  } catch (error) {
    logError("safeTextEditFlow.run", error);
    return {
      ok: false,
      approved,
      completed: false,
      completionState: "failed",
      completionProof: null,
      approvalPhrase: APPROVAL_PHRASE,
      message: "Safe text edit flow failed. No file was changed, merged, or deployed.",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
