import fs from "node:fs";
function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ${message}`);
    process.exit(1);
  }
  console.log(`✅ ${message}`);
}
const login = fs.readFileSync("app/login/page.tsx", "utf8");
const css = fs.readFileSync("app/ui-components.css", "utf8");
assert(fs.existsSync("public/images/rune-private-access-login.png"), "private access login art is committed as a static image");
assert(login.includes("rune-private-access-login"), "login page uses the private access scene");
assert(login.includes("/images/rune-private-access-login.png"), "login page renders Javier's private access art");
assert(login.includes("rune-private-access-form"), "real login form is overlaid on the art");
assert(login.includes('credentials: "include"'), "login keeps mobile-safe credential handling");
assert(login.includes("window.location.assign(nextPath)"), "login keeps full navigation after successful auth");
assert(css.includes(".rune-private-access-art") && css.includes("object-fit: cover"), "art fills the login viewport");
assert(css.includes(".rune-private-access-input") && css.includes(".rune-private-access-btn"), "password and enter controls are styled over the stone panel");
console.log("✅ Private access login smoke test passed.");
