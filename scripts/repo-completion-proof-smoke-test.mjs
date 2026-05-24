import fs from "node:fs";
function assert(condition, message) { if (!condition) { console.error(`❌ ${message}`); process.exit(1); } console.log(`✅ ${message}`); }
const flow = fs.readFileSync("lib/safe-text-edit-flow.ts", "utf8");
const chat = fs.readFileSync("app/api/chat/route.ts", "utf8");
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
assert(flow.includes("completed: boolean"), "Safe text edit result has completed boolean");
assert(flow.includes("completionState"), "Safe text edit result has completion state");
assert(flow.includes("completionProof"), "Safe text edit result carries completion proof");
assert(flow.includes("proposal_created_not_applied"), "Proposal-only state is not treated as applied");
assert(flow.includes("pr_opened_not_merged"), "PR-opened state is not treated as merged");
assert(flow.includes("Default branch is not changed until merge"), "PR state explains default branch is unchanged");
assert(chat.includes("success: result.completed"), "Chat tool success follows completion, not mere action success");
assert(chat.includes("actionSucceeded: result.ok"), "Chat still exposes action success separately");
assert(chat.includes("not_completed_yet_do_not_claim_file_changed"), "Chat result explicitly blocks false completion claims");
assert(chat.includes("Repo completion truth rule"), "System prompt includes repo completion truth rule");
assert(chat.includes("Creating a proposal is not completion"), "System prompt says proposal is not completion");
assert(chat.includes("Opening a PR is not the same as changing main"), "System prompt says PR is not main change");
assert(pkg.scripts["test:repo-completion-proof"] === "node scripts/repo-completion-proof-smoke-test.mjs", "Package exposes repo completion proof test");
for (const forbidden of ["pulls.merge", "vercel deploy", "stripe.", "ALTER TABLE", "dns.records.update", "sendCustomer"]){
  assert(!flow.includes(forbidden), `Completion proof patch does not add ${forbidden}`);
}
console.log("✅ Repo completion proof smoke test passed.");
