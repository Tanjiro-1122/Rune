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

assert(chat.includes("mobile-tools-project-tile"), "mobile project switchboard class exists");
assert(chat.includes("Project switchboard"), "project switchboard remains visible");
assert(chat.includes("selectProject(project.key)"), "project switching logic remains wired");
assert(css.includes(".mobile-tools-project-tile .context-panel-header"), "mobile project header compact style exists");
assert(css.includes(".mobile-tools-project-tile .side-section-copy"), "mobile project helper copy can be hidden");
assert(css.includes("display: none"), "mobile compact switchboard hides secondary copy/repo details");
assert(css.includes(".mobile-tools-project-tile .project-switchboard-card"), "mobile project card compact style exists");
assert(css.includes("min-height: 58px"), "mobile project cards are shorter");
assert(css.includes("border-radius: 18px"), "mobile project cards have compact radius");
assert(css.includes("padding: 0.62rem 0.66rem"), "mobile project cards use tighter padding");
assert(css.includes(".mobile-tools-project-tile .project-switchboard-card em"), "mobile repo line is targeted");
assert(css.includes(".mobile-tools-project-tile .project-safety-badge"), "mobile safety badge remains styled");
assert(css.includes("font-size: 0.52rem"), "mobile safety badge is compact");

for (const forbidden of ["execute_redeploy", "execute_rollback", "run_approved_repo_action(", "commitChangesDirectly("]) {
  assert(!chat.includes(`onClick={() => ${forbidden}`), `project switchboard polish does not wire direct mutating click for ${forbidden}`);
}

console.log("✅ Mobile Tools project switchboard smoke test passed.");
