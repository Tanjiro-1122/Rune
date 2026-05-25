export type RuneProjectKey = "rune" | "unfiltr" | "swh" | "family";
export type ProjectPlatform = "ios" | "android" | "web";
export type ProjectHealthCheckKey =
  | "web_availability"
  | "vercel_deployments"
  | "github_actions"
  | "supabase_memory"
  | "app_store_connect"
  | "revenuecat"
  | "google_play"
  | "base44_dependency";

export type RuneProjectIntegration = {
  appStoreConnect?: {
    appId?: string;
    bundleId?: string;
    issuerIdEnv?: string;
    keyIdEnv?: string;
    privateKeyEnv?: string;
  };
  googlePlay?: {
    packageName?: string;
    serviceAccountEnv?: string;
  };
  revenueCat?: {
    projectLabel?: string;
    apiKeyEnv?: string;
    entitlement?: string;
  };
  supabase?: {
    projectRef?: string;
    urlEnv?: string;
    serviceRoleEnv?: string;
  };
  base44?: {
    appId?: string;
    severanceStatus: "legacy_dependency" | "removed" | "not_applicable";
  };
};

export type RuneProject = {
  key: RuneProjectKey;
  label: string;
  canonicalName: string;
  repo: string;
  description: string;
  safetyLevel: "owner-console" | "production-app" | "sensitive-production-app";
  aliases: string[];
  /** Platforms this project is actually deployed on. Empty means unknown/all. */
  platforms: ProjectPlatform[];
  liveUrl?: string;
  vercelProjectId?: string;
  vercelProjectIdEnv?: string;
  productionBranch: string;
  healthChecks: ProjectHealthCheckKey[];
  integrations: RuneProjectIntegration;
};

export const RUNE_CANONICAL_PROJECTS: RuneProject[] = [
  {
    key: "rune",
    label: "Rune",
    canonicalName: "Rune private owner console",
    repo: "Tanjiro-1122/Rune",
    description:
      "Rune is Javier's private AI operating workspace for memory, project control, repo review, task orchestration, and future owner-only services.",
    safetyLevel: "owner-console",
    platforms: ["web"],
    liveUrl: "https://mrruneai.vercel.app",
    vercelProjectId: "prj_C8yIrPTBitcCIkW745Gx80LBB6CA",
    vercelProjectIdEnv: "RUNE_VERCEL_PROJECT_ID",
    productionBranch: "main",
    healthChecks: ["web_availability", "vercel_deployments", "github_actions", "supabase_memory", "base44_dependency"],
    integrations: {
      supabase: {
        projectRef: "hvvrbpvsgjxiicigkwhu",
        urlEnv: "SUPABASE_URL",
        serviceRoleEnv: "SUPABASE_SERVICE_ROLE_KEY",
      },
      base44: {
        severanceStatus: "removed",
      },
    },
    aliases: ["rune", "jarvis", "personal ai", "super agent", "private ai", "your repo", "your own repo", "your source", "this app", "this workspace", "owner console", "command center"],
  },
  {
    key: "unfiltr",
    label: "Unfiltr",
    canonicalName: "Unfiltr by Javier",
    repo: "Tanjiro-1122/UniltrbyJavierbackup",
    description:
      "AI companion and mental wellness app. iOS-only — no Android/Google Play presence. Production changes affect real users and must be handled behind approval gates.",
    safetyLevel: "sensitive-production-app",
    platforms: ["ios", "web"],
    liveUrl: "https://unfiltrbyjavier2.vercel.app",
    vercelProjectId: "prj_WU7TJF4pq8xngaks0VVEVRV1l5Rm",
    vercelProjectIdEnv: "UNFILTR_VERCEL_PROJECT_ID",
    productionBranch: "main",
    healthChecks: ["web_availability", "vercel_deployments", "github_actions", "app_store_connect", "revenuecat", "base44_dependency"],
    integrations: {
      appStoreConnect: {
        appId: "6760604917",
        bundleId: "com.huertas.unfiltr",
        issuerIdEnv: "APP_STORE_CONNECT_ISSUER_ID",
        keyIdEnv: "APP_STORE_CONNECT_KEY_ID",
        privateKeyEnv: "APP_STORE_CONNECT_PRIVATE_KEY",
      },
      revenueCat: {
        projectLabel: "Unfiltr",
        apiKeyEnv: "REVENUECAT_API_KEY",
        entitlement: "unfiltr by javier Pro",
      },
      base44: {
        appId: "69b332a392004d139d4ba495",
        severanceStatus: "removed",
      },
    },
    aliases: ["unfiltr", "unfiltr by javier", "main app", "ai companion", "mental wellness app"],
  },
  {
    key: "swh",
    label: "SWH",
    canonicalName: "Sports Wager Helper",
    repo: "Tanjiro-1122/swhmobile",
    description:
      "Sports Wager Helper mobile/web project. Production changes require repo review and approval before execution.",
    safetyLevel: "production-app",
    platforms: ["android", "web"],
    productionBranch: "main",
    healthChecks: ["web_availability", "github_actions", "google_play", "base44_dependency"],
    integrations: {
      googlePlay: {
        packageName: "com.huertas.sportswagerhelper",
        serviceAccountEnv: "GOOGLE_PLAY_SERVICE_ACCOUNT_JSON",
      },
      base44: {
        severanceStatus: "removed",
      },
    },
    aliases: ["swh", "sportswager helper", "sports wager helper", "sports wager", "sports app", "betting app"],
  },
  {
    key: "family",
    label: "Unfiltr Family",
    canonicalName: "Unfiltr Family",
    repo: "Tanjiro-1122/UnfiltrFamily",
    description:
      "Separate elderly-care companion platform. Treat as a distinct production project from Unfiltr by Javier.",
    safetyLevel: "sensitive-production-app",
    platforms: ["web"],
    productionBranch: "main",
    healthChecks: ["web_availability", "github_actions", "base44_dependency"],
    integrations: {
      base44: {
        severanceStatus: "removed",
      },
    },
    aliases: ["family", "unfiltr family", "elderly care", "elderly-care companion", "family app"],
  },
];

