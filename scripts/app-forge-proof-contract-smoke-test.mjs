import fs from "node:fs";
function assert(condition, message) { if (!condition) { console.error(`❌ ${message}`); process.exit(1); } console.log(`✅ ${message}`); }
const appForge = fs.readFileSync("lib/app-forge.ts", "utf8");
const chat = fs.readFileSync("app/api/chat/route.ts", "utf8");
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
assert(appForge.includes("AppForgeProofContract"), "App Forge exposes a completion proof contract");
assert(appForge.includes("completed: false"), "App Forge defaults handoff/queued states to not completed");
assert(appForge.includes("handoff_only_no_repo_created"), "Metadata-only handoff cannot be reported as app created");
assert(appForge.includes("queued_not_executed_no_repo_created"), "Queued repo creation cannot be reported as repo created");
assert(appForge.includes("queued_not_executed_no_preview_deployed"), "Queued preview deploy cannot be reported as deployed");
assert(appForge.includes("not_completed_yet_do_not_claim_app_created"), "Approval failures block app-created claims");
assert(appForge.includes("github_repo_verification"), "Repo verification is required evidence");
assert(appForge.includes("branch_verification"), "Branch verification is required evidence");
assert(appForge.includes("deployment_url"), "Deployment URL is required evidence for deploy claims");
assert(chat.includes("It is not Emergent-style live preview/runtime yet"), "Chat prompt keeps App Forge capability honest");
assert(chat.includes("Repo completion truth rule"), "Chat prompt includes repo completion truth rule");
assert(pkg.scripts["test:app-forge-proof-contract"] === "node scripts/app-forge-proof-contract-smoke-test.mjs", "Package exposes App Forge proof contract test");
for (const forbidden of ["pulls.merge", "vercel deploy --prod", "stripe.", "ALTER TABLE", "DROP TABLE", "dns.records.update", "sendCustomer"]){
  assert(!appForge.includes(forbidden), `App Forge proof patch does not include ${forbidden}`);
}
console.log("✅ App Forge proof contract smoke test passed.");
