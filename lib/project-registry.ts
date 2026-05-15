export type JarvisProjectKey = "jarvis" | "unfiltr" | "swh" | "family";

export type JarvisProject = {
  key: JarvisProjectKey;
  label: string;
  canonicalName: string;
  repo: string;
  description: string;
  safetyLevel: "owner-console" | "production-app" | "sensitive-production-app";
  aliases: string[];
};

export const JARVIS_CANONICAL_PROJECTS: JarvisProject[] = [
  {
    key: "jarvis",
    label: "Jarvis",
    canonicalName: "Jarvis private owner console",
    repo: "Tanjiro-1122/Jarvis",
    description:
      "Javier's private AI operating workspace for memory, project control, repo review, task orchestration, and future owner-only services.",
    safetyLevel: "owner-console",
    aliases: ["jarvis", "your repo", "your own repo", "your source", "this app", "this workspace", "owner console"],
  },
  {
    key: "unfiltr",
    label: "Unfiltr",
    canonicalName: "Unfiltr by Javier",
    repo: "Tanjiro-1122/UniltrbyJavierbackup",
    description:
      "AI companion and mental wellness app. Production changes affect real users and must be handled behind approval gates.",
    safetyLevel: "sensitive-production-app",
    aliases: ["unfiltr", "unfiltr by javier", "main app", "ai companion", "mental wellness app"],
  },
  {
    key: "swh",
    label: "SWH",
    canonicalName: "SportsWager Helper",
    repo: "Tanjiro-1122/swhmobile",
    description:
      "SportsWager Helper mobile/web project. Production changes require repo review and approval before execution.",
    safetyLevel: "production-app",
    aliases: ["swh", "sportswager helper", "sports wager helper", "sports app"],
  },
  {
    key: "family",
    label: "Unfiltr Family",
    canonicalName: "Unfiltr Family",
    repo: "Tanjiro-1122/UnfiltrFamily",
    description:
      "Separate elderly-care companion platform. Treat as a distinct production project from Unfiltr by Javier.",
    safetyLevel: "sensitive-production-app",
    aliases: ["family", "unfiltr family", "elderly care", "elderly-care companion", "family app"],
  },
];

export const JARVIS_DEFAULT_REPO = "Tanjiro-1122/Jarvis";

export const JARVIS_APPROVAL_REQUIRED_ACTIONS = [
  "changing production code",
  "committing code",
  "opening pull requests",
  "deploying",
  "sending customer-facing messages",
  "granting credits/free months/subscription changes",
  "accessing sensitive financial data",
  "performing banking actions",
] as const;

export const JARVIS_REAL_CAPABILITIES = [
  "Supabase-backed memory and memory events",
  "Project switchboard for Jarvis, Unfiltr, SWH, and Unfiltr Family",
  "Repo Control proposal workflow",
  "Build Intelligence snapshots when GitHub/Vercel env vars are configured",
  "Deploy Health diagnostics without exposing secrets",
  "Private upload storage with signed URLs",
  "Background task queue and runner API foundation",
  "GitHub repository inspection with configured GitHub token or public access",
] as const;

export const JARVIS_NOT_CONNECTED_YET = [
  "Banking actions or Bank of America integration",
  "Email sending/customer support inbox automation",
  "RevenueCat direct admin/granting controls",
  "App Store Connect direct release control",
  "Google Play Console direct release control",
] as const;

function normalize(input: string) {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function normalizeRepoSlug(input: string | null | undefined) {
  const raw = (input || JARVIS_DEFAULT_REPO).trim();
  const match = raw.match(/github\.com\/([^/\s]+\/[^/\s#?]+)/i);
  const slug = (match?.[1] || raw).replace(/\.git$/i, "").replace(/^@/, "").trim();
  return slug || JARVIS_DEFAULT_REPO;
}

export function splitRepoSlug(input: string | null | undefined) {
  const slug = normalizeRepoSlug(input);
  const [owner, repo] = slug.split("/");
  return {
    slug,
    owner: owner || "Tanjiro-1122",
    repo: repo || "Jarvis",
  };
}

export function getProjectByKey(key: string | null | undefined) {
  return JARVIS_CANONICAL_PROJECTS.find((project) => project.key === key) || null;
}

export function getProjectByRepo(repo: string | null | undefined) {
  const slug = normalizeRepoSlug(repo).toLowerCase();
  return JARVIS_CANONICAL_PROJECTS.find((project) => project.repo.toLowerCase() === slug) || null;
}

export function inferProjectFromText(text: string | null | undefined) {
  const normalized = normalize(text || "");
  if (!normalized) return null;
  return (
    JARVIS_CANONICAL_PROJECTS.find((project) =>
      [project.label, project.canonicalName, project.key, project.repo, ...project.aliases].some((alias) => {
        const candidate = normalize(alias);
        return candidate.length >= 3 && normalized.includes(candidate);
      })
    ) || null
  );
}

export function resolveCanonicalRepo(input: string | null | undefined, textHint?: string | null) {
  const raw = (input || "").trim();
  if (raw) {
    const directProject = getProjectByRepo(raw) || getProjectByKey(raw.toLowerCase());
    if (directProject) return directProject.repo;

    const normalizedRaw = normalize(raw);
    const aliasProject = JARVIS_CANONICAL_PROJECTS.find((project) =>
      [project.label, project.canonicalName, project.key, ...project.aliases].some((alias) => normalize(alias) === normalizedRaw)
    );
    if (aliasProject) return aliasProject.repo;

    return normalizeRepoSlug(raw);
  }

  const inferred = inferProjectFromText(textHint || "");
  return inferred?.repo || JARVIS_DEFAULT_REPO;
}

export function buildProjectRegistryPromptSection() {
  const projectLines = JARVIS_CANONICAL_PROJECTS.map(
    (project) =>
      `- ${project.label}: repo \`${project.repo}\`; ${project.description} Safety: ${project.safetyLevel}.`
  ).join("\n");

  return `## Canonical Project Registry\n${projectLines}\n\n## Brain Grounding Rules\n- If Javier asks about "your repo", "your own repo", "Jarvis code", "this app", or "read yourself", use \`${JARVIS_DEFAULT_REPO}\`. Never guess \`javierhuertas/jarvis\` or invent owner/repo names.\n- If Javier mentions Unfiltr, use \`Tanjiro-1122/UniltrbyJavierbackup\`.\n- If Javier mentions SWH or SportsWager Helper, use \`Tanjiro-1122/swhmobile\`.\n- If Javier mentions Unfiltr Family or elderly-care companion, use \`Tanjiro-1122/UnfiltrFamily\`.\n- If the requested project is not in this registry, ask for the repo slug instead of guessing.\n- Be capability-accurate: separate what is verified, partially wired, requires env/schema setup, and not connected yet.\n\n## Real Capability Snapshot\nCurrently real/wired foundations:\n${JARVIS_REAL_CAPABILITIES.map((item) => `- ${item}`).join("\n")}\n\nNot connected yet:\n${JARVIS_NOT_CONNECTED_YET.map((item) => `- ${item}`).join("\n")}\n\nActions requiring explicit Javier approval before execution:\n${JARVIS_APPROVAL_REQUIRED_ACTIONS.map((item) => `- ${item}`).join("\n")}`;
}
