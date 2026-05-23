import fs from "node:fs";

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ${message}`);
    process.exit(1);
  }
  console.log(`✅ ${message}`);
}

const forge = fs.readFileSync("lib/app-forge.ts", "utf8");
const previewHelper = forge.slice(forge.indexOf("export function createAppForgePreviewHandoff"));
const route = fs.readFileSync("app/api/app-forge/preview-handoff/route.ts", "utf8");
const chat = fs.readFileSync("app/api/chat/route.ts", "utf8");
const pkg = fs.readFileSync("package.json", "utf8");

assert(forge.includes("createAppForgePreviewHandoff"), "App Forge exposes preview handoff helper");
assert(forge.includes("APPROVE APP FORGE PREVIEW DEPLOY"), "preview handoff declares exact future approval phrase");
assert(forge.includes("metadata_only_no_vercel_project_created_no_deploy_no_env_mutation_no_production_launch"), "preview handoff safety forbids deploy/env/prod launch");
assert(forge.includes("vercel deploy --prebuilt --target=preview"), "preview handoff provides preview command as metadata");
assert(!/fetch\(|queueCliRunnerJob\(|spawn\(|execFile\(|execSync\(|\bexec\(/.test(previewHelper.replace(/`vercel deploy --prebuilt --target=preview`/g, "")), "preview helper does not call APIs, queue jobs, or execute deploys");
assert(route.includes("Authentication required") && route.includes("createAppForgePreviewHandoff"), "preview handoff route is protected and uses helper");
assert(!/vercel|deploy|queueCliRunnerJob|exec|spawn/.test(route.replace(/preview-handoff/g, "").replace(/createAppForgePreviewHandoff/g, "")), "preview route does not deploy or queue execution");
assert(chat.includes("app_forge_preview_handoff"), "chat exposes App Forge v3 preview handoff tool");
assert(chat.includes("does not create a Vercel project, deploy, merge, mutate env vars"), "chat tool describes preview safety honestly");
assert(pkg.includes("test:app-forge-v3-preview-handoff"), "package exposes App Forge v3 smoke test");
console.log("✅ App Forge v3 preview handoff smoke test passed.");
