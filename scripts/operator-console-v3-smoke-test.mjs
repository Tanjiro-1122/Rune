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

assert(chat.includes("Control Tower v3"), "Operator Console v3 label exists");
assert(chat.includes("type OperatorCommandCard"), "Operator v3 command card type exists");
assert(chat.includes("getOperatorCommandCards"), "Operator v3 command card builder exists");
assert(chat.includes("getProposalReadinessLabel"), "proposal readiness label helper exists");
assert(chat.includes('data-testid="operator-command-grid"'), "Operator v3 command grid test id exists");
assert(chat.includes('data-testid="operator-proposal-badges"'), "Operator v3 proposal badges test id exists");
assert(chat.includes("Best next move"), "Operator v3 best-next-move card exists");
assert(chat.includes("Repo Control"), "Operator v3 repo control card exists");
assert(chat.includes("Read-only health"), "Operator v3 health card exists");
assert(chat.includes("Build signal"), "Operator v3 build card exists");
assert(chat.includes("Runner queue"), "Operator v3 runner card exists");
assert(chat.includes("Proposal-only shortcuts"), "Operator v3 communicates proposal-only shortcuts");
assert(chat.includes("No merge or deploy"), "Operator v3 communicates no merge/deploy boundary");
assert(chat.includes("onClick={() => handleCabinetDrawerSelect(card.targetDrawer)}"), "Operator v3 cards use mobile-aware drawer navigation");
assert(!chat.includes("onClick={() => setActiveCabinetDrawer(card.targetDrawer)}"), "Operator v3 cards avoid direct drawer state jumps");
assert(css.includes(".operator-command-grid"), "Operator v3 command grid CSS exists");
assert(css.includes(".operator-command-card"), "Operator v3 command card CSS exists");
assert(css.includes(".operator-proposal-badges"), "Operator v3 proposal badges CSS exists");
assert(css.includes("grid-template-columns: repeat(2, minmax(0, 1fr))"), "Operator v3 command grid uses two-column cards");
assert(css.includes(".operator-command-card--warning"), "Operator v3 warning card tone exists");
assert(css.includes(".operator-command-card--error"), "Operator v3 error card tone exists");
assert(css.includes(".operator-control-tower-card,\n  .operator-command-grid"), "Operator v3 mobile layout collapses to one column");

for (const forbidden of ["execute_redeploy", "execute_rollback", "run_approved_repo_action(", "commitChangesDirectly(", "deployment_control", "vercel --prod"]) {
  assert(!chat.includes(`onClick={() => ${forbidden}`), `Operator v3 does not wire direct mutating click for ${forbidden}`);
}

console.log("✅ Operator Console v3 smoke test passed.");
