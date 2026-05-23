import fs from "node:fs";
function assert(condition, message) {
  if (!condition) { console.error(`❌ ${message}`); process.exit(1); }
  console.log(`✅ ${message}`);
}
const forge = fs.readFileSync("lib/app-forge.ts", "utf8");
const runner = fs.readFileSync("scripts/trusted-runner.mjs", "utf8");
const script = fs.readFileSync("scripts/app-forge-preview-deploy.mjs", "utf8");
const chat = fs.readFileSync("app/api/chat/route.ts", "utf8");
const pkg = fs.readFileSync("package.json", "utf8");
assert(forge.includes("APPROVE APP FORGE PREVIEW DEPLOY"), "App Forge v4 requires exact preview approval phrase");
assert(forge.includes("queueAppForgePreviewDeploy") && forge.includes('kind: "app_forge_preview_deploy"'), "App Forge v4 queues dedicated preview runner kind");
assert(forge.includes("previewOnly: true") && forge.includes("production: false") && forge.includes("envMutation: false"), "App Forge v4 metadata enforces preview-only/no env mutation");
assert(runner.includes('["app_forge_preview_deploy", "APPROVE APP FORGE PREVIEW DEPLOY"]'), "trusted runner knows preview approval phrase");
assert(runner.includes("App Forge preview deploy command does not match the allowed command shape"), "trusted runner validates preview command shape");
assert(runner.includes("RUNE_APP_FORGE_PREVIEW_METADATA_BASE64"), "trusted runner passes preview metadata to script");
assert(script.includes("repoSlug") && script.includes("toLowerCase()") && script.includes("replace(/[^a-z0-9._-]+/g"), "preview script uses sanitized lowercase project folder slug");
assert(script.includes("vercel") && script.includes("build") && script.includes("--yes"), "preview script runs Vercel build before prebuilt deploy");
assert(script.includes("vercel") && script.includes("--target=preview") && script.includes("--prebuilt"), "preview script deploys preview only");
assert(script.includes("verifyPreviewDeployment") && script.includes("VERCEL_TOKEN is required to verify preview deployment target"), "preview script verifies deployed target through Vercel API");
assert(script.includes("match.target !== \"preview\"") && script.includes("Preview deploy safety violation"), "preview script fails if Vercel reports non-preview target");
assert(script.includes("production must be false") && script.includes("envMutation must be false") && script.includes("schemaMutation must be false"), "preview script revalidates safety flags");
assert(!/--prod|target=production|vercel\s+env|supabase|revenuecat|appstore|eas submit|merge/i.test(script), "preview script has no production/env/schema/payment/store/merge commands");
assert(chat.includes("queue_app_forge_preview_deploy"), "chat exposes App Forge v4 queue tool");
assert(pkg.includes("app-forge-preview-deploy") && pkg.includes("test:app-forge-v4-preview-runner"), "package exposes preview runner and test");
console.log("✅ App Forge v4 preview runner smoke test passed.");
