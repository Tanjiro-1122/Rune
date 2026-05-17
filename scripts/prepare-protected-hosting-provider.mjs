#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUIRED_PREVIOUS_APPROVAL = "APPROVE OWNER PREVIEW HOSTING";
const NEXT_REQUIRED_APPROVAL = "APPROVE PROTECTED HOSTING PROVIDER";

function argValue(name) {
  const prefix = `--${name}=`;
  const found = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : "";
}

function isTrue(value) {
  return value === true || value === "true";
}

function isFalse(value) {
  return value === false || value === "false" || value === undefined || value === null;
}

function relativePathInside(baseDir, relativePath) {
  if (!relativePath || path.isAbsolute(relativePath)) return false;
  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(baseDir, relativePath);
  return resolvedTarget.startsWith(resolvedBase + path.sep);
}

function validateProtectedHostingProviderInput({ proposalId, execution, cwd }) {
  const blockers = [];
  const appDir = String(execution.appDir || "");

  if (!UUID_RE.test(proposalId)) blockers.push("invalid_proposal_id");
  if (execution.proposalId !== proposalId) blockers.push("execution_proposal_id_mismatch");
  if (!isTrue(execution.ok)) blockers.push("preview_execution_not_ok");
  if (Array.isArray(execution.blockers) && execution.blockers.length > 0) blockers.push("preview_execution_has_blockers");
  if (execution.safety !== "protected_owner_preview_execution_recorded_no_hosting_no_public_url") blockers.push("execution_safety_not_recorded_owner_preview");
  if (execution.approvalPhrase !== REQUIRED_PREVIOUS_APPROVAL) blockers.push("previous_approval_phrase_mismatch");
  if (execution.nextRequiredApproval !== NEXT_REQUIRED_APPROVAL) blockers.push("next_approval_phrase_not_recorded");
  if (!isTrue(execution.ownerOnly)) blockers.push("owner_only_not_true");
  if (execution.targetAudience !== "javier_only") blockers.push("target_audience_not_javier_only");
  if (execution.productionClass !== "private_owner_only") blockers.push("production_class_not_private_owner_only");
  if (!isTrue(execution.authRequired)) blockers.push("auth_required_not_true");
  if (execution.accessPolicy !== "owner_only_authenticated_javier") blockers.push("access_policy_not_owner_only_authenticated_javier");
  if (!isFalse(execution.publicLaunch)) blockers.push("public_launch_must_be_false");
  if (!isFalse(execution.customerFacing)) blockers.push("customer_facing_must_be_false");
  if (!isFalse(execution.paymentsChange)) blockers.push("payments_change_must_be_false");
  if (!isFalse(execution.schemaMutation)) blockers.push("schema_mutation_must_be_false");
  if (!isFalse(execution.envWrites)) blockers.push("env_writes_must_be_false");
  if (!isFalse(execution.mergePerformed)) blockers.push("merge_performed_must_be_false");
  if (!isFalse(execution.deployCommandExecuted)) blockers.push("deploy_command_executed_must_be_false");
  if (!isFalse(execution.hostedPreviewCreated)) blockers.push("hosted_preview_created_must_be_false");
  if (!isFalse(execution.vercelProd)) blockers.push("vercel_prod_must_be_false");
  if (!isFalse(execution.promotionAllowed)) blockers.push("promotion_allowed_must_be_false");
  if (execution.publicPreviewUrl !== null && execution.publicPreviewUrl !== undefined && execution.publicPreviewUrl !== "") blockers.push("public_preview_url_must_be_empty");
  if (execution.protectedPreviewUrl !== null && execution.protectedPreviewUrl !== undefined && execution.protectedPreviewUrl !== "") blockers.push("protected_preview_url_must_be_empty");
  if (!relativePathInside(path.join(cwd, "apps"), appDir.replace(/^apps\//, ""))) blockers.push("app_dir_not_inside_apps");
  if (!existsSync(path.resolve(cwd, appDir))) blockers.push("app_dir_missing");

  return { ok: blockers.length === 0, blockers, appDir };
}

async function main() {
  const proposalId = argValue("proposal-id");
  if (!UUID_RE.test(proposalId)) throw new Error("A valid --proposal-id=<uuid> is required.");

  const cwd = process.cwd();
  const executionPath = path.join(cwd, ".jarvis", "private-preview-executions", `${proposalId}.json`);
  if (!existsSync(executionPath)) throw new Error(`Protected owner preview execution not found: ${path.relative(cwd, executionPath)}`);

  const execution = JSON.parse(await readFile(executionPath, "utf8"));
  const validation = validateProtectedHostingProviderInput({ proposalId, execution, cwd });

  const outputDir = path.join(cwd, ".jarvis", "protected-hosting-providers");
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `${proposalId}.json`);
  const provider = {
    proposalId,
    appName: execution.appName || execution.slug,
    slug: execution.slug,
    appDir: validation.appDir,
    executionPath: path.relative(cwd, executionPath),
    provider: "jarvis_proxy",
    preferredProtectionStrategy: "jarvis_signed_owner_proxy",
    ownerOnly: true,
    targetAudience: "javier_only",
    authRequired: true,
    accessPolicy: "owner_only_authenticated_javier",
    rawProviderUrlExposed: false,
    publicLaunch: false,
    customerFacing: false,
    paymentsChange: false,
    schemaMutation: false,
    envWrites: false,
    mergePerformed: false,
    deployCommandPrepared: false,
    deployCommandExecuted: false,
    hostedPreviewCreated: false,
    publicPreviewUrl: null,
    protectedPreviewUrl: null,
    rawProviderPreviewUrl: null,
    vercelProd: false,
    promotionAllowed: false,
    tokenTtlSeconds: 900,
    accessAuditRequired: true,
    revocationSupported: true,
    compatibility: {
      ownerSessionRequired: true,
      signedPreviewTokenRequired: true,
      rawProviderUrlHidden: true,
      shortLivedAccess: true,
    },
    checkedAt: new Date().toISOString(),
    ok: validation.ok,
    blockers: validation.blockers,
    safety: validation.ok
      ? "protected_hosting_provider_adapter_prepared_no_deploy_no_public_url"
      : "protected_hosting_provider_adapter_blocked_no_deploy_no_public_url",
    nextRequiredApproval: NEXT_REQUIRED_APPROVAL,
  };

  await writeFile(outputPath, `${JSON.stringify(provider, null, 2)}\n`, "utf8");
  if (!validation.ok) {
    throw new Error(`Protected hosting provider adapter blocked: ${validation.blockers.join(", ")}`);
  }

  console.log(`Protected hosting provider adapter prepared: ${path.relative(cwd, outputPath)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
