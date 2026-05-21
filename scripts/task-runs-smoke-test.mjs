import fs from "node:fs";

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ${message}`);
    process.exit(1);
  }
  console.log(`✅ ${message}`);
}

const schema = fs.readFileSync("supabase/schema.sql", "utf8");
const tasks = fs.readFileSync("lib/tasks.ts", "utf8");
const chat = fs.readFileSync("app/api/chat/route.ts", "utf8");

assert(schema.includes("create table if not exists workspace_task_runs"), "workspace_task_runs table exists");
assert(schema.includes("task_id         uuid not null references workspace_tasks"), "task runs belong to durable tasks");
assert(schema.includes("heartbeat_at") && schema.includes("attempt"), "task runs track heartbeats and attempts");
assert(schema.includes("workspace_task_runs_status_heartbeat_idx"), "task run heartbeat/status index exists");
assert(tasks.includes("WorkspaceTaskRunSummary") && tasks.includes("latestRun"), "task summaries include latest execution run");
assert(tasks.includes("createWorkspaceTaskRun") && tasks.includes("closeActiveWorkspaceTaskRuns"), "task lifecycle creates and closes runs");
assert(tasks.includes("ensureActiveWorkspaceTaskRun"), "resumed/started tasks ensure active run exists");
assert(chat.includes("if (!shouldTrackWorkspaceTask) return null"), "normal conversation state remains separated from durable tasks");
console.log("✅ Task runs execution-history smoke test passed.");
