import fs from "node:fs";
import assert from "node:assert/strict";

const middleware = fs.readFileSync("middleware.ts", "utf8");
const selfTest = fs.readFileSync("app/api/self-test/route.ts", "utf8");
const productionProof = fs.readFileSync("scripts/production-proof-runner.mjs", "utf8");

assert(middleware.includes("isInternalProofRequest"), "middleware must expose internal proof request bypass");
assert(middleware.includes("/api/deploy-health"), "middleware must allow deploy-health proof endpoint with internal auth");
assert(middleware.includes("/api/self-test"), "middleware must allow self-test proof endpoint with internal auth");
assert(middleware.includes("process.env.RUNE_INTERNAL_TOKEN") && middleware.includes("process.env.CRON_SECRET"), "middleware must accept RUNE_INTERNAL_TOKEN or CRON_SECRET");
assert(selfTest.includes("process.env.RUNE_INTERNAL_TOKEN") && selfTest.includes("process.env.CRON_SECRET"), "self-test route auth must accept RUNE_INTERNAL_TOKEN or CRON_SECRET");
assert(productionProof.includes("process.env.RUNE_INTERNAL_TOKEN || process.env.CRON_SECRET"), "production proof runner must send available internal/cron token");

console.log("Internal proof auth smoke test passed.");
