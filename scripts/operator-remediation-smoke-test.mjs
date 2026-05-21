import fs from "node:fs";

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ${message}`);
    process.exit(1);
  }
  console.log(`✅ ${message}`);
}

const remediation = fs.readFileSync("lib/operator-remediation.ts", "utf8");
const health = fs.readFileSync("lib/app-health-snapshot.ts", "utf8");

assert(remediation.includes("app-store-connect-remove-forbidden-sort"), "known ASC sort failure maps to a code-fix action");
assert(remediation.includes("lib/app-store-connect-readonly.ts"), "ASC remediation points at the real target file");
assert(remediation.includes("approvalRequired: false"), "safe internal ASC code fix can be auto-planned without external account approval");
assert(health.includes("actionRecommendations"), "app health snapshots expose actionable recommendations");
assert(health.includes("getKnownRemediationActions"), "app health snapshots classify known failures into actions");
console.log("✅ Operator remediation smoke test passed.");
