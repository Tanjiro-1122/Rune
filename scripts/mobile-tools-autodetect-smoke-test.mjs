import fs from "node:fs";

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ${message}`);
    process.exit(1);
  }
  console.log(`✅ ${message}`);
}

const chat = fs.readFileSync("components/chat.tsx", "utf8");

assert(chat.includes("function detectMobileToolsMode"), "mobile tools detection helper exists");
assert(chat.includes('window.matchMedia("(max-width: 820px)")'), "detector checks small viewport");
assert(chat.includes('window.matchMedia("(pointer: coarse)")'), "detector checks touch/coarse pointer");
assert(chat.includes("navigator.userAgent"), "detector checks browser user agent");
assert(chat.includes("iPhone|iPad|iPod|Android|Mobile|IEMobile|Opera Mini"), "detector recognizes mobile browser families");
assert(chat.includes("navigator.maxTouchPoints"), "detector checks touch points");
assert(chat.includes("isMobileToolsMode") && chat.includes("setIsMobileToolsMode"), "mobile mode state exists");
assert(chat.includes("resize"), "detector updates on resize");
assert(chat.includes("orientationchange"), "detector updates on orientation change");
assert(chat.includes("data-tools-mode={isMobileToolsMode ? \"mobile\" : \"desktop\"}"), "drawer records selected tools mode");
assert(chat.includes("toolsShellClassName"), "shell class branches by detected mode");
assert(chat.includes('"context-sidebar context-sidebar--open mobile-tools-shell"'), "mobile branch uses tile-board shell");
assert(chat.includes('"context-sidebar context-sidebar--open"'), "desktop branch keeps normal drawer shell");
assert(chat.includes("toolsPanelClassName"), "panel class branches by detected mode");
assert(chat.includes('"context-panel mobile-tools-tile-board"'), "mobile branch uses tile-board panel");
assert(chat.includes(': "context-panel"'), "desktop branch keeps normal context panel");
assert(chat.includes("{isMobileToolsMode && ("), "mobile intro only renders in mobile mode");
assert(chat.includes('data-testid={isMobileToolsMode ? "mobile-tools-top-tiles" : "desktop-tools-drawers"}'), "top tools test id branches by mode");
assert(chat.includes("filingCabinetTabClassName"), "drawer tabs branch by detected mode");
assert(chat.includes("toolsSectionClassName"), "nested section tile classes are mobile-only");

for (const forbidden of ["execute_redeploy", "execute_rollback", "run_approved_repo_action(", "commitChangesDirectly("]) {
  assert(!chat.includes(`onClick={() => ${forbidden}`), `auto-detect mode does not wire direct mutating click for ${forbidden}`);
}

console.log("✅ Mobile Tools auto-detect smoke test passed.");
