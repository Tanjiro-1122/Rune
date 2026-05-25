import { Octokit } from "@octokit/rest";
import { getRuneRuntimeIdentity } from "@/lib/project-runtime";
import { getAllowedRepoSlugs, isRepoAllowed } from "@/lib/repo-actions";
import { logError } from "@/lib/errors";

export interface RepoAccessCapabilityReport {
  ok: boolean;
  repo: string;
  defaultBranch: string | null;
  allowlisted: boolean;
  tokenConfigured: boolean;
  canReadRepo: boolean;
  canReadDefaultBranch: boolean;
  canCreateBranch: boolean | null;
  canOpenPullRequest: boolean | null;
  classification: "fixable_by_code" | "blocked_by_repo_access" | "blocked_by_allowlist" | "blocked_by_token";
  reason: string;
  checkedAt: string;
  safeWriteScope: string[];
}

function getGitHubClient() {
  const token = process.env.GITHUB_TOKEN || process.env.RUNE_GITHUB_TOKEN || process.env.JARVIS_GITHUB_TOKEN;
  return {
    tokenConfigured: Boolean(token),
    octokit: new Octokit({
      ...(token ? { auth: token } : {}),
      userAgent: "Rune-Repo-Access-Capability/1.0 (+https://github.com/Tanjiro-1122/Rune)",
    }),
  };
}

function repoParts(repoSlug: string) {
  const cleaned = repoSlug.replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/i, "");
  const [owner, repo] = cleaned.split("/");
  return { owner, repo, slug: `${owner}/${repo}` };
}

export async function checkRepoAccessCapability(repoOverride?: string | null): Promise<RepoAccessCapabilityReport> {
  const runtime = getRuneRuntimeIdentity();
  const { owner, repo, slug } = repoParts(repoOverride || runtime.repo);
  const { tokenConfigured, octokit } = getGitHubClient();
  const allowlisted = isRepoAllowed(slug);
  const checkedAt = new Date().toISOString();
  const safeWriteScope = [
    "read repository metadata",
    "read default branch ref",
    "create branch only through approved Repo Control PR path",
    "open pull request only after approval and passing temp workspace checks",
    "never merge or deploy from capability probe",
  ];

  if (!allowlisted) {
    return {
      ok: false,
      repo: slug,
      defaultBranch: null,
      allowlisted,
      tokenConfigured,
      canReadRepo: false,
      canReadDefaultBranch: false,
      canCreateBranch: null,
      canOpenPullRequest: null,
      classification: "blocked_by_allowlist",
      reason: `Repo ${slug} is not allowlisted. Allowed repos: ${Array.from(getAllowedRepoSlugs()).join(", ") || "none configured"}.`,
      checkedAt,
      safeWriteScope,
    };
  }

  if (!tokenConfigured) {
    return {
      ok: false,
      repo: slug,
      defaultBranch: null,
      allowlisted,
      tokenConfigured,
      canReadRepo: false,
      canReadDefaultBranch: false,
      canCreateBranch: null,
      canOpenPullRequest: null,
      classification: "blocked_by_token",
      reason: "GitHub token is not configured, so Rune cannot safely inspect or open PRs.",
      checkedAt,
      safeWriteScope,
    };
  }

  try {
    const repository = await octokit.repos.get({ owner, repo });
    const defaultBranch = repository.data.default_branch || "main";
    await octokit.git.getRef({ owner, repo, ref: `heads/${defaultBranch}` });

    // Non-mutating permission inference. GitHub does not require us to create a branch to know whether
    // the authenticated token has push/admin rights. Actual branch/PR creation still happens only in
    // openRepoActionPullRequest after proposal approval and temp workspace checks.
    const permissions = (repository.data.permissions || {}) as { push?: boolean; admin?: boolean; maintain?: boolean };
    const canPush = Boolean(permissions.push || permissions.admin || permissions.maintain);

    return {
      ok: true,
      repo: slug,
      defaultBranch,
      allowlisted,
      tokenConfigured,
      canReadRepo: true,
      canReadDefaultBranch: true,
      canCreateBranch: canPush,
      canOpenPullRequest: canPush,
      classification: canPush ? "fixable_by_code" : "blocked_by_repo_access",
      reason: canPush
        ? "GitHub repo access is ready for read/branch/PR operations through Repo Control gates."
        : "GitHub repo is readable, but token permissions do not appear to allow branch/PR creation.",
      checkedAt,
      safeWriteScope,
    };
  } catch (error) {
    logError("repoAccessCapability.check", error);
    return {
      ok: false,
      repo: slug,
      defaultBranch: null,
      allowlisted,
      tokenConfigured,
      canReadRepo: false,
      canReadDefaultBranch: false,
      canCreateBranch: null,
      canOpenPullRequest: null,
      classification: "blocked_by_repo_access",
      reason: error instanceof Error ? error.message : "Unable to read GitHub repository.",
      checkedAt,
      safeWriteScope,
    };
  }
}
