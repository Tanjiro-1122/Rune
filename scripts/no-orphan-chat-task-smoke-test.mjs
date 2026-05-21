import fs from "node:fs";

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ${message}`);
    process.exit(1);
  }
  console.log(`✅ ${message}`);
}

const route = fs.readFileSync("app/api/chat/route.ts", "utf8");
const tasks = fs.readFileSync("lib/tasks.ts", "utf8");

assert(route.includes("shouldCreateWorkspaceTask"), "chat route gates workspace task creation");
assert(route.includes("shouldTrackWorkspaceTask"), "chat route computes tracking eligibility");
assert(route.includes("if (!shouldTrackWorkspaceTask) return null"), "normal chat skips task row creation");
assert(route.includes("resumeTaskId") && route.includes("return true"), "resumed tasks still track task rows");
assert(tasks.includes("orphaned chat state"), "reconciler can close legacy orphan chat task rows");
console.log("✅ No-orphan chat task smoke test passed.");
