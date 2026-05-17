import fs from "node:fs";

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ${message}`);
    process.exit(1);
  }
  console.log(`✅ ${message}`);
}

const chat = fs.readFileSync("components/chat.tsx", "utf8");

assert(chat.includes("mobileActiveDrawerRef"), "mobile active drawer scroll ref exists");
assert(chat.includes("useRef<HTMLDivElement>(null)"), "mobile active drawer ref is typed");
assert(chat.includes("function handleCabinetDrawerSelect"), "drawer selection handler exists");
assert(chat.includes("setActiveCabinetDrawer(drawerKey)"), "drawer handler still switches active drawer");
assert(chat.includes("if (!isMobileToolsMode) return"), "drawer auto-scroll is mobile-only");
assert(chat.includes("window.setTimeout"), "drawer auto-scroll waits for active content render");
assert(chat.includes("scrollIntoView"), "drawer handler scrolls active content into view");
assert(chat.includes('behavior: "smooth"'), "mobile drawer jump uses smooth scrolling");
assert(chat.includes('block: "start"'), "mobile drawer jump aligns active content to top");
assert(chat.includes("handleCabinetDrawerSelect(drawer.key)"), "drawer tile click uses mobile-aware handler");
assert(chat.includes('data-testid="mobile-tools-active-drawer-anchor"'), "active drawer anchor test id exists");

for (const forbidden of ["execute_redeploy", "execute_rollback", "run_approved_repo_action(", "commitChangesDirectly("]) {
  assert(!chat.includes(`onClick={() => ${forbidden}`), `active drawer jump does not wire direct mutating click for ${forbidden}`);
}

console.log("✅ Mobile Tools active drawer jump smoke test passed.");
