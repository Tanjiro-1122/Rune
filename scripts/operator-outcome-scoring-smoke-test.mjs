import fs from "node:fs";
function assert(condition, message) { if (!condition) { console.error(`❌ ${message}`); process.exit(1); } console.log(`✅ ${message}`); }
const scorer = fs.readFileSync("lib/operator-outcome-scoring.ts", "utf8");
const briefing = fs.readFileSync("lib/operator-briefing.ts", "utf8");
const brain = fs.readFileSync("lib/operator-priority-brain.ts", "utf8");
const chat = fs.readFileSync("components/chat.tsx", "utf8");
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
assert(scorer.includes("scoreOperatorOutcome"), "Outcome scorer helper exists");
assert(scorer.includes("likely_resolved"), "Outcome scorer can mark likely resolved");
assert(scorer.includes("recurring"), "Outcome scorer can mark recurring");
assert(scorer.includes("pending"), "Outcome scorer can mark pending");
assert(scorer.includes("unknown"), "Outcome scorer can mark unknown");
assert(scorer.includes("tokenOverlap"), "Outcome scorer compares decisions to completions");
assert(scorer.includes("readOnly: true"), "Outcome scorer is explicitly read-only");
assert(scorer.includes("root-cause investigation"), "Outcome scorer recommends root-cause escalation for repeats");
assert(briefing.includes("scoreOperatorOutcome"), "Briefing attaches outcome score");
assert(brain.includes("outcomeScore?"), "Priority brief supports outcome score");
assert(chat.includes("Outcome:"), "Operator UI surfaces outcome score");
assert(pkg.scripts["test:operator-outcome-scoring"] === "node scripts/operator-outcome-scoring-smoke-test.mjs", "Package exposes outcome scoring smoke test");
for (const forbidden of [".insert(", ".update(", ".upsert(", ".delete(", "openRepoActionPullRequest(", "createRepoActionProposal(", "vercel --prod", "stripe", "grantEntitlement", "sendPushNotificationsToAll("]) {
  assert(!scorer.includes(forbidden), `Outcome scorer does not call ${forbidden}`);
}
console.log("✅ Operator outcome scoring smoke test passed.");
