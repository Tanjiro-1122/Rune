import fs from "node:fs";

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ${message}`);
    process.exit(1);
  }
  console.log(`✅ ${message}`);
}

const chat = fs.readFileSync("components/chat.tsx", "utf8");
const css = fs.readFileSync("app/globals.css", "utf8");

assert(chat.includes("taskLastCheckedAt"), "task refresh records last checked time");
assert(chat.includes("getTaskActivityLabel"), "task chip formats status/progress/age");
assert(chat.includes("isPossiblyStaleTask"), "task chip detects stale active tasks");
assert(chat.includes("Task working") && chat.includes("Task stale") && chat.includes("Task queued"), "summary chip distinguishes working/stale/queued states");
assert(chat.includes("taskLastCheckedLabel"), "task chip exposes last checked label");
assert(!chat.includes('<span className="summary-chip">Task running</span>'), "old opaque Task running chip removed");
assert(css.includes(".task-activity-chip") && css.includes(".task-activity-chip--stale"), "task activity chip styles exist");
console.log("✅ Task activity chip smoke test passed.");
