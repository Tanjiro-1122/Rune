import fs from "node:fs";
import assert from "node:assert/strict";

const route = fs.readFileSync("app/api/commands/inbound/route.ts", "utf8");
const docs = fs.readFileSync("docs/reports/owned-command-provider-readiness-v1.md", "utf8");

const requiredEnv = [
  "TWILIO_AUTH_TOKEN",
  "TWILIO_WHATSAPP_FROM",
  "WHATSAPP_CLOUD_VERIFY_TOKEN",
  "WHATSAPP_CLOUD_ACCESS_TOKEN",
  "RUNE_COMMAND_TEST_TOKEN",
];

for (const envName of requiredEnv) {
  assert(route.includes(envName), `Inbound command route must expose/provider-check ${envName}`);
  assert(docs.includes(envName), `Provider readiness doc must list ${envName}`);
}

const requiredProof = [
  "provider signature verification",
  "owner sender allowlist",
  "Supabase command event persistence",
  "queue/runner handoff",
  "outbound proof response through owned provider",
];

for (const proof of requiredProof) {
  assert(route.includes(proof), `Inbound route must keep ${proof} locked as required proof`);
  assert(docs.includes(proof), `Provider readiness doc must explain ${proof}`);
}

assert(route.includes("configuredProviders"), "Inbound route must report configured providers without revealing secrets");
assert(route.includes("blocked: true"), "Inbound route must remain locked by default");

console.log("Owned command provider readiness smoke test passed.");
console.log("Provider env/documentation contract exists while execution remains blocked by default.");
