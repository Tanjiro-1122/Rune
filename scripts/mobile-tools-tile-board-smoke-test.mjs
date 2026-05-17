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

assert(chat.includes("mobile-tools-shell"), "mobile tools shell class is attached to drawer");
assert(chat.includes("mobile-tools-tile-board"), "mobile tools tile board class exists");
assert(chat.includes('data-testid="mobile-tools-tile-board"'), "mobile tile board test id exists");
assert(chat.includes('data-testid="mobile-tools-top-tiles"'), "top-level tool tiles test id exists");
assert(chat.includes("mobile-tools-top-tile"), "top-level drawer buttons render as mobile tiles");
assert(chat.includes("mobile-tools-top-tile--active"), "active top tile class exists");
assert(chat.includes("mobile-tools-project-tile"), "project switchboard becomes a mobile project tile");
assert(chat.includes("mobile-tools-section"), "nested drawer content uses mobile section tiles");
assert(chat.includes("Mobile command board"), "mobile command board intro copy exists");
assert(chat.includes("Each drawer stays read-only"), "mobile board communicates read-only gate boundary");

for (const drawer of ["operator", "memory", "health", "repo", "build", "activity", "files", "tasks"]) {
  assert(chat.includes(`key: \"${drawer}\"`) || chat.includes(`key: "${drawer}"`), `top-level tile exists for ${drawer}`);
}

assert(css.includes("Mobile Tools tile board — phone-first nested tiles"), "mobile tile board CSS block exists");
assert(css.includes(".mobile-tools-top-tiles"), "mobile top tile grid style exists");
assert(css.includes("grid-template-columns: repeat(2, minmax(0, 1fr)) !important"), "mobile top tiles use 2-column grid");
assert(css.includes(".mobile-tools-section"), "nested section tile styles exist");
assert(css.includes(".mobile-tools-section .operator-summary-card"), "nested operator cards are styled as tiles");
assert(css.includes(".mobile-tools-section .operator-quick-actions"), "nested operator quick actions use tile layout");
assert(css.includes("desktop unchanged"), "CSS explicitly documents desktop unchanged boundary");

for (const forbidden of ["execute_redeploy", "execute_rollback", "run_approved_repo_action(", "commitChangesDirectly("]) {
  assert(!chat.includes(`onClick={() => ${forbidden}`), `mobile tile board does not wire direct mutating click for ${forbidden}`);
}

console.log("✅ Mobile Tools tile board smoke test passed.");
