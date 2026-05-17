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
const ui = fs.readFileSync("components/chat.tsx", "utf8");

const plannerStart = lib.indexOf("export type SessionFragmentMergePlanResult");
assert(plannerStart > 0, "merge planner result type exists");
const planner = lib.slice(plannerStart);

assert(planner.includes("planJarvisSessionFragmentMerge"), "merge planner function exists");
assert(planner.includes("dryRun: true"), "planner is explicitly dry-run");
assert(planner.includes("readOnly: true"), "planner is explicitly read-only");
assert(planner.includes("APPROVE JARVIS SESSION MERGE"), "planner requires separate merge approval phrase");
assert(planner.includes("Planner only. No merge executor is implemented by this tool."), "planner states there is no executor");
assert(planner.includes("messageRowsUpdatedDirectly: 0"), "planner does not propose direct message edits");
assert(planner.includes("messageContentRead: false"), "planner does not read message content");
assert(planner.includes("No merge, update, delete, insert, upsert, RPC, or schema mutation"), "planner declares no-mutation boundary");

for (const needle of [".insert(", ".update(", ".delete(", ".upsert(", "rpc("]) {
  assert(!planner.includes(needle), `planner contains no ${needle}`);
}

assert(chat.includes("plan_jarvis_fragmented_session_merge"), "chat exposes merge planner tool");
assert(chat.includes("execute: async () => planJarvisSessionFragmentMerge()"), "chat tool calls planner only");
assert(chat.includes("must never imply it executed the merge"), "system prompt blocks merge execution claims");
assert(chat.includes("or implemented a merge executor"), "system prompt blocks executor claims");
assert(!chat.includes("execute_jarvis_session_merge"), "no merge executor tool exists");

assert(ui.includes("SessionFragmentMergePlanCard"), "merge planner UI card exists");
assert(ui.includes("planner-only dry run"), "UI shows planner-only mode");
assert(ui.includes("no merge/update/delete/insert/upsert/RPC/schema changes"), "UI shows mutation boundary");

console.log("✅ Session fragmentation merge planner smoke test passed.");
