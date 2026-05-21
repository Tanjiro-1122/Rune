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

assert(chat.includes("Read-only controls"), "mobile active drawer subtitle exists");
assert(chat.includes("mobile-tools-active-badge"), "mobile active drawer status badge exists");
assert(chat.includes("No mutations"), "mobile active drawer badge text communicates safety");
assert(chat.includes("{isMobileToolsMode && <small>Read-only controls</small>}"), "active drawer subtitle is mobile-only");
assert(chat.includes('{isMobileToolsMode && <b className="mobile-tools-active-badge">No mutations</b>}'), "active badge is mobile-only");
assert(css.includes(".mobile-tools-active-badge"), "active drawer badge CSS exists");
assert(css.includes("grid-template-columns: minmax(0, 1fr) auto"), "active drawer label uses responsive grid layout");
assert(css.includes("radial-gradient(circle at top left"), "active drawer label has premium emphasis background");
assert(css.includes(".mobile-tools-active-label strong"), "active drawer title typography is styled");
assert(css.includes(".mobile-tools-active-label small"), "active drawer subtitle typography is styled");
assert(css.includes("grid-column: 1 / -1"), "Back to tools button spans active label width on mobile");
assert(css.includes("text-align: center"), "Back to tools button text remains centered");

for (const forbidden of ["execute_redeploy", "execute_rollback", "run_approved_repo_action(", "commitChangesDirectly("]) {
  assert(!chat.includes(`onClick={() => ${forbidden}`), `active status polish does not wire direct mutating click for ${forbidden}`);
}

console.log("✅ Mobile Tools active status smoke test passed.");
