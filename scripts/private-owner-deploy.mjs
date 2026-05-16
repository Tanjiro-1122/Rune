#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

function safeSlug(value) {
  const slug = String(value || "private-app").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "private-app";
}

function decodeMetadata() {
  const encoded = process.env.JARVIS_PRIVATE_DEPLOY_METADATA_BASE64 || "";
  if (!encoded) return {};
  try {
    return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch (error) {
    throw new Error(`Unable to decode private deploy metadata: ${error instanceof Error ? error.message : "unknown error"}`);
  }
}

function validateOwnerOnly({ proposalId, ownerOnly, metadata }) {
  const blockers = [];
  const previewHandoff = metadata.previewHandoff || metadata.preview_handoff || {};

  if (!UUID_RE.test(proposalId)) blockers.push("invalid_proposal_id");
  if (ownerOnly !== "true") blockers.push("owner_only_arg_not_true");
  if (metadata.proposalId !== proposalId) blockers.push("metadata_proposal_id_mismatch");
  if (!isTrue(metadata.ownerOnly)) blockers.push("metadata_owner_only_not_true");
  if (metadata.targetAudience !== "javier_only") blockers.push("target_audience_not_javier_only");
  if (metadata.productionClass !== "private_owner_only") blockers.push("production_class_not_private_owner_only");
  if (!isFalse(metadata.publicLaunch)) blockers.push("public_launch_must_be_false");
  if (!isFalse(metadata.customerFacing)) blockers.push("customer_facing_must_be_false");
  if (!isFalse(metadata.paymentsChange)) blockers.push("payments_change_must_be_false");
  if (!isFalse(metadata.schemaMutation)) blockers.push("schema_mutation_must_be_false");
  if (!isTrue(metadata.authRequired)) blockers.push("auth_required_not_true");
  if (metadata.accessPolicy !== "owner_only_authenticated_javier") blockers.push("access_policy_not_owner_only_authenticated_javier");
  if (metadata.executorMode !== "owner_only_executor_v1") blockers.push("executor_mode_not_owner_only_executor_v1");
  if (!isTrue(previewHandoff.ready)) blockers.push("preview_handoff_not_ready");

  const slug = safeSlug(metadata.slug || metadata.appSlug || previewHandoff.slug || previewHandoff.appName);
  const appDir = path.join(process.cwd(), "apps", slug);
  if (!appDir.startsWith(path.join(process.cwd(), "apps") + path.sep)) blockers.push("app_dir_outside_apps");
  if (!existsSync(appDir)) blockers.push("generated_app_directory_missing");

  if (blockers.length) {
    throw new Error(`Private owner executor blocked: ${blockers.join(", ")}`);
  }

  return { slug, appDir, previewHandoff };
}

async function main() {
  const proposalId = argValue("proposal-id");
  const ownerOnly = argValue("owner-only");
  const metadata = decodeMetadata();
  const validated = validateOwnerOnly({ proposalId, ownerOnly, metadata });

  const manifestDir = path.join(process.cwd(), ".jarvis", "private-deployments");
  await mkdir(manifestDir, { recursive: true });
  const manifestPath = path.join(manifestDir, `${proposalId}.json`);
  const manifest = {
    proposalId,
    appName: metadata.appName || validated.previewHandoff.appName || validated.slug,
    slug: validated.slug,
    appDir: path.relative(process.cwd(), validated.appDir),
    ownerOnly: true,
    targetAudience: "javier_only",
    productionClass: "private_owner_only",
    publicLaunch: false,
    customerFacing: false,
    paymentsChange: false,
    schemaMutation: false,
    authRequired: true,
    accessPolicy: "owner_only_authenticated_javier",
    executorMode: "owner_only_executor_v1",
    artifactOnly: true,
    deployedPublicly: false,
    vercelProd: false,
    createdAt: new Date().toISOString(),
    safety: "private_owner_executor_artifact_only_no_public_launch_no_prod_deploy",
  };

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`Private owner executor completed artifact-only manifest: ${path.relative(process.cwd(), manifestPath)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
