import fs from "node:fs";

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ${message}`);
    process.exit(1);
  }
  console.log(`✅ ${message}`);
}

const memory = fs.readFileSync("lib/operator-decision-memory.ts", "utf8");
const cron = fs.readFileSync("app/api/cron/daily-briefing/route.ts", "utf8");
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));

assert(memory.includes("writeOperatorDecisionMemory"), "Operator decision memory writeback helper exists");
assert(memory.includes("upsertMemory"), "Writeback uses central memory helper");
assert(memory.includes("logMemoryEvent"), "Writeback logs an auditable memory event");
assert(memory.includes("operator_decision_writeback"), "Writeback uses explicit source marker");
assert(memory.includes("operator.decision_memory.saved"), "Writeback records saved event type");
assert(memory.includes("operator.decision_memory.skipped"), "Writeback records skipped event type");
assert(memory.includes("[redacted]"), "Writeback sanitizes token-like secrets");
assert(memory.includes('decision.target === "none"'), "Writeback skips calm/no-action decisions");
assert(memory.includes("Allowed next step"), "Writeback stores allowed next step");
assert(memory.includes("Blocked actions"), "Writeback stores blocked actions");

assert(cron.includes("writeOperatorDecisionMemory"), "Daily briefing cron calls decision writeback");
assert(cron.includes("This is intentionally in the cron path, not the read-only briefing GET route."), "Cron documents read-only route boundary");
assert(cron.includes("decisionMemory"), "Cron returns writeback result summary");
assert(pkg.scripts["test:operator-decision-memory"] === "node scripts/operator-decision-memory-smoke-test.mjs", "Package exposes decision memory smoke test");

for (const forbidden of ["openRepoActionPullRequest(", "createRepoActionProposal(", "vercel --prod", "stripe", "grantEntitlement", "refundPayment", "sendPushNotificationsToAll("]) {
  assert(!memory.includes(forbidden), `Decision memory helper does not call ${forbidden}`);
}

console.log("✅ Operator decision memory smoke test passed.");
