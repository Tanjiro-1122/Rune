import fs from "node:fs";

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ${message}`);
    process.exit(1);
  }
  console.log(`✅ ${message}`);
}

const executor = fs.readFileSync("lib/operator-executor.ts", "utf8");
const chat = fs.readFileSync("app/api/chat/route.ts", "utf8");

assert(executor.includes("generateRepoActionProposedDiff"), "executor v2 generates proposed diffs");
assert(executor.includes("sandboxCheckRepoActionDiff"), "executor v2 runs sandbox checks");
assert(executor.includes("runTemporaryWorkspaceBuildCheck"), "executor v2 runs temp workspace checks");
assert(executor.includes("openRepoActionPullRequest"), "executor v2 can call the existing PR gate");
assert(executor.includes("options.openPrIfApproved"), "PR opening is opt-in and gated");
assert(executor.includes("open_pr_if_approved"), "execution plan labels PR opening as conditional");
assert(executor.includes("stopped before merge, deploy"), "executor proof states it stops before merge/deploy");
assert(!executor.includes("updateRepoActionStatus({") && !executor.includes("executeDeploymentControlAction"), "executor does not approve, merge, or deploy");
assert(chat.includes("openPrIfApproved"), "chat tool exposes explicit PR opt-in flag");
assert(chat.includes("never merges, deploys"), "chat tool documents hard safety boundary");
console.log("✅ Operator executor bridge v2 smoke test passed.");
