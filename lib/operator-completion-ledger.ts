import { Octokit } from "@octokit/rest";
import { getRuneRuntimeIdentity } from "@/lib/project-runtime";
import { logError } from "@/lib/errors";

export interface OperatorCompletionLedgerItem {
  prNumber: number;
  title: string;
  mergedAt: string;
  url: string;
  author: string | null;
  branch: string;
  summary: string;
}

export interface OperatorCompletionLedger {
  generatedAt: string;
  readOnly: true;
  source: "github_merged_prs";
  repo: string;
  recentCompletions: OperatorCompletionLedgerItem[];
  latestSummary: string | null;
  safetyBoundary: string[];
  error?: string;
}

function getGitHubClient() {
  const token = process.env.GITHUB_TOKEN || process.env.RUNE_GITHUB_TOKEN;
  return new Octokit({
    ...(token ? { auth: token } : {}),
    userAgent: "Rune-Completion-Ledger/1.0 (+https://github.com/Tanjiro-1122/Rune)",
  });
}

function repoParts(repoSlug: string) {
  const cleaned = repoSlug.replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/i, "");
  const [owner, repo] = cleaned.split("/");
  return { owner, repo, slug: `${owner}/${repo}` };
}

function cleanSummary(value: string | null | undefined) {
  const text = String(value || "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/\b(sk|pk|rk|whsec|ghp|github_pat|vcp|eyJ)[A-Za-z0-9_\-\.]{12,}\b/g, "[redacted]")
    .replace(/[#*_`>\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 240 ? `${text.slice(0, 240)}…` : text;
}

export async function getOperatorCompletionLedger(options: { limit?: number; repo?: string | null } = {}): Promise<OperatorCompletionLedger> {
  const runtime = getRuneRuntimeIdentity();
  const { owner, repo, slug } = repoParts(options.repo || runtime.repo);
  const limit = Math.min(Math.max(options.limit ?? 6, 1), 12);

  try {
    const octokit = getGitHubClient();
    const { data } = await octokit.pulls.list({
      owner,
      repo,
      state: "closed",
      sort: "updated",
      direction: "desc",
      per_page: Math.max(limit * 2, 10),
    });

    const recentCompletions = data
      .filter((pull) => Boolean(pull.merged_at))
      .slice(0, limit)
      .map((pull) => ({
        prNumber: pull.number,
        title: pull.title,
        mergedAt: pull.merged_at || pull.updated_at || "",
        url: pull.html_url,
        author: pull.user?.login ?? null,
        branch: pull.head?.ref || "unknown",
        summary: cleanSummary(pull.body),
      }));

    return {
      generatedAt: new Date().toISOString(),
      readOnly: true,
      source: "github_merged_prs",
      repo: slug,
      recentCompletions,
      latestSummary: recentCompletions[0]
        ? `Latest completed improvement: PR #${recentCompletions[0].prNumber} — ${recentCompletions[0].title}`
        : null,
      safetyBoundary: [
        "Completion Ledger is read-only.",
        "It reads merged GitHub PR metadata only.",
        "It does not create PRs, merge, deploy, rollback, mutate schemas, change payments, or contact customers.",
      ],
    };
  } catch (error) {
    logError("operatorCompletionLedger.get", error);
    return {
      generatedAt: new Date().toISOString(),
      readOnly: true,
      source: "github_merged_prs",
      repo: slug,
      recentCompletions: [],
      latestSummary: null,
      safetyBoundary: ["Completion Ledger is read-only."],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
