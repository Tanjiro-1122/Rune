import fs from "node:fs";

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ${message}`);
    process.exit(1);
  }
  console.log(`✅ ${message}`);
}

const routeMap = fs.readFileSync("lib/rune-route-map.ts", "utf8");
const architecture = fs.readFileSync("docs/rune-architecture.md", "utf8");

for (const group of ["Auth", "Chat", "Projects", "Tasks", "Memory", "Vault", "Tools", "Operator", "Automations", "System"]) {
  assert(routeMap.includes(`label: "${group}"`), `route map includes ${group}`);
  assert(architecture.includes(group), `architecture doc explains ${group}`);
}

for (const route of ["/api/chat", "/api/app-health", "/api/tasks", "/api/memory", "/api/vault", "/api/operator-briefing", "/api/cron/operator-events"]) {
  assert(routeMap.includes(route), `route map includes ${route}`);
}

assert(routeMap.includes("findRuneRouteGroup"), "route lookup helper exists");
assert(architecture.includes("Do not move API routes casually."), "architecture doc warns against risky route moves");
assert(architecture.includes("compatibility wrapper"), "route move policy requires compatibility wrappers");
console.log("✅ Rune route map smoke test passed.");
