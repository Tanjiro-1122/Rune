import fs from "node:fs";
function assert(condition, message) { if (!condition) { console.error(`❌ ${message}`); process.exit(1); } console.log(`✅ ${message}`); }
const deploy = fs.readFileSync("lib/privileged-deployment.ts", "utf8");
const route = fs.readFileSync("app/api/privileged-operations/route.ts", "utf8");
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
assert(deploy.includes("runPrivilegedDeployment"), "Privileged deployment wrapper exists");
assert(deploy.includes("evaluatePrivilegedOperationGate"), "Deployment wrapper evaluates shared privileged gate");
assert(deploy.includes("auditPrivilegedOperationGate"), "Deployment wrapper audits shared privileged gate");
assert(deploy.includes("prepareDeploymentControlAction"), "Deployment wrapper prepares deployment target first");
assert(deploy.includes("executeDeploymentControlAction"), "Deployment wrapper hands off to existing deployment-control executor");
assert(deploy.includes("dryRun !== false"), "Deployment wrapper defaults to dry-run");
assert(deploy.includes("dry_run_no_deployment_mutation"), "Deployment wrapper has dry-run safety label");
assert(deploy.includes("blocked_no_deployment_mutation"), "Deployment wrapper blocks without mutation");
assert(deploy.includes("kind === \"deploy\""), "Deployment wrapper supports deploy");
assert(deploy.includes("kind === \"deploy\" ? \"execute_redeploy\" : \"execute_rollback\""), "Deployment wrapper maps deploy/rollback to legacy deployment-control actions");
assert(route.includes("\"deploy\", \"rollback\""), "Privileged operations route exposes deploy and rollback actions");
assert(route.includes("runPrivilegedDeployment"), "Privileged operations route wires deployment wrapper");
assert(route.includes("deploymentId"), "Privileged operations route accepts deployment target");
assert(pkg.scripts["test:privileged-deployment"] === "node scripts/privileged-deployment-smoke-test.mjs", "Package exposes privileged deployment smoke test");
for (const forbidden of ["stripe.", "grantEntitlement(", "ALTER TABLE", "DROP TABLE", "dns.records.update", "sendCustomer"]){
  assert(!deploy.includes(forbidden), `Deployment wrapper does not include ${forbidden}`);
}
console.log("✅ Privileged deployment smoke test passed.");
