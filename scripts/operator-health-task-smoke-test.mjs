import fs from "node:fs";

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ${message}`);
    process.exit(1);
  }
  console.log(`✅ ${message}`);
}

const chat = fs.readFileSync("app/api/chat/route.ts", "utf8");

assert(chat.includes("createRemediationTask"), "health tool accepts a remediation-task flag");
assert(chat.includes("snapshot.actionRecommendations"), "health tool reads actionable recommendations");
assert(chat.includes("function getAgentTools"), "workspace-aware tool layer exists");
assert(chat.includes("createWorkspaceTask"), "workspace-aware health tool creates visible workspace tasks");
assert(chat.includes("Operator remediation:"), "created task titles are labeled as Operator remediation");
assert(chat.includes("remediationTasks"), "tool result reports created remediation task IDs");
assert(chat.includes("fix a diagnosed health problem"), "tool description routes fix-it prompts into health remediation");
console.log("✅ Operator health task bridge smoke test passed.");
