import { createRepoActionProposal, type RepoActionFileTarget, type RepoActionProposalRow, type RepoActionRisk } from "@/lib/repo-actions";

export type AppCreatorPlatform = "web" | "mobile" | "both";
export type AppCreatorComplexity = "simple" | "standard" | "advanced";

export interface AppCreatorInput {
  idea: string;
  appName?: string | null;
  targetUsers?: string | null;
  platform?: AppCreatorPlatform;
  complexity?: AppCreatorComplexity;
  mustHaveFeatures?: string[];
  preferredStack?: string | null;
  projectKey?: string | null;
  repo?: string | null;
  sessionId?: string | null;
  workspaceId?: string | null;
  conversationId?: string | null;
}

export interface AppCreatorPlan {
  appName: string;
  slug: string;
  platform: AppCreatorPlatform;
  complexity: AppCreatorComplexity;
  targetUsers: string;
  coreFeatures: string[];
  screens: string[];
  dataModel: string[];
  repoPlan: string[];
  buildPlan: string[];
  safety: string;
}

export interface AppCreatorResult {
  ok: boolean;
  appPlan?: AppCreatorPlan;
  proposal?: RepoActionProposalRow;
  proposalId?: string;
  error?: string;
  message: string;
  safety: string;
  nextAction: string;
}

