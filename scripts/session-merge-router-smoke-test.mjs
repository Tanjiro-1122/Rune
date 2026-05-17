import fs from "node:fs";

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ${message}`);
    process.exit(1);
  }
  console.log(`✅ ${message}`);
}

const chat = fs.readFileSync("app/api/chat/route.ts", "utf8");

assert(chat.includes('const JARVIS_SESSION_MERGE_APPROVAL_PHRASE = "APPROVE JARVIS SESSION MERGE"'), "exact approval phrase constant exists");
assert(chat.includes("function isApprovedJarvisSessionMergeIntent"), "session merge intent detector exists");
assert(chat.includes("input.includes(JARVIS_SESSION_MERGE_APPROVAL_PHRASE)"), "detector requires exact phrase substring");
assert(chat.includes('return { type: "tool", toolName: "execute_jarvis_session_merge" };'), "forced tool choice routes to merge executor");
const forcedChoiceStart = chat.indexOf("function getForcedToolChoice");
const forcedChoiceEnd = chat.indexOf("function buildRoutingHint");
const forcedChoice = chat.slice(forcedChoiceStart, forcedChoiceEnd);
assert(forcedChoice.indexOf("isApprovedJarvisSessionMergeIntent(input)") < forcedChoice.indexOf("isCodeExecutionIntent(input, codeExecutionAvailable)"), "merge approval route runs before generic code execution routing");
assert(forcedChoice.indexOf("isApprovedJarvisSessionMergeIntent(input)") < forcedChoice.indexOf("isCalculationIntent(input)"), "merge approval route runs before calculator routing");
assert(chat.includes("Do not call capability snapshot first"), "routing hint blocks capability snapshot detour");
assert(chat.includes("call execute_jarvis_session_merge immediately"), "system prompt forces executor on exact phrase");
assert(chat.includes("approvalPhrase: z.string"), "executor still requires explicit approvalPhrase parameter");
assert(chat.includes("Must exactly equal APPROVE JARVIS SESSION MERGE"), "tool schema documents exact phrase requirement");

assert(forcedChoice.includes("execute_jarvis_session_merge"), "forced tool choice includes executor");
assert(!forcedChoice.includes('toolName: "get_jarvis_capability_snapshot"'), "forced choice does not route approval phrase to capability snapshot");

console.log("✅ Session merge router smoke test passed.");
