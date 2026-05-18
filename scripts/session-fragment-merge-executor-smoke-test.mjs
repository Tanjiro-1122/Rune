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

const executorStart = lib.indexOf("export type SessionFragmentMergeExecutionResult");
assert(executorStart > 0, "merge executor result type exists");
const executor = lib.slice(executorStart);

assert(executor.includes("executeRuneSessionFragmentMerge"), "merge executor function exists");
assert(executor.includes('approvalPhrase !== "APPROVE RUNE SESSION MERGE"'), "executor requires exact approval phrase");
assert(executor.includes("Blocked: exact approval phrase was not provided."), "wrong phrase is blocked before mutations");
assert(executor.includes('from("conversations")'), "executor can update conversation ownership metadata");
assert(executor.includes('from("workspaces")'), "executor can update workspace ownership metadata");
assert(executor.includes('from("workspace_memberships")'), "executor can attach owner workspace memberships");
assert(executor.includes('from("workspace_events")'), "executor can normalize workspace event session metadata");
assert(!executor.includes('from("messages").update'), "executor never updates message rows");
assert(!executor.includes('from("messages").select("content'), "executor never selects message content");
assert(!executor.includes('content_text'), "executor never reads workspace document content");
assert(executor.includes("messageRowsUpdated: 0"), "executor reports zero message row updates");
assert(executor.includes("messageContentRead: false"), "executor reports no message content reads");
assert(executor.includes("deletesPerformed: 0"), "executor reports zero deletes");
assert(executor.includes("schemaMutationsPerformed: 0"), "executor reports zero schema mutations");
assert(!executor.includes('.delete('), "executor contains no delete calls");
assert(!executor.includes('rpc('), "executor contains no RPC calls");

assert(chat.includes("execute_rune_session_merge"), "chat exposes approved merge executor tool");
assert(chat.includes("approvalPhrase: z.string"), "chat tool requires explicit approval phrase parameter");
assert(chat.includes("Must exactly equal APPROVE RUNE SESSION MERGE"), "tool schema documents exact phrase");
assert(chat.includes("must never read message content, update message rows, delete rows, mutate schema"), "system prompt states executor boundaries");

assert(ui.includes("SessionFragmentMergeExecutionCard"), "execution UI card exists");
assert(ui.includes("exact approval only"), "UI shows exact approval boundary");
assert(ui.includes("no message content/message row edits/deletes/schema changes"), "UI shows mutation boundaries");

console.log("✅ Session fragmentation merge executor smoke test passed.");
