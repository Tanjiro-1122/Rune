/**
 * lib/app-creator-pipeline.ts
 *
 * Rune App Creator Pipeline — single-call orchestrator.
 *
 * Replaces the 6-step manual flow (create → preview → refine → scaffold →
 * handoff → deploy) with one smart function that drives the full lifecycle
 * and returns a structured result at every stage.
 *
 * Safety contract:
 *  - Plan + Scaffold stages are always safe (no deploys, no writes to prod)
 *  - Deploy stage requires explicit owner approval token
 *  - Read-only inspection at every step — no silent mutations
 */

import {
  buildAppCreatorPlan,
  createAppCreatorProposal,
  createApprovedAppScaffold,
  prepareAppCreatorPreviewHandoff,
  runAppCreatorScaffoldBridge,
  type AppCreatorInput,
  type AppCreatorPlan,
  type AppCreatorResult,
  type AppScaffoldResult,
} from "@/lib/app-creator";
import { getSupabaseClient } from "@/lib/supabase";
import { logError } from "@/lib/errors";

// ── Types ──────────────────────────────────────────────────────────────────

export type PipelineStage =
  | "plan"         // Dry-run — generate plan, no files written
  | "scaffold"     // Generate starter files + open PR
  | "deploy"       // Trigger production deploy (requires approval token)
  | "status";      // Read current proposal status

export type PipelineStatus =
  | "planned"
  | "scaffolded"
  | "pr_open"
  | "deploying"
  | "deployed"
  | "failed"
  | "awaiting_approval";

export interface PipelineRun {
  ok: boolean;
  stage: PipelineStage;
  status: PipelineStatus;
  proposalId?: string;
  appName?: string;
  plan?: AppCreatorPlan;
  prUrl?: string;
  prNumber?: number;
  previewUrl?: string;
  deployUrl?: string;
  changedFiles?: string[];
  message: string;
  nextAction: string;
  safety: string;
  error?: string;
}

export interface PipelineInput {
  /** Free-form idea — "build me a habit tracker with streaks" */
  idea: string;
  appName?: string | null;
  targetUsers?: string | null;
  platform?: "web" | "mobile" | "both";
  complexity?: "simple" | "standard" | "advanced";
  mustHaveFeatures?: string[];
  preferredStack?: string | null;
  /** Which stage to run. Default: "plan" */
  stage?: PipelineStage;
  /** Required for stage="deploy" */
  proposalId?: string | null;
  /** Required for stage="deploy" — must equal RUNE_DEPLOY_TOKEN env var */
  approvalToken?: string | null;
  workspaceId?: string | null;
  conversationId?: string | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function safeDeployToken(): string {
  return process.env.RUNE_DEPLOY_TOKEN?.trim() || "";
}

async function saveProposalStatus(
  proposalId: string,
  status: PipelineStatus,
  extra: Record<string, unknown> = {}
): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase) return;
  try {
    await supabase.from("agent_memories").upsert(
      {
        kind: "decision",
        title: `pipeline-${proposalId}`,
        content: JSON.stringify({ proposalId, status, updatedAt: new Date().toISOString(), ...extra }),
        project_key: "rune",
        tags: ["pipeline", "app-creator"],
        priority: 3,
        is_active: true,
        source: "app-creator-pipeline",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "title,project_key" }
    );
  } catch {
    // non-fatal
  }
}

export async function getPipelineStatus(proposalId: string): Promise<PipelineRun | null> {
  const supabase = getSupabaseClient();
  if (!supabase) return null;
  try {
    const { data } = await supabase
      .from("agent_memories")
      .select("content")
      .eq("title", `pipeline-${proposalId}`)
      .eq("project_key", "rune")
      .single();
    if (!data?.content) return null;
    const saved = JSON.parse(data.content);
    return {
      ok: true,
      stage: "status",
      status: saved.status,
      proposalId,
      prUrl: saved.prUrl,
      prNumber: saved.prNumber,
      previewUrl: saved.previewUrl,
      deployUrl: saved.deployUrl,
      message: `Pipeline status for proposal ${proposalId}: ${saved.status}`,
      nextAction: getNextAction(saved.status),
      safety: "read-only",
    };
  } catch {
    return null;
  }
}

function getNextAction(status: PipelineStatus): string {
  switch (status) {
    case "planned":
      return "Call pipeline with stage='scaffold' and the proposalId to generate files and open a PR.";
    case "scaffolded":
    case "pr_open":
      return "Review the PR, then call pipeline with stage='deploy' + your approval token to ship it.";
    case "deploying":
      return "Deployment in progress — check back in ~2 minutes.";
    case "deployed":
      return "App is live. Check the deploy URL.";
    case "awaiting_approval":
      return "Provide approval token to proceed with deploy.";
    default:
      return "Check error details and retry.";
  }
}

