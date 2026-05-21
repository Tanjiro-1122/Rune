import fs from "node:fs";

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ${message}`);
    process.exit(1);
  }
  console.log(`✅ ${message}`);
}

const orchestration = fs.readFileSync("lib/orchestration.ts", "utf8");
assert(orchestration.includes("Array.isArray(lastUserMessage.parts)"), "latest user text guards missing parts array");
assert(orchestration.includes("typeof lastUserMessage.content === \"string\""), "latest user text falls back to string content");
assert(!orchestration.includes("return lastUserMessage.parts\n    .filter"), "unsafe latest-user parts.filter removed");
console.log("✅ Live chat orchestration smoke test passed.");
