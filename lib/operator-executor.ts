import { getRuneRuntimeIdentity } from "@/lib/project-runtime";
import {
  addWorkspaceTaskCheckpoint,
  claimWorkspaceTaskForRunner,
  completeWorkspaceTask,
  createWorkspaceTask,
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
import { classifyOperatorFailure, getOperatorRetryDecision, type OperatorFailureClassification } from "@/lib/operator-failure-classifier";

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

export interface OperatorFailureEvidenceBundle {
  parentTaskId: string;
  failureClass: OperatorFailureClassification["failureClass"];
  disposition: OperatorFailureClassification["disposition"];
  reason: string;
  failedStage: string | null;
  failedStageError: string;
  targetFiles: string[];
  verification: string[];
  attemptedRetries: number;
  stageProofs: Array<{ action: string; ok: boolean; proof?: string; error?: string }>;
  nextSafeAction: string;
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
  failureRecovery?: {
    classification: OperatorFailureClassification;
    retryPolicy: { maxAttempts: number; attemptedRetries: number };
    followUpTaskId?: string | null;
  };
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
    return { ok: false, error: "Executor Bridge v3 only supports fix_code remediation tasks." };
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

type OperatorStageResult = { ok: boolean; error?: string; [key: string]: unknown };

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runStageWithRetry<T extends OperatorStageResult>(input: {
  action: string;
  maxAttempts: number;
  steps: OperatorExecutorResult["steps"];
  proof: (result: T) => string | undefined;
  run: () => Promise<T>;
}) {
  let lastResult: T | null = null;
  for (let attempt = 1; attempt <= input.maxAttempts; attempt += 1) {
    const result = await input.run();
    lastResult = result;
    const proof = result.ok ? input.proof(result) : undefined;
    const decision = getOperatorRetryDecision({ error: result.error || `${input.action} failed.`, attempt, maxAttempts: input.maxAttempts });
    input.steps.push({
      action: attempt > 1 ? `${input.action}:attempt_${attempt}` : input.action,
      ok: result.ok,
      proof,
      error: result.ok ? undefined : result.error,
    });
    if (result.ok) return result;
    if (!decision.shouldRetry) return result;
    await sleep(decision.nextRetryDelayMs ?? 0);
  }
  return lastResult as T;
}


function createFailureEvidenceBundle(input: {
  task: WorkspaceTaskSummary;
  classification: OperatorFailureClassification;
  message: string;
  plan?: OperatorExecutionPlan;
  steps: OperatorExecutorResult["steps"];
  attemptedRetries: number;
}): OperatorFailureEvidenceBundle {
  const failed = [...input.steps].reverse().find((step) => !step.ok) ?? null;
  return {
    parentTaskId: input.task.id,
    failureClass: input.classification.failureClass,
    disposition: input.classification.disposition,
    reason: input.classification.reason,
    failedStage: failed?.action ?? null,
    failedStageError: failed?.error || input.message,
    targetFiles: input.plan?.targetFiles ?? [],
    verification: input.plan?.verification ?? [],
    attemptedRetries: input.attemptedRetries,
    stageProofs: input.steps.slice(-8).map((step) => ({
      action: step.action,
      ok: step.ok,
      proof: step.proof,
      error: step.error,
    })),
    nextSafeAction: "Inspect this evidence bundle, inspect target files, then prepare a small gated Repo Control follow-up proposal. Stop before merge/deploy/external mutations.",
    forbiddenActions: input.plan?.forbiddenActions ?? ["merge", "deploy", "rollback", "external_account_edit", "database_migration", "payment_change"],
  };
}

async function createFailureFollowUpTask(input: {
  task: WorkspaceTaskSummary;
  classification: OperatorFailureClassification;
  message: string;
  plan?: OperatorExecutionPlan;
  steps: OperatorExecutorResult["steps"];
  attemptedRetries: number;
}) {
  if (input.classification.disposition !== "non_retryable") return null;
  if (!["invalid_patch", "build_compile_error", "test_failure", "missing_target_file"].includes(input.classification.failureClass)) return null;

  const failureEvidenceBundle = createFailureEvidenceBundle({
    task: input.task,
    classification: input.classification,
    message: input.message,
    plan: input.plan,
    steps: input.steps,
    attemptedRetries: input.attemptedRetries,
  });

  return createWorkspaceTask({
    workspaceId: input.task.workspaceId,
    conversationId: input.task.conversationId,
    title: `Follow-up remediation: ${input.classification.failureClass.replaceAll("_", " ")}`,
    inputText: [
      `Parent task: ${input.task.id}`,
      `Failure class: ${input.classification.failureClass}`,
      `Reason: ${input.classification.reason}`,
      `Failed stage: ${failureEvidenceBundle.failedStage ?? "unknown"}`,
      `Error: ${input.message}`,
      `Next safe action: ${failureEvidenceBundle.nextSafeAction}`,
    ].join("\n"),
    intent: "fix_code",
    runnerMetadata: {
      failureEvidenceBundle,
      parentTaskId: input.task.id,
      source: "operator_executor_failure_recovery",
    },
    steps: [
      { key: "inspect_failure", label: "Inspect preserved executor failure proof" },
      ...(input.plan?.targetFiles ?? []).map((path, index) => ({ key: `inspect_target_${index + 1}`, label: `Inspect ${path}` })),
      { key: "patch_follow_up", label: "Patch the code/test issue that caused executor failure" },
      { key: "verify_follow_up", label: "Run the failing verification again" },
    ].slice(0, 8),
  });
}

export async function runOperatorExecutorBridge(options: {
  taskId: string;
  workspaceId?: string | null;
  conversationId?: string | null;
  runnerId?: string;
  openPrIfApproved?: boolean;
  trackPrIfOpened?: boolean;
  maxAttempts?: number;
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
    const proposalResult = await runStageWithRetry({
      action: "create_repo_proposal",
      maxAttempts: options.maxAttempts ?? 3,
      steps,
      proof: (result) => result.proposal?.id,
      run: () => createRepoActionProposal({
      title: claimed.title.replace(/^Operator remediation:\s*/i, ""),
      summary: claimed.inputText.slice(0, 900),
      findings: claimed.inputText,
      plan: [
        ...claimed.steps.map((step) => `- ${step.label}`),
        options.openPrIfApproved
          ? "- Executor Bridge v2 may open a PR only if the existing Repo Control approval and build gates pass."
          : "- Executor Bridge v2 stops before PR/merge/deploy gates unless openPrIfApproved is true.",
      ].join("\n"),
      repo: getRuneRuntimeIdentity().repo,
      projectKey: "rune",
      riskLevel: "medium",
      files: plan.targetFiles.map((path) => ({ path, operation: "update" as const, note: "Target file from remediation task." })),
      workspaceId: claimed.workspaceId,
      conversationId: claimed.conversationId,
      }),
    });
    if (!proposalResult.ok || !proposalResult.proposal) throw new Error(proposalResult.error || "Repo Control proposal creation failed.");

    await updateWorkspaceTaskStep({ taskId: task.id, stepKey: claimed.steps[0]?.key ?? "prepare", status: "completed", detail: `Repo Control proposal created: ${proposalResult.proposal.id}`, progress: 45 });

    const inspect = await runStageWithRetry({ action: "inspect_repo", maxAttempts: options.maxAttempts ?? 3, steps, proof: () => "target files inspected", run: () => inspectRepoActionFiles({ id: proposalResult.proposal.id }) });
    if (!inspect.ok) throw new Error(inspect.error || "Repo inspection failed.");

    const draft = await runStageWithRetry({ action: "draft_diff", maxAttempts: options.maxAttempts ?? 3, steps, proof: () => "diff draft prepared", run: () => draftRepoActionDiff({ id: proposalResult.proposal.id }) });
    if (!draft.ok) throw new Error(draft.error || "Diff draft failed.");

    const generated = await runStageWithRetry({ action: "generate_diff", maxAttempts: options.maxAttempts ?? 3, steps, proof: () => "proposed diff generated", run: () => generateRepoActionProposedDiff({ id: proposalResult.proposal.id }) });
    if (!generated.ok) throw new Error(generated.error || "Diff generation failed.");

    const sandbox = await runStageWithRetry({ action: "sandbox_check", maxAttempts: options.maxAttempts ?? 3, steps, proof: () => "sandbox checks passed", run: () => sandboxCheckRepoActionDiff({ id: proposalResult.proposal.id }) });
    if (!sandbox.ok) throw new Error(sandbox.error || "Sandbox check failed.");

    const tempWorkspace = await runStageWithRetry({ action: "temp_workspace_check", maxAttempts: options.maxAttempts ?? 3, steps, proof: () => "temporary workspace check passed", run: () => runTemporaryWorkspaceBuildCheck({ id: proposalResult.proposal.id }) });
    if (!tempWorkspace.ok) throw new Error(tempWorkspace.error || "Temporary workspace check failed.");

    let prUrl: string | undefined;
    if (options.openPrIfApproved) {
      const pr = await runStageWithRetry({ action: "open_pr_if_approved", maxAttempts: options.maxAttempts ?? 3, steps, proof: (result) => "prUrl" in result && typeof result.prUrl === "string" ? result.prUrl : undefined, run: () => openRepoActionPullRequest({ id: proposalResult.proposal.id }) });
      prUrl = "prUrl" in pr && typeof pr.prUrl === "string" ? pr.prUrl : undefined;
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
        const tracked = await runStageWithRetry({ action: "track_pr", maxAttempts: options.maxAttempts ?? 3, steps, proof: () => "PR tracked", run: () => trackRepoActionPullRequest({ id: proposalResult.proposal.id }) });
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
    const classification = classifyOperatorFailure(message);
    const attemptedRetries = Math.max(0, steps.filter((step) => /:attempt_\d+$/.test(step.action)).length);
    const followUpTaskId = await createFailureFollowUpTask({ task, classification, message, plan, steps, attemptedRetries });
    const failureEvidenceBundle = createFailureEvidenceBundle({ task, classification, message, plan, steps, attemptedRetries });
    await addWorkspaceTaskCheckpoint(task.id, {
      label: "Executor stopped with classified failure",
      summary: `${classification.failureClass}: ${message}`,
      blocker: classification.disposition === "blocked" ? classification.reason : message,
      metadata: {
        runnerId,
        steps,
        plan,
        failureRecovery: {
          classification,
          retryPolicy: { maxAttempts: options.maxAttempts ?? 3, attemptedRetries },
          followUpTaskId,
          failureEvidenceBundle,
        },
      },
    });
    await failWorkspaceTask(task.id, message);
    return {
      ok: false,
      taskId: task.id,
      runnerId,
      plan,
      steps,
      message,
      error: message,
      failureRecovery: {
        classification,
        retryPolicy: { maxAttempts: options.maxAttempts ?? 3, attemptedRetries },
        followUpTaskId,
      },
    };
  }
}
