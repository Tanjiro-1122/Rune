import { inferProjectFromText, RUNE_DEFAULT_REPO, resolveCanonicalRepo, splitRepoSlug } from "@/lib/project-registry";
import { type DetectedIntent, type ReasoningRoute, needsRepositoryInspection } from "@/lib/orchestration";

export type AgentWorkPhase = "understand" | "inspect" | "plan" | "propose" | "verify" | "respond";

export interface AgentWorkLoopSnapshot {
  projectKey: string | null;
  projectLabel: string;
  repo: string;
  repoOwner: string;
  repoName: string;
  phases: AgentWorkPhase[];
  inspectionRequired: boolean;
  repoControlRequired: boolean;
  exactApprovalRequired: boolean;
  progressLabel: string;
  ownerFacingRule: string;
}

export function buildAgentWorkLoopSnapshot(options: {
  input: string;
  intent: DetectedIntent;
  reasoningRoute: ReasoningRoute;
}): AgentWorkLoopSnapshot {
  const project = inferProjectFromText(options.input);
  const repo = resolveCanonicalRepo(null, options.input);
  const resolved = splitRepoSlug(repo || RUNE_DEFAULT_REPO);
  const inspectionRequired =
    needsRepositoryInspection(options.input) ||
    options.reasoningRoute === "inspect_first" ||
    options.reasoningRoute === "proposal_required";
  const repoControlRequired = options.reasoningRoute === "proposal_required";
  const exactApprovalRequired =
    options.reasoningRoute === "approval_required" ||
    options.reasoningRoute === "proposal_required" ||
    repoControlRequired;

  const phases: AgentWorkPhase[] = ["understand"];
  if (inspectionRequired) phases.push("inspect");
  if (options.reasoningRoute === "plan_first" || repoControlRequired || exactApprovalRequired) phases.push("plan");
  if (repoControlRequired) phases.push("propose");
  if (inspectionRequired || repoControlRequired) phases.push("verify");
  phases.push("respond");

  const progressLabel = repoControlRequired
    ? "Inspecting repo and preparing a safe proposal"
    : inspectionRequired
      ? "Inspecting before answering"
      : options.reasoningRoute === "self_audit"
        ? "Running self-audit"
        : options.reasoningRoute === "truth_check"
          ? "Checking capability truth"
          : "Reasoning through request";

  const ownerFacingRule = repoControlRequired
    ? "Show Findings → Plan → files/risk before any code change. Use Repo Control for execution gates."
    : exactApprovalRequired
      ? "Gather facts and ask for exact approval before any sensitive/external action."
      : inspectionRequired
        ? "Inspect real project state before making claims."
        : "Answer directly and keep it concise.";

  return {
    projectKey: project?.key ?? null,
    projectLabel: project?.label ?? "General/Rune default",
    repo: resolved.slug,
    repoOwner: resolved.owner,
    repoName: resolved.repo,
    phases: Array.from(new Set(phases)),
    inspectionRequired,
    repoControlRequired,
    exactApprovalRequired,
    progressLabel,
    ownerFacingRule,
  };
}

export function formatAgentWorkLoopPromptSection(snapshot: AgentWorkLoopSnapshot) {
  return `## Agent Core Work Loop
- Project scope: ${snapshot.projectLabel}
- Repo scope: ${snapshot.repo}
- Phases: ${snapshot.phases.join(" → ")}
- Inspection required: ${snapshot.inspectionRequired ? "yes" : "no"}
- Repo Control required: ${snapshot.repoControlRequired ? "yes" : "no"}
- Exact approval required: ${snapshot.exactApprovalRequired ? "yes" : "no"}
- Owner-facing rule: ${snapshot.ownerFacingRule}

If inspection is required, use \`listRepositoryTree\` before conclusions and \`readRepositoryFile\` for relevant files before proposing changes. If Repo Control is required, create a Repo Control proposal with \`create_repo_action_proposal\` after Findings → Plan; do not claim the change is done until the proposal/diff/check path has completed.`;
}
