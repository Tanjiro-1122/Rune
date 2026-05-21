import { getProjectByKey, getProjectVercelProjectId, splitRepoSlug, type RuneProjectKey } from "@/lib/project-registry";

export interface ProjectRuntimeIdentity {
  key: RuneProjectKey;
  repo: string;
  owner: string;
  repoName: string;
  liveUrl: string;
  vercelProjectId: string;
  productionBranch: string;
}

export function getProjectRuntimeIdentity(key: RuneProjectKey, env: NodeJS.ProcessEnv = process.env): ProjectRuntimeIdentity {
  const project = getProjectByKey(key);
  if (!project) throw new Error(`Unknown Rune project: ${key}`);

  const repoOverride = key === "rune" ? env.RUNE_GITHUB_REPO : undefined;
  const liveUrlOverride = key === "rune" ? env.RUNE_LIVE_URL : undefined;
  const vercelProjectOverride = key === "rune" ? env.VERCEL_PROJECT_ID : undefined;

  const repo = repoOverride || project.repo;
  const split = splitRepoSlug(repo);
  return {
    key,
    repo: split.slug,
    owner: split.owner,
    repoName: split.repo,
    liveUrl: (liveUrlOverride || project.liveUrl || "").replace(/\/$/, ""),
    vercelProjectId: vercelProjectOverride || getProjectVercelProjectId(key, env) || "",
    productionBranch: project.productionBranch || "main",
  };
}

export function getRuneRuntimeIdentity(env: NodeJS.ProcessEnv = process.env) {
  return getProjectRuntimeIdentity("rune", env);
}
