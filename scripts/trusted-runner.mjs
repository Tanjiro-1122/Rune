#!/usr/bin/env node
import { spawn } from "node:child_process";

const RUNNER_ID = process.env.RUNNER_ID || "trusted-runner-1";
const BASE_URL = (process.env.JARVIS_BASE_URL || "").replace(/\/$/, "");
const RUNNER_TOKEN = process.env.JARVIS_RUNNER_TOKEN || "";
const DRY_RUN = (process.env.JARVIS_RUNNER_DRY_RUN || "true").toLowerCase() !== "false";
const ALLOW_DRY_RUN_CLAIM = (process.env.JARVIS_RUNNER_ALLOW_DRY_RUN_CLAIM || "false").toLowerCase() === "true";
const POLL_INTERVAL_MS = Number(process.env.JARVIS_RUNNER_POLL_INTERVAL_MS || 15_000);
const ONCE = process.argv.includes("--once");
const EXECUTE = (process.env.JARVIS_RUNNER_EXECUTION_MODE || "dry-run").toLowerCase() === "execute" && !DRY_RUN;

const EXACT_APPROVALS = new Map([
  ["vercel_redeploy", "APPROVE JARVIS REDEPLOY"],
  ["vercel_rollback", "APPROVE JARVIS ROLLBACK"],
  ["private_app_creator_deploy", "APPROVE PRIVATE JARVIS DEPLOY"],
]);

function requireEnv() {
  const missing = [];
  if (!BASE_URL) missing.push("JARVIS_BASE_URL");
  if (!RUNNER_TOKEN) missing.push("JARVIS_RUNNER_TOKEN");
  if (EXECUTE && !process.env.VERCEL_TOKEN) missing.push("VERCEL_TOKEN");
  if (missing.length) throw new Error(`Missing required env vars: ${missing.join(", ")}`);
}

async function runnerRequest(payload) {
  const response = await fetch(`${BASE_URL}/api/runner`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${RUNNER_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.error || `Runner API error ${response.status}`);
  return json;
}

function metadataFor(task) {
  return task?.runnerMetadata || task?.runner_metadata || {};
}

function isTrue(value) {
  return value === true || value === "true";
}

function isFalse(value) {
  return value === false || value === "false" || value === undefined || value === null;
}

function validatePrivateAppCreatorDeployMetadata(metadata, command) {
  const proposalMatch = command.match(/--proposal-id=([0-9a-f-]+)/);
  const commandProposalId = proposalMatch?.[1] || "";
  const previewHandoff = metadata.previewHandoff || metadata.preview_handoff || {};
  const requiredApproval = EXACT_APPROVALS.get("private_app_creator_deploy");

  const blockers = [];
  if (!/^[0-9a-f-]{36}$/.test(commandProposalId)) blockers.push("missing_valid_proposal_id");
  if (metadata.proposalId !== commandProposalId) blockers.push("proposal_id_mismatch");
  if (!isTrue(metadata.ownerOnly)) blockers.push("owner_only_not_true");
  if (metadata.targetAudience !== "javier_only") blockers.push("target_audience_not_javier_only");
  if (metadata.productionClass !== "private_owner_only") blockers.push("production_class_not_private_owner_only");
  if (!isFalse(metadata.publicLaunch)) blockers.push("public_launch_must_be_false");
  if (!isFalse(metadata.customerFacing)) blockers.push("customer_facing_must_be_false");
  if (!isFalse(metadata.paymentsChange)) blockers.push("payments_change_must_be_false");
  if (!isFalse(metadata.schemaMutation)) blockers.push("schema_mutation_must_be_false");
  if (!isTrue(metadata.authRequired)) blockers.push("auth_required_not_true");
  if (metadata.accessPolicy !== "owner_only_authenticated_javier") blockers.push("access_policy_not_owner_only_authenticated_javier");
  if (metadata.executorMode !== "dry_run_validator_only") blockers.push("executor_mode_not_dry_run_validator_only");
  if (!isTrue(previewHandoff.ready)) blockers.push("preview_handoff_not_ready");
  if (previewHandoff.requiredApprovalPhrase && previewHandoff.requiredApprovalPhrase !== "APPROVE JARVIS REDEPLOY") blockers.push("unexpected_preview_handoff_approval_phrase");
  if (metadata.approval_text !== requiredApproval) blockers.push("private_approval_phrase_mismatch");

  if (blockers.length) {
    return { ok: false, error: `Private App Creator dry-run blocked: ${blockers.join(", ")}.` };
  }

  return {
    ok: true,
    dryRunOnly: true,
    message: `Private App Creator deploy dry-run passed for proposal ${commandProposalId}. Owner-only metadata is valid; no command was executed.`,
  };
}

function validateTask(task) {
  if (!task) return { ok: false, error: "No task returned." };
  if (task.intent !== "cli_runner") return { ok: false, error: `Refusing non-cli_runner task: ${task.intent || "unknown"}` };

  const metadata = metadataFor(task);
  const kind = String(metadata.job_kind || "");
  const executionMode = String(metadata.execution_mode || "");
  const command = String(metadata.command || "").trim();

  if (executionMode !== "queued_only_no_local_execution") {
    return { ok: false, error: `Unexpected execution mode: ${executionMode || "missing"}` };
  }
  if (!command) return { ok: false, error: "Missing runner command." };
  if (!kind) return { ok: false, error: "Missing runner job kind." };

  const expectedApproval = EXACT_APPROVALS.get(kind);
  if (expectedApproval && metadata.approval_text !== expectedApproval) {
    return { ok: false, error: `Approval phrase mismatch for ${kind}.` };
  }

  if (kind === "vercel_redeploy" && !/^vercel redeploy \S+ --token=\$VERCEL_TOKEN$/.test(command)) {
    return { ok: false, error: "Redeploy command does not match the allowed Vercel command shape." };
  }
  if (kind === "vercel_rollback" && !/^vercel rollback \S+ --token=\$VERCEL_TOKEN$/.test(command)) {
    return { ok: false, error: "Rollback command does not match the allowed Vercel command shape." };
  }
  if (kind === "private_app_creator_deploy") {
    if (!/^npm run private-owner-deploy -- --proposal-id=[0-9a-f-]+ --owner-only=true$/.test(command)) {
      return { ok: false, error: "Private App Creator deployment command does not match the owner-only command shape." };
    }
    const privateValidation = validatePrivateAppCreatorDeployMetadata(metadata, command);
    if (!privateValidation.ok) return privateValidation;
    return { ok: true, kind, command, metadata, dryRunOnly: true, dryRunMessage: privateValidation.message };
  }
  if (!EXACT_APPROVALS.has(kind)) {
    return { ok: false, error: `Execution for job kind ${kind} is not implemented in runner v1.` };
  }

  return { ok: true, kind, command, metadata };
}

function commandToSpawn(validation) {
  const [, action, target] = validation.command.match(/^vercel (redeploy|rollback) (\S+) --token=\$VERCEL_TOKEN$/) || [];
  if (!action || !target) throw new Error("Unable to parse Vercel command.");
  return { command: "vercel", args: [action, target, "--token", process.env.VERCEL_TOKEN] };
}

function runCommand(validation) {
  const { command, args } = commandToSpawn(validation);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`Command exited with code ${code}: ${stderr || stdout}`.slice(0, 900)));
    });
  });
}

