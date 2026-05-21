import fs from "node:fs";

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ${message}`);
    process.exit(1);
  }
  console.log(`✅ ${message}`);
}

const executor = fs.readFileSync("lib/operator-executor.ts", "utf8");
const tasks = fs.readFileSync("lib/tasks.ts", "utf8");
const chat = fs.readFileSync("app/api/chat/route.ts", "utf8");

assert(executor.includes("createOperatorExecutionPlan"), "executor normalizes tasks into execution plans");
assert(executor.includes("claimWorkspaceTaskForRunner"), "executor claims tasks through a lease guard");
assert(executor.includes("forbiddenActions"), "execution plans declare forbidden actions");
assert(executor.includes("stop_before_pr"), "v1 explicitly stops before PR gates");
assert(executor.includes("createRepoActionProposal"), "executor bridges tasks into Repo Control proposals");
assert(executor.includes("addWorkspaceTaskCheckpoint"), "executor attaches proof/checkpoints to task state");
assert(!executor.includes("mergePullRequest") && !executor.includes("executeDeploymentControlAction"), "executor does not merge or deploy");
assert(tasks.includes("claimWorkspaceTaskForRunner"), "task system exposes a runner claim helper");
assert(chat.includes("execute_operator_remediation_task"), "chat exposes workspace-aware executor bridge tool");
console.log("✅ Operator executor bridge smoke test passed.");
