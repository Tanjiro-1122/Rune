import fs from "node:fs";
function assert(condition, message) { if (!condition) { console.error(`❌ ${message}`); process.exit(1); } console.log(`✅ ${message}`); }
const history = fs.readFileSync("lib/operator-decision-history.ts", "utf8");
const briefing = fs.readFileSync("lib/operator-briefing.ts", "utf8");
const brain = fs.readFileSync("lib/operator-priority-brain.ts", "utf8");
const chat = fs.readFileSync("components/chat.tsx", "utf8");
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
assert(history.includes("getOperatorDecisionHistorySignal"), "Decision history reader exists");
assert(history.includes("applyDecisionHistoryBoost"), "Decision history boost helper exists");
assert(history.includes("listActiveMemories"), "Decision history reads existing memory only");
assert(history.includes('memory.source === "operator_decision_writeback"'), "Decision history only considers operator writeback memories");
assert(history.includes("recurrenceBoost"), "Decision history computes recurrence boost");
assert(history.includes("root cause rather than only patching symptoms"), "Recurring decisions push root-cause behavior");
assert(briefing.includes("getOperatorDecisionHistorySignal"), "Briefing reads decision history");
assert(briefing.includes("applyDecisionHistoryBoost"), "Briefing applies decision history boost");
assert(brain.includes("decisionHistory?"), "Priority brain payload supports decision history");
assert(chat.includes("Recurring +"), "Operator UI surfaces recurring decision boost");
assert(pkg.scripts["test:operator-decision-history"] === "node scripts/operator-decision-history-smoke-test.mjs", "Package exposes decision history smoke test");
for (const forbidden of [".insert(", ".update(", ".upsert(", ".delete(", "openRepoActionPullRequest(", "createRepoActionProposal(", "vercel --prod", "stripe", "grantEntitlement"]) {
  assert(!history.includes(forbidden), `Decision history helper does not call ${forbidden}`);
}
console.log("✅ Operator decision history smoke test passed.");
