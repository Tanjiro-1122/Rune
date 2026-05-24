import fs from "node:fs";
function assert(condition, message) {
  if (!condition) { console.error(`❌ ${message}`); process.exit(1); }
  console.log(`✅ ${message}`);
}
const source = fs.readFileSync("lib/app-forge.ts", "utf8");
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
assert(source.includes("verifyAppForgeRunnerResult"), "App Forge exposes runner-result verifier");
assert(source.includes("repo_created_with_github_proof"), "Repo-created success requires GitHub proof truth state");
assert(source.includes("preview_deployed_with_live_proof"), "Preview-deployed success requires live proof truth state");
assert(source.includes("commit_sha"), "Verifier requires commit SHA proof");
assert(source.includes("deployment_url"), "Verifier requires deployment URL proof for preview deploys");
assert(source.includes("live_smoke"), "Verifier requires live smoke proof for preview deploys");
assert(source.includes("Do not claim the app/repo/deployment is complete"), "Verifier blocks completion claims without proof");
assert(source.includes("verification_only_no_repo_no_deploy_no_schema_payment_dns_customer_mutation"), "Verifier is read-only/safety labeled");
assert(pkg.scripts["test:app-forge-runner-result-proof"] === "node scripts/app-forge-runner-result-proof-smoke-test.mjs", "Package exposes App Forge runner-result proof smoke test");
for (const forbidden of ["gh repo create", "vercel deploy", "octokit.repos.create", "pulls.merge", "ALTER TABLE", "stripe.", "dns.records", "route53", "cloudflare"]){
  const verifierBlock = source.slice(source.indexOf("export interface VerifyAppForgeRunnerResultInput"));
  assert(!verifierBlock.includes(forbidden), `Runner-result verifier does not perform ${forbidden}`);
}
console.log("✅ App Forge runner-result proof smoke test passed.");
