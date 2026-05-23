import fs from "node:fs";

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ${message}`);
    process.exit(1);
  }
  console.log(`✅ ${message}`);
}

const lib = fs.readFileSync("lib/app-forge.ts", "utf8");
const route = fs.readFileSync("app/api/app-forge/repo-handoff/route.ts", "utf8");
const pkg = fs.readFileSync("package.json", "utf8");
const chat = fs.readFileSync("app/api/chat/route.ts", "utf8");

assert(lib.includes("createAppForgeRepoHandoff"), "App Forge exposes repo handoff creator");
assert(lib.includes("gh repo create") && lib.includes("git push"), "handoff includes explicit repo creation commands for approved runner use");
assert(lib.includes("repo_handoff_only_no_repo_created_no_files_written_no_deploy"), "handoff safety states no repo/files/deploy happened");
assert(!/(fetch\(|Octokit|POST.*api.github.com|execSync|spawn\()/s.test(lib), "handoff lib does not call GitHub or execute shell commands");
assert(route.includes("RUNE_DEPLOY_TOKEN") && route.includes("Unauthorized"), "route is owner-token protected");
assert(!/gh repo create|git push|deploy|merge/.test(route), "route does not create repos, push, merge, or deploy");
assert(pkg.includes("test:app-forge-repo-handoff"), "package exposes App Forge smoke test");
assert(chat.includes("app_forge_repo_handoff"), "chat exposes App Forge repo handoff tool");
assert(chat.includes("Rune can create apps through the controlled App Creator workflow"), "system prompt states controlled app creation accurately");
console.log("✅ App Forge repo handoff smoke test passed.");
