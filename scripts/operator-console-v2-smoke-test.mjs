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

assert(chat.includes("Control Tower v3"), "Control Tower v3 label exists");
assert(chat.includes('data-testid="operator-control-tower-card"'), "control tower test id exists");
assert(chat.includes("getOperatorNextAction"), "recommended next action helper exists");
assert(chat.includes("operatorNextAction.title"), "next action title renders");
assert(chat.includes("operatorNextAction.detail"), "next action detail renders");
assert(chat.includes("operator-signal-strip"), "operator signal strip renders");
assert(chat.includes("operatorSignalCount"), "signal count is computed");
assert(chat.includes("safetyLabel"), "project safety labels exist");
assert(chat.includes("safetyTone"), "project safety tones exist");
assert(chat.includes("project-safety-badge"), "project safety badges render");
assert(chat.includes("Read-only console"), "active project card states read-only mode");
assert(chat.includes("No mutations"), "control tower states no mutations");
assert(chat.includes("Refresh control tower"), "quick action uses control tower wording");
assert(chat.includes("Check build intelligence"), "build intelligence quick action exists");
assert(chat.includes("Draft proposal"), "draft proposal quick action exists");

for (const forbidden of ["deployment_control", "execute_rollback", "execute_redeploy", "run_approved_repo_action(", "commitChangesDirectly("]) {
  assert(!chat.includes(`onClick={() => ${forbidden}`), `operator v2 does not wire direct mutating click for ${forbidden}`);
}

assert(css.includes("Operator Console v2 — premium read-only control tower"), "operator v2 CSS block exists");
assert(css.includes(".operator-control-tower-card"), "control tower card styles exist");
assert(css.includes(".operator-next-action"), "next action styles exist");
assert(css.includes(".operator-signal-strip"), "signal strip styles exist");
assert(css.includes(".project-safety-badge--sensitive"), "sensitive project safety badge style exists");
assert(css.includes(".project-safety-badge--read-only"), "read-only project safety badge style exists");

console.log("✅ Operator Console v2 smoke test passed.");
