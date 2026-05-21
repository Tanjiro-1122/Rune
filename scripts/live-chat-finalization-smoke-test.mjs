import fs from "node:fs";

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ${message}`);
    process.exit(1);
  }
  console.log(`✅ ${message}`);
}

const route = fs.readFileSync("app/api/chat/route.ts", "utf8");
assert(route.includes("Array.isArray(lastUserMessage.parts)"), "chat finalization guards missing parts array");
assert(route.includes("typeof lastUserContent === \"string\""), "chat finalization falls back to string content");
assert(route.includes("Array.isArray(lastUserContent)"), "chat finalization falls back to array content");
assert(!route.includes("const userContent = lastUserMessage.parts\n            .filter"), "unsafe direct parts.filter removed");
console.log("✅ Live chat finalization smoke test passed.");
