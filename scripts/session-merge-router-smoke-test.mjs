import fs from "node:fs";

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ${message}`);
    process.exit(1);
  }
  console.log(`✅ ${message}`);
}

const chat = fs.readFileSync("app/api/chat/route.ts", "utf8");

assert(chat.includes('const RUNE_SESSION_MERGE_APPROVAL_PHRASE = "APPROVE RUNE SESSION MERGE"'), "exact approval phrase constant exists");
assert(chat.includes("function isApprovedRuneSessionMergeIntent"), "session merge intent detector exists");
assert(chat.includes("input.includes(RUNE_SESSION_MERGE_APPROVAL_PHRASE)"), "detector requires exact phrase substring");
assert(chat.includes('return { type: "tool", toolName: "execute_rune_session_merge" };'), "forced tool choice routes to merge executor");
const forcedChoiceStart = chat.indexOf("function getForcedToolChoice");
const forcedChoiceEnd = chat.indexOf("function buildRoutingHint");
const forcedChoice = chat.slice(forcedChoiceStart, forcedChoiceEnd);
assert(forcedChoice.indexOf("isApprovedRuneSessionMergeIntent(input)") < forcedChoice.indexOf("isCodeExecutionIntent(input, codeExecutionAvailable)"), "merge approval route runs before generic code execution routing");
assert(!forcedChoice.includes("isCalculationIntent(input)"), "calculator is not forced in forced tool choice loop");
const routingHintStart = chat.indexOf("function buildRoutingHint");
const routingHintEnd = chat.indexOf("function getAllowedToolNames");
const routingHint = chat.slice(routingHintStart, routingHintEnd);
assert(routingHint.indexOf("isApprovedRuneSessionMergeIntent(input)") < routingHint.indexOf("isCalculationIntent(input)"), "merge approval hint runs before calculator hint");
assert(chat.includes("Do not call capability snapshot first"), "routing hint blocks capability snapshot detour");
assert(chat.includes("call execute_rune_session_merge immediately"), "system prompt forces executor on exact phrase");
assert(chat.includes("approvalPhrase: z.string"), "executor still requires explicit approvalPhrase parameter");
assert(chat.includes("Must exactly equal APPROVE RUNE SESSION MERGE"), "tool schema documents exact phrase requirement");

assert(forcedChoice.includes("execute_rune_session_merge"), "forced tool choice includes executor");
assert(!forcedChoice.includes('toolName: "get_rune_capability_snapshot"'), "forced choice does not route approval phrase to capability snapshot");

console.log("✅ Session merge router smoke test passed.");
