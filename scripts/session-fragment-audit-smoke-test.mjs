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
const audit = lib.slice(0, plannerStart > 0 ? plannerStart : undefined);

assert(audit.includes("auditRuneSessionFragments"), "fragment audit library exists");
assert(audit.includes("RUNE_OWNER_SESSION_ID"), "audit recognizes unified owner session");
assert(audit.includes('from("conversations")'), "audit reads conversations metadata");
assert(audit.includes('from("messages")'), "audit counts message records");
assert(audit.includes('select("conversation_id, created_at")'), "audit does not select message content");
assert(!audit.includes('select("conversation_id, content'), "audit never selects message content");
assert(!audit.includes('.insert('), "audit performs no inserts");
assert(!audit.includes('.update('), "audit performs no updates");
assert(!audit.includes('.delete('), "audit performs no deletes");
assert(!audit.includes('.upsert('), "audit performs no upserts");
assert(!/rpc\s*\(/.test(audit), "audit performs no SQL RPC mutations");
assert(audit.includes("Read-only Supabase select queries only."), "audit reports read-only boundary");
assert(audit.includes("No message content is returned."), "audit reports message-content boundary");
assert(audit.includes("No merge, update, delete, insert, or schema mutation"), "audit reports no-mutation boundary");
assert(chat.includes("audit_rune_session_fragments"), "chat exposes audit tool");
assert(chat.includes("execute: async () => auditRuneSessionFragments()"), "chat tool calls read-only audit library");
assert(chat.includes("never reads message content"), "system prompt documents audit read-only content boundary");
assert(chat.includes("never reads message content, merges sessions"), "system prompt blocks merge claims");
assert(ui.includes("SessionFragmentAuditCard"), "UI card exists");
assert(ui.includes("read-only · no message content"), "UI card shows read-only mode");
assert(ui.includes("no merge/update/delete/schema changes"), "UI card shows safety boundary");
console.log("✅ Session fragmentation audit smoke test passed.");
