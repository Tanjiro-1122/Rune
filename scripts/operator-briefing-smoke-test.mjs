import fs from "node:fs";

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ${message}`);
    process.exit(1);
  }
  console.log(`✅ ${message}`);
}

const briefing = fs.readFileSync("lib/operator-briefing.ts", "utf8");
const route = fs.readFileSync("app/api/operator-briefing/route.ts", "utf8");
const appHealth = fs.readFileSync("lib/app-health-snapshot.ts", "utf8");
const deployHealth = fs.readFileSync("lib/deploy-health.ts", "utf8");
const buildIntel = fs.readFileSync("lib/build-intelligence.ts", "utf8");

assert(briefing.includes("export async function getDailyOperatorBriefing"), "Daily Operator Briefing composer exists");
assert(briefing.includes('briefingType: "daily_operator"'), "Briefing returns daily_operator type");
assert(briefing.includes("readOnly: true"), "Briefing explicitly returns readOnly true");
assert(briefing.includes('if (["warning", "partial", "missing", "proposed", "queued", "running"].includes(normalized)) return "warning"'), "Briefing treats missing read-only visibility as warning, not blocked");
assert(briefing.includes("isIntegrationVisibilityWarning"), "Briefing identifies integration visibility warnings separately");
assert(briefing.includes("integration visibility or health warnings"), "Briefing warning headline avoids blocked wording for read-only integrations");
assert(briefing.includes("JARVIS_CANONICAL_PROJECTS.map"), "Briefing covers canonical projects");
assert(briefing.includes("getAppHealthSnapshot({ projectKey: project.key, repo: project.repo, skipActionLog: true })"), "Briefing reads app health without action logging");
assert(briefing.includes("getBuildIntelligenceSnapshot({ projectKey: project.key, repo: project.repo, skipActionLog: true })"), "Briefing reads build intelligence without action logging");
assert(briefing.includes("getDeployHealthSnapshot({ skipActionLog: true })"), "Briefing reads deploy health without action logging");
assert(briefing.includes("listRepoActionProposals({ limit: 12 })"), "Briefing summarizes Repo Control proposals read-only");
assert(briefing.includes('.from("workspace_tasks")'), "Briefing reads workspace task status directly");
assert(briefing.includes('.select("id, title, status, runner_status, updated_at")'), "Briefing task query uses narrow read projection");
assert(briefing.includes('.from("agent_memories")'), "Briefing checks agent_memories reachability");
assert(briefing.includes('.from("agent_memory_events")'), "Briefing checks agent_memory_events reachability");
assert(briefing.includes("No repo merge, deploy, rollback, release, schema change, payment action, customer message, runner job, or entitlement change is executed."), "Briefing contains explicit safety notice");

assert(route.includes("export async function GET()"), "Operator briefing API exposes GET only");
assert(route.includes("getDailyOperatorBriefing"), "Operator briefing API calls composer");
assert(!route.includes("POST") && !route.includes("PATCH") && !route.includes("PUT") && !route.includes("DELETE"), "Operator briefing API does not expose mutating HTTP methods");

assert(appHealth.includes("skipActionLog?: boolean"), "App health supports skipActionLog option");
assert(appHealth.includes("if (!options.skipActionLog)"), "App health can skip action logging");
assert(deployHealth.includes("skipActionLog?: boolean"), "Deploy health supports skipActionLog option");
assert(deployHealth.includes("if (!options.skipActionLog)"), "Deploy health can skip action logging");
assert(buildIntel.includes("skipActionLog?: boolean"), "Build intelligence supports skipActionLog option");
assert(buildIntel.includes("if (!options.skipActionLog)"), "Build intelligence can skip action logging");

for (const forbidden of [
  "createRepoActionProposal(",
  "draftRepoActionDiff(",
  "generateRepoActionProposedDiff(",
  "sandboxCheckRepoActionDiff(",
  "runTemporaryWorkspaceBuildCheck(",
  "openRepoActionPullRequest(",
  "trackRepoActionPullRequest(",
  "runApprovedRepoActionExecutor(",
  "prepareRepoDeploymentHandoff(",
  "runRepoControlFlow(",
  "updateRepoActionStatus(",
  "createQueuedWorkspaceJob(",
  "resumeWorkspaceTask(",
  "startWorkspaceTask(",
  "completeWorkspaceTask(",
  "failWorkspaceTask(",
  "execute_redeploy",
  "execute_rollback",
  "deployment_control",
  "vercel --prod",
  "stripe",
  "grantEntitlement",
  "refundPayment"
]) {
  assert(!briefing.includes(forbidden), `Briefing does not call or wire ${forbidden}`);
}

for (const forbiddenWrite of [".insert(", ".update(", ".upsert(", ".delete("] ) {
  assert(!briefing.includes(forbiddenWrite), `Briefing composer does not use Supabase write operation ${forbiddenWrite}`);
}

console.log("✅ Operator briefing smoke test passed.");
