import fs from "node:fs";
function assert(condition, message) { if (!condition) { console.error(`❌ ${message}`); process.exit(1); } console.log(`✅ ${message}`); }
const flow = fs.readFileSync("lib/safe-text-edit-flow.ts", "utf8");
const chat = fs.readFileSync("app/api/chat/route.ts", "utf8");
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
assert(flow.includes("runSafeTextEditFlow"), "Safe text edit flow helper exists");
assert(flow.includes("APPROVE SAFE TEXT EDIT"), "Safe text edit uses exact approval phrase");
assert(flow.includes("createRepoActionProposal"), "Safe text edit creates Repo Control proposal");
assert(flow.includes("updateRepoActionStatus"), "Safe text edit can approve proposal after exact phrase");
assert(flow.includes("runRepoControlFlow"), "Safe text edit runs Repo Control flow after approval");
assert(flow.includes("isRepoAllowed"), "Safe text edit checks repo allowlist");
assert(flow.includes("README\\.md|docs\\/"), "Safe text edit is limited to README/docs/Markdown files");
assert(flow.includes("MAX_REPLACEMENTS"), "Safe text edit limits replacement count");
assert(flow.includes("No merge or deploy happened"), "Safe text edit declares no merge/deploy");
assert(chat.includes("run_safe_text_edit_flow"), "Chat exposes safe text edit tool");
assert(chat.includes("prefer run_safe_text_edit_flow"), "Router hints teach Rune to use safe text edit for small replacements");
assert(pkg.scripts["test:safe-text-edit-flow"] === "node scripts/safe-text-edit-flow-smoke-test.mjs", "Package exposes safe text edit smoke test");
for (const forbidden of ["pulls.merge", "vercel deploy", "vercel rollback", "stripe.", "grantEntitlement(", "ALTER TABLE", "DROP TABLE", "dns.records.update", "sendCustomer"]){
  assert(!flow.includes(forbidden), `Safe text edit does not include ${forbidden}`);
}
console.log("✅ Safe text edit flow smoke test passed.");
