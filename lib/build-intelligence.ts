import { Octokit } from "@octokit/rest";
import { logError } from "@/lib/errors";
import { getExternalServicesHealth, summarizeExternalServicesHealth, type ExternalServiceCheck } from "@/lib/external-services-health";
import { logActionEvent } from "@/lib/action-events";
import { getProjectByKey } from "@/lib/project-registry";

const DEFAULT_REPO = "Tanjiro-1122/Jarvis";
const EXTERNAL_INTELLIGENCE_TIMEOUT_MS = 8_000;

export interface GitHubIntelligence {
  configured: boolean;
  repo: string;
  htmlUrl?: string;
  defaultBranch?: string;
  private?: boolean;
  description?: string | null;
  pushedAt?: string | null;
  latestCommit?: {
    sha: string;
    message: string;
    author?: string | null;
    date?: string | null;
    url?: string;
  } | null;
  latestWorkflowRun?: {
    id: number;
    name?: string | null;
    status?: string | null;
    conclusion?: string | null;
    branch?: string | null;
    createdAt?: string | null;
    updatedAt?: string | null;
    url?: string | null;
  } | null;
  error?: string;
}

export interface VercelIntelligence {
  configured: boolean;
  project?: string | null;
  latestDeployment?: {
    uid?: string;
    name?: string | null;
    state?: string | null;
    url?: string | null;
    createdAt?: string | null;
    readyAt?: string | null;
    target?: string | null;
  } | null;
  error?: string;
}

export interface BuildIntelligenceSnapshot {
  generatedAt: string;
  github: GitHubIntelligence;
  vercel: VercelIntelligence;
  externalServices: {
    generatedAt: string;
    summary: ReturnType<typeof summarizeExternalServicesHealth>;
    services: ExternalServiceCheck[];
  };
}

