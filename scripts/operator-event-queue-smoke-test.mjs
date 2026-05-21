import fs from "node:fs";

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ${message}`);
    process.exit(1);
  }
  console.log(`✅ ${message}`);
}

const queue = fs.readFileSync("lib/operator-event-queue.ts", "utf8");
const route = fs.readFileSync("app/api/cron/operator-events/route.ts", "utf8");

assert(queue.includes("enqueueOperatorEvent"), "event queue exposes enqueueOperatorEvent");
assert(queue.includes("runOperatorEventQueueHealthSweep"), "event queue exposes health sweep processor");
assert(queue.includes("getAppHealthSnapshot"), "event queue ingests health snapshot findings");
assert(queue.includes("createQueuedWorkspaceJob"), "event queue creates queued workspace jobs, not ad hoc tasks");
assert(queue.includes("operatorEventKey"), "event queue stores idempotency keys in runner metadata");
assert(queue.includes("matching queued/running task already exists"), "event queue skips duplicate active tasks");
assert(queue.includes("RUNE_DEFAULT_WORKSPACE_ID"), "event queue requires explicit/default workspace context");
assert(queue.includes("operator_executor_bridge_v3"), "event queue routes safe actions to executor bridge metadata");
assert(!queue.includes("runOperatorExecutorBridge("), "event queue does not execute tasks directly");
assert(!queue.includes("openRepoActionPullRequest") && !queue.includes("executeDeploymentControlAction"), "event queue adds no PR/deploy powers");
assert(route.includes("CRON_SECRET"), "operator event cron route is protected");
console.log("✅ Operator event queue smoke test passed.");
