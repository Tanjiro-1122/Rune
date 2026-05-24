import { Octokit } from "@octokit/rest";
import { evaluatePrivilegedOperationGate, auditPrivilegedOperationGate } from "@/lib/privileged-operations";
import { isRepoAllowed } from "@/lib/repo-actions";
import { logError } from "@/lib/errors";

export interface PrivilegedMergeInput {
  repo: string;
  prNumber: number;
  approvalText?: string | null;
  dryRun?: boolean;
  requestedBy?: string | null;
  projectKey?: string | null;
  workspaceId?: string | null;
  conversationId?: string | null;
}

export interface PrivilegedMergeResult {
  ok: boolean;
  dryRun: boolean;
  canExecute: boolean;
  merged?: boolean;
  repo: string;
  prNumber: number;
  title?: string | null;
  url?: string | null;
  baseBranch?: string | null;
  headBranch?: string | null;
  headSha?: string | null;
  mergeable?: boolean | null;
  state?: string | null;
  checksConclusion?: string;
  gateMessage: string;
  message: string;
  error?: string;
}

function getGitHubClient() {
  const token = process.env.GITHUB_TOKEN || process.env.RUNE_GITHUB_TOKEN;
  return new Octokit({
    ...(token ? { auth: token } : {}),
    userAgent: "Rune-Privileged-Merge/1.0 (+https://github.com/Tanjiro-1122/Rune)",
  });
}

function repoParts(repoSlug: string) {
  const cleaned = repoSlug.replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/i, "");
  const [owner, repo] = cleaned.split("/");
  return { owner, repo, slug: `${owner}/${repo}` };
}

function summarizeCheckRuns(runs: Array<{ conclusion: string | null; status: string | null }>) {
  if (!runs.length) return "no_checks_found";
  if (runs.some((run) => run.conclusion === "failure" || run.conclusion === "cancelled" || run.conclusion === "timed_out")) return "failing";
  if (runs.some((run) => run.status !== "completed")) return "pending";
  if (runs.every((run) => run.conclusion === "success" || run.conclusion === "neutral" || run.conclusion === "skipped")) return "passing";
  return "unknown";
}

export async function runPrivilegedMerge(input: PrivilegedMergeInput): Promise<PrivilegedMergeResult> {
  const { owner, repo, slug } = repoParts(input.repo);
  const octokit = getGitHubClient();

  if (!isRepoAllowed(slug)) {
    return {
      ok: false,
      dryRun: input.dryRun === true,
      canExecute: false,
      repo: slug,
      prNumber: input.prNumber,
      gateMessage: "Repo is not allowlisted for privileged merge.",
      message: "Privileged merge blocked before GitHub mutation.",
      error: "Repo is not allowlisted.",
    };
  }

  try {
    const pr = await octokit.pulls.get({ owner, repo, pull_number: input.prNumber });
    const headSha = pr.data.head.sha;
    const checks = await octokit.checks.listForRef({ owner, repo, ref: headSha, per_page: 100 }).catch(() => ({ data: { check_runs: [] } }));
    const checksConclusion = summarizeCheckRuns((checks.data.check_runs || []).map((run) => ({ conclusion: run.conclusion, status: run.status })));

    const evidence = {
      approved_pr_url: pr.data.html_url,
      passing_checks: checksConclusion,
      diff_summary: `${pr.data.changed_files ?? 0} files changed, +${pr.data.additions ?? 0}/-${pr.data.deletions ?? 0}`,
      rollback_plan: `Revert merge commit or redeploy previous known-good deployment for ${slug}.`,
    };
    const scope = {
      repo: slug,
      pr_number: input.prNumber,
      base_branch: pr.data.base.ref,
    };
    const gate = evaluatePrivilegedOperationGate({
      kind: "merge",
      approvalText: input.approvalText,
      dryRun: input.dryRun === true,
      scope,
      evidence,
      requestedBy: input.requestedBy,
      projectKey: input.projectKey || "rune",
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
    });

    const mergeable = pr.data.mergeable;
    const open = pr.data.state === "open";
    const checksPassing = checksConclusion === "passing" || checksConclusion === "no_checks_found";
    const canExecute = gate.canExecute && open && mergeable !== false && checksPassing;

    await auditPrivilegedOperationGate({
      kind: "merge",
      approvalText: input.approvalText,
      dryRun: input.dryRun === true,
      scope,
      evidence,
      requestedBy: input.requestedBy,
      projectKey: input.projectKey || "rune",
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
    }, { ...gate, canExecute });

    const baseResult = {
      dryRun: input.dryRun === true,
      canExecute,
      repo: slug,
      prNumber: input.prNumber,
      title: pr.data.title,
      url: pr.data.html_url,
      baseBranch: pr.data.base.ref,
      headBranch: pr.data.head.ref,
      headSha,
      mergeable,
      state: pr.data.state,
      checksConclusion,
      gateMessage: gate.message,
    };

    if (input.dryRun || !canExecute) {
      return {
        ok: canExecute,
        ...baseResult,
        merged: false,
        message: canExecute
          ? "Privileged merge dry-run passed. Re-submit with dryRun=false and exact approval to merge."
          : "Privileged merge is blocked until gate, PR state, mergeability, and checks are satisfied.",
        error: canExecute ? undefined : "Merge gate blocked.",
      };
    }

    const merged = await octokit.pulls.merge({
      owner,
      repo,
      pull_number: input.prNumber,
      merge_method: "squash",
      commit_title: `Rune merge: ${pr.data.title}`.slice(0, 240),
      commit_message: "Merged by Rune privileged merge gate after exact owner approval, scope evidence, and audit logging.",
    });

    return {
      ok: merged.data.merged === true,
      ...baseResult,
      merged: merged.data.merged === true,
      message: merged.data.message || "Privileged merge executed.",
    };
  } catch (error) {
    logError("privilegedMerge.run", error);
    return {
      ok: false,
      dryRun: input.dryRun === true,
      canExecute: false,
      repo: slug,
      prNumber: input.prNumber,
      gateMessage: "Privileged merge failed before completion.",
      message: "Privileged merge failed.",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
