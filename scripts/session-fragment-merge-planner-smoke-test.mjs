import fs from "node:fs";

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ${message}`);
    process.exit(1);
  }
  console.log(`✅ ${message}`);
}

const lib = fs.readFileSync("lib/session-fragment-audit.ts", "utf8");
const chat = fs.readFileSync("app/api/chat/route.ts", "utf8");
const ui = fs.readFileSync("components/chat.tsx", "utf8") + "\n" + fs.readFileSync("components/chat/tool-cards.tsx", "utf8");

const plannerStart = lib.indexOf("export type SessionFragmentMergePlanResult");
assert(plannerStart > 0, "merge planner result type exists");
const executorStart = lib.indexOf("export type SessionFragmentMergeExecutionResult");
const planner = lib.slice(plannerStart, executorStart > plannerStart ? executorStart : undefined);

assert(planner.includes("planRuneSessionFragmentMerge"), "merge planner function exists");
assert(planner.includes("dryRun: true"), "planner is explicitly dry-run");
assert(planner.includes("readOnly: true"), "planner is explicitly read-only");
assert(planner.includes("APPROVE RUNE SESSION MERGE"), "planner requires separate merge approval phrase");
assert(planner.includes("Planner only. No merge executor is implemented by this tool."), "planner states there is no executor");
assert(planner.includes("messageRowsUpdatedDirectly: 0"), "planner does not propose direct message edits");
assert(planner.includes("messageContentRead: false"), "planner does not read message content");
assert(planner.includes("No merge, update, delete, insert, upsert, RPC, or schema mutation"), "planner declares no-mutation boundary");

for (const needle of [".insert(", ".update(", ".delete(", ".upsert(", "rpc("]) {
  assert(!planner.includes(needle), `planner contains no ${needle}`);
}

assert(chat.includes("plan_rune_fragmented_session_merge"), "chat exposes merge planner tool");
assert(chat.includes("execute: async () => planRuneSessionFragmentMerge()"), "chat tool calls planner only");
assert(chat.includes("execute_rune_session_merge") && chat.includes("never reads message content"), "system prompt/tool description blocks merge execution claims");
assert(chat.includes("execute_rune_session_merge") && chat.includes("APPROVE RUNE SESSION MERGE"), "system prompt/tool description blocks executor claims");
assert(chat.includes("execute_rune_session_merge"), "approved merge executor tool exists separately from planner");
assert(chat.includes("approvalPhrase: z.string"), "separate executor requires explicit approval phrase");

assert(ui.includes("session") && ui.includes("merge") || ui.includes("fragment"), "merge planner UI/card handling exists");
assert(ui.includes("planner") || ui.includes("dry run") || ui.includes("read-only"), "UI/tool card shows planner-only mode");
assert(ui.includes("no merge") || ui.includes("read-only") || ui.includes("mutation"), "UI/tool card shows mutation boundary");

console.log("✅ Session fragmentation merge planner smoke test passed.");
