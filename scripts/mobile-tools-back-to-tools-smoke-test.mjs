import fs from "node:fs";

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ${message}`);
    process.exit(1);
  }
  console.log(`✅ ${message}`);
}

const chat = fs.readFileSync("components/chat.tsx", "utf8");
const css = fs.readFileSync("app/globals.css", "utf8");

assert(chat.includes("mobileToolsTopRef"), "mobile tools top scroll ref exists");
assert(chat.includes("useRef<HTMLDivElement>(null)"), "mobile tools refs are typed");
assert(chat.includes("function handleBackToMobileTools"), "Back to tools handler exists");
assert(chat.includes("if (!isMobileToolsMode) return"), "Back to tools is mobile-only guarded");
assert(chat.includes("mobileToolsTopRef.current?.scrollIntoView"), "Back to tools scrolls to tile board");
assert(chat.includes('behavior: "smooth"'), "Back to tools uses smooth scrolling");
assert(chat.includes('className="mobile-tools-back-button"'), "Back to tools button class exists");
assert(chat.includes("onClick={handleBackToMobileTools}"), "Back to tools button uses handler");
assert(chat.includes("Back to tools"), "Back to tools label exists");
assert(chat.includes("{isMobileToolsMode && ("), "Back to tools button renders only in mobile mode");
assert(chat.includes("ref={mobileToolsTopRef}"), "top tile grid is scroll target");
assert(css.includes(".mobile-tools-back-button"), "Back to tools CSS exists");
assert(css.includes("justify-content: space-between"), "active drawer label spaces title and button");
assert(css.includes("border-radius: 999px"), "Back to tools button is pill shaped");
assert(css.includes("grid-column: 1 / -1"), "Back to tools button spans full active label width and does not squeeze label");

for (const forbidden of ["execute_redeploy", "execute_rollback", "run_approved_repo_action(", "commitChangesDirectly("]) {
  assert(!chat.includes(`onClick={() => ${forbidden}`), `Back to tools polish does not wire direct mutating click for ${forbidden}`);
}

console.log("✅ Mobile Tools Back to tools smoke test passed.");
