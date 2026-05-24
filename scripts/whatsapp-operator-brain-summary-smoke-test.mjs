import fs from "node:fs";
function assert(condition, message) { if (!condition) { console.error(`❌ ${message}`); process.exit(1); } console.log(`✅ ${message}`); }
const briefing = fs.readFileSync("lib/whatsapp-briefing.ts", "utf8");
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
assert(briefing.includes("🧠 *Brain:*"), "WhatsApp briefing surfaces operator brain score");
assert(briefing.includes("🎯 *Outcome:*"), "WhatsApp briefing surfaces outcome score");
assert(briefing.includes("🧭 *Runbook:*"), "WhatsApp briefing surfaces root-cause runbook step");
assert(briefing.includes("✅ *Completed:*"), "WhatsApp briefing surfaces completion ledger");
assert(briefing.includes("priorityDecisionBrief"), "WhatsApp briefing reads priority decision brief");
assert(briefing.includes("outcomeScore"), "WhatsApp briefing reads outcome score");
assert(briefing.includes("completionLedger"), "WhatsApp briefing reads completion ledger");
assert(briefing.includes("compact("), "WhatsApp briefing clips noisy text for mobile");
assert(pkg.scripts["test:whatsapp-operator-brain-summary"] === "node scripts/whatsapp-operator-brain-summary-smoke-test.mjs", "Package exposes WhatsApp brain summary smoke test");
for (const forbidden of [".insert(", ".update(", ".upsert(", ".delete(", "openRepoActionPullRequest(", "createRepoActionProposal(", "vercel --prod", "stripe", "grantEntitlement"]) {
  assert(!briefing.includes(forbidden), `WhatsApp briefing builder does not call ${forbidden}`);
}
console.log("✅ WhatsApp operator brain summary smoke test passed.");
