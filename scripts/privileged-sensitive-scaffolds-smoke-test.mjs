import fs from "node:fs";
function assert(condition, message) { if (!condition) { console.error(`❌ ${message}`); process.exit(1); } console.log(`✅ ${message}`); }
const scaffold = fs.readFileSync("lib/privileged-sensitive-scaffolds.ts", "utf8");
const route = fs.readFileSync("app/api/privileged-operations/route.ts", "utf8");
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
for (const kind of ["change_payments", "grant_entitlements", "mutate_schema", "mutate_dns", "mutate_customer_systems"]) {
  assert(scaffold.includes(kind), `Scaffold supports ${kind}`);
  assert(route.includes(`"${kind}"`), `Route accepts ${kind}`);
}
assert(scaffold.includes("evaluatePrivilegedOperationGate"), "Sensitive scaffolds evaluate shared privileged gate");
assert(scaffold.includes("auditPrivilegedOperationGate"), "Sensitive scaffolds audit every gate");
assert(scaffold.includes("realMutationSupported: false"), "Sensitive scaffolds explicitly do not support real mutation");
assert(scaffold.includes("const canExecute = false"), "Sensitive scaffolds hard-block execution");
assert(scaffold.includes("scaffold_only_no_external_mutation"), "Sensitive scaffolds report no external mutation safety");
assert(scaffold.includes("Open a separate implementation PR"), "Sensitive scaffolds require separate implementation PR");
assert(route.includes("runPrivilegedSensitiveScaffold"), "Privileged operations route wires sensitive scaffolds");
assert(pkg.scripts["test:privileged-sensitive-scaffolds"] === "node scripts/privileged-sensitive-scaffolds-smoke-test.mjs", "Package exposes sensitive scaffold smoke test");
for (const forbidden of ["stripe.", "revenuecat.", "ALTER TABLE", "DROP TABLE", "dns.records.update", "cloudflare.", "sendCustomer", "fetch(\"https://api.stripe.com", "pulls.merge", "vercel deploy"]){
  assert(!scaffold.includes(forbidden), `Sensitive scaffolds do not include ${forbidden}`);
}
console.log("✅ Privileged sensitive scaffolds smoke test passed.");
