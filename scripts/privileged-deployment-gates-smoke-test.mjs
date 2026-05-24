import fs from "node:fs";
function assert(condition, message) { if (!condition) { console.error(`❌ ${message}`); process.exit(1); } console.log(`✅ ${message}`); }
const deployment = fs.readFileSync("lib/deployment-control.ts", "utf8");
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
assert(deployment.includes("evaluatePrivilegedOperationGate"), "Deployment control evaluates shared privileged gate");
assert(deployment.includes("auditPrivilegedOperationGate"), "Deployment control audits shared privileged gate");
assert(deployment.includes('return action === "execute_redeploy" ? "deploy" : "rollback"'), "Deployment actions map to privileged deploy/rollback kinds");
assert(deployment.includes("APPROVE RUNE DEPLOY"), "Redeploy now uses shared APPROVE RUNE DEPLOY phrase");
assert(deployment.includes("APPROVE RUNE ROLLBACK"), "Rollback uses shared APPROVE RUNE ROLLBACK phrase");
assert(deployment.includes("dryRun: true"), "Deployment gate records dry-run evidence before queueing");
assert(deployment.includes("privileged_gate_blocked"), "Deployment blocks on failed privileged gate");
assert(deployment.includes("RUNE_DEPLOYMENT_MUTATION_MODE"), "Deployment mutation mode uses Rune env name");
assert(deployment.includes("queueCliRunnerJob"), "Deployment mutations remain delegated to CLI runner queue");
assert(!deployment.includes("fetch(`https://api.vercel.com/v13/deployments"), "Deployment control does not call undocumented mutation endpoint");
assert(!deployment.includes("execa(\"vercel"), "Deployment control does not run Vercel CLI directly in web runtime");
assert(pkg.scripts["test:privileged-deployment-gates"] === "node scripts/privileged-deployment-gates-smoke-test.mjs", "Package exposes privileged deployment gates smoke test");
console.log("✅ Privileged deployment gates smoke test passed.");
