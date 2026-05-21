import fs from "node:fs";

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ${message}`);
    process.exit(1);
  }
  console.log(`✅ ${message}`);
}

const registry = fs.readFileSync("lib/project-registry.ts", "utf8");
const chat = fs.readFileSync("app/api/chat/route.ts", "utf8");
const targeting = fs.readFileSync("lib/repo-targeting.ts", "utf8");

assert(registry.includes("resolveProjectContext"), "central project resolver exists");
assert(registry.includes("ProjectResolutionResult"), "resolver returns structured confidence result");
assert(registry.includes("confidence >= 60") && registry.includes("confidence < 85"), "resolver encodes act/assumption confidence threshold");
assert(registry.includes("Base44 severance") && registry.includes("global_operation"), "Base44 severance resolves as all-project operation");
assert(registry.includes("Do not ask which project") && registry.includes("Do not ask which app"), "Base44 severance prompt blocks unnecessary clarification");
assert(registry.includes("recent_context"), "resolver supports recent project fallback");
assert(chat.includes("resolveProjectContext({ text: latestUserText })"), "chat route resolves project before model prompt");
assert(chat.includes("projectResolutionSection"), "chat prompt includes resolution guidance");
assert(targeting.includes("resolveProjectContext"), "repo targeting uses central resolver");
console.log("✅ Project resolver smoke test passed.");
