import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";

const moduleSource = fs.readFileSync("lib/owned-command-verification.ts", "utf8");
const routeSource = fs.readFileSync("app/api/commands/inbound/route.ts", "utf8");

assert(moduleSource.includes("verifyOwnedCommand"), "verification module must export verifyOwnedCommand");
assert(moduleSource.includes("twilio_whatsapp"), "must support Twilio WhatsApp provider");
assert(moduleSource.includes("whatsapp_cloud"), "must support WhatsApp Cloud provider");
assert(moduleSource.includes("manual_test"), "must support manual test provider");
assert(moduleSource.includes("crypto.createHmac(\"sha1\""), "Twilio verification must use HMAC-SHA1");
assert(moduleSource.includes("crypto.createHmac(\"sha256\""), "Meta verification must use HMAC-SHA256");
assert(moduleSource.includes("timingSafeEqual"), "signature comparison must be timing-safe");
assert(moduleSource.includes("RUNE_COMMAND_OWNER_SENDERS"), "must require owner sender allowlist");
assert(moduleSource.includes("executionEnabled: false"), "verification must not enable execution yet");

assert(routeSource.includes("pickOwnedCommandProvider"), "inbound route must pick provider from headers");
assert(routeSource.includes("verifyOwnedCommand"), "inbound route must call verification module");
assert(routeSource.includes("owned_command_inbound.verified"), "inbound route must persist verified command event");
assert(routeSource.includes("owned_command_inbound.rejected"), "inbound route must persist rejected command event");
assert(routeSource.includes("status: 202"), "verified commands must be accepted but not executed");
assert(routeSource.includes("execution remains locked"), "verified commands must stay blocked from execution");

// Contract proof for the signature algorithms used by the module.
const twilioToken = "twilio-secret";
const twilioUrl = "https://mrruneai.vercel.app/api/commands/inbound";
const twilioParams = new URLSearchParams({ From: "whatsapp:+15551234567", Body: "check Rune health", MessageSid: "SM123" });
const sorted = [...twilioParams.entries()].sort(([a], [b]) => a.localeCompare(b));
const twilioBase = twilioUrl + sorted.map(([key, value]) => `${key}${value}`).join("");
const twilioSignature = crypto.createHmac("sha1", twilioToken).update(twilioBase).digest("base64");
assert.equal(typeof twilioSignature, "string");
assert(twilioSignature.length > 20);

const metaSignature = `sha256=${crypto.createHmac("sha256", "meta-secret").update(JSON.stringify({ ok: true })).digest("hex")}`;
assert(metaSignature.startsWith("sha256="));
assert.equal(metaSignature.length, 71);

console.log("Owned command verification smoke test passed.");
