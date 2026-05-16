import { createRepoActionProposal, isRepoActionProposalId, repoActionProposalIdError, type RepoActionFileTarget, type RepoActionProposalRow, type RepoActionRisk } from "@/lib/repo-actions";
import { getSupabaseClient } from "@/lib/supabase";
import { logError } from "@/lib/errors";
import { logActionEvent } from "@/lib/action-events";

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

export interface AppScaffoldResult {
  ok: boolean;
  proposalId: string;
  appPlan?: AppCreatorPlan;
  proposal?: RepoActionProposalRow;
  changedFiles?: string[];
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

  const supabase = getSupabaseClient();
  let proposal = proposalResult.proposal;
  if (supabase) {
    const metadata = {
      ...(proposal.draft_metadata || {}),
      app_creator: {
        version: "1.1",
        phase: "blueprint",
        plan,
        preferred_stack: cleanText(input.preferredStack, 240),
        scaffold_ready: false,
      },
    };
    const { data, error } = await supabase
      .from("jarvis_repo_action_proposals")
      .update({ draft_metadata: metadata, updated_at: new Date().toISOString() })
      .eq("id", proposal.id)
      .select("id, title, summary, findings, plan, repo, project_key, risk_level, status, files, diff_preview, approval_note, draft_metadata, session_id, workspace_id, conversation_id, created_at, updated_at, approved_at, executed_at")
      .single();
    if (error) {
      logError("appCreator.createAppCreatorProposal.metadata", error);
    } else if (data) {
      proposal = data as RepoActionProposalRow;
    }
  }

  return {
    ok: true,
    appPlan: plan,
    proposal,
    proposalId: proposal.id,
    message: "App Creator v1 created a blueprint and Repo Control proposal. No files, schema, deployment, or production systems were changed.",
    safety: plan.safety,
    nextAction: "Review and approve the proposal. After approval, run approved_app_scaffold to generate the starter app patch.",
  };
}

function metadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).slice(0, 8) : [];
}

function planFromProposal(proposal: RepoActionProposalRow): AppCreatorPlan {
  const metadata = metadataRecord(proposal.draft_metadata);
  const appCreator = metadataRecord(metadata.app_creator);
  const stored = metadataRecord(appCreator.plan);
  const titleName = proposal.title.replace(/^Create app:\s*/i, "").trim();
  const appName = cleanText(stored.appName as string | undefined, 80) || cleanText(titleName, 80) || "New App";
  const coreFeatures = stringArray(stored.coreFeatures).length ? stringArray(stored.coreFeatures) : inferFeatures(`${proposal.summary} ${proposal.findings} ${proposal.plan}`);
  const screens = stringArray(stored.screens).length ? stringArray(stored.screens) : inferScreens(coreFeatures);
  const dataModel = stringArray(stored.dataModel).length ? stringArray(stored.dataModel) : inferDataModel(coreFeatures);
  const complexity = ["simple", "standard", "advanced"].includes(String(stored.complexity)) ? stored.complexity as AppCreatorComplexity : "standard";
  const platform = ["web", "mobile", "both"].includes(String(stored.platform)) ? stored.platform as AppCreatorPlatform : "web";
  return {
    appName,
    slug: cleanText(stored.slug as string | undefined, 80) || slugify(appName),
    platform,
    complexity,
    targetUsers: cleanText(stored.targetUsers as string | undefined, 180) || "Users defined in the approved App Creator proposal.",
    coreFeatures,
    screens,
    dataModel,
    repoPlan: stringArray(stored.repoPlan).length ? stringArray(stored.repoPlan) : ["Create deterministic starter scaffold.", "Run Repo Control checks.", "Open PR only after gates pass."],
    buildPlan: stringArray(stored.buildPlan).length ? stringArray(stored.buildPlan) : ["Generate patch.", "Run sandbox/temp workspace checks.", "Open PR if approved."],
    safety: "approved_scaffold_patch_no_merge_no_deploy",
  };
}

