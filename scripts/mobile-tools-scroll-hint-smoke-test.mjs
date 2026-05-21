import fs from "node:fs";

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ${message}`);
    process.exit(1);
  }
  console.log(`✅ ${message}`);
}

const chat = fs.readFileSync("components/chat.tsx", "utf8");
const css = ["app/chat-mobile.css", "app/operator.css", "app/ui-components.css", "app/globals.css"].map((file) => fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "").join("\n");

assert(chat.includes("mobile-tools-scroll-hint"), "mobile scroll hint markup exists");
assert(chat.includes("Scroll for drawer details"), "mobile scroll hint copy exists");
assert(chat.includes("{isMobileToolsMode && ("), "mobile scroll hint is gated to mobile mode");
assert(chat.includes('aria-hidden="true"'), "mobile scroll hint is decorative for screen readers");
assert(css.includes(".mobile-tools-scroll-hint"), "mobile scroll hint CSS exists");
assert(css.includes("pointer-events: none"), "mobile scroll hint does not block taps");
assert(css.includes("user-select: none"), "mobile scroll hint is non-interactive");
assert(css.includes("text-transform: uppercase"), "mobile scroll hint matches command-board style");
assert(css.includes(".mobile-tools-scroll-hint::before"), "mobile scroll hint has divider before line");
assert(css.includes(".mobile-tools-scroll-hint::after"), "mobile scroll hint has divider after line");
assert(css.includes("background: linear-gradient(90deg"), "mobile scroll hint divider uses subtle fade line");

for (const forbidden of ["execute_redeploy", "execute_rollback", "run_approved_repo_action(", "commitChangesDirectly("]) {
  assert(!chat.includes(`onClick={() => ${forbidden}`), `scroll hint polish does not wire direct mutating click for ${forbidden}`);
}

console.log("✅ Mobile Tools scroll hint smoke test passed.");
