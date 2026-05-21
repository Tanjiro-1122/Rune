import fs from "node:fs";

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ${message}`);
    process.exit(1);
  }
  console.log(`✅ ${message}`);
}

const vercel = JSON.parse(fs.readFileSync("vercel.json", "utf8"));
const crons = Array.isArray(vercel.crons) ? vercel.crons : [];
const operatorCron = crons.find((cron) => cron.path === "/api/cron/operator-events");
const route = fs.readFileSync("app/api/cron/operator-events/route.ts", "utf8");
const queue = fs.readFileSync("lib/operator-event-queue.ts", "utf8");

assert(Boolean(operatorCron), "operator event cron is registered in vercel.json");
assert(operatorCron.schedule === "*/30 * * * *", "operator event cron runs every 30 minutes");
assert(route.includes("CRON_SECRET"), "operator event cron route requires CRON_SECRET auth");
assert(queue.includes("RUNE_DEFAULT_WORKSPACE_ID"), "operator queue uses default workspace env for background tasks");
assert(!queue.includes("runOperatorExecutorBridge("), "cron queue still does not directly execute tasks");
console.log("✅ Operator event cron config smoke test passed.");
