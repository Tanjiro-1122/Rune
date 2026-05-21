import {
  addWorkspaceTaskCheckpoint,
  claimWorkspaceTaskForRunner,
  completeWorkspaceTask,
  failWorkspaceTask,
  getWorkspaceTask,
  updateWorkspaceTaskStep,
  type WorkspaceTaskSummary,
} from "@/lib/tasks";
import {
  createRepoActionProposal,
  draftRepoActionDiff,
  generateRepoActionProposedDiff,
  inspectRepoActionFiles,
  openRepoActionPullRequest,
  runTemporaryWorkspaceBuildCheck,
  sandboxCheckRepoActionDiff,
  trackRepoActionPullRequest,
} from "@/lib/repo-actions";

export type OperatorExecutionActionType =
  | "inspect_repo"
  | "create_repo_proposal"
  | "draft_diff"
  | "generate_diff"
  | "sandbox_check"
  | "temp_workspace_check"
  | "open_pr_if_approved"
  | "track_pr"
  | "stop_before_merge_deploy";

export interface OperatorExecutionPlanAction {
  type: OperatorExecutionActionType;
  description: string;
}

export interface OperatorExecutionPlan {
  taskType: "fix_code";
  safety: "repo_local_verifiable";
  targetFiles: string[];
  actions: OperatorExecutionPlanAction[];
  verification: string[];
  forbiddenActions: string[];
}

export interface OperatorExecutorResult {
  ok: boolean;
  taskId: string;
  runnerId: string;
  plan?: OperatorExecutionPlan;
  proposalId?: string;
  prUrl?: string;
  steps: Array<{ action: string; ok: boolean; proof?: string; error?: string }>;
  message: string;
  error?: string;
}

function extractTargetFiles(task: WorkspaceTaskSummary) {
  const fromSteps = task.steps
    .map((step) => step.label.match(/Inspect\s+(.+)$/i)?.[1])
    .filter(Boolean)
    .flatMap((value) => String(value).split(","))
    .map((value) => value.trim())
    .filter((value) => value.includes("/") && !value.includes(".."));

  const metadataFiles = task.runnerMetadata?.targetFiles;
  const fromMetadata = Array.isArray(metadataFiles)
    ? metadataFiles.map((value) => String(value)).filter((value) => value.includes("/") && !value.includes(".."))
    : [];

  return Array.from(new Set([...fromMetadata, ...fromSteps])).slice(0, 8);
}

function extractVerification(task: WorkspaceTaskSummary) {
  return task.steps
    .map((step) => step.label.trim())
    .filter((label) => /^npm run |^Live |^curl |^GET |^POST |health/i.test(label))
    .slice(0, 8);
}

export function createOperatorExecutionPlan(task: WorkspaceTaskSummary): { ok: true; plan: OperatorExecutionPlan } | { ok: false; error: string } {
  if (task.intent !== "fix_code") {
    return { ok: false, error: "Executor Bridge v1 only supports fix_code remediation tasks." };
  }

  const targetFiles = extractTargetFiles(task);
  if (targetFiles.length === 0) {
    return { ok: false, error: "No safe target files were found on the remediation task." };
  }

  return {
    ok: true,
    plan: {
      taskType: "fix_code",
      safety: "repo_local_verifiable",
      targetFiles,
      actions: [
        { type: "inspect_repo", description: "Inspect the target files through Repo Control." },
        { type: "create_repo_proposal", description: "Create a Repo Control proposal from the remediation task." },
        { type: "draft_diff", description: "Prepare a deterministic proposed diff for review." },
        { type: "generate_diff", description: "Generate a proposed unified diff through Repo Control." },
        { type: "sandbox_check", description: "Run Repo Control sandbox checks." },
        { type: "temp_workspace_check", description: "Rehearse the proposed diff in a temporary workspace." },
        { type: "open_pr_if_approved", description: "Open a PR only if the existing Repo Control approval and build gates pass." },
        { type: "stop_before_merge_deploy", description: "Stop before merge, deployment, rollback, or external account mutation gates." },
      ],
      verification: extractVerification(task),
      forbiddenActions: ["merge", "deploy", "rollback", "external_account_edit", "database_migration", "payment_change"],
    },
  };
}

