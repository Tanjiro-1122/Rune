import fs from "node:fs";
import assert from "node:assert/strict";

const requiredTables = [
  "agent_memories",
  "agent_memory_events",
  "rune_action_events",
  "workspace_tasks",
  "workspace_task_runs",
  "rune_tasks",
  "rune_reminders",
  "rune_outbox",
  "briefing_log",
];

const requiredRuntimeEnv = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
];

const files = {
  schema: fs.readFileSync("supabase/schema.sql", "utf8"),
  missingTables: fs.existsSync("supabase/migrations/20260520_missing_tables.sql")
    ? fs.readFileSync("supabase/migrations/20260520_missing_tables.sql", "utf8")
    : "",
  deployHealth: fs.readFileSync("lib/deploy-health.ts", "utf8"),
  memory: fs.readFileSync("lib/memory.ts", "utf8"),
  actions: fs.readFileSync("lib/action-events.ts", "utf8"),
  tasks: fs.readFileSync("lib/tasks.ts", "utf8"),
  selfTest: fs.readFileSync("app/api/self-test/route.ts", "utf8"),
};

const combinedSchema = `${files.schema}\n${files.missingTables}`;
for (const table of requiredTables) {
  assert(
    combinedSchema.includes(table),
    `Supabase schema/migrations must document required persistence table: ${table}`,
  );
}

for (const envName of requiredRuntimeEnv) {
  assert(
    files.deployHealth.includes(envName) || files.selfTest.includes(envName),
    `Runtime health/self-test must expose missing ${envName} as a blocker`,
  );
}

assert(files.memory.includes("agent_memories"), "Memory helper must use agent_memories");
assert(files.actions.includes("rune_action_events"), "Action event helper must use rune_action_events");
assert(files.tasks.includes("workspace_tasks"), "Task helper must use workspace_tasks");
assert(files.selfTest.includes("agent_memories"), "Self-test must verify memory table reachability");
assert(files.deployHealth.includes("workspace_tasks"), "Deploy health must verify workspace_tasks table reachability");
assert(files.deployHealth.includes("agent_memories"), "Deploy health must verify agent_memories table reachability");

console.log("Supabase persistence proof contract smoke test passed.");
console.log(`Required tables: ${requiredTables.join(", ")}`);
console.log("Runtime proof still requires production /api/self-test?suite=supabase and /api/deploy-health evidence.");
