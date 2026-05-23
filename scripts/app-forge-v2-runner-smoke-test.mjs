import fs from "node:fs";

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ${message}`);
    process.exit(1);
  }
  console.log(`✅ ${message}`);
}

const forge = fs.readFileSync("lib/app-forge.ts", "utf8");
const runner = fs.readFileSync("scripts/trusted-runner.mjs", "utf8");
const script = fs.readFileSync("scripts/app-forge-repo-create.mjs", "utf8");
const chat = fs.readFileSync("app/api/chat/route.ts", "utf8");
const pkg = fs.readFileSync("package.json", "utf8");

assert(forge.includes("APPROVE APP FORGE REPO CREATE"), "App Forge v2 requires exact approval phrase");
assert(forge.includes("queueAppForgeRepoCreate") && forge.includes("queueCliRunnerJob"), "App Forge v2 queues through trusted runner jobs");
assert(forge.includes('kind: "app_forge_repo_create"'), "App Forge v2 uses dedicated runner kind");
assert(forge.includes("publicLaunch: false") && forge.includes("deploy: false") && forge.includes("schemaMutation: false"), "App Forge v2 metadata forbids launch/deploy/schema mutation");
assert(runner.includes('["app_forge_repo_create", "APPROVE APP FORGE REPO CREATE"]'), "trusted runner knows App Forge approval phrase");
assert(runner.includes("App Forge repo create command does not match the allowed command shape"), "trusted runner validates App Forge command shape");
assert(runner.includes("RUNE_APP_FORGE_METADATA_BASE64"), "trusted runner passes App Forge metadata to script");
assert(script.includes("gh") && script.includes("repo") && script.includes("create") && script.includes("npm") && script.includes("build") && script.includes("git") && script.includes("--push"), "App Forge script creates repo after build and pushes branch");
assert(script.includes("deploy must be false") && script.includes("schemaMutation must be false"), "App Forge script revalidates no deploy/schema mutation");
assert(script.includes(".gitignore") && script.includes("node_modules") && script.includes("dist"), "App Forge script writes gitignore before git add");
assert(script.includes('moduleResolution: "Bundler"'), "App Forge script uses modern TypeScript bundler module resolution");
assert(script.includes("src/vite-env.d.ts") && script.includes("vite/client"), "App Forge script writes Vite env types for CSS imports");
assert(!/(vercel|supabase|revenuecat|appstore|eas submit|merge)\s/i.test(script), "App Forge script has no deploy/payment/store/merge commands");
assert(chat.includes("queue_app_forge_repo_create"), "chat exposes App Forge v2 queue tool");
assert(pkg.includes("app-forge-repo-create"), "package exposes App Forge runner script");
console.log("✅ App Forge v2 runner smoke test passed.");
