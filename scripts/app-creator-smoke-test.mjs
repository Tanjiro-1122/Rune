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
assert(/createApprovedAppScaffold/.test(lib), "App Creator must expose approved scaffold generation.");
assert(/buildAppScaffoldPatch/.test(lib), "App Creator must build deterministic scaffold patches.");
assert(/blueprint_only_no_files_changed_no_schema_no_deploy/.test(lib), "App Creator must enforce blueprint-only v1 safety.");
assert(/approved_scaffold_patch_no_merge_no_deploy/.test(lib), "App Creator scaffold must not merge or deploy.");
assert(/Proposal must be approved before scaffolding/.test(lib), "App Creator scaffold must require proposal approval.");
assert(/createRepoActionProposal/.test(lib), "App Creator must route through Repo Control.");
assert(/create_app_proposal/.test(route), "Chat must expose create_app_proposal tool.");
assert(/approved_app_scaffold/.test(route), "Chat must expose approved_app_scaffold tool.");
assert(/does not edit files, create schemas, deploy, or open a PR/.test(route), "Tool description must state no direct mutation.");
assert(/Jarvis can create apps through the controlled App Creator workflow/.test(route), "System prompt must answer app creation accurately.");
assert(/AppCreatorCard/.test(ui), "Chat UI must render App Creator card.");
assert(/changedFiles/.test(ui), "App Creator card must surface generated scaffold files.");
assert(/tool-card--app-creator/.test(ui) && /tool-card--app-creator/.test(css), "App Creator UI styling must exist.");

console.log("✅ App Creator smoke test passed.");
