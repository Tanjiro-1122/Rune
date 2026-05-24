import fs from "node:fs";
function assert(condition, message) { if (!condition) { console.error(`❌ ${message}`); process.exit(1); } console.log(`✅ ${message}`); }
const ledger = fs.readFileSync("lib/operator-completion-ledger.ts", "utf8");
const briefing = fs.readFileSync("lib/operator-briefing.ts", "utf8");
const chat = fs.readFileSync("components/chat.tsx", "utf8");
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
assert(ledger.includes("getOperatorCompletionLedger"), "Completion ledger helper exists");
assert(ledger.includes("octokit.pulls.list"), "Completion ledger reads GitHub PR metadata");
assert(ledger.includes('state: "closed"'), "Completion ledger reads closed PRs");
assert(ledger.includes("pull.merged_at"), "Completion ledger filters merged PRs");
assert(ledger.includes("[redacted]"), "Completion ledger redacts token-like secrets from summaries");
assert(ledger.includes("Completion Ledger is read-only."), "Completion ledger declares read-only boundary");
assert(ledger.includes("It does not create PRs, merge, deploy, rollback, mutate schemas, change payments, or contact customers."), "Completion ledger forbids mutating actions");
assert(briefing.includes("getOperatorCompletionLedger"), "Briefing includes completion ledger");
assert(briefing.includes("completionLedger"), "Briefing payload exposes completion ledger");
assert(chat.includes("Completed:"), "Operator UI surfaces completion ledger summary");
assert(pkg.scripts["test:operator-completion-ledger"] === "node scripts/operator-completion-ledger-smoke-test.mjs", "Package exposes completion ledger smoke test");
for (const forbidden of [".insert(", ".update(", ".upsert(", ".delete(", "openRepoActionPullRequest(", "createRepoActionProposal(", "vercel --prod", "stripe", "grantEntitlement"]) {
  assert(!ledger.includes(forbidden), `Completion ledger helper does not call ${forbidden}`);
}
console.log("✅ Operator completion ledger smoke test passed.");
