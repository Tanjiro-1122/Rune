import fs from "node:fs";

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ${message}`);
    process.exit(1);
  }
  console.log(`✅ ${message}`);
}

const route = fs.readFileSync("app/api/cron/operator-executor/route.ts", "utf8");
const vercel = fs.readFileSync("vercel.json", "utf8");
const queue = fs.readFileSync("lib/operator-event-queue.ts", "utf8");

assert(route.includes("CRON_SECRET"), "executor cron is protected by CRON_SECRET");
assert(route.includes("RUNE_DEFAULT_WORKSPACE_ID") && route.includes("JARVIS_DEFAULT_WORKSPACE_ID"), "executor cron uses default workspace env fallback");
assert(route.includes('metadata?.executor === "operator_executor_bridge_v3"'), "executor cron only claims operator executor tasks");
assert(route.includes("metadata?.approvalRequired !== true"), "executor cron skips approval-required tasks");
assert(route.includes("openPrIfApproved: false"), "executor cron cannot open PRs automatically");
assert(route.includes("trackPrIfOpened: false"), "executor cron does not track PRs from cron");
assert(!/(mergeRepoAction|openRepoActionPullRequest|deployProduction|redeploy|rollback|deleteProduction|runDatabaseMigration|grantEntitlement)\s*\(/i.test(route), "executor cron contains no unsafe PR/merge/deploy/external mutation calls");
assert(vercel.includes('"path": "/api/cron/operator-executor"'), "Vercel schedules operator executor cron");
assert(queue.includes('"family"'), "operator event sweep includes Family project");
console.log("✅ Operator executor cron smoke test passed.");
