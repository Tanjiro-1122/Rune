import fs from "node:fs";

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ${message}`);
    process.exit(1);
  }
  console.log(`✅ ${message}`);
}

const brain = fs.readFileSync("lib/operator-priority-brain.ts", "utf8");
const briefing = fs.readFileSync("lib/operator-briefing.ts", "utf8");
const chat = fs.readFileSync("components/chat.tsx", "utf8");
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));

assert(brain.includes("createOperatorPriorityDecisionBrief"), "Priority brain exports decision composer");
assert(brain.includes('brainVersion: "operator_priority_brain_v1"'), "Priority brain version is explicit");
assert(brain.includes("projectSignals"), "Priority brain ranks project health signals");
assert(brain.includes("proposalSignals"), "Priority brain ranks Repo Control proposal signals");
assert(brain.includes("taskSignals"), "Priority brain ranks workspace task signals");
assert(brain.includes("memorySignals"), "Priority brain ranks memory persistence signals");
assert(brain.includes("Decision brief is read-only ranking only."), "Priority brain has read-only safety boundary");
assert(brain.includes("It cannot merge, deploy, mutate schemas, change payments, grant entitlements, or contact customers."), "Priority brain forbids sensitive actions");

for (const forbidden of ["createRepoActionProposal(", "openRepoActionPullRequest(", "vercel --prod", ".insert(", ".update(", ".upsert(", ".delete(", "stripe", "grantEntitlement"]) {
  assert(!brain.includes(forbidden), `Priority brain does not call ${forbidden}`);
}

assert(briefing.includes("createOperatorPriorityDecisionBrief"), "Briefing composes priority decision brief");
assert(briefing.includes("priorityDecisionBrief"), "Briefing payload includes priority decision brief");
assert(briefing.includes("priorityDecisionBrief.topDecision"), "Briefing recommendation uses top decision when present");
assert(chat.includes("priorityDecisionBrief"), "Operator UI type/render accepts priority decision brief");
assert(chat.includes("Brain:"), "Operator briefing card surfaces brain score");
assert(pkg.scripts["test:operator-priority-brain"] === "node scripts/operator-priority-brain-smoke-test.mjs", "Package exposes priority brain smoke test");

console.log("✅ Operator priority brain smoke test passed.");
