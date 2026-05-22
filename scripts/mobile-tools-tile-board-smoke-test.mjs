import fs from "node:fs";

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ${message}`);
    process.exit(1);
  }
  console.log(`✅ ${message}`);
}

const chat = fs.readFileSync("components/chat.tsx", "utf8");
const orchestrationModel = fs.readFileSync("components/chat/orchestration-model.ts", "utf8");
const uiSource = `${chat}
${orchestrationModel}`;
const css = ["app/chat-mobile.css", "app/operator.css", "app/ui-components.css", "app/globals.css"].map((file) => fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "").join("\n");

assert(uiSource.includes("mobile-tools-shell"), "mobile tools shell branch exists");
assert(uiSource.includes("mobile-tools-tile-board"), "mobile tools tile board class branch exists");
assert(chat.includes('data-testid="mobile-tools-tile-board"'), "mobile tile board test id exists");
assert(chat.includes('"mobile-tools-top-tiles"'), "top-level mobile tool tiles test id branch exists");
assert(uiSource.includes("mobile-tools-top-tile"), "top-level drawer buttons render as mobile tiles");
assert(uiSource.includes("mobile-tools-top-tile--active"), "active top tile class exists");
assert(uiSource.includes("mobile-tools-project-tile"), "project switchboard becomes a mobile project tile");
assert(uiSource.includes("mobile-tools-section"), "nested drawer content uses mobile section tiles");
assert(chat.includes("Mobile command board"), "mobile command board intro copy exists");
assert(chat.includes("Each drawer stays read-only"), "mobile board communicates read-only gate boundary");

for (const drawer of ["operator", "memory", "health", "repo", "build", "activity", "files", "tasks"]) {
  assert(uiSource.includes(`key: \"${drawer}\"`) || uiSource.includes(`key: "${drawer}"`), `top-level tile exists for ${drawer}`);
}

assert(css.includes(".mobile-tools-tile-board"), "mobile tile board CSS block exists");
assert(css.includes(".mobile-tools-top-tiles"), "mobile top tile grid style exists");
assert(/grid-template-columns:\s*(repeat\(|1fr|auto-fit)/.test(css), "mobile top tiles define a responsive grid");
assert(css.includes(".mobile-tools-section"), "nested section tile styles exist");
assert(css.includes(".mobile-tools-section .operator-summary-card"), "nested operator cards are styled as tiles");
assert(css.includes(".mobile-tools-section .operator-quick-actions"), "nested operator quick actions use tile layout");
assert(css.includes("@media") && css.includes("max-width"), "mobile CSS is scoped by responsive media rules");

for (const forbidden of ["execute_redeploy", "execute_rollback", "run_approved_repo_action(", "commitChangesDirectly("]) {
  assert(!chat.includes(`onClick={() => ${forbidden}`), `mobile tile board does not wire direct mutating click for ${forbidden}`);
}

console.log("✅ Mobile Tools tile board smoke test passed.");