function cleanText(value: string | null | undefined, max = 900) {
  return (value ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function titleCase(value: string) {
  return value
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function slugify(value: string) {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "new-app";
}

function inferAppName(idea: string, provided?: string | null) {
  const explicit = cleanText(provided, 80);
  if (explicit) return titleCase(explicit);
  const words = cleanText(idea, 120)
    .replace(/^(create|build|make|design)\s+(me\s+)?(a|an|the)?\s*/i, "")
    .split(/\s+/)
    .filter((word) => !["simple", "basic", "new", "app", "application", "for", "that", "with"].includes(word.toLowerCase()))
    .slice(0, 4);
  return titleCase(words.join(" ") || "New App");
}

function unique(items: string[]) {
  return Array.from(new Set(items.map((item) => cleanText(item, 140)).filter(Boolean))).slice(0, 8);
}

function inferFeatures(idea: string, provided?: string[]) {
  const text = idea.toLowerCase();
  const features = unique(provided ?? []);
  if (text.includes("crm") || text.includes("customer")) features.push("Customer/contact management", "Status pipeline", "Notes and follow-ups");
  if (text.includes("habit") || text.includes("streak")) features.push("Habit tracking", "Daily check-ins", "Streak analytics");
  if (text.includes("task") || text.includes("todo")) features.push("Task list", "Priority/status tracking", "Due date reminders");
  if (text.includes("invoice") || text.includes("payment")) features.push("Invoice records", "Payment status tracking");
  if (text.includes("journal") || text.includes("mood")) features.push("Private entries", "Mood trends", "Reflection prompts");
  if (features.length === 0) features.push("Clean dashboard", "Create/edit records", "Search and filtering", "Settings/preferences");
  return unique(features).slice(0, 6);
}

function inferScreens(features: string[]) {
  const screens = ["Landing / welcome", "Main dashboard"];
  if (features.some((feature) => /customer|contact|record|task|habit|entry|invoice/i.test(feature))) screens.push("Create/edit form", "Detail view");
  if (features.some((feature) => /analytics|trend|streak|status|pipeline/i.test(feature))) screens.push("Insights view");
  screens.push("Settings");
  return unique(screens).slice(0, 6);
}

function inferDataModel(features: string[]) {
  const models = ["User profile / owner settings"];
  if (features.some((feature) => /customer|contact/i.test(feature))) models.push("Contact: name, status, notes, next_follow_up");
  if (features.some((feature) => /task/i.test(feature))) models.push("Task: title, priority, status, due_date");
  if (features.some((feature) => /habit|streak/i.test(feature))) models.push("Habit: title, cadence, streak_count, last_check_in");
  if (features.some((feature) => /invoice|payment/i.test(feature))) models.push("Invoice: customer, amount, due_date, payment_status");
  if (features.some((feature) => /journal|mood|entry/i.test(feature))) models.push("Entry: content, mood, tags, created_at");
  if (models.length === 1) models.push("Record: title, status, notes, created_at");
  return unique(models).slice(0, 6);
}

function riskForComplexity(complexity: AppCreatorComplexity): RepoActionRisk {
  if (complexity === "advanced") return "high";
  if (complexity === "standard") return "medium";
  return "low";
}

function buildBlueprint(plan: AppCreatorPlan, idea: string, preferredStack?: string | null) {
  return [
    `# App Creator blueprint — ${plan.appName}`,
    "",
    "This is a controlled app-creation proposal. No files are changed by this blueprint step.",
    "",
    "## Original idea",
    cleanText(idea, 1200),
    "",
    "## Product shape",
    `- Platform: ${plan.platform}`,
    `- Complexity: ${plan.complexity}`,
    `- Target users: ${plan.targetUsers}`,
    preferredStack ? `- Preferred stack: ${cleanText(preferredStack, 240)}` : "- Preferred stack: Next.js + TypeScript + Supabase-ready architecture unless Javier chooses otherwise.",
    "",
    "## Core features",
    ...plan.coreFeatures.map((feature) => `- ${feature}`),
    "",
    "## Screens",
    ...plan.screens.map((screen) => `- ${screen}`),
    "",
    "## Data model draft",
    ...plan.dataModel.map((model) => `- ${model}`),
    "",
    "## Repo plan",
    ...plan.repoPlan.map((step) => `- ${step}`),
    "",
    "## Build/verification plan",
    ...plan.buildPlan.map((step) => `- ${step}`),
    "",
    "## Safety gates",
    "- This proposal does not deploy, merge, mutate schemas, send messages, or create paid services.",
    "- Scaffolding requires an approved follow-up Repo Control execution.",
    "- Production deployment requires a separate deployment approval gate.",
  ].join("\n");
}

export function buildAppCreatorPlan(input: AppCreatorInput): AppCreatorPlan {
  const idea = cleanText(input.idea, 1600);
  const appName = inferAppName(idea, input.appName);
  const slug = slugify(appName);
  const platform = input.platform ?? "web";
  const complexity = input.complexity ?? "standard";
  const coreFeatures = inferFeatures(idea, input.mustHaveFeatures);
  const screens = inferScreens(coreFeatures);
  const dataModel = inferDataModel(coreFeatures);
  const targetUsers = cleanText(input.targetUsers, 180) || "A focused private or small-business user group defined by Javier during the proposal review.";

  return {
    appName,
    slug,
    platform,
    complexity,
    targetUsers,
    coreFeatures,
    screens,
    dataModel,
    repoPlan: [
      `Create a dedicated scaffold area for ${slug}.`,
      "Add typed UI shell, routing, and premium clean styling.",
      "Add Supabase-ready data access boundaries without mutating production schema automatically.",
      "Run build/type checks before PR handoff.",
    ],
    buildPlan: [
      "Generate scaffold only after explicit Repo Control approval.",
      "Run smoke tests and production build.",
      "Open/track PR when gates pass.",
      "Prepare deployment handoff; do not deploy automatically.",
    ],
    safety: "blueprint_only_no_files_changed_no_schema_no_deploy",
  };
}

export async function createAppCreatorProposal(input: AppCreatorInput): Promise<AppCreatorResult> {
  const idea = cleanText(input.idea, 1600);
  if (!idea) {
    return {
      ok: false,
      error: "App idea is required.",
      message: "App Creator could not start because no app idea was provided.",
      safety: "no_action_taken",
      nextAction: "Describe the app Javier wants Jarvis to create.",
    };
  }

  const plan = buildAppCreatorPlan(input);
  const blueprint = buildBlueprint(plan, idea, input.preferredStack);
  const files: RepoActionFileTarget[] = [
    { path: `docs/app-creator/${plan.slug}.md`, operation: "create", note: "Store the app blueprint and implementation checklist." },
    { path: `apps/${plan.slug}/package.json`, operation: "create", note: "Future scaffold package manifest if Javier approves scaffolding." },
    { path: `apps/${plan.slug}/app/page.tsx`, operation: "create", note: "Future main app shell/page." },
    { path: `apps/${plan.slug}/app/globals.css`, operation: "create", note: "Future polished light UI styling." },
    { path: `apps/${plan.slug}/lib/schema-plan.ts`, operation: "create", note: "Future Supabase schema plan only; no schema mutation." },
  ];

  const proposalResult = await createRepoActionProposal({
    title: `Create app: ${plan.appName}`,
    summary: `App Creator v1 proposal for ${plan.appName}: ${plan.coreFeatures.slice(0, 3).join(", ")}.`,
    findings: [
      `Javier asked Jarvis to create an app from this idea: ${idea}`,
      "Jarvis can create this through a controlled App Creator workflow, starting with a blueprint and Repo Control proposal.",
      "This v1 step intentionally avoids direct scaffold/deploy/schema mutation until the proposal is approved.",
    ].join("\n"),
    plan: blueprint,
    repo: input.repo || "Tanjiro-1122/Jarvis",
    projectKey: input.projectKey || "jarvis",
    riskLevel: riskForComplexity(plan.complexity),
    files,
    diffPreview: blueprint,
    sessionId: input.sessionId ?? null,
    workspaceId: input.workspaceId ?? null,
    conversationId: input.conversationId ?? null,
  });

  if (!proposalResult.ok || !proposalResult.proposal) {
    return {
      ok: false,
      appPlan: plan,
      error: proposalResult.error || "Repo Control proposal could not be created.",
      message: "App Creator prepared the blueprint but could not save the Repo Control proposal.",
      safety: plan.safety,
      nextAction: "Check Repo Control/Supabase configuration, then rerun App Creator.",
    };
  }

  return {
    ok: true,
    appPlan: plan,
    proposal: proposalResult.proposal,
    proposalId: proposalResult.proposal.id,
    message: "App Creator v1 created a blueprint and Repo Control proposal. No files, schema, deployment, or production systems were changed.",
    safety: plan.safety,
    nextAction: "Review the proposal. If approved, run the controlled Repo Control flow to scaffold and verify the app.",
  };
}
