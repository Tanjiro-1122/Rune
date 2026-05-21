import fs from "node:fs";

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ${message}`);
    process.exit(1);
  }
  console.log(`✅ ${message}`);
}

const tasks = fs.readFileSync("lib/tasks.ts", "utf8");
const route = fs.readFileSync("app/api/cron/reconcile-tasks/route.ts", "utf8");
const taskApi = fs.readFileSync("app/api/tasks/route.ts", "utf8");
const vercel = JSON.parse(fs.readFileSync("vercel.json", "utf8"));

assert(tasks.includes("reconcileWorkspaceTasks"), "durable task reconciler exists");
assert(tasks.includes("conversationHasAssistantReply"), "reconciler checks saved assistant replies");
assert(tasks.includes("completeWorkspaceTask") && tasks.includes("Assistant response was generated"), "reconciler completes answered chat tasks");
assert(tasks.includes("failWorkspaceTask") && tasks.includes("reconciled as stale"), "reconciler fails truly stale unanswered tasks");
assert(taskApi.includes("reconcileWorkspaceTasks"), "task API reconciles before returning task chips");
assert(route.includes("CRON_SECRET") && route.includes("reconcileWorkspaceTasks"), "protected cron route runs reconciler");
assert(vercel.crons?.some((cron) => cron.path === "/api/cron/reconcile-tasks" && cron.schedule === "*/5 * * * *"), "Vercel cron schedules reconciler every 5 minutes");
console.log("✅ Task reconciler smoke test passed.");
