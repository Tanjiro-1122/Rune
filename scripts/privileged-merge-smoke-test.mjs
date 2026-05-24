import fs from "node:fs";
function assert(condition, message) { if (!condition) { console.error(`❌ ${message}`); process.exit(1); } console.log(`✅ ${message}`); }
const merge = fs.readFileSync("lib/privileged-merge.ts", "utf8");
const route = fs.readFileSync("app/api/privileged-operations/route.ts", "utf8");
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
assert(merge.includes("runPrivilegedMerge"), "Privileged merge executor exists");
assert(merge.includes("evaluatePrivilegedOperationGate"), "Privileged merge evaluates gate");
assert(merge.includes("auditPrivilegedOperationGate"), "Privileged merge audits gate");
assert(merge.includes("isRepoAllowed"), "Privileged merge checks repo allowlist");
assert(merge.includes("checks.listForRef"), "Privileged merge checks GitHub checks");
assert(merge.includes("pulls.merge"), "Privileged merge can perform GitHub merge");
assert(merge.includes("merge_method: \"squash\""), "Privileged merge uses squash merge");
assert(merge.includes("input.dryRun || !canExecute"), "Privileged merge blocks execution during dry-run or failed gate");
assert(merge.includes("APPROVE RUNE MERGE") === false, "Executor relies on shared policy rather than hardcoding phrase");
assert(route.includes("privileged-operations"), "Privileged operations route exists");
assert(route.includes("\"list_policies\", \"evaluate_gate\", \"merge\"") && route.includes("\"deploy\", \"rollback\""), "Route exposes list/evaluate/merge plus deploy/rollback actions");
assert(route.includes("dryRun: z.boolean().default(true)"), "Route defaults to dry-run");
assert(route.includes("runPrivilegedMerge"), "Route wires privileged merge executor");
assert(pkg.scripts["test:privileged-merge"] === "node scripts/privileged-merge-smoke-test.mjs", "Package exposes privileged merge smoke test");
for (const forbidden of ["vercel deploy", "vercel rollback", "stripe.", "grantEntitlement(", "ALTER TABLE", "DROP TABLE", "dns.records.update", "sendCustomer"]){
  assert(!merge.includes(forbidden), `Privileged merge does not include ${forbidden}`);
}
console.log("✅ Privileged merge smoke test passed.");
