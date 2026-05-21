import fs from "node:fs";

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ${message}`);
    process.exit(1);
  }
  console.log(`✅ ${message}`);
}

const helper = fs.readFileSync("lib/owner-session.ts", "utf8");
const routes = [
  "app/api/workspaces/route.ts",
  "app/api/conversations/route.ts",
  "app/api/history/route.ts",
  "app/api/artifacts/route.ts",
  "app/api/tasks/route.ts",
  "app/api/chat/route.ts",
  "app/api/files/signed-url/route.ts",
  "app/api/upload/route.ts",
  "app/api/actions/route.ts",
  "app/api/jobs/route.ts",
  "app/api/repo-actions/route.ts",
];

assert(helper.includes('RUNE_OWNER_SESSION_ID = "owner:javier"'), "stable Javier owner session id exists");
assert(helper.includes("verifySessionCookie"), "owner session resolver verifies signed Jarvis cookie");
assert(helper.includes("return RUNE_OWNER_SESSION_ID"), "authenticated requests ignore browser-local IDs");
assert(helper.includes("clientSessionId"), "local/dev fallback still accepts client session id");
assert(helper.includes("never trust browser-provided session IDs without a valid signed cookie"), "production owner session resolver rejects unsigned browser session ids");
assert(helper.includes("process.env.NODE_ENV === \"production\") return \"\""), "production resolver returns empty session on invalid signed cookie");
assert(helper.includes("Request | NextRequest"), "resolver supports both NextRequest routes and standard chat Request");

for (const route of routes) {
  const content = fs.readFileSync(route, "utf8");
  assert(content.includes("resolveOwnerSessionId"), `${route} resolves server-side owner session`);
}

const chat = fs.readFileSync("app/api/chat/route.ts", "utf8");
assert(chat.includes("sessionId: clientSessionId"), "chat route treats client session id as untrusted input");
assert(chat.includes("const sessionId = await resolveOwnerSessionId(req, clientSessionId)"), "chat route uses unified owner session for persistence and access");
assert(chat.includes("Authentication required."), "chat route rejects unauthenticated streaming requests");
assert(chat.includes("middleware intentionally bypasses it for stable streaming"), "chat route documents internal auth guard for middleware bypass");

const workspaces = fs.readFileSync("app/api/workspaces/route.ts", "utf8");
assert(workspaces.includes("const sessionId = await resolveOwnerSessionId(req, clientSessionId)"), "workspace bootstrap uses unified owner session");

const history = fs.readFileSync("app/api/history/route.ts", "utf8");
assert(history.includes("const sessionId = await resolveOwnerSessionId(req, clientSessionId)"), "history loads from unified owner session");

console.log("✅ Owner session cohesion smoke test passed.");
