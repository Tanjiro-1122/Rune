import fs from "node:fs";

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ${message}`);
    process.exit(1);
  }
  console.log(`✅ ${message}`);
}

const registry = fs.readFileSync("lib/project-registry.ts", "utf8");

for (const key of ['key: "rune"', 'key: "unfiltr"', 'key: "swh"', 'key: "family"']) {
  assert(registry.includes(key), `registry includes ${key}`);
}

for (const metadata of [
  'liveUrl: "https://mrruneai.vercel.app"',
  'liveUrl: "https://unfiltrbyjavier2.vercel.app"',
  'vercelProjectIdEnv: "RUNE_VERCEL_PROJECT_ID"',
  'vercelProjectIdEnv: "UNFILTR_VERCEL_PROJECT_ID"',
  'bundleId: "com.huertas.unfiltr"',
  'appId: "6760604917"',
  'packageName: "com.huertas.sportswagerhelper"',
  'projectRef: "hvvrbpvsgjxiicigkwhu"',
  'severanceStatus: "legacy_dependency"',
]) {
  assert(registry.includes(metadata), `registry includes ${metadata}`);
}

for (const helper of ["getProjectLiveUrl", "getProjectVercelProjectId", "getProjectsWithHealthCheck", "getProjectsWithBase44Dependency", "resolveProjectContext"]) {
  assert(registry.includes(`function ${helper}`) || registry.includes(`function ${helper}`.replace('function ', 'export function ')), `registry exposes ${helper}`);
}

assert(!registry.includes('canonicalName: "SportsWager Helper"'), "SWH canonical name is human-spaced consistently");
console.log("✅ Project registry source-of-truth smoke test passed.");
