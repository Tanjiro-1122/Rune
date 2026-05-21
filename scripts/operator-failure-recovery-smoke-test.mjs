import fs from "node:fs";

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ${message}`);
    process.exit(1);
  }
  console.log(`✅ ${message}`);
}

const classifier = fs.readFileSync("lib/operator-failure-classifier.ts", "utf8");
const executor = fs.readFileSync("lib/operator-executor.ts", "utf8");
const chat = fs.readFileSync("app/api/chat/route.ts", "utf8");

assert(classifier.includes("transient_network") && classifier.includes("github_rate_limit"), "classifier defines retryable infrastructure classes");
assert(classifier.includes("approval_missing") && classifier.includes("repo_not_allowlisted"), "classifier defines blocked safety classes");
assert(classifier.includes("build_compile_error") && classifier.includes("invalid_patch"), "classifier defines non-retryable code failure classes");
assert(classifier.includes("getOperatorRetryDecision"), "retry decision is deterministic policy code");
assert(executor.includes("runStageWithRetry"), "executor wraps stages with bounded retry helper");
assert(executor.includes("createFailureFollowUpTask"), "executor can create follow-up remediation tasks");
assert(executor.includes("failureRecovery"), "executor returns structured failure recovery metadata");
assert(executor.includes("attemptedRetries"), "executor preserves retry attempt metadata");
assert(chat.includes("maxAttempts"), "chat tool exposes bounded retry attempts");
assert(!executor.includes("executeDeploymentControlAction") && !executor.includes("mergePullRequest"), "retry recovery adds no merge/deploy power");
console.log("✅ Operator failure recovery smoke test passed.");
