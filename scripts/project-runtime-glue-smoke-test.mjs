import fs from "node:fs";

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ${message}`);
    process.exit(1);
  }
  console.log(`✅ ${message}`);
}

const runtime = fs.readFileSync("lib/project-runtime.ts", "utf8");
const lifecycle = fs.readFileSync("lib/rune-lifecycle.ts", "utf8");
const selfTest = fs.readFileSync("app/api/self-test/route.ts", "utf8");

assert(runtime.includes('getProjectRuntimeIdentity') && runtime.includes('getRuneRuntimeIdentity'), "project runtime helpers exist");
assert(runtime.includes('getProjectByKey') && runtime.includes('getProjectVercelProjectId'), "runtime identity reads from registry");
assert(lifecycle.includes('getRuneRuntimeIdentity') && lifecycle.includes('PRODUCTION_BRANCH'), "Rune lifecycle uses registry runtime identity");
assert(!lifecycle.includes('"Tanjiro-1122/Rune"') && !lifecycle.includes('"prj_C8yIrPTBitcCIkW745Gx80LBB6CA"') && !lifecycle.includes('"https://mrruneai.vercel.app"'), "Rune lifecycle no longer hardcodes repo/project/live URL");
assert(selfTest.includes('getRuneRuntimeIdentity'), "self-test uses registry runtime identity");
assert(!selfTest.includes('"prj_C8yIrPTBitcCIkW745Gx80LBB6CA"'), "self-test no longer hardcodes Vercel project ID");
console.log("✅ Project runtime glue smoke test passed.");
