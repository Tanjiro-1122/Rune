import fs from "node:fs";
function assert(condition, message) { if (!condition) { console.error(`❌ ${message}`); process.exit(1); } console.log(`✅ ${message}`); }
const capability = fs.readFileSync("lib/repo-access-capability.ts", "utf8");
const executor = fs.readFileSync("lib/operator-executor.ts", "utf8");
const repoActions = fs.readFileSync("lib/repo-actions.ts", "utf8");
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
assert(capability.includes("checkRepoAccessCapability"), "Repo access capability helper exists");
assert(capability.includes("Octokit"), "Capability helper uses GitHub API");
assert(capability.includes("isRepoAllowed"), "Capability helper checks repo allowlist");
assert(capability.includes("tokenConfigured"), "Capability helper checks token presence");
assert(capability.includes("canCreateBranch"), "Capability helper reports branch capability");
assert(capability.includes("canOpenPullRequest"), "Capability helper reports PR capability");
assert(capability.includes("fixable_by_code"), "Capability helper classifies code-fixable access");
assert(capability.includes("blocked_by_repo_access"), "Capability helper classifies repo access blocks");
assert(capability.includes("Non-mutating permission inference"), "Capability probe is documented as non-mutating");
assert(capability.includes("never merge or deploy from capability probe"), "Capability helper declares no merge/deploy boundary");
assert(repoActions.includes("export function getAllowedRepoSlugs"), "Repo actions exports allowed repo helper");
assert(repoActions.includes("export function isRepoAllowed"), "Repo actions exports allowlist helper");
assert(executor.includes("checkRepoAccessCapability"), "Executor checks repo capability before repair stages");
assert(executor.includes("Executor blocked before repo mutation"), "Executor blocks early on repo access failure");
assert(executor.includes("repoAccess?: RepoAccessCapabilityReport"), "Execution plan carries repo access report");
assert(pkg.scripts["test:repo-access-capability"] === "node scripts/repo-access-capability-smoke-test.mjs", "Package exposes repo access capability smoke test");
for (const forbidden of ["createRef", "createOrUpdateFileContents", "pulls.create", "git push", "vercel --prod", "stripe", "grantEntitlement"]) {
  assert(!capability.includes(forbidden), `Capability probe does not mutate via ${forbidden}`);
}
console.log("✅ Repo access capability smoke test passed.");
