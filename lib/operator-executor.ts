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
  inspectRepoActionFiles,
} from "@/lib/repo-actions";

export type OperatorExecutionActionType = "inspect_repo" | "create_repo_proposal" | "draft_diff" | "stop_before_pr";

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
        { type: "stop_before_pr", description: "Stop before PR, merge, deployment, or external account mutation gates." },
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
    summary: `Executor Bridge v1 claimed this task and normalized a ${plan.taskType} plan for ${plan.targetFiles.join(", ")}.`,
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
        "- Executor Bridge v1 stops before PR/merge/deploy gates.",
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

    await addWorkspaceTaskCheckpoint(task.id, {
      label: "Executor prepared safe repo workflow",
      summary: `Repo Control proposal ${proposalResult.proposal.id} was created and safe prep stages ran. Executor Bridge v1 stopped before PR, merge, deploy, or external edits.`,
      completedStep: "create_repo_proposal",
      nextStep: "Owner can approve/run Repo Control PR stage if needed.",
      metadata: { runnerId, proposalId: proposalResult.proposal.id, steps, plan },
    });

    await completeWorkspaceTask(task.id, `Executor Bridge v1 prepared Repo Control proposal ${proposalResult.proposal.id}. No PR, merge, deploy, or external account mutation happened.`);
    return {
      ok: true,
      taskId: task.id,
      runnerId,
      plan,
      proposalId: proposalResult.proposal.id,
      steps,
      message: "Executor Bridge v1 completed safe prep and stopped before PR/merge/deploy gates.",
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