export async function runOperatorExecutorBridge(options: {
  taskId: string;
  workspaceId?: string | null;
  conversationId?: string | null;
  runnerId?: string;
  openPrIfApproved?: boolean;
  trackPrIfOpened?: boolean;
}): Promise<OperatorExecutorResult> {
  const runnerId = options.runnerId ?? `operator-executor-${Date.now()}`;
  const steps: OperatorExecutorResult["steps"] = [];
  const task = await getWorkspaceTask(options.taskId);
  if (!task) return { ok: false, taskId: options.taskId, runnerId, steps, message: "Task not found.", error: "Task not found." };
  if (options.workspaceId && task.workspaceId !== options.workspaceId) {
    return { ok: false, taskId: task.id, runnerId, steps, message: "Task workspace mismatch.", error: "Task workspace mismatch." };
  }

  const planResult = createOperatorExecutionPlan(task);
  if (!planResult.ok) {
    await failWorkspaceTask(task.id, planResult.error);
    return { ok: false, taskId: task.id, runnerId, steps, message: planResult.error, error: planResult.error };
  }
  const plan = planResult.plan;

  const claimed = await claimWorkspaceTaskForRunner({ taskId: task.id, runnerId, expectedWorkspaceId: options.workspaceId ?? null });
  if (!claimed) {
    return { ok: false, taskId: task.id, runnerId, plan, steps, message: "Task could not be claimed. Another runner may own it.", error: "Task could not be claimed." };
  }

  await addWorkspaceTaskCheckpoint(task.id, {
    label: "Executor claimed task",
    summary: `Executor Bridge v2 claimed this task and normalized a ${plan.taskType} plan for ${plan.targetFiles.join(", ")}.`,
    nextStep: "Create Repo Control proposal",
    metadata: { runnerId, plan },
  });

  try {
    const proposalResult = await createRepoActionProposal({
      title: claimed.title.replace(/^Operator remediation:\s*/i, ""),
      summary: claimed.inputText.slice(0, 900),
      findings: claimed.inputText,
      plan: [
        ...claimed.steps.map((step) => `- ${step.label}`),
        options.openPrIfApproved
          ? "- Executor Bridge v2 may open a PR only if the existing Repo Control approval and build gates pass."
          : "- Executor Bridge v2 stops before PR/merge/deploy gates unless openPrIfApproved is true.",
      ].join("\n"),
      repo: "Tanjiro-1122/Rune",
      projectKey: "rune",
      riskLevel: "medium",
      files: plan.targetFiles.map((path) => ({ path, operation: "update" as const, note: "Target file from remediation task." })),
      workspaceId: claimed.workspaceId,
      conversationId: claimed.conversationId,
    });
    steps.push({ action: "create_repo_proposal", ok: proposalResult.ok, proof: proposalResult.proposal?.id, error: proposalResult.error });
    if (!proposalResult.ok || !proposalResult.proposal) throw new Error(proposalResult.error || "Repo Control proposal creation failed.");

    await updateWorkspaceTaskStep({ taskId: task.id, stepKey: claimed.steps[0]?.key ?? "prepare", status: "completed", detail: `Repo Control proposal created: ${proposalResult.proposal.id}`, progress: 45 });

    const inspect = await inspectRepoActionFiles({ id: proposalResult.proposal.id });
    steps.push({ action: "inspect_repo", ok: inspect.ok, proof: inspect.ok ? "target files inspected" : undefined, error: inspect.error });
    if (!inspect.ok) throw new Error(inspect.error || "Repo inspection failed.");

    const draft = await draftRepoActionDiff({ id: proposalResult.proposal.id });
    steps.push({ action: "draft_diff", ok: draft.ok, proof: draft.ok ? "diff draft prepared" : undefined, error: draft.error });
    if (!draft.ok) throw new Error(draft.error || "Diff draft failed.");

    const generated = await generateRepoActionProposedDiff({ id: proposalResult.proposal.id });
    steps.push({ action: "generate_diff", ok: generated.ok, proof: generated.ok ? "proposed diff generated" : undefined, error: generated.error });
    if (!generated.ok) throw new Error(generated.error || "Diff generation failed.");

    const sandbox = await sandboxCheckRepoActionDiff({ id: proposalResult.proposal.id });
    steps.push({ action: "sandbox_check", ok: sandbox.ok, proof: sandbox.ok ? "sandbox checks passed" : undefined, error: sandbox.error });
    if (!sandbox.ok) throw new Error(sandbox.error || "Sandbox check failed.");

    const tempWorkspace = await runTemporaryWorkspaceBuildCheck({ id: proposalResult.proposal.id });
    steps.push({ action: "temp_workspace_check", ok: tempWorkspace.ok, proof: tempWorkspace.ok ? "temporary workspace check passed" : undefined, error: tempWorkspace.error });
    if (!tempWorkspace.ok) throw new Error(tempWorkspace.error || "Temporary workspace check failed.");

    let prUrl: string | undefined;
    if (options.openPrIfApproved) {
      const pr = await openRepoActionPullRequest({ id: proposalResult.proposal.id });
      prUrl = "prUrl" in pr && typeof pr.prUrl === "string" ? pr.prUrl : undefined;
      steps.push({ action: "open_pr_if_approved", ok: pr.ok, proof: prUrl, error: pr.error });
      if (!pr.ok) {
        await addWorkspaceTaskCheckpoint(task.id, {
          label: "Executor stopped at PR gate",
          summary: pr.error || "Repo Control PR gate blocked this task. This is expected unless the proposal is approved and checks are ready.",
          blocker: pr.error || "PR gate blocked.",
          completedStep: "temp_workspace_check",
          nextStep: "Approve the Repo Control proposal if PR creation is desired.",
          metadata: { runnerId, proposalId: proposalResult.proposal.id, steps, plan },
        });
      } else if (options.trackPrIfOpened !== false) {
        const tracked = await trackRepoActionPullRequest({ id: proposalResult.proposal.id });
        steps.push({ action: "track_pr", ok: tracked.ok, proof: tracked.ok ? "PR tracked" : undefined, error: tracked.error });
      }
    }

    await addWorkspaceTaskCheckpoint(task.id, {
      label: prUrl ? "Executor opened PR safely" : "Executor prepared safe repo workflow",
      summary: prUrl
        ? `Repo Control proposal ${proposalResult.proposal.id} passed safe checks and opened PR ${prUrl}. Executor Bridge v2 stopped before merge, deploy, rollback, or external edits.`
        : `Repo Control proposal ${proposalResult.proposal.id} was created and safe checks ran. Executor Bridge v2 stopped before PR, merge, deploy, or external edits.`,
      completedStep: prUrl ? "open_pr_if_approved" : "temp_workspace_check",
      nextStep: prUrl ? "Review the PR. Merge/deploy still require separate approval gates." : "Approve the Repo Control proposal if PR creation is desired.",
      metadata: { runnerId, proposalId: proposalResult.proposal.id, prUrl, steps, plan },
    });

    await completeWorkspaceTask(task.id, prUrl
      ? `Executor Bridge v2 opened PR ${prUrl} and stopped before merge/deploy.`
      : `Executor Bridge v2 prepared Repo Control proposal ${proposalResult.proposal.id}. No PR, merge, deploy, or external account mutation happened.`);
    return {
      ok: true,
      taskId: task.id,
      runnerId,
      plan,
      proposalId: proposalResult.proposal.id,
      prUrl,
      steps,
      message: prUrl
        ? "Executor Bridge v2 opened a PR after approval/check gates and stopped before merge/deploy."
        : "Executor Bridge v2 completed safe checks and stopped before PR/merge/deploy gates.",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Operator executor failed.";
    await addWorkspaceTaskCheckpoint(task.id, {
      label: "Executor stopped with failure",
      summary: message,
      blocker: message,
      metadata: { runnerId, steps, plan },
    });
    await failWorkspaceTask(task.id, message);
    return { ok: false, taskId: task.id, runnerId, plan, steps, message, error: message };
  }
}
