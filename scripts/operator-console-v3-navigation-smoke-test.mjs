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

assert(chat.includes("function handleCabinetDrawerSelect(drawerKey: CabinetDrawerKey)"), "mobile-aware drawer navigation handler exists");
assert(chat.includes("mobileActiveDrawerRef.current?.scrollIntoView"), "drawer navigation scrolls active section into view on mobile");
assert(chat.includes("window.setTimeout(() =>"), "drawer navigation waits for active content render");
assert(chat.includes("onClick={() => handleCabinetDrawerSelect(card.targetDrawer)}"), "Operator v3 command cards use mobile-aware drawer navigation");
assert(!chat.includes("onClick={() => setActiveCabinetDrawer(card.targetDrawer)}"), "Operator v3 command cards do not use direct state-only jumps");
assert(chat.includes('data-testid="operator-command-grid"'), "Operator v3 command grid remains testable");
assert(chat.includes("operatorCommandCards.map"), "Operator v3 command cards are still generated from safe metadata");
assert(css.includes(".operator-command-card"), "Operator v3 command card styles remain present");

for (const forbidden of ["execute_redeploy", "execute_rollback", "run_approved_repo_action(", "commitChangesDirectly(", "deployment_control", "vercel --prod"]) {
  assert(!chat.includes(`onClick={() => ${forbidden}`), `Operator v3 navigation does not wire direct mutating click for ${forbidden}`);
}

console.log("✅ Operator Console v3 navigation smoke test passed.");
