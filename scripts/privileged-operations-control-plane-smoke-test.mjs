import fs from "node:fs";
function assert(condition, message) { if (!condition) { console.error(`❌ ${message}`); process.exit(1); } console.log(`✅ ${message}`); }
const ops = fs.readFileSync("lib/privileged-operations.ts", "utf8");
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
for (const kind of ["merge", "deploy", "rollback", "change_payments", "grant_entitlements", "mutate_schema", "mutate_dns", "mutate_customer_systems"]) {
  assert(ops.includes(`| "${kind}"`) || ops.includes(`${kind}: {`), `Registry covers ${kind}`);
}
for (const phrase of [
  "APPROVE RUNE MERGE",
  "APPROVE RUNE DEPLOY",
  "APPROVE RUNE ROLLBACK",
  "APPROVE RUNE PAYMENT CHANGE",
  "APPROVE RUNE ENTITLEMENT GRANT",
  "APPROVE RUNE SCHEMA MUTATION",
  "APPROVE RUNE DNS CHANGE",
  "APPROVE RUNE CUSTOMER SYSTEM CHANGE",
]) {
  assert(ops.includes(phrase), `Exact approval phrase exists: ${phrase}`);
}
assert(ops.includes("evaluatePrivilegedOperationGate"), "Gate evaluator exists");
assert(ops.includes("auditPrivilegedOperationGate"), "Gate audit helper exists");
assert(ops.includes("blocked_until_explicit_approval"), "Operations are blocked by default");
assert(ops.includes("dryRunRequired: true"), "Dry-run evidence is required");
assert(ops.includes("auditRequired: true"), "Audit is required");
assert(ops.includes("requiredEvidence"), "Required evidence is part of policy");
assert(ops.includes("requiredScopeFields"), "Required scope is part of policy");
assert(pkg.scripts["test:privileged-operations-control-plane"] === "node scripts/privileged-operations-control-plane-smoke-test.mjs", "Package exposes privileged operations smoke test");
for (const forbidden of ["pulls.merge", "vercel deploy", "vercel rollback", "stripe.", "grantEntitlement(", "ALTER TABLE", "DROP TABLE", "dns.records.update", "sendCustomer"]){
  assert(!ops.includes(forbidden), `Control plane does not execute ${forbidden}`);
}
console.log("✅ Privileged operations control-plane smoke test passed.");
