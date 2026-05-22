import fs from "node:fs";

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ${message}`);
    process.exit(1);
  }
  console.log(`✅ ${message}`);
}

const chat = fs.readFileSync("components/chat.tsx", "utf8");
const task = fs.readFileSync("components/chat/task-activity.ts", "utf8");
for (const name of ["getTaskStatusLabel", "getTaskAgeLabel", "isPossiblyStaleTask", "getTaskActivityLabel", "getRunnerJobLabel", "getCommandPreview"]) {
  assert(task.includes(`export function ${name}`), `${name} lives in task activity module`);
  assert(!chat.includes(`function ${name}`), `${name} is not defined inline in chat.tsx`);
}
assert(chat.includes('./chat/task-activity'), "chat imports task activity helpers");
console.log("✅ Task activity decomposition smoke test passed.");
