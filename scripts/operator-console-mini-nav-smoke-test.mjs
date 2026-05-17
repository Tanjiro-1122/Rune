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

assert(chat.includes("operatorCommandRef"), "Operator command section ref exists");
assert(chat.includes("operatorSummaryRef"), "Operator summary section ref exists");
assert(chat.includes("operatorProposalsRef"), "Operator proposals section ref exists");
assert(chat.includes("operatorTasksRef"), "Operator tasks section ref exists");
assert(chat.includes("function scrollOperatorSection"), "Operator mini-nav scroll helper exists");
assert(chat.includes("targetRef.current?.scrollIntoView"), "Operator mini-nav uses scrollIntoView only");
assert(chat.includes('data-testid="operator-mini-nav"'), "Operator mini-nav test id exists");
assert(chat.includes("Operator section shortcuts"), "Operator mini-nav has accessible label");
assert(chat.includes(">Command</button>"), "Operator mini-nav Command shortcut exists");
assert(chat.includes(">Summary</button>"), "Operator mini-nav Summary shortcut exists");
assert(chat.includes(">Proposals</button>"), "Operator mini-nav Proposals shortcut exists");
assert(chat.includes(">Tasks</button>"), "Operator mini-nav Tasks shortcut exists");
assert(chat.includes('data-testid="operator-summary-grid"'), "Operator summary anchor test id exists");
assert(chat.includes('data-testid="operator-proposals-section"'), "Operator proposals anchor test id exists");
assert(chat.includes('data-testid="operator-tasks-section"'), "Operator tasks anchor test id exists");
assert(css.includes(".operator-mini-nav"), "Operator mini-nav CSS exists");
assert(css.includes("position: sticky"), "Operator mini-nav is sticky within Operator");
assert(css.includes("grid-template-columns: repeat(4, minmax(0, 1fr))"), "Operator mini-nav has four compact shortcuts");
assert(css.includes("scroll-margin-top: 76px"), "Operator section anchors avoid sticky overlap");

for (const forbidden of ["execute_redeploy", "execute_rollback", "run_approved_repo_action(", "commitChangesDirectly(", "deployment_control", "vercel --prod"]) {
  assert(!chat.includes(`onClick={() => ${forbidden}`), `Operator mini-nav does not wire direct mutating click for ${forbidden}`);
}

console.log("✅ Operator Console mini-nav smoke test passed.");
