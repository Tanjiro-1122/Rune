import fs from "node:fs";
import assert from "node:assert/strict";

const read = (path) => fs.existsSync(path) ? fs.readFileSync(path, "utf8") : "";

const briefing = read("lib/whatsapp-briefing.ts");
const dailyCron = read("app/api/cron/daily-briefing/route.ts");
const chatRoute = read("app/api/chat/route.ts");
const schema = `${read("supabase/schema.sql")}\n${read("supabase/migrations/20260520_missing_tables.sql")}`;
const docs = read("docs/reports/whatsapp-command-control-proof-v1.md");

assert(briefing.includes("buildWhatsAppBriefingMessage"), "Rune must retain daily WhatsApp briefing composer");
assert(dailyCron.includes("buildWhatsAppBriefingMessage"), "Daily cron must still build the WhatsApp/operator briefing message");
assert(schema.includes("rune_outbox"), "Supabase schema/migrations must include rune_outbox for owned outbound command responses");
assert(chatRoute.includes("rune_outbox"), "Chat/tooling must know about rune_outbox as an owned outbound surface");

assert(docs.includes("Inbound command webhook"), "Proof doc must require an inbound command webhook");
assert(docs.includes("Outbound delivery provider"), "Proof doc must require an outbound delivery provider");
assert(docs.includes("Approval gate"), "Proof doc must preserve approval gates for risky actions");
assert(docs.includes("briefing-only is not command/control"), "Proof doc must state briefing-only is not enough");
assert(docs.includes("No customer messages"), "Proof doc must preserve customer-message safety boundary");

const routeFiles = fs.readdirSync("app/api", { recursive: true }).map(String).filter((p) => p.endsWith("route.ts"));
const inboundCandidates = routeFiles.filter((p) => /whatsapp|twilio|command|inbound/i.test(p));
const hasDedicatedInboundWebhook = inboundCandidates.some((p) => /whatsapp|twilio|inbound/i.test(p) && !p.includes("cron/daily-briefing"));

console.log("WhatsApp command/control proof smoke test passed.");
console.log(`Dedicated inbound webhook present: ${hasDedicatedInboundWebhook ? "yes" : "no — expected gap until Phase 4 implementation"}`);
console.log("Current proof status: Rune has briefing/outbox foundations, but owned WhatsApp command input still needs implementation.");
