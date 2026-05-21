import fs from "node:fs";

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ${message}`);
    process.exit(1);
  }
  console.log(`✅ ${message}`);
}

const build = fs.readFileSync("lib/build-intelligence.ts", "utf8");
const deploy = fs.readFileSync("lib/deployment-control.ts", "utf8");
const repo = fs.readFileSync("lib/repo-actions.ts", "utf8");

for (const [label, source] of [["build intelligence", build], ["deployment control", deploy], ["repo actions", repo]]) {
  assert(source.includes("getRuneRuntimeIdentity"), `${label} uses project runtime identity`);
}

assert(build.includes("normalizeRepoSlug") && build.includes("const DEFAULT_REPO = RUNE_RUNTIME.repo"), "build intelligence derives repo from registry runtime");
assert(build.includes("RUNE_RUNTIME.vercelProjectId"), "build intelligence derives Vercel project from registry runtime");
assert(deploy.includes("getRuneRuntimeIdentity().vercelProjectId"), "deployment control derives Vercel project from registry runtime");
assert(repo.includes("const DEFAULT_REPO = RUNE_RUNTIME.repo"), "repo actions derives default repo from registry runtime");
assert(repo.includes("RUNE_RUNTIME.vercelProjectId"), "repo actions derives Vercel project from registry runtime");

for (const [label, source] of [["build intelligence", build], ["repo actions", repo]]) {
  assert(!source.includes('const DEFAULT_REPO = "Tanjiro-1122/Rune"'), `${label} no longer hardcodes DEFAULT_REPO`);
}
assert(!deploy.includes("process.env.VERCEL_PROJECT_ID || process.env.RUNE_VERCEL_PROJECT_ID"), "deployment control no longer has scattered Vercel project fallback chain");
console.log("✅ Runtime identity build/deploy/repo smoke test passed.");