async function handleClaimedTask(task) {
  const validation = validateTask(task);
  if (!validation.ok) {
    await runnerRequest({ action: "fail", runnerId: RUNNER_ID, taskId: task.id, message: `Runner refused job safely: ${validation.error}` });
    console.log(`Refused task ${task.id}: ${validation.error}`);
    return;
  }

  await runnerRequest({ action: "heartbeat", runnerId: RUNNER_ID, taskId: task.id, message: `Validated ${validation.kind}; dryRun=${DRY_RUN}` });

  if (validation.dryRunOnly) {
    const message = validation.dryRunMessage || `Dry-run validation passed for ${validation.kind}; no command was executed.`;
    await runnerRequest({ action: "complete", runnerId: RUNNER_ID, taskId: task.id, message });
    console.log(message);
    return;
  }

  if (!EXECUTE) {
    const message = DRY_RUN
      ? `Dry-run validation passed for ${validation.kind}; command was not executed.`
      : `Runner execution mode is not enabled; command was not executed.`;
    await runnerRequest({ action: "fail", runnerId: RUNNER_ID, taskId: task.id, message });
    console.log(message);
    return;
  }

  const result = await runCommand(validation);
  const summary = `CLI runner job completed: ${validation.kind}. ${result.stdout.slice(0, 500)}`.trim();
  await runnerRequest({ action: "complete", runnerId: RUNNER_ID, taskId: task.id, message: summary });
  console.log(summary);
}

async function tick() {
  if (DRY_RUN && !ALLOW_DRY_RUN_CLAIM) {
    console.log("Dry-run mode is on. Refusing to claim jobs unless JARVIS_RUNNER_ALLOW_DRY_RUN_CLAIM=true.");
    return;
  }
  const { task } = await runnerRequest({ action: "claim", runnerId: RUNNER_ID });
  if (!task) {
    console.log("No queued runner task.");
    return;
  }
  await handleClaimedTask(task);
}

async function main() {
  requireEnv();
  console.log(`Jarvis trusted runner starting. runnerId=${RUNNER_ID} dryRun=${DRY_RUN} execute=${EXECUTE}`);
  if (ONCE) {
    await tick();
    return;
  }
  for (;;) {
    try {
      await tick();
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
