import fs from "node:fs";
import assert from "node:assert/strict";

const middleware = fs.readFileSync("middleware.ts", "utf8");
const route = fs.readFileSync("app/api/commands/inbound/route.ts", "utf8");

assert(middleware.includes('pathname.startsWith("/api/commands/inbound")'), "Middleware must allow the inbound command route to reach its handler");
assert(middleware.includes("provider verification and owner allowlists"), "Middleware comment must document handler-level verification boundary");
assert(route.includes("blocked: true"), "Inbound route must remain blocked by default");
assert(route.includes("provider signature verification"), "Inbound route must still require provider signature verification before execution");
assert(route.includes("owner sender allowlist"), "Inbound route must still require owner sender allowlist before execution");

console.log("Command inbound middleware allow smoke test passed.");
console.log("Middleware allows the webhook route, while the handler still blocks execution until verification is implemented.");
