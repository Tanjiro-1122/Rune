import {
  RUNE_DEFAULT_REPO,
  getProjectByKey,
  getProjectByRepo,
  inferProjectFromText,
  resolveCanonicalRepo,
  resolveProjectContext,
} from "@/lib/project-registry";
import { Octokit } from "@octokit/rest";
import type { RepoActionFileTarget, RepoActionRisk } from "@/lib/repo-actions";

function compactText(parts: Array<string | null | undefined>) {
  return parts.filter(Boolean).join("\n").toLowerCase();
}

function hasAny(text: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(text));
}

function pushUnique(files: RepoActionFileTarget[], target: RepoActionFileTarget) {
  if (!files.some((file) => file.path === target.path)) files.push(target);
}

export function inferRepoActionTargets(input: {
  title?: string | null;
  summary?: string | null;
  findings?: string | null;
  plan?: string | null;
  repo?: string | null;
  projectKey?: string | null;
  riskLevel?: RepoActionRisk | null;
  files?: RepoActionFileTarget[] | null;
}) {
  const requestText = compactText([input.title, input.summary, input.findings, input.plan]);
  const inferredProject =
    getProjectByKey(input.projectKey || undefined) ||
    getProjectByRepo(input.repo || undefined) ||
    resolveProjectContext({ text: requestText }).project ||
    inferProjectFromText(requestText);
  const repo = resolveCanonicalRepo(input.repo || inferredProject?.repo || RUNE_DEFAULT_REPO, requestText);
  const project = getProjectByRepo(repo) || inferredProject;
  const projectKey = project?.key || input.projectKey || "rune";
  const files: RepoActionFileTarget[] = [...(input.files || [])];

  if (projectKey === "rune") {
    if (hasAny(requestText, [/router|routing|intent|self[- ]?audit|capabilit|calculator|calculate/])) {
      pushUnique(files, { path: "lib/orchestration.ts", operation: "inspect", note: "Routing, intent detection, and planner behavior." });
      pushUnique(files, { path: "app/api/chat/route.ts", operation: "inspect", note: "Chat tools, prompt, and execution route." });
    }
    if (hasAny(requestText, [/repo control|proposal|pull request|\bpr\b|diff|sandbox|ladder|builder|agent core/])) {
      pushUnique(files, { path: "lib/repo-actions.ts", operation: "inspect", note: "Repo Control backend stages and safety gates." });
      pushUnique(files, { path: "app/api/chat/route.ts", operation: "inspect", note: "Chat-facing Repo Control tools." });
      pushUnique(files, { path: "components/chat.tsx", operation: "inspect", note: "Repo Control progress rendering." });
    }
    if (hasAny(requestText, [/ui|design|glass|light|dark|mobile|iphone|drawer|composer|progress|card|visual/])) {
      pushUnique(files, { path: "components/chat.tsx", operation: "inspect", note: "Primary chat UI and cards." });
      pushUnique(files, { path: "app/globals.css", operation: "inspect", note: "Global shell and visual styling." });
    }
    if (hasAny(requestText, [/memory|supabase|schema|database|table/])) {
      pushUnique(files, { path: "lib/memory.ts", operation: "inspect", note: "Memory persistence layer." });
      pushUnique(files, { path: "supabase/schema.sql", operation: "inspect", note: "Database schema." });
    }
    if (hasAny(requestText, [/deploy|vercel|health|env|environment|setup/])) {
      pushUnique(files, { path: "lib/deploy-health.ts", operation: "inspect", note: "Deploy health checks." });
      pushUnique(files, { path: "app/api/deploy-health/route.ts", operation: "inspect", note: "Deploy health endpoint." });
    }
  }

  if (projectKey === "unfiltr") {
    if (hasAny(requestText, [/pricing|purchase|subscription|revenuecat|paywall|premium|entitlement|restore/])) {
      pushUnique(files, { path: "src/pages/Pricing.jsx", operation: "inspect", note: "Pricing/paywall UI candidate." });
      pushUnique(files, { path: "src/lib/entitlements.js", operation: "inspect", note: "Entitlement mapping candidate." });
      pushUnique(files, { path: "src/components/hooks/useAppleSubscriptions.jsx", operation: "inspect", note: "Subscription bridge candidate." });
    }
    if (hasAny(requestText, [/chat|companion|message|memory|greeting|bubble/])) {
      pushUnique(files, { path: "src/pages/ChatPage.jsx", operation: "inspect", note: "Main companion chat candidate." });
      pushUnique(files, { path: "src/lib/AuthContext.jsx", operation: "inspect", note: "Profile/auth context candidate." });
    }
    if (hasAny(requestText, [/home|hub|settings|toggle|profile/])) {
      pushUnique(files, { path: "src/pages/HomeScreen.jsx", operation: "inspect", note: "Home screen candidate." });
      pushUnique(files, { path: "src/pages/Settings.jsx", operation: "inspect", note: "Settings/toggles candidate." });
    }
  }

  if (projectKey === "swh") {
    if (hasAny(requestText, [/ask sal|sal|parlay|prediction|odds|bet|wager/])) {
      pushUnique(files, { path: "src/pages/AskSAL.jsx", operation: "inspect", note: "Ask SAL candidate." });
      pushUnique(files, { path: "api/generateParlay.ts", operation: "inspect", note: "Parlay generation candidate." });
    }
    if (hasAny(requestText, [/player|team|stats|statistics/])) {
      pushUnique(files, { path: "api/getPlayerStats.js", operation: "inspect", note: "Player stats candidate." });
      pushUnique(files, { path: "api/getTeamStats.js", operation: "inspect", note: "Team stats candidate." });
    }
  }

  if (projectKey === "family") {
    if (hasAny(requestText, [/care|elder|family|check[- ]?in|dashboard|guardian/])) {
      pushUnique(files, { path: "src/pages/HomeScreen.jsx", operation: "inspect", note: "Family home/dashboard candidate." });
      pushUnique(files, { path: "src/pages/Settings.jsx", operation: "inspect", note: "Family settings candidate." });
    }
  }

  let riskLevel = input.riskLevel || "medium";
  if (project?.safetyLevel === "sensitive-production-app") riskLevel = "high";
  if (project?.safetyLevel === "owner-console" && !hasAny(requestText, [/auth|security|secret|deploy|production|delete|payment|customer/])) riskLevel = input.riskLevel || "medium";
  if (hasAny(requestText, [/auth|security|secret|payment|purchase|revenuecat|deploy|delete|production|customer|email|bank|financial/])) riskLevel = "high";

  return {
    repo,
    projectKey,
    riskLevel,
    files: files.slice(0, 20),
  };
}


