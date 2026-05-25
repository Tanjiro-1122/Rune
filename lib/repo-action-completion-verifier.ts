import { Octokit } from "@octokit/rest";
import { getRuneRuntimeIdentity } from "@/lib/project-runtime";
import { isRepoAllowed } from "@/lib/repo-actions";
import { logError } from "@/lib/errors";

export type RepoActionProofKind =
  | "proposal"
  | "pr"
  | "merge"
  | "default_branch_file"
  | "deployment"
  | "live_smoke";

export interface RepoActionProofItem {
  kind: RepoActionProofKind;
  ok: boolean;
  label: string;
  url?: string | null;
  sha?: string | null;
  branch?: string | null;
  path?: string | null;
  details?: string | null;
}

export interface RepoActionCompletionEvidence {
  ok: boolean;
  completed: boolean;
  completionTruth: "completed_with_proof" | "not_completed_yet_do_not_claim_done";
  repo: string;
  defaultBranch?: string | null;
  proof: RepoActionProofItem[];
  missingProof: string[];
  summary: string;
}

function getGitHubClient() {
  const token = process.env.GITHUB_TOKEN || process.env.RUNE_GITHUB_TOKEN || process.env.JARVIS_GITHUB_TOKEN;
  return new Octokit({
    ...(token ? { auth: token } : {}),
    userAgent: "Rune-Completion-Verifier/1.0 (+https://github.com/Tanjiro-1122/Rune)",
  });
}

function repoParts(repoSlug?: string | null) {
  const fallback = getRuneRuntimeIdentity().repo;
  const raw = String(repoSlug || fallback).replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/i, "");
  const [owner, repo] = raw.split("/");
  return { owner, repo, slug: `${owner}/${repo}` };
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

export function buildRepoActionCompletionEvidence(input: {
  repo?: string | null;
  defaultBranch?: string | null;
  proof?: RepoActionProofItem[];
  requiredProof?: RepoActionProofKind[];
}): RepoActionCompletionEvidence {
  const { slug } = repoParts(input.repo);
  const proof = input.proof || [];
  const required = input.requiredProof?.length ? input.requiredProof : ["merge"];
  const missingProof = unique(required.filter((kind) => !proof.some((item) => item.kind === kind && item.ok)).map((kind) => {
    if (kind === "pr") return "verified PR URL";
    if (kind === "merge") return "verified merge result / commit SHA";
    if (kind === "default_branch_file") return "verified default-branch file content";
    if (kind === "deployment") return "verified deployment URL/status";
    if (kind === "live_smoke") return "verified live smoke result";
    return "verified proposal evidence";
  }));
  const completed = missingProof.length === 0;
  return {
    ok: true,
    completed,
    completionTruth: completed ? "completed_with_proof" : "not_completed_yet_do_not_claim_done",
    repo: slug,
    defaultBranch: input.defaultBranch || null,
    proof,
    missingProof,
    summary: completed
      ? `Completed with proof: ${proof.filter((item) => item.ok).map((item) => item.label).join("; ")}`
      : `Not complete yet. Missing proof: ${missingProof.join(", ")}.`,
  };
}