// ── Stage: Plan ────────────────────────────────────────────────────────────

async function stagePlan(input: PipelineInput): Promise<PipelineRun> {
  const plan = buildAppCreatorPlan({
    idea: input.idea,
    appName: input.appName ?? null,
    targetUsers: input.targetUsers ?? null,
    platform: input.platform ?? "web",
    complexity: input.complexity ?? "standard",
    mustHaveFeatures: input.mustHaveFeatures,
    preferredStack: input.preferredStack ?? null,
    projectKey: "rune",
    repo: "Tanjiro-1122/Rune",
  });

  // Create proposal in Supabase via repo-actions
  const proposalResult: AppCreatorResult = await createAppCreatorProposal({
    idea: input.idea,
    appName: input.appName ?? null,
    targetUsers: input.targetUsers ?? null,
    platform: input.platform ?? "web",
    complexity: input.complexity ?? "standard",
    mustHaveFeatures: input.mustHaveFeatures,
    preferredStack: input.preferredStack ?? null,
    projectKey: "rune",
    repo: "Tanjiro-1122/Rune",
    sessionId: null,
    workspaceId: input.workspaceId ?? null,
    conversationId: input.conversationId ?? null,
  });

  if (!proposalResult.ok || !proposalResult.proposal?.id) {
    return {
      ok: false,
      stage: "plan",
      status: "failed",
      plan,
      message: proposalResult.message || "Failed to create proposal.",
      nextAction: "Check error and retry.",
      safety: "no changes made",
      error: proposalResult.message,
    };
  }

  const proposalId = proposalResult.proposal.id;
  await saveProposalStatus(proposalId, "planned", { plan, appName: plan.appName });

  return {
    ok: true,
    stage: "plan",
    status: "planned",
    proposalId,
    appName: plan.appName,
    plan,
    message: `✅ Plan created for "${plan.appName}". ${plan.coreFeatures.length} features across ${plan.screens.length} screens.`,
    nextAction: `Call pipeline with stage='scaffold' and proposalId='${proposalId}' to generate the starter files and open a PR.`,
    safety: "read-only — no files written yet",
  };
}

// ── Stage: Scaffold ────────────────────────────────────────────────────────

async function stageScaffold(proposalId: string): Promise<PipelineRun> {
  if (!proposalId) {
    return {
      ok: false,
      stage: "scaffold",
      status: "failed",
      message: "proposalId is required for scaffold stage.",
      nextAction: "Run stage='plan' first to get a proposalId.",
      safety: "no changes made",
    };
  }

  const result: AppScaffoldResult = await createApprovedAppScaffold({ proposalId });

  if (!result.ok) {
    await saveProposalStatus(proposalId, "failed", { scaffoldError: result.error });
    return {
      ok: false,
      stage: "scaffold",
      status: "failed",
      proposalId,
      message: result.message || "Scaffold failed.",
      nextAction: result.nextAction || "Check error details.",
      safety: "no changes made",
      error: result.error,
    };
  }

  // Now bridge to PR — open a GitHub PR from the scaffold patch
  const bridge = await runAppCreatorScaffoldBridge({ proposalId, openPr: true, trackPr: true });
  const prUrl = bridge.prUrl ?? (result.proposal?.draft_metadata?.prUrl as string | undefined) ?? null;
  const prNumber = prUrl ? parseInt(prUrl.split("/").pop() ?? "0") : undefined;

  await saveProposalStatus(proposalId, prUrl ? "pr_open" : "scaffolded", {
    prUrl,
    prNumber,
    changedFiles: result.changedFiles,
  });

  return {
    ok: true,
    stage: "scaffold",
    status: prUrl ? "pr_open" : "scaffolded",
    proposalId,
    appName: result.appPlan?.appName,
    plan: result.appPlan,
    prUrl: prUrl ?? undefined,
    prNumber,
    changedFiles: result.changedFiles,
    message: prUrl
      ? `✅ Scaffold complete. PR opened: ${prUrl}`
      : `✅ Scaffold complete. ${result.changedFiles?.length ?? 0} files generated.`,
    nextAction: prUrl
      ? `Review PR at ${prUrl}, then call pipeline with stage='deploy' + approvalToken to ship.`
      : "PR could not be opened automatically. Check repo-actions for the patch.",
    safety: "files staged in branch — nothing merged yet",
  };
}

