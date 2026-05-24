import fs from "node:fs";
import assert from "node:assert/strict";

const routePath = "app/api/commands/inbound/route.ts";
const route = fs.readFileSync(routePath, "utf8");

assert(route.includes("/api/commands/inbound"), "Owned command inbound route must exist");
assert(route.includes("WHATSAPP_CLOUD_VERIFY_TOKEN"), "Route must support WhatsApp Cloud verify-token handshake");
assert(route.includes("TWILIO_AUTH_TOKEN"), "Route must name Twilio WhatsApp configuration as a provider path");
assert(route.includes("RUNE_COMMAND_TEST_TOKEN"), "Route must leave a safe manual-test configuration path");
assert(route.includes("blocked: true"), "Route must default to blocked until verification is implemented");
assert(route.includes("provider signature verification"), "Route must identify signature verification as required proof");
assert(route.includes("owner sender allowlist"), "Route must require owner sender allowlist before execution");
assert(route.includes("queue/runner handoff"), "Route must require queue/runner handoff for command work");
assert(route.includes("logActionEvent"), "Route must log blocked probes to Rune action events when Supabase is configured");
assert(!route.includes("sendMessage("), "Inbound scaffold must not send outbound messages yet");
assert(!route.includes("runPrivilegedMerge"), "Inbound scaffold must not execute privileged merge actions");
assert(!route.includes("runPrivilegedDeployment"), "Inbound scaffold must not execute deploy actions");

console.log("Owned command inbound scaffold smoke test passed.");
console.log("Route is intentionally locked until provider signature verification and owner allowlist are added.");
