#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NEXT_REQUIRED_APPROVAL = "APPROVE OWNER PREVIEW TOKEN ROUTE";

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

function validateTokenContractInput({ proposalId, provider, cwd }) {
  const blockers = [];
  const appDir = String(provider.appDir || "");

  if (!UUID_RE.test(proposalId)) blockers.push("invalid_proposal_id");
  if (provider.proposalId !== proposalId) blockers.push("provider_proposal_id_mismatch");
  if (!isTrue(provider.ok)) blockers.push("provider_adapter_not_ok");
  if (Array.isArray(provider.blockers) && provider.blockers.length > 0) blockers.push("provider_adapter_has_blockers");
  if (provider.safety !== "protected_hosting_provider_adapter_prepared_no_deploy_no_public_url") blockers.push("provider_safety_not_adapter_prepared");
  if (provider.provider !== "jarvis_proxy") blockers.push("provider_not_jarvis_proxy");
  if (provider.preferredProtectionStrategy !== "jarvis_signed_owner_proxy") blockers.push("strategy_not_jarvis_signed_owner_proxy");
  if (!isTrue(provider.ownerOnly)) blockers.push("owner_only_not_true");
  if (provider.targetAudience !== "javier_only") blockers.push("target_audience_not_javier_only");
  if (!isTrue(provider.authRequired)) blockers.push("auth_required_not_true");
  if (provider.accessPolicy !== "owner_only_authenticated_javier") blockers.push("access_policy_not_owner_only_authenticated_javier");
  if (!isFalse(provider.rawProviderUrlExposed)) blockers.push("raw_provider_url_exposed_must_be_false");
  if (!isFalse(provider.publicLaunch)) blockers.push("public_launch_must_be_false");
  if (!isFalse(provider.customerFacing)) blockers.push("customer_facing_must_be_false");
  if (!isFalse(provider.paymentsChange)) blockers.push("payments_change_must_be_false");
  if (!isFalse(provider.schemaMutation)) blockers.push("schema_mutation_must_be_false");
  if (!isFalse(provider.envWrites)) blockers.push("env_writes_must_be_false");
  if (!isFalse(provider.mergePerformed)) blockers.push("merge_performed_must_be_false");
  if (!isFalse(provider.deployCommandPrepared)) blockers.push("deploy_command_prepared_must_be_false");
  if (!isFalse(provider.deployCommandExecuted)) blockers.push("deploy_command_executed_must_be_false");
  if (!isFalse(provider.hostedPreviewCreated)) blockers.push("hosted_preview_created_must_be_false");
  if (!isFalse(provider.vercelProd)) blockers.push("vercel_prod_must_be_false");
  if (!isFalse(provider.promotionAllowed)) blockers.push("promotion_allowed_must_be_false");
  if (provider.publicPreviewUrl !== null && provider.publicPreviewUrl !== undefined && provider.publicPreviewUrl !== "") blockers.push("public_preview_url_must_be_empty");
  if (provider.protectedPreviewUrl !== null && provider.protectedPreviewUrl !== undefined && provider.protectedPreviewUrl !== "") blockers.push("protected_preview_url_must_be_empty");
  if (provider.rawProviderPreviewUrl !== null && provider.rawProviderPreviewUrl !== undefined && provider.rawProviderPreviewUrl !== "") blockers.push("raw_provider_preview_url_must_be_empty");
  if (!isTrue(provider.compatibility?.ownerSessionRequired)) blockers.push("owner_session_required_not_true");
  if (!isTrue(provider.compatibility?.signedPreviewTokenRequired)) blockers.push("signed_preview_token_required_not_true");
  if (!isTrue(provider.compatibility?.rawProviderUrlHidden)) blockers.push("raw_provider_url_hidden_not_true");
  if (!isTrue(provider.compatibility?.shortLivedAccess)) blockers.push("short_lived_access_not_true");
  if (!isTrue(provider.accessAuditRequired)) blockers.push("access_audit_required_not_true");
  if (!isTrue(provider.revocationSupported)) blockers.push("revocation_supported_not_true");
  if (!relativePathInside(path.join(cwd, "apps"), appDir.replace(/^apps\//, ""))) blockers.push("app_dir_not_inside_apps");
  if (!existsSync(path.resolve(cwd, appDir))) blockers.push("app_dir_missing");

  return { ok: blockers.length === 0, blockers, appDir };
}

async function main() {
  const proposalId = argValue("proposal-id");
  if (!UUID_RE.test(proposalId)) throw new Error("A valid --proposal-id=<uuid> is required.");

  const cwd = process.cwd();
  const providerPath = path.join(cwd, ".jarvis", "protected-hosting-providers", `${proposalId}.json`);
  if (!existsSync(providerPath)) throw new Error(`Protected hosting provider adapter not found: ${path.relative(cwd, providerPath)}`);

  const provider = JSON.parse(await readFile(providerPath, "utf8"));
  const validation = validateTokenContractInput({ proposalId, provider, cwd });

  const outputDir = path.join(cwd, ".jarvis", "owner-preview-token-contracts");
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `${proposalId}.json`);
  const contract = {
    proposalId,
    appName: provider.appName || provider.slug,
    slug: provider.slug,
    appDir: validation.appDir,
    providerPath: path.relative(cwd, providerPath),
    tokenType: "owner_preview_access",
    issuer: "jarvis",
    audience: "javier_only",
    provider: "jarvis_proxy",
    strategy: "jarvis_signed_owner_proxy",
    ttlSeconds: 900,
    singleUseRecommended: true,
    ownerSessionRequired: true,
    revocationSupported: true,
    accessAuditRequired: true,
    rawProviderUrlHidden: true,
    rawProviderUrlExposed: false,
    tokenSigningPrepared: false,
    tokenGenerated: false,
    tokenRouteCreated: false,
    livePreviewRouteCreated: false,
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
    requiredClaims: ["sub", "aud", "iss", "iat", "exp", "jti", "proposalId", "ownerOnly"],
    checkedAt: new Date().toISOString(),
    ok: validation.ok,
    blockers: validation.blockers,
    safety: validation.ok
      ? "owner_preview_token_contract_prepared_no_token_no_route_no_url"
      : "owner_preview_token_contract_blocked_no_token_no_route_no_url",
    nextRequiredApproval: NEXT_REQUIRED_APPROVAL,
  };

  await writeFile(outputPath, `${JSON.stringify(contract, null, 2)}\n`, "utf8");
  if (!validation.ok) {
    throw new Error(`Owner preview token contract blocked: ${validation.blockers.join(", ")}`);
  }

  console.log(`Owner preview token contract prepared: ${path.relative(cwd, outputPath)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
