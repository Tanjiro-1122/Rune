import fs from "node:fs";

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ${message}`);
    process.exit(1);
  }
  console.log(`✅ ${message}`);
}

const chat = fs.readFileSync("components/chat.tsx", "utf8");
const css = ["app/chat-mobile.css", "app/operator.css", "app/ui-components.css", "app/globals.css"].map((file) => fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "").join("\n");

assert(chat.includes("interface OperatorBriefingSnapshot"), "Operator briefing UI type exists");
assert(chat.includes("const [operatorBriefing, setOperatorBriefing]"), "Operator briefing state exists");
assert(chat.includes("async function refreshOperatorBriefing"), "Operator briefing refresh helper exists");
assert(chat.includes('fetch("/api/operator-briefing")'), "Operator briefing fetches GET-only route");
assert(chat.includes("refreshOperatorBriefing().catch"), "Operator console refresh includes briefing without blocking all signals");
assert(chat.includes('data-testid="operator-briefing-card"'), "Operator briefing card test id exists");
assert(chat.includes("Today’s Briefing"), "Operator briefing card label exists");
assert(chat.includes("Daily Operator Briefing"), "Operator briefing empty state copy exists");
assert(chat.includes("normalizeBriefingForDisplay"), "Operator briefing card has a display normalizer");
assert(chat.includes("displayedOperatorBriefing"), "Operator briefing card renders normalized display payload");
assert(chat.includes('overallStatus: "warning"'), "Operator briefing display normalizer can downgrade visibility-only blockers to warning");
assert(chat.includes("isExternalServiceVisibilityOnlyText"), "Operator briefing UI detects external-service visibility-only text");
assert(chat.includes("displayedOperatorBriefing.projects.length"), "Operator briefing summarizes project count");
assert(chat.includes("displayedOperatorBriefing.proposals.length"), "Operator briefing summarizes proposal count");
assert(chat.includes("displayedOperatorBriefing.tasks.length"), "Operator briefing summarizes task count");
assert(chat.includes("displayedOperatorBriefing.memory.agentMemoriesReachable"), "Operator briefing surfaces memory reachability");
assert(chat.includes("selectedBriefingProject"), "Operator briefing project-specific warning summary exists");
assert(chat.includes("<strong>{operatorSignalCount}</strong> signals loaded"), "Operator signal count avoids stale denominator");
assert(!chat.includes("operatorSignalCount}/5"), "Operator signal count does not hardcode five signals");

assert(css.includes(".operator-briefing-card"), "Operator briefing card CSS exists");
assert(css.includes(".operator-briefing-meta"), "Operator briefing metadata CSS exists");
assert(css.includes("@media (max-width: 820px)"), "Operator briefing card has mobile handling");

const briefingHelperStart = chat.indexOf("async function refreshOperatorBriefing");
const briefingHelperEnd = chat.indexOf("async function refreshOperatorConsole", briefingHelperStart);
const briefingCardStart = chat.indexOf('data-testid="operator-briefing-card"');
const briefingCardEnd = chat.indexOf('<article className="operator-summary-card operator-summary-card--primary">', briefingCardStart);
assert(briefingHelperStart >= 0 && briefingHelperEnd > briefingHelperStart, "Operator briefing helper slice is detectable");
assert(briefingCardStart >= 0 && briefingCardEnd > briefingCardStart, "Operator briefing card slice is detectable");
const briefingOnly = `${chat.slice(briefingHelperStart, briefingHelperEnd)}
${chat.slice(briefingCardStart, briefingCardEnd)}`;

for (const forbidden of [
  "execute_redeploy",
  "execute_rollback",
  "run_approved_repo_action(",
  "commitChangesDirectly(",
  "deployment_control",
  "vercel --prod",
  "openRepoActionPullRequest(",
  "runApprovedRepoActionExecutor(",
]) {
  assert(!briefingOnly.includes(forbidden), `Operator briefing UI does not wire direct mutating click for ${forbidden}`);
}

console.log("✅ Operator briefing UI smoke test passed.");
