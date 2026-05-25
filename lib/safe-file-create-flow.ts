import { Octokit } from "@octokit/rest";
import { createRepoActionProposal, runRepoControlFlow, isRepoAllowed } from "@/lib/repo-actions";
import { getRuneRuntimeIdentity } from "@/lib/project-runtime";
import { logError } from "@/lib/errors";
import { verifyPullRequestProof } from "@/lib/repo-action-completion-verifier";

const APPROVAL_PHRASE = "APPROVE SAFE FILE CREATE";
const MAX_CONTENT_BYTES = 20_000;

export interface SafeFileCreateInput {
  repo?: string | null;
  path: string;
  content?: string | null;
  projectKey?: string | null;
  approvalText?: string | null;
  workspaceId?: string | null;
  conversationId?: string | null;
}

export type SafeFileCreateCompletionState = "proposal_created_not_applied" | "pr_opened_not_merged" | "failed";

export interface SafeFileCreateResult {
  ok: boolean;
  approved: boolean;
  completed: boolean;
  completionState: SafeFileCreateCompletionState;
  completionProof?: string | null;
  proposalId?: string;
  prUrl?: string;
  message: string;
  error?: string;
  approvalPhrase: string;
}

function getGitHubClient() {
  const token = process.env.GITHUB_TOKEN || process.env.RUNE_GITHUB_TOKEN;
  return new Octokit({
    ...(token ? { auth: token } : {}),
    userAgent: "Rune-Safe-File-Create/1.0 (+https://github.com/Tanjiro-1122/Rune)",
  });
}

function repoParts(repoSlug?: string | null) {
  const fallback = getRuneRuntimeIdentity().repo;
  const raw = String(repoSlug || fallback).replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/i, "");
  const [owner, repo] = raw.split("/");
  return { owner, repo, slug: `${owner}/${repo}` };
}

function assertSafeCreatePath(path: string) {
  if (!path || path.includes("..") || path.startsWith("/") || /[\u0000-\u001f]/.test(path)) throw new Error("Unsafe file path for safe file create.");
  if (path.endsWith("/") || path.includes("//")) throw new Error("Safe file create requires a concrete file path, not a directory.");
  if (/\.(env|pem|key|p8|p12|crt|cer|jks|keystore|mobileprovision)$/i.test(path)) throw new Error("Safe file create blocks secret/certificate-style file extensions.");
  if (!/^(README\.md|docs\/|\.github\/|[\w.-]+(\.md|\.txt)?$)/i.test(path)) {
    throw new Error("Safe file create is limited to root text/Markdown files, docs, or .github files. Use full Repo Control for broader code files.");
  }
}

function assertSafeContent(content: string) {
  if (Buffer.byteLength(content, "utf8") > MAX_CONTENT_BYTES) throw new Error("Safe file create content is too large.");
  if (/BEGIN .*PRIVATE KEY|api[_-]?key\s*[:=]|password\s*[:=]|secret\s*[:=]/i.test(content)) throw new Error("Safe file create blocked because content looks secret-like.");
}

function unifiedCreateDiff(path: string, content: string) {
  const lines = content.replace(/\n?$/, "\n").split("\n");
  if (lines.at(-1) === "") lines.pop();
  return [
    `diff --git a/${path} b/${path}`,
    "new file mode 100644",
    "--- /dev/null",
    `+++ b/${path}`,
    `@@ -0,0 +1,${Math.max(lines.length, 1)} @@`,
    ...(lines.length ? lines.map((line) => `+${line}`) : ["+"]),
    "",
  ].join("\n");
}

export async function runSafeFileCreateFlow(input: SafeFileCreateInput): Promise<SafeFileCreateResult> {
  const { owner, repo, slug } = repoParts(input.repo);
  const path = input.path.trim();
  const content = input.content ?? "";
  const approved = String(input.approvalText || "").trim() === APPROVAL_PHRASE;

  try {
    assertSafeCreatePath(path);
    assertSafeContent(content);
    if (!isRepoAllowed(slug)) throw new Error(`Repo ${slug} is not allowlisted for safe file create.`);

    const octokit = getGitHubClient();
    const repository = await octokit.repos.get({ owner, repo });
    const branch = repository.data.default_branch || "main";
    const existing = await octokit.repos.getContent({ owner, repo, path, ref: branch }).catch((error) => error);
    if (!(existing instanceof Error) && !existing?.status) throw new Error(`File ${path} already exists on ${branch}.`);

    const diff = unifiedCreateDiff(path, content);
    const proposalResult = await createRepoActionProposal({
      title: `Safe file create: ${path}`,
      summary: `Create new file ${path} in ${slug}.`,
      findings: [`Repo: ${slug}`, `File: ${path}`, `Default branch: ${branch}`, "Safe create mode: new text file only.", `Content bytes: ${Buffer.byteLength(content, "utf8")}`].join("\n"),
      plan: ["1. Confirm target file does not exist on the default branch.", "2. Create only the requested text file.", "3. Run Repo Control sandbox/temp workspace checks.", "4. Open a PR only after approval; do not merge or deploy."].join("\n"),
      repo: slug,
      projectKey: input.projectKey || "rune",
      riskLevel: "low",
      files: [{ path, operation: "create", note: "Safe new text file creation." }],
      diffPreview: diff,
      workspaceId: input.workspaceId || null,
      conversationId: input.conversationId || null,
    });
    if (!proposalResult.ok || !proposalResult.proposal) throw new Error(proposalResult.error || "Could not create Repo Control proposal.");
    const proposalId = proposalResult.proposal.id;

    if (!approved) {
      return { ok: true, approved: false, completed: false, completionState: "proposal_created_not_applied", completionProof: `Repo Control proposal ${proposalId} created; file ${path} is not on the default branch.`, proposalId, approvalPhrase: APPROVAL_PHRASE, message: `Safe file-create proposal created, but ${path} is not created yet. To run checks and open a PR, approve with: ${APPROVAL_PHRASE}` };
    }

    // Use the /api/approve endpoint directly — more reliable than in-stream Supabase writes
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000";
    const approveRes = await fetch(`${baseUrl}/api/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: proposalId, code: "1122" }),
    });
    if (!approveRes.ok) {
      const approveErr = await approveRes.text().catch(() => "unknown");
      throw new Error(`Could not approve safe file create proposal via /api/approve: ${approveErr}`);
    }
    const flow = await runRepoControlFlow({ id: proposalId, openPr: true, trackPr: true });
    if (!flow.ok) throw new Error("message" in flow ? String(flow.message) : "Repo Control flow failed for safe file create.");
    const prUrl = "prUrl" in flow ? flow.prUrl : undefined;
    const prEvidence = await verifyPullRequestProof({ repo: slug, prUrl, requiredProof: ["pr"] });
    return { ok: true, approved: true, completed: false, completionState: "pr_opened_not_merged", completionProof: prEvidence.proof.find((item) => item.kind === "pr" && item.ok)?.url ? `Verified PR opened: ${prUrl}. File ${path} is not on the default branch until merge.` : `Repo Control flow completed for proposal ${proposalId}, but PR proof was not verified.`, proposalId, prUrl, approvalPhrase: APPROVAL_PHRASE, message: `Safe file-create checks passed and PR proof was checked, but ${path} is not on the default branch until the PR is merged. No merge or deploy happened.` };
  } catch (error) {
    logError("safeFileCreateFlow.run", error);
    return { ok: false, approved, completed: false, completionState: "failed", completionProof: null, approvalPhrase: APPROVAL_PHRASE, message: "Safe file create failed. No file was created, merged, or deployed.", error: error instanceof Error ? error.message : String(error) };
  }
}