export async function verifyPullRequestProof(input: {
  repo?: string | null;
  prUrl?: string | null;
  requiredProof?: RepoActionProofKind[];
}): Promise<RepoActionCompletionEvidence> {
  const { owner, repo, slug } = repoParts(input.repo);
  const proof: RepoActionProofItem[] = [];
  let defaultBranch: string | null = null;

  try {
    if (!isRepoAllowed(slug)) throw new Error(`Repo ${slug} is not allowlisted for completion verification.`);
    const prMatch = String(input.prUrl || "").match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/i);
    if (!prMatch) {
      return buildRepoActionCompletionEvidence({
        repo: slug,
        proof: [{ kind: "pr", ok: false, label: "No valid GitHub PR URL supplied", details: "A GitHub pull request URL is required for PR proof." }],
        requiredProof: input.requiredProof || ["pr"],
      });
    }
    const [, urlOwner, urlRepo, number] = prMatch;
    const normalizedUrlSlug = `${urlOwner}/${urlRepo}`;
    if (normalizedUrlSlug.toLowerCase() !== slug.toLowerCase()) throw new Error(`PR URL repo ${normalizedUrlSlug} does not match expected repo ${slug}.`);

    const octokit = getGitHubClient();
    const repository = await octokit.repos.get({ owner, repo });
    defaultBranch = repository.data.default_branch || "main";
    const pr = await octokit.pulls.get({ owner, repo, pull_number: Number(number) });
    proof.push({
      kind: "pr",
      ok: true,
      label: `PR #${number} verified`,
      url: pr.data.html_url,
      sha: pr.data.head.sha,
      branch: pr.data.head.ref,
      details: `state=${pr.data.state}; merged=${Boolean(pr.data.merged_at)}`,
    });
    if (pr.data.merged_at && pr.data.merge_commit_sha) {
      proof.push({ kind: "merge", ok: true, label: `PR #${number} merged`, url: pr.data.html_url, sha: pr.data.merge_commit_sha, branch: defaultBranch, details: `merged_at=${pr.data.merged_at}` });
    } else {
      proof.push({ kind: "merge", ok: false, label: `PR #${number} is not merged`, url: pr.data.html_url, sha: pr.data.head.sha, branch: pr.data.head.ref, details: "Default branch may not include the change yet." });
    }
    return buildRepoActionCompletionEvidence({ repo: slug, defaultBranch, proof, requiredProof: input.requiredProof || ["pr"] });
  } catch (error) {
    logError("repoActionCompletionVerifier.verifyPullRequestProof", error);
    return {
      ok: false,
      completed: false,
      completionTruth: "not_completed_yet_do_not_claim_done",
      repo: slug,
      defaultBranch,
      proof,
      missingProof: ["verification failed"],
      summary: "Repo action completion verification failed. Do not claim the repo action is complete.",
    };
  }
}

export async function verifyDefaultBranchFileProof(input: {
  repo?: string | null;
  path: string;
  expectedIncludes?: string | null;
  requiredProof?: RepoActionProofKind[];
}): Promise<RepoActionCompletionEvidence> {
  const { owner, repo, slug } = repoParts(input.repo);
  const proof: RepoActionProofItem[] = [];
  let defaultBranch: string | null = null;

  try {
    if (!isRepoAllowed(slug)) throw new Error(`Repo ${slug} is not allowlisted for file proof verification.`);
    const octokit = getGitHubClient();
    const repository = await octokit.repos.get({ owner, repo });
    defaultBranch = repository.data.default_branch || "main";
    const response = await octokit.repos.getContent({ owner, repo, path: input.path, ref: defaultBranch });
    const content = response.data;
    if (Array.isArray(content) || content.type !== "file") throw new Error(`${input.path} is not a plain file on ${defaultBranch}.`);
    let includes = true;
    if (input.expectedIncludes) {
      const decoded = Buffer.from(String("content" in content ? content.content : "").replace(/\n/g, ""), "base64").toString("utf8");
      includes = decoded.includes(input.expectedIncludes);
    }
    proof.push({
      kind: "default_branch_file",
      ok: includes,
      label: includes ? `${input.path} verified on ${defaultBranch}` : `${input.path} exists but expected content was not found`,
      sha: "sha" in content ? content.sha : null,
      branch: defaultBranch,
      path: input.path,
      details: "size" in content ? `${content.size} bytes` : null,
    });
    return buildRepoActionCompletionEvidence({ repo: slug, defaultBranch, proof, requiredProof: input.requiredProof || ["default_branch_file"] });
  } catch (error) {
    logError("repoActionCompletionVerifier.verifyDefaultBranchFileProof", error);
    proof.push({ kind: "default_branch_file", ok: false, label: `${input.path} not verified on default branch`, path: input.path, branch: defaultBranch, details: error instanceof Error ? error.message : String(error) });
    return buildRepoActionCompletionEvidence({ repo: slug, defaultBranch, proof, requiredProof: input.requiredProof || ["default_branch_file"] });
  }
}
