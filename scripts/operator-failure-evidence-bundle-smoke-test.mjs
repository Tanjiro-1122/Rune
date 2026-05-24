import fs from "node:fs";
function assert(condition, message) { if (!condition) { console.error(`❌ ${message}`); process.exit(1); } console.log(`✅ ${message}`); }
const executor = fs.readFileSync("lib/operator-executor.ts", "utf8");
const tasks = fs.readFileSync("lib/tasks.ts", "utf8");
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
assert(executor.includes("OperatorFailureEvidenceBundle"), "Executor defines failure evidence bundle contract");
assert(executor.includes("createFailureEvidenceBundle"), "Executor creates failure evidence bundles");
assert(executor.includes("failedStage"), "Evidence bundle records failed stage");
assert(executor.includes("failedStageError"), "Evidence bundle records failed stage error");
assert(executor.includes("stageProofs"), "Evidence bundle preserves recent stage proofs");
assert(executor.includes("targetFiles"), "Evidence bundle preserves target files");
assert(executor.includes("verification"), "Evidence bundle preserves verification commands");
assert(executor.includes("nextSafeAction"), "Evidence bundle carries next safe action");
assert(executor.includes("failureEvidenceBundle"), "Failure bundle is attached to follow-up and checkpoint metadata");
assert(executor.includes('source: "operator_executor_failure_recovery"'), "Follow-up task metadata records recovery source");
assert(tasks.includes("runnerMetadata?: Record<string, unknown> | null"), "createWorkspaceTask accepts runner metadata");
assert(tasks.includes("runner_metadata: runnerMetadata ?? {}"), "createWorkspaceTask stores runner metadata");
assert(pkg.scripts["test:operator-failure-evidence-bundle"] === "node scripts/operator-failure-evidence-bundle-smoke-test.mjs", "Package exposes failure evidence bundle smoke test");
for (const forbidden of ["vercel --prod", "stripe", "grantEntitlement", "refundPayment", "execute_redeploy", "execute_rollback"]) {
  assert(!executor.includes(forbidden), `Executor evidence bundle patch does not add ${forbidden}`);
}
console.log("✅ Operator failure evidence bundle smoke test passed.");
