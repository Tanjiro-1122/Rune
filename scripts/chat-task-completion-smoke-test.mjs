import fs from "node:fs";

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ${message}`);
    process.exit(1);
  }
  console.log(`✅ ${message}`);
}

const route = fs.readFileSync("app/api/chat/route.ts", "utf8");

assert(route.includes("withChatFinishTimeout("), "onFinish persistence uses timeout guard");
assert(route.includes("timeout.completeTask"), "timeout fallback completes visible task");
assert(route.includes("Answer generated. Final persistence timed out"), "timeout fallback records generated-answer summary");
assert(route.includes("hasGeneratedText"), "persistence error distinguishes generated text from true failure");
assert(route.includes("persistence.completeTask"), "generated-text persistence error completes task instead of leaving running");
console.log("✅ Chat task completion smoke test passed.");
