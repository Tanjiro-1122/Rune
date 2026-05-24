import fs from "node:fs";
function assert(condition, message) { if (!condition) { console.error(`❌ ${message}`); process.exit(1); } console.log(`✅ ${message}`); }
const runbook = fs.readFileSync("lib/operator-root-cause-runbook.ts", "utf8");
const briefing = fs.readFileSync("lib/operator-briefing.ts", "utf8");
const brain = fs.readFileSync("lib/operator-priority-brain.ts", "utf8");
const chat = fs.readFileSync("components/chat.tsx", "utf8");
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
assert(runbook.includes("createOperatorRootCauseRunbook"), "Root-cause runbook helper exists");
assert(runbook.includes("evidenceToCollect"), "Runbook lists evidence to collect");
assert(runbook.includes("safeInvestigationSteps"), "Runbook lists safe investigation steps");
assert(runbook.includes("stopConditions"), "Runbook defines stop conditions");
assert(runbook.includes("blockedActions"), "Runbook defines blocked actions");
assert(runbook.includes("Do not merge without Javier approval."), "Runbook preserves merge gate");
assert(runbook.includes("Do not deploy, redeploy, or rollback from this runbook."), "Runbook blocks deploy/rollback");
assert(runbook.includes("Do not guess at code paths; inspect live source first."), "Runbook requires source inspection");
assert(runbook.includes("root-cause fix over repeated symptom patches"), "Runbook favors root-cause fixes");
assert(briefing.includes("createOperatorRootCauseRunbook"), "Briefing attaches root-cause runbook");
assert(brain.includes("rootCauseRunbook?"), "Priority brief supports root-cause runbook");
assert(chat.includes("Runbook:"), "Operator UI surfaces runbook prompt");
assert(pkg.scripts["test:operator-root-cause-runbook"] === "node scripts/operator-root-cause-runbook-smoke-test.mjs", "Package exposes root-cause runbook smoke test");
for (const forbidden of [".insert(", ".update(", ".upsert(", ".delete(", "openRepoActionPullRequest(", "createRepoActionProposal(", "vercel --prod", "stripe", "grantEntitlement"]) {
  assert(!runbook.includes(forbidden), `Runbook helper does not call ${forbidden}`);
}
console.log("✅ Operator root-cause runbook smoke test passed.");
