import fs from "node:fs";
function assert(condition, message) { if (!condition) { console.error(`❌ ${message}`); process.exit(1); } console.log(`✅ ${message}`); }
const verifier = fs.readFileSync("lib/repo-action-completion-verifier.ts", "utf8");
const safeFile = fs.readFileSync("lib/safe-file-create-flow.ts", "utf8");
const safeText = fs.readFileSync("lib/safe-text-edit-flow.ts", "utf8");
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
assert(verifier.includes("RepoActionCompletionEvidence"), "Verifier defines completion evidence contract");
assert(verifier.includes('completionTruth: "completed_with_proof" | "not_completed_yet_do_not_claim_done"'), "Verifier encodes proof-first completion truth");
assert(verifier.includes("verifyPullRequestProof"), "Verifier checks GitHub PR proof");
assert(verifier.includes("verifyDefaultBranchFileProof"), "Verifier checks default-branch file proof");
assert(verifier.includes("isRepoAllowed"), "Verifier enforces repo allowlist");
assert(verifier.includes("merged_at") && verifier.includes("merge_commit_sha"), "Verifier distinguishes PR opened from merged");
assert(verifier.includes("missingProof"), "Verifier reports missing proof instead of pretending completion");
assert(safeFile.includes("verifyPullRequestProof"), "Safe file create validates PR proof after opening PR");
assert(safeText.includes("verifyPullRequestProof"), "Safe text edit validates PR proof after opening PR");
assert(safeFile.includes("completed: false") && safeText.includes("completed: false"), "Safe flows still refuse to call PR-opened state complete");
assert(pkg.scripts["test:repo-action-completion-verifier"] === "node scripts/repo-action-completion-verifier-smoke-test.mjs", "Package exposes verifier smoke test");
for (const forbidden of ["pulls.merge", "vercel deploy", "stripe.", "ALTER TABLE", "DROP TABLE", "dns.records.update", "sendCustomer"]){
  assert(!verifier.includes(forbidden), `Verifier does not include ${forbidden}`);
}
console.log("✅ Repo action completion verifier smoke test passed.");
