import { evaluatePrivilegedOperationGate, auditPrivilegedOperationGate } from "@/lib/privileged-operations";
import { executeDeploymentControlAction, prepareDeploymentControlAction } from "@/lib/deployment-control";
import { logError } from "@/lib/errors";

export interface PrivilegedDeploymentInput {
  kind: "deploy" | "rollback";
  deploymentId?: string | null;
  approvalText?: string | null;
  dryRun?: boolean;
  project?: string | null;
  environment?: string | null;
  commitSha?: string | null;
  reason?: string | null;
  buildPassed?: boolean | null;
  requestedBy?: string | null;
  projectKey?: string | null;
  workspaceId?: string | null;
  conversationId?: string | null;
}

export interface PrivilegedDeploymentResult {
  ok: boolean;
  kind: "deploy" | "rollback";
  dryRun: boolean;
  canExecute: boolean;
  approved: boolean;
  gateMessage: string;
  deployment?: unknown;
  latestDeployment?: unknown;
  rollbackCandidate?: unknown;
  documentedCommand?: string;
  taskId?: string | null;
  message: string;
  error?: string;
  safety: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function deploymentLabel(value: unknown) {
  const deployment = asRecord(value);
  return String(deployment.uid || deployment.url || deployment.name || "unknown_deployment");
}

export async function runPrivilegedDeployment(input: PrivilegedDeploymentInput): Promise<PrivilegedDeploymentResult> {
  const kind = input.kind;
  const dryRun = input.dryRun !== false;
  const project = input.project || "runeai";
  const environment = input.environment || "production";

  try {
    const prepared = await prepareDeploymentControlAction({
      action: kind === "deploy" ? "prepare_redeploy" : "prepare_rollback",
      deploymentId: input.deploymentId || null,
      reason: input.reason || null,
    });

    const preparedRecord = asRecord(prepared);
    const deployment = preparedRecord.deployment ?? null;
    const latestDeployment = preparedRecord.latestDeployment ?? null;
    const rollbackCandidate = preparedRecord.rollbackCandidate ?? null;
    const deploymentId = deploymentLabel(deployment);
    const latestId = deploymentLabel(latestDeployment);
    const rollbackTarget = deploymentLabel(rollbackCandidate || deployment);

    const gateInput = kind === "deploy"
      ? {
          kind,
          approvalText: input.approvalText,
          dryRun: true,
          scope: {
            project,
            environment,
            commit_sha: input.commitSha || deploymentId,
          },
          evidence: {
            build_passed: input.buildPassed === false ? "not_confirmed" : "confirmed_or_existing_ready_deployment",
            target_environment: environment,
            release_summary: input.reason || `Redeploy ${deploymentId} for ${project}.`,
            rollback_plan: `Use APPROVE RUNE ROLLBACK to restore previous READY deployment if ${project} regresses.`,
          },
          requestedBy: input.requestedBy,
          projectKey: input.projectKey || "rune",
          workspaceId: input.workspaceId,
          conversationId: input.conversationId,
        } as const
      : {
          kind,
          approvalText: input.approvalText,
          dryRun: true,
          scope: {
            project,
            environment,
            rollback_target: rollbackTarget,
          },
          evidence: {
            incident_summary: input.reason || `Rollback requested for ${project}.`,
            current_deployment: latestId,
            target_rollback_deployment: rollbackTarget,
            blast_radius: `Production ${project} traffic may move from ${latestId} to ${rollbackTarget}.`,
          },
          requestedBy: input.requestedBy,
          projectKey: input.projectKey || "rune",
          workspaceId: input.workspaceId,
          conversationId: input.conversationId,
        } as const;

    const gate = evaluatePrivilegedOperationGate(gateInput);
    const preparedOk = prepared.ok === true;
    const canExecute = gate.canExecute && preparedOk;
    await auditPrivilegedOperationGate(gateInput, { ...gate, canExecute });

    if (dryRun || !canExecute) {
      return {
        ok: dryRun ? preparedOk : false,
        kind,
        dryRun,
        canExecute,
        approved: gate.approved,
        gateMessage: gate.message,
        deployment,
        latestDeployment,
        rollbackCandidate,
        message: canExecute
          ? `Privileged ${kind} dry-run passed. Re-submit with dryRun=false and the same exact approval to queue the CLI runner job.`
          : `Privileged ${kind} is blocked until the gate, evidence, scope, and deployment target are valid.`,
        error: canExecute ? undefined : preparedRecord.error ? String(preparedRecord.error) : "Privileged deployment gate blocked.",
        safety: dryRun ? "dry_run_no_deployment_mutation" : "blocked_no_deployment_mutation",
      };
    }

    // The legacy deployment-control module still calls deploy execute_redeploy.
    // This wrapper is the owner-facing privileged gate: it only passes the legacy
    // approval phrase after APPROVE RUNE DEPLOY / APPROVE RUNE ROLLBACK passes
    // the shared privileged-operation policy, dry-run evidence, scope validation,
    // and audit logging.
    const execution = await executeDeploymentControlAction({
      action: kind === "deploy" ? "execute_redeploy" : "execute_rollback",
      deploymentId: input.deploymentId || null,
      approvalText: kind === "deploy" ? "APPROVE RUNE REDEPLOY" : "APPROVE RUNE ROLLBACK",
      reason: input.reason || null,
      workspaceId: input.workspaceId || null,
      conversationId: input.conversationId || null,
    });
    const executionRecord = asRecord(execution);

    return {
      ok: execution.ok === true,
      kind,
      dryRun,
      canExecute,
      approved: gate.approved,
      gateMessage: gate.message,
      deployment: executionRecord.deployment ?? deployment,
      latestDeployment,
      rollbackCandidate,
      documentedCommand: typeof executionRecord.documentedCommand === "string" ? executionRecord.documentedCommand : undefined,
      taskId: typeof executionRecord.taskId === "string" ? executionRecord.taskId : null,
      message: typeof executionRecord.message === "string" ? executionRecord.message : `Privileged ${kind} execution completed through deployment-control gate.`,
      error: typeof executionRecord.error === "string" ? executionRecord.error : undefined,
      safety: typeof executionRecord.safety === "string" ? executionRecord.safety : "deployment_control_gate_completed",
    };
  } catch (error) {
    logError("privilegedDeployment.run", error);
    return {
      ok: false,
      kind,
      dryRun,
      canExecute: false,
      approved: false,
      gateMessage: `Privileged ${kind} failed before completion.`,
      message: `Privileged ${kind} failed. No deployment mutation happened.`,
      error: error instanceof Error ? error.message : String(error),
      safety: "failed_no_deployment_mutation",
    };
  }
}
