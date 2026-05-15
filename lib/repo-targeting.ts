import {
  JARVIS_DEFAULT_REPO,
  getProjectByKey,
  getProjectByRepo,
  inferProjectFromText,
  resolveCanonicalRepo,
} from "@/lib/project-registry";
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
    inferProjectFromText(requestText);
  const repo = resolveCanonicalRepo(input.repo || inferredProject?.repo || JARVIS_DEFAULT_REPO, requestText);
  const project = getProjectByRepo(repo) || inferredProject;
  const projectKey = project?.key || input.projectKey || "jarvis";
  const files: RepoActionFileTarget[] = [...(input.files || [])];

  if (projectKey === "jarvis") {
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