// ── Stage: Deploy ──────────────────────────────────────────────────────────

async function stageDeploy(
  proposalId: string,
  approvalToken: string | null | undefined
): Promise<PipelineRun> {
  const expected = safeDeployToken();

  if (!expected) {
    return {
      ok: false,
      stage: "deploy",
      status: "awaiting_approval",
      proposalId,
      message: "RUNE_DEPLOY_TOKEN is not configured. Set it in Vercel env vars.",
      nextAction: "Add RUNE_DEPLOY_TOKEN to Vercel environment variables.",
      safety: "no deploy triggered",
    };
  }

  if (!approvalToken || approvalToken.trim() !== expected) {
    return {
      ok: false,
      stage: "deploy",
      status: "awaiting_approval",
      proposalId,
      message: "Approval token missing or incorrect. Provide the correct RUNE_DEPLOY_TOKEN to deploy.",
      nextAction: "Provide the correct approvalToken to trigger the deploy.",
      safety: "no deploy triggered — token mismatch",
    };
  }

  // Token valid — trigger handoff
  const handoff = await prepareAppCreatorPreviewHandoff({ proposalId });

  if (!handoff.ok) {
    await saveProposalStatus(proposalId, "failed", { deployError: handoff.error });
    return {
      ok: false,
      stage: "deploy",
      status: "failed",
      proposalId,
      message: handoff.message || "Deploy handoff failed.",
      nextAction: handoff.nextAction || "Check error details.",
      safety: "no deploy triggered",
      error: handoff.error,
    };
  }

  const previewUrl = handoff.preview?.scaffoldReady
    ? `https://mrruneai.vercel.app`
    : undefined;

  await saveProposalStatus(proposalId, "deploying", { previewUrl });

  return {
    ok: true,
    stage: "deploy",
    status: "deploying",
    proposalId,
    previewUrl,
    message: `✅ Deploy triggered for proposal ${proposalId}. Production deploy in progress.`,
    nextAction: "Check mrruneai.vercel.app in ~2 minutes. Call stage='status' to check progress.",
    safety: "approved deploy in flight",
  };
}

// ── Main export ────────────────────────────────────────────────────────────

/**
 * Run a stage of the App Creator pipeline.
 *
 * Stages:
 *   "plan"     → generate plan + proposal (safe, no files)
 *   "scaffold" → generate files + open PR (requires proposalId)
 *   "deploy"   → merge + deploy (requires proposalId + approvalToken)
 *   "status"   → read current status (requires proposalId)
 */
export async function runAppCreatorPipeline(input: PipelineInput): Promise<PipelineRun> {
  const stage = input.stage ?? "plan";

  try {
    switch (stage) {
      case "plan":
        return await stagePlan(input);

      case "scaffold":
        if (!input.proposalId) {
          return {
            ok: false,
            stage: "scaffold",
            status: "failed",
            message: "proposalId is required for scaffold stage.",
            nextAction: "Run stage='plan' first.",
            safety: "no changes made",
          };
        }
        return await stageScaffold(input.proposalId);

      case "deploy":
        if (!input.proposalId) {
          return {
            ok: false,
            stage: "deploy",
            status: "failed",
            message: "proposalId is required for deploy stage.",
            nextAction: "Run stage='plan' then stage='scaffold' first.",
            safety: "no deploy triggered",
          };
        }
        return await stageDeploy(input.proposalId, input.approvalToken);

      case "status":
        if (!input.proposalId) {
          return {
            ok: false,
            stage: "status",
            status: "failed",
            message: "proposalId required for status check.",
            nextAction: "Provide a proposalId.",
            safety: "read-only",
          };
        }
        return (await getPipelineStatus(input.proposalId)) ?? {
          ok: false,
          stage: "status",
          status: "failed",
          proposalId: input.proposalId,
          message: "No pipeline record found for this proposalId.",
          nextAction: "Start with stage='plan' for a new app.",
          safety: "read-only",
        };

      default:
        return {
          ok: false,
          stage: "plan",
          status: "failed",
          message: `Unknown stage: ${stage}`,
          nextAction: "Use stage: plan | scaffold | deploy | status",
          safety: "no changes made",
        };
    }
  } catch (err) {
    logError("appCreatorPipeline", err);
    return {
      ok: false,
      stage,
      status: "failed",
      message: "Pipeline encountered an unexpected error.",
      nextAction: "Check error details and retry.",
      safety: "no changes made",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
