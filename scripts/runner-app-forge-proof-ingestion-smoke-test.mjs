import fs from "node:fs";
function assert(condition, message) { if (!condition) { console.error(`❌ ${message}`); process.exit(1); } console.log(`✅ ${message}`); }
const runner = fs.readFileSync("app/api/runner/route.ts", "utf8");
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
assert(runner.includes('verifyAppForgeRunnerResult'), "Runner route imports App Forge proof verifier");
assert(runner.includes('RunnerEvidenceSchema'), "Runner completion accepts structured evidence");
assert(runner.includes('jobKind === "app_forge_repo_create" || jobKind === "app_forge_preview_deploy"'), "Runner identifies App Forge jobs");
assert(runner.includes('runner.app_forge_proof_missing'), "Runner logs missing proof as blocked");
assert(runner.includes('status: "running"'), "Missing proof keeps task running rather than completed");
assert(runner.includes('status: 409'), "Missing proof returns conflict instead of success");
assert(runner.includes('completionTruth: verification.completionTruth'), "Runner returns completion truth");
assert(runner.includes('completionEvidence: verification.completionEvidence'), "Runner returns completion evidence");
assert(runner.includes('runner.app_forge_proof_verified'), "Runner logs verified proof");
assert(pkg.scripts["test:runner-app-forge-proof-ingestion"] === "node scripts/runner-app-forge-proof-ingestion-smoke-test.mjs", "Package exposes runner App Forge proof ingestion test");
for (const forbidden of ["pulls.merge", "vercel deploy", "stripe.", "ALTER TABLE", "DROP TABLE", "dns.records.update", "sendCustomer"]){
  assert(!runner.includes(forbidden), `Runner proof ingestion does not include ${forbidden}`);
}
console.log("✅ Runner App Forge proof ingestion smoke test passed.");
