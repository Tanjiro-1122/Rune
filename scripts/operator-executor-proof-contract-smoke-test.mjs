import fs from "node:fs";
function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ${message}`);
    process.exit(1);
  }
  console.log(`✅ ${message}`);
}
const executor = fs.readFileSync("lib/operator-executor.ts", "utf8");
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
assert(executor.includes("verifyPullRequestProof"), "Operator executor imports PR completion verifier");
assert(executor.includes("completionEvidence?: RepoActionCompletionEvidence"), "Operator result exposes completion evidence");
assert(executor.includes("completionTruth?: RepoActionCompletionEvidence"), "Operator result exposes completion truth");
assert(executor.includes("completed?: boolean"), "Operator result exposes completed boolean");
assert(executor.includes("requiredProof: [\"pr\", \"merge\"]"), "Executor requires PR and merge proof for completion");
assert(executor.includes("completionEvidence?.completed ?? false"), "Executor defaults completed to false without proof");
assert(executor.includes("not_completed_yet_do_not_claim_done"), "Executor blocks done claims without proof");
assert(executor.includes("Merge/deploy were not performed"), "Executor states merge/deploy did not happen");
assert(executor.includes("metadata: { runnerId, proposalId: proposalResult.proposal.id, prUrl, steps, plan, completionEvidence"), "Checkpoint stores completion evidence metadata");
assert(pkg.scripts["test:operator-executor-proof-contract"] === "node scripts/operator-executor-proof-contract-smoke-test.mjs", "Package exposes operator proof contract smoke test");
for (const forbidden of ["pulls.merge", "vercel deploy", "stripe.", "ALTER TABLE", "DROP TABLE", "dns.records.update", "sendCustomer"]) {
  assert(!executor.includes(forbidden), `Operator proof patch does not include ${forbidden}`);
}
console.log("✅ Operator executor proof contract smoke test passed.");