function splitRepo(repoSlug: string) {
  const raw = repoSlug.trim();
  const match = raw.match(/github\.com\/([^/\s]+\/[^/\s#?]+)|^([^/\s]+\/[^/\s#?]+)$/i);
  const slug = (match?.[1] || match?.[2] || RUNE_DEFAULT_REPO).replace(/\.git$/i, "");
  const [owner, repo] = slug.split("/");
  return { owner: owner || "Tanjiro-1122", repo: repo || "Rune", slug };
}

function getGitHubClient() {
  const token = process.env.GITHUB_TOKEN || process.env.RUNE_GITHUB_TOKEN;
  return new Octokit({
    ...(token ? { auth: token } : {}),
    userAgent: "Rune-Repo-Targeting/1.0 (+https://github.com/Tanjiro-1122/Rune)",
  });
}

function normalizePath(value: string) {
  return value.replace(/^\/+/, "").trim();
}

function scoreCandidate(requested: string, candidate: string) {
  const req = normalizePath(requested).toLowerCase();
  const cand = normalizePath(candidate).toLowerCase();
  if (cand === req) return 1000;
  if (cand.endsWith(`/${req}`)) return 850;
  const reqBase = req.split("/").pop() || req;
  const candBase = cand.split("/").pop() || cand;
  if (candBase === reqBase) return 700;
  if (cand.endsWith(reqBase)) return 550;
  const reqParts = req.split(/[/.\-_]/).filter(Boolean);
  const candParts = cand.split(/[/.\-_]/).filter(Boolean);
  const overlap = reqParts.filter((part) => candParts.includes(part)).length;
  return overlap * 100 - Math.abs(cand.length - req.length) * 0.2;
}

function findClosestPath(requested: string, filePaths: string[]) {
  let best: { path: string; score: number } | null = null;
  for (const candidate of filePaths) {
    const score = scoreCandidate(requested, candidate);
    if (!best || score > best.score) best = { path: candidate, score };
  }
  return best && best.score >= 180 ? best.path : null;
}

export async function validateRepoActionTargets(input: {
  repo: string;
  files: RepoActionFileTarget[];
}) {
  const { owner, repo } = splitRepo(input.repo);
  const originalFiles = input.files || [];
  if (!originalFiles.length) {
    return {
      ok: true,
      verified: false,
      files: originalFiles,
      defaultBranch: null as string | null,
      notes: ["No file targets were provided or inferred."],
    };
  }

  try {
    const octokit = getGitHubClient();
    const { data: repoData } = await octokit.repos.get({ owner, repo });
    const defaultBranch = repoData.default_branch || "main";
    const { data: refData } = await octokit.git.getRef({ owner, repo, ref: `heads/${defaultBranch}` });
    const { data: treeData } = await octokit.git.getTree({
      owner,
      repo,
      tree_sha: refData.object.sha,
      recursive: "true",
    });
    const filePaths = treeData.tree
      .filter((item) => item.type === "blob" && typeof item.path === "string")
      .map((item) => item.path as string);
    const fileSet = new Set(filePaths.map((file) => file.toLowerCase()));
    const notes: string[] = [];
    const validated = originalFiles.map((file) => {
      const cleanedPath = normalizePath(file.path);
      if (fileSet.has(cleanedPath.toLowerCase())) {
        return { ...file, path: cleanedPath, note: file.note ? `${file.note} Verified in repo tree.` : "Verified in repo tree." };
      }
      const closest = findClosestPath(cleanedPath, filePaths);
      if (closest) {
        notes.push(`Retargeted ${cleanedPath} → ${closest}`);
        return {
          ...file,
          path: closest,
          note: [file.note, `Retargeted from ${cleanedPath} after repo-tree validation.`].filter(Boolean).join(" "),
        };
      }
      notes.push(`Could not verify ${cleanedPath}`);
      return {
        ...file,
        path: cleanedPath,
        note: [file.note, "Not found during repo-tree validation; inspect stage may confirm alternate location."].filter(Boolean).join(" "),
      };
    });

    return { ok: true, verified: true, files: validated, defaultBranch, notes };
  } catch (error) {
    return {
      ok: false,
      verified: false,
      files: originalFiles,
      defaultBranch: null as string | null,
      notes: [error instanceof Error ? error.message : "Repo-tree validation failed."],
    };
  }
}
