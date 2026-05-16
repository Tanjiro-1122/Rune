import fs from "node:fs";

const lib = fs.readFileSync("lib/app-creator.ts", "utf8");
const route = fs.readFileSync("app/api/chat/route.ts", "utf8");
const ui = fs.readFileSync("components/chat.tsx", "utf8");
const css = fs.readFileSync("app/globals.css", "utf8");

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ${message}`);
    process.exit(1);
  }
}

assert(/buildAppCreatorPlan/.test(lib), "App Creator must build a deterministic app plan.");
assert(/createAppCreatorProposal/.test(lib), "App Creator must create a controlled proposal.");
assert(/blueprint_only_no_files_changed_no_schema_no_deploy/.test(lib), "App Creator must enforce blueprint-only v1 safety.");
assert(/createRepoActionProposal/.test(lib), "App Creator must route through Repo Control.");
assert(/create_app_proposal/.test(route), "Chat must expose create_app_proposal tool.");
assert(/does not edit files, create schemas, deploy, or open a PR/.test(route), "Tool description must state no direct mutation.");
assert(/Jarvis can create apps through the controlled App Creator workflow/.test(route), "System prompt must answer app creation accurately.");
assert(/AppCreatorCard/.test(ui), "Chat UI must render App Creator card.");
assert(/tool-card--app-creator/.test(ui) && /tool-card--app-creator/.test(css), "App Creator UI styling must exist.");

console.log("✅ App Creator smoke test passed.");