function escapePatchContent(value: string) {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function fileCreateDiff(filePath: string, content: string) {
  const normalized = escapePatchContent(content).replace(/\n?$/, "\n");
  const lines = normalized.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return [
    `diff --git a/${filePath} b/${filePath}`,
    "new file mode 100644",
    "index 0000000..1111111",
    "--- /dev/null",
    `+++ b/${filePath}`,
    `@@ -0,0 +1,${lines.length} @@`,
    ...lines.map((line) => `+${line}`),
  ].join("\n");
}

function tsArray(items: string[]) {
  return `[${items.map((item) => JSON.stringify(item)).join(", ")}]`;
}

export function buildAppScaffoldPatch(plan: AppCreatorPlan) {
  const base = `apps/${plan.slug}`;
  const componentName = `${plan.slug.replace(/(^|-)([a-z])/g, (_, __, char: string) => char.toUpperCase()).replace(/[^A-Za-z0-9]/g, "")}App`;
  const files = new Map<string, string>();

  files.set(`docs/app-creator/${plan.slug}.md`, [
    `# ${plan.appName}`,
    "",
    "Generated by Jarvis App Creator v1.1 after proposal approval.",
    "",
    `- Platform: ${plan.platform}`,
    `- Complexity: ${plan.complexity}`,
    `- Target users: ${plan.targetUsers}`,
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
    "## Safety",
    "This scaffold is a starter patch only. It does not create production schema, merge, deploy, send messages, or create paid services.",
  ].join("\n"));

  files.set(`${base}/README.md`, [
    `# ${plan.appName}`,
    "",
    "Starter app scaffold generated by Jarvis App Creator v1.1.",
    "",
    "## What is included",
    "- Typed product blueprint",
    "- Premium light UI shell",
    "- Supabase-ready schema plan",
    "- No production deployment or schema mutation",
    "",
    "## Next gates",
    "1. Review the PR diff.",
    "2. Run build checks.",
    "3. Approve deployment separately if this app should go live.",
  ].join("\n"));

  files.set(`${base}/app/page.tsx`, [
    `const features = ${tsArray(plan.coreFeatures)};`,
    `const screens = ${tsArray(plan.screens)};`,
    "",
    `export default function ${componentName}() {`,
    "  return (",
    "    <main className=\"min-h-screen bg-[#f7f8ff] text-slate-950\">",
    "      <section className=\"mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-10 px-6 py-12\">",
    "        <div className=\"rounded-[2rem] border border-white/70 bg-white/80 p-8 shadow-2xl shadow-violet-200/40 backdrop-blur\">",
    `          <p className=\"text-sm font-semibold uppercase tracking-[0.3em] text-violet-500\">${plan.platform} app scaffold</p>`,
    `          <h1 className=\"mt-4 text-4xl font-semibold tracking-tight md:text-6xl\">${plan.appName}</h1>`,
    `          <p className=\"mt-5 max-w-3xl text-lg leading-8 text-slate-600\">A polished starter experience for ${plan.targetUsers}</p>`,
    "        </div>",
    "",
    "        <div className=\"grid gap-4 md:grid-cols-3\">",
    "          {features.map((feature) => (",
    "            <article key={feature} className=\"rounded-3xl border border-white/70 bg-white/75 p-6 shadow-xl shadow-slate-200/40\">",
    "              <span className=\"text-xs font-bold uppercase tracking-[0.25em] text-violet-500\">Feature</span>",
    "              <h2 className=\"mt-3 text-xl font-semibold\">{feature}</h2>",
    "            </article>",
    "          ))}",
    "        </div>",
    "",
    "        <div className=\"rounded-[2rem] border border-white/70 bg-white/75 p-6 shadow-xl shadow-slate-200/40\">",
    "          <h2 className=\"text-2xl font-semibold\">Planned screens</h2>",
    "          <div className=\"mt-4 flex flex-wrap gap-3\">",
    "            {screens.map((screen) => (",
    "              <span key={screen} className=\"rounded-full bg-violet-50 px-4 py-2 text-sm font-medium text-violet-700\">{screen}</span>",
    "            ))}",
    "          </div>",
    "        </div>",
    "      </section>",
    "    </main>",
    "  );",
    "}",
  ].join("\n"));

  files.set(`${base}/lib/schema-plan.ts`, [
    "export const schemaPlan = {",
    `  appName: ${JSON.stringify(plan.appName)},`,
    `  slug: ${JSON.stringify(plan.slug)},`,
    `  entities: ${JSON.stringify(plan.dataModel, null, 2).replace(/\n/g, "\n  ")},`,
    "  safety: \"schema_plan_only_no_database_mutation\",",
    "} as const;",
  ].join("\n"));

  files.set(`${base}/package.json`, JSON.stringify({
    name: plan.slug,
    private: true,
    version: "0.1.0",
    scripts: { dev: "next dev", build: "next build", start: "next start" },
    dependencies: { next: "15.5.18", react: "19.1.0", "react-dom": "19.1.0" },
    devDependencies: { typescript: "^5" },
  }, null, 2) + "\n");

  const changedFiles = Array.from(files.keys());
  const diff = changedFiles.map((filePath) => fileCreateDiff(filePath, files.get(filePath) || "")).join("\n");
  return { diff, changedFiles };
}

export async function createApprovedAppScaffold(options: { proposalId: string }): Promise<AppScaffoldResult> {
  const proposalId = cleanText(options.proposalId, 120);
  if (!isRepoActionProposalId(proposalId)) {
    return {
      ok: false,
      proposalId,
      error: repoActionProposalIdError(proposalId),
      message: "App scaffold did not start because the proposal ID was invalid.",
      safety: "no_action_taken",
      nextAction: "Use the App Creator proposal UUID from the proposal card.",
    };
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    return {
      ok: false,
      proposalId,
      error: "Supabase is not configured.",
      message: "App scaffold could not load the proposal.",
      safety: "no_action_taken",
      nextAction: "Configure Supabase, then rerun approved_app_scaffold.",
    };
  }

  const { data: existing, error: fetchError } = await supabase
    .from("jarvis_repo_action_proposals")
    .select("id, title, summary, findings, plan, repo, project_key, risk_level, status, files, diff_preview, approval_note, draft_metadata, session_id, workspace_id, conversation_id, created_at, updated_at, approved_at, executed_at")
    .eq("id", proposalId)
    .single();

  if (fetchError || !existing) {
    logError("appCreator.createApprovedAppScaffold.fetch", fetchError);
    return {
      ok: false,
      proposalId,
      error: fetchError?.message || "Proposal not found.",
      message: "App scaffold could not find the proposal.",
      safety: "no_action_taken",
      nextAction: "Confirm the App Creator proposal ID and try again.",
    };
  }

  const proposal = existing as RepoActionProposalRow;
  const metadata = metadataRecord(proposal.draft_metadata);
  const appCreator = metadataRecord(metadata.app_creator);
  const isAppCreatorProposal = Boolean(appCreator.version) || /^Create app:/i.test(proposal.title);
  if (!isAppCreatorProposal) {
    return {
      ok: false,
      proposalId,
      message: "This proposal is not an App Creator proposal.",
      error: "approved_app_scaffold only works with App Creator proposals.",
      safety: "no_action_taken",
      nextAction: "Create an app proposal first with create_app_proposal.",
    };
  }
  if (proposal.status !== "approved") {
    return {
      ok: false,
      proposalId,
      appPlan: planFromProposal(proposal),
      message: "App scaffold stopped at the approval gate.",
      error: "Proposal must be approved before scaffolding.",
      safety: "approval_required_no_files_changed_no_schema_no_deploy",
      nextAction: "Approve the App Creator proposal, then rerun approved_app_scaffold.",
    };
  }

  const plan = planFromProposal(proposal);
  const { diff, changedFiles } = buildAppScaffoldPatch(plan);
  const now = new Date().toISOString();
  const preview = [
    `# Approved app scaffold diff — ${plan.appName}`,
    `Repo: ${proposal.repo}`,
    `Generated: ${now}`,
    "",
    "This is an approved scaffold patch. It creates starter files only. It does not merge, deploy, mutate schemas, or touch production systems.",
    "",
    "```diff",
    diff,
    "```",
    "",
    "Next checkpoint: run Repo Control sandbox/temp workspace checks, then PR handoff if gates pass.",
  ].join("\n");

  const updatedMetadata = {
    ...metadata,
    app_creator: {
      ...appCreator,
      version: "1.1",
      phase: "approved_scaffold",
      plan,
      scaffold_ready: true,
      scaffold_generated_at: now,
      scaffold_changed_files: changedFiles,
      safety: "approved_scaffold_patch_no_merge_no_deploy",
    },
    generated_at: now,
    draft_type: "deterministic_app_scaffold_patch",
    safety: "approved_scaffold_patch_no_merge_no_deploy",
  };

  const { data: updated, error: updateError } = await supabase
    .from("jarvis_repo_action_proposals")
    .update({
      files: changedFiles.map((filePath) => ({ path: filePath, operation: "create", note: "Generated by App Creator v1.1 approved scaffold." })),
      diff_preview: preview,
      draft_metadata: updatedMetadata,
      updated_at: now,
    })
    .eq("id", proposalId)
    .select("id, title, summary, findings, plan, repo, project_key, risk_level, status, files, diff_preview, approval_note, draft_metadata, session_id, workspace_id, conversation_id, created_at, updated_at, approved_at, executed_at")
    .single();

  if (updateError || !updated) {
    logError("appCreator.createApprovedAppScaffold.update", updateError);
    return {
      ok: false,
      proposalId,
      appPlan: plan,
      changedFiles,
      error: updateError?.message || "Unable to save scaffold patch.",
      message: "App scaffold patch was generated but could not be saved to the proposal.",
      safety: "no_repo_mutation_no_merge_no_deploy",
      nextAction: "Retry approved_app_scaffold after checking Supabase.",
    };
  }

  await logActionEvent({
    eventType: "app_creator.scaffold_generated",
    summary: `App Creator scaffold generated: ${plan.appName}`,
    status: "proposed",
    approvalStage: "approval",
    riskLevel: proposal.risk_level,
    projectKey: proposal.project_key,
    sessionId: proposal.session_id,
    workspaceId: proposal.workspace_id,
    conversationId: proposal.conversation_id,
    metadata: { proposalId, appName: plan.appName, slug: plan.slug, changedFiles, safety: "approved_scaffold_patch_no_merge_no_deploy" },
  });

  return {
    ok: true,
    proposalId,
    appPlan: plan,
    proposal: updated as RepoActionProposalRow,
    changedFiles,
    message: "App Creator v1.1 generated the approved starter-app scaffold patch. No merge, deployment, schema mutation, or production change happened.",
    safety: "approved_scaffold_patch_no_merge_no_deploy",
    nextAction: "Run run_repo_control_flow on this proposal to sandbox-check, temp-build-check, and open/track a PR if gates pass.",
  };
}
