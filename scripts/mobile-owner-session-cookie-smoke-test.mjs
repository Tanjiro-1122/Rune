import fs from "node:fs";
function assert(c, m) {
  if (!c) {
    console.error(`❌ ${m}`);
    process.exit(1);
  }
  console.log(`✅ ${m}`);
}
const auth = fs.readFileSync("lib/auth.ts", "utf8");
const login = fs.readFileSync("app/api/auth/login/route.ts", "utf8");
const logout = fs.readFileSync("app/api/auth/logout/route.ts", "utf8");
const loginPage = fs.readFileSync("app/login/page.tsx", "utf8");
assert(auth.includes("function getSessionCookieOptions"), "shared session cookie options exist");
assert(auth.includes('sameSite: secure ? "none" as const : "lax" as const'), "production session cookie uses SameSite=None with dev-safe Lax fallback");
assert(auth.includes("secure,") && auth.includes('process.env.VERCEL_ENV === "production"'), "secure flag is enabled for production/Vercel production");
assert(login.includes("getSessionCookieOptions(maxAge)"), "login uses shared mobile-safe cookie options");
assert(logout.includes("getExpiredSessionCookieOptions()"), "logout clears cookie with matching options");
assert(!login.includes('sameSite: "strict"') && !logout.includes('sameSite: "strict"'), "Strict SameSite is removed from auth cookie writes");
assert(loginPage.includes('credentials: "include"'), "login fetch explicitly includes credentials");
assert(loginPage.includes("window.location.assign(nextPath)"), "login success uses full navigation so mobile sends the fresh cookie");
console.log("✅ Mobile owner session cookie smoke test passed.");