export const RUNE_DEFAULT_REPO = "Tanjiro-1122/Rune";

export const RUNE_APPROVAL_REQUIRED_ACTIONS = [
  "changing production code",
  "committing code",
  "opening pull requests",
  "deploying",
  "sending customer-facing messages",
  "granting credits/free months/subscription changes",
  "accessing sensitive financial data",
  "performing banking actions",
] as const;

export const RUNE_REAL_CAPABILITIES = [
  "Supabase-backed memory and memory events",
  "Project switchboard for Rune, Unfiltr, SWH, and Unfiltr Family",
  "Repo Control proposal workflow",
  "Build Intelligence snapshots when GitHub/Vercel env vars are configured",
  "Deploy Health diagnostics without exposing secrets",
  "Private upload storage with signed URLs",
  "Background task queue and runner API foundation",
  "GitHub repository inspection with configured GitHub token or public access",
] as const;

export const RUNE_NOT_CONNECTED_YET = [
  "Banking actions or Bank of America integration",
  // Email sending now wired via Resend (RESEND_API_KEY)
  "RevenueCat direct admin/granting controls",
  "App Store Connect direct release control",
  "Google Play Console direct release control",
] as const;

function normalize(input: string) {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function normalizeRepoSlug(input: string | null | undefined) {
  const raw = (input || RUNE_DEFAULT_REPO).trim();
  const match = raw.match(/github\.com\/([^/\s]+\/[^/\s#?]+)/i);
  const slug = (match?.[1] || raw).replace(/\.git$/i, "").replace(/^@/, "").trim();
  return slug || RUNE_DEFAULT_REPO;
}

export function splitRepoSlug(input: string | null | undefined) {
  const slug = normalizeRepoSlug(input);
  const [owner, repo] = slug.split("/");
  return {
    slug,
    owner: owner || "Tanjiro-1122",
    repo: repo || "Rune",
  };
}

export function getProjectByKey(key: string | null | undefined) {
  return RUNE_CANONICAL_PROJECTS.find((project) => project.key === key) || null;
}

export function getProjectByRepo(repo: string | null | undefined) {
  const slug = normalizeRepoSlug(repo).toLowerCase();
  return RUNE_CANONICAL_PROJECTS.find((project) => project.repo.toLowerCase() === slug) || null;
}

export function getProjectLiveUrl(key: string | null | undefined) {
  return getProjectByKey(key)?.liveUrl || null;
}

export function getProjectVercelProjectId(key: string | null | undefined, env: NodeJS.ProcessEnv = process.env) {
  const project = getProjectByKey(key);
  if (!project) return null;
  const envValue = project.vercelProjectIdEnv ? env[project.vercelProjectIdEnv] : undefined;
  return envValue || project.vercelProjectId || null;
}

export function getProjectsWithHealthCheck(check: ProjectHealthCheckKey) {
  return RUNE_CANONICAL_PROJECTS.filter((project) => project.healthChecks.includes(check));
}

export function getProjectsWithBase44Dependency() {
  return RUNE_CANONICAL_PROJECTS.filter((project) => project.integrations.base44?.severanceStatus === "legacy_dependency");
}

export function inferProjectFromText(text: string | null | undefined) {
  const normalized = normalize(text || "");
  if (!normalized) return null;
  return (
    RUNE_CANONICAL_PROJECTS.find((project) =>
      [project.label, project.canonicalName, project.key, project.repo, ...project.aliases].some((alias) => {
        const candidate = normalize(alias);
        return candidate.length >= 3 && normalized.includes(candidate);
      })
    ) || null
  );
}

export type ProjectResolutionConfidence = "high" | "medium" | "low";

export interface ProjectResolutionResult {
  project: RuneProject | null;
  projects: RuneProject[];
  confidence: number;
  confidenceBand: ProjectResolutionConfidence;
  source: "explicit" | "alias" | "workspace_alias" | "recent_context" | "global_operation" | "none";
  reason: string;
  shouldAct: boolean;
  shouldMentionAssumption: boolean;
  shouldClarify: boolean;
  operation?: "base44_severance" | "general_project";
}

function confidenceBand(confidence: number): ProjectResolutionConfidence {
  if (confidence >= 85) return "high";
  if (confidence >= 60) return "medium";
  return "low";
}

function uniqueProjects(projects: RuneProject[]) {
  const seen = new Set<RuneProjectKey>();
  return projects.filter((project) => {
    if (seen.has(project.key)) return false;
    seen.add(project.key);
    return true;
  });
}

export function resolveProjectContext(input: {
  text?: string | null;
  recentProjectKey?: string | null;
}): ProjectResolutionResult {
  const raw = input.text || "";
  const normalized = normalize(raw);

  const empty: ProjectResolutionResult = {
    project: null,
    projects: [],
    confidence: 0,
    confidenceBand: "low",
    source: "none",
    reason: "No project reference was detected.",
    shouldAct: false,
    shouldMentionAssumption: false,
    shouldClarify: true,
  };
  if (!normalized) return empty;

  const base44SeverancePattern = /(base44|base 44).*(severance|severed|sever|dependency|dependencies|ties|connection|connections|references?)|(severance|severed|sever).*(base44|base 44)/i;
  if (base44SeverancePattern.test(raw)) {
    const projects = RUNE_CANONICAL_PROJECTS.slice();
    return {
      project: null,
      projects,
      confidence: 94,
      confidenceBand: "high",
      source: "global_operation",
      reason: "Base44 severance is a known all-project dependency audit across Rune, Unfiltr, SWH, and Unfiltr Family.",
      shouldAct: true,
      shouldMentionAssumption: false,
      shouldClarify: false,
      operation: "base44_severance",
    };
  }

  const scored = RUNE_CANONICAL_PROJECTS.map((project) => {
    const aliases = [project.label, project.canonicalName, project.key, project.repo, ...project.aliases];
    let best = 0;
    let reason = "";
    for (const alias of aliases) {
      const candidate = normalize(alias);
      if (!candidate || candidate.length < 3) continue;
      if (normalized === candidate) {
        best = Math.max(best, 98);
        reason = `Exact project reference matched “${alias}”.`;
      } else if (normalized.includes(candidate)) {
        const score = candidate.length >= 8 ? 92 : 86;
        if (score > best) {
          best = score;
          reason = `Project alias matched “${alias}”.`;
        }
      }
    }
    return { project, score: best, reason };
  }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score);

  if (scored.length > 0) {
    const top = scored[0];
    const tied = uniqueProjects(scored.filter((item) => item.score >= top.score - 4).map((item) => item.project));
    const confidence = tied.length > 1 ? Math.max(60, top.score - 18) : top.score;
    const band = confidenceBand(confidence);
    return {
      project: tied.length === 1 ? tied[0] : null,
      projects: tied,
      confidence,
      confidenceBand: band,
      source: top.score >= 92 ? "explicit" : "alias",
      reason: tied.length === 1 ? top.reason : "Multiple project aliases matched with similar confidence.",
      shouldAct: confidence >= 60,
      shouldMentionAssumption: confidence >= 60 && confidence < 85,
      shouldClarify: confidence < 60,
      operation: "general_project",
    };
  }

  const recent = getProjectByKey(input.recentProjectKey || undefined);
  if (recent) {
    return {
      project: recent,
      projects: [recent],
      confidence: 70,
      confidenceBand: "medium",
      source: "recent_context",
      reason: `No explicit project was named, so recent project context resolves to ${recent.label}.`,
      shouldAct: true,
      shouldMentionAssumption: true,
      shouldClarify: false,
      operation: "general_project",
    };
  }

  return empty;
}

export function buildProjectResolutionPromptSection(result: ProjectResolutionResult) {
  if (result.operation === "base44_severance") {
    return `## Project Resolution
- Resolved operation: Base44 severance / dependency audit.
- Confidence: ${result.confidence}%.
- Scope: ${result.projects.map((project) => project.label).join(", ")}.
- Do not ask which project. Do not ask which app. Act on the all-project Base44 dependency audit and mention that scope briefly.`;
  }

  if (result.project) {
    return `## Project Resolution
- Resolved project: ${result.project.label} (${result.project.repo}).
- Confidence: ${result.confidence}%.
- Source: ${result.source}.
- ${result.shouldMentionAssumption ? "Mention the assumption briefly, then act." : "Do not ask for clarification; act on this project."}`;
  }

  if (result.projects.length > 1 && result.shouldAct) {
    return `## Project Resolution
- Multiple likely projects: ${result.projects.map((project) => `${project.label} (${project.repo})`).join(", ")}.
- Confidence: ${result.confidence}%.
- Act across these projects unless the request requires a single destructive target.`;
  }

  return `## Project Resolution
- No confident project match. Ask one clarifying question only if a project is required to proceed.`;
}

export function resolveCanonicalRepo(input: string | null | undefined, textHint?: string | null) {
  const raw = (input || "").trim();
  if (raw) {
    const directProject = getProjectByRepo(raw) || getProjectByKey(raw.toLowerCase());
    if (directProject) return directProject.repo;

    const normalizedRaw = normalize(raw);
    const aliasProject = RUNE_CANONICAL_PROJECTS.find((project) =>
      [project.label, project.canonicalName, project.key, ...project.aliases].some((alias) => normalize(alias) === normalizedRaw)
    );
    if (aliasProject) return aliasProject.repo;

    return normalizeRepoSlug(raw);
  }

  const inferred = inferProjectFromText(textHint || "");
  return inferred?.repo || RUNE_DEFAULT_REPO;
}

export function buildProjectRegistryPromptSection() {
  const projectLines = RUNE_CANONICAL_PROJECTS.map(
    (project) =>
      `- ${project.label}: repo \`${project.repo}\`; ${project.description} Safety: ${project.safetyLevel}. Platforms: ${project.platforms.length ? project.platforms.join(", ") : "unknown"}.`
  ).join("\n");

  return `## Canonical Project Registry\n${projectLines}\n\n## Brain Grounding Rules\n- If Javier asks about "your repo", "your own repo", "Rune code", "this app", or "read yourself", use \`${RUNE_DEFAULT_REPO}\`. Never guess \`javierhuertas/jarvis\` or invent owner/repo names.\n- If Javier mentions Unfiltr, use \`Tanjiro-1122/UniltrbyJavierbackup\`.\n- If Javier mentions SWH or SportsWager Helper, use \`Tanjiro-1122/swhmobile\`.\n- If Javier mentions Unfiltr Family or elderly-care companion, use \`Tanjiro-1122/UnfiltrFamily\`.\n- Unfiltr is iOS-only — never expect Google Play credentials for Unfiltr.\n- If the requested project is not in this registry, ask for the repo slug instead of guessing.\n- Be capability-accurate: separate what is verified, partially wired, requires env/schema setup, and not connected yet.\n\n## Real Capability Snapshot\nCurrently real/wired foundations:\n${RUNE_REAL_CAPABILITIES.map((item) => `- ${item}`).join("\n")}\n\nNot connected yet:\n${RUNE_NOT_CONNECTED_YET.map((item) => `- ${item}`).join("\n")}\n\nActions requiring explicit Javier approval before execution:\n${RUNE_APPROVAL_REQUIRED_ACTIONS.map((item) => `- ${item}`).join("\n")}`;
}