function getRepoSlug(repoOverride?: string | null) {
  const raw = repoOverride || process.env.JARVIS_GITHUB_REPO || DEFAULT_REPO;
  const match = raw.match(/github\.com\/([^/\s]+\/[^/\s#?]+)|^([^/\s]+\/[^/\s#?]+)$/i);
  const slug = (match?.[1] || match?.[2] || DEFAULT_REPO).replace(/\.git$/i, "");
  const [owner, repo] = slug.split("/");
  return { owner, repo, slug };
}

function getOctokitClient() {
  const githubToken = process.env.GITHUB_TOKEN || process.env.JARVIS_GITHUB_TOKEN;
  return new Octokit({
    ...(githubToken ? { auth: githubToken } : {}),
    userAgent: "Jarvis-Build-Intelligence/1.0 (+https://github.com/Tanjiro-1122/Jarvis)",
  });
}

function isoFromVercelTimestamp(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return new Date(value).toISOString();
}

async function withIntelligenceTimeout<T>(label: string, promise: Promise<T>, fallback: () => T): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timeout = setTimeout(() => {
          logError(`buildIntelligence.${label}.timeout`, new Error(`${label} intelligence timed out after ${EXTERNAL_INTELLIGENCE_TIMEOUT_MS}ms`));
          resolve(fallback());
        }, EXTERNAL_INTELLIGENCE_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function getGitHubIntelligence(repoOverride?: string | null): Promise<GitHubIntelligence> {
  const { owner, repo, slug } = getRepoSlug(repoOverride);
  const tokenConfigured = Boolean(process.env.GITHUB_TOKEN || process.env.JARVIS_GITHUB_TOKEN);
  const octokit = getOctokitClient();

  try {
    const repository = await octokit.repos.get({ owner, repo });
    const branch = repository.data.default_branch || "main";

    const [commitsResult, workflowRunsResult] = await Promise.allSettled([
      octokit.repos.listCommits({ owner, repo, sha: branch, per_page: 1 }),
      octokit.actions.listWorkflowRunsForRepo({ owner, repo, per_page: 1 }),
    ]);

    const latestCommit = commitsResult.status === "fulfilled" && commitsResult.value.data[0]
      ? commitsResult.value.data[0]
      : null;
    const latestRun = workflowRunsResult.status === "fulfilled" && workflowRunsResult.value.data.workflow_runs[0]
      ? workflowRunsResult.value.data.workflow_runs[0]
      : null;

    return {
      configured: tokenConfigured,
      repo: slug,
      htmlUrl: repository.data.html_url,
      defaultBranch: branch,
      private: repository.data.private,
      description: repository.data.description,
      pushedAt: repository.data.pushed_at,
      latestCommit: latestCommit
        ? {
            sha: latestCommit.sha,
            message: latestCommit.commit.message,
            author: latestCommit.commit.author?.name,
            date: latestCommit.commit.author?.date,
            url: latestCommit.html_url,
          }
        : null,
      latestWorkflowRun: latestRun
        ? {
            id: latestRun.id,
            name: latestRun.name,
            status: latestRun.status,
            conclusion: latestRun.conclusion,
            branch: latestRun.head_branch,
            createdAt: latestRun.created_at,
            updatedAt: latestRun.updated_at,
            url: latestRun.html_url,
          }
        : null,
    };
  } catch (error) {
    logError("buildIntelligence.github", error);
    return {
      configured: tokenConfigured,
      repo: slug,
      error: error instanceof Error ? error.message : "Unable to inspect GitHub repo.",
    };
  }
}

export async function getVercelIntelligence(): Promise<VercelIntelligence> {
  const token = process.env.VERCEL_TOKEN || process.env.JARVIS_VERCEL_TOKEN;
  const project = process.env.VERCEL_PROJECT_ID || process.env.JARVIS_VERCEL_PROJECT_ID || process.env.VERCEL_PROJECT_NAME || process.env.JARVIS_VERCEL_PROJECT_NAME || "Jarvis";
  const teamId = process.env.VERCEL_TEAM_ID || process.env.JARVIS_VERCEL_TEAM_ID;

  if (!token) {
    return {
      configured: false,
      project,
      error: "Set VERCEL_TOKEN plus project/team env vars to inspect deployments.",
    };
  }

  try {
    const params = new URLSearchParams({ limit: "1" });
    if (project) params.set("projectId", project);
    if (teamId) params.set("teamId", teamId);

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
      }>;
    };
    const deployment = payload.deployments?.[0] ?? null;

    return {
      configured: true,
      project,
      latestDeployment: deployment
        ? {
            uid: deployment.uid,
            name: deployment.name,
            state: deployment.state,
            url: deployment.url ? `https://${deployment.url}` : null,
            createdAt: isoFromVercelTimestamp(deployment.createdAt),
            readyAt: isoFromVercelTimestamp(deployment.readyAt ?? deployment.ready),
            target: deployment.target,
          }
        : null,
    };
  } catch (error) {
    logError("buildIntelligence.vercel", error);
    return {
      configured: true,
      project,
      error: error instanceof Error ? error.message : "Unable to inspect Vercel deployments.",
    };
  }
}

export async function getBuildIntelligenceSnapshot(options: { projectKey?: string | null; repo?: string | null; skipActionLog?: boolean } = {}): Promise<BuildIntelligenceSnapshot> {
  const projectRepo = options.repo || getProjectByKey(options.projectKey)?.repo || null;
  const repoSlug = getRepoSlug(projectRepo).slug;
  const project = process.env.VERCEL_PROJECT_ID || process.env.JARVIS_VERCEL_PROJECT_ID || process.env.VERCEL_PROJECT_NAME || process.env.JARVIS_VERCEL_PROJECT_NAME || "Jarvis";
  const [github, vercel] = await Promise.all([
    withIntelligenceTimeout("github", getGitHubIntelligence(projectRepo), () => ({
      configured: Boolean(process.env.GITHUB_TOKEN || process.env.JARVIS_GITHUB_TOKEN),
      repo: repoSlug,
      error: `GitHub intelligence timed out after ${EXTERNAL_INTELLIGENCE_TIMEOUT_MS}ms; returning partial snapshot.`,
    })),
    withIntelligenceTimeout("vercel", getVercelIntelligence(), () => ({
      configured: Boolean(process.env.VERCEL_TOKEN || process.env.JARVIS_VERCEL_TOKEN),
      project,
      error: `Vercel intelligence timed out after ${EXTERNAL_INTELLIGENCE_TIMEOUT_MS}ms; returning partial snapshot.`,
    })),
  ]);
  const externalServices = getExternalServicesHealth();
  const snapshot = {
    generatedAt: new Date().toISOString(),
    github,
    vercel,
    externalServices: {
      generatedAt: new Date().toISOString(),
      summary: summarizeExternalServicesHealth(externalServices),
      services: externalServices,
    },
  };

  if (!options.skipActionLog) {
    await logActionEvent({
      eventType: "intelligence.snapshot",
      summary: `Build intelligence refreshed for ${github.repo}`,
      status: github.error ? "failed" : "executed",
      approvalStage: "findings",
      riskLevel: "low",
      projectKey: options.projectKey ?? "jarvis",
      metadata: {
        repo: github.repo,
        githubConfigured: github.configured,
        vercelConfigured: vercel.configured,
        githubError: github.error,
        vercelError: vercel.error,
        externalServices: snapshot.externalServices.summary,
      },
    });
  }

  return snapshot;
}
