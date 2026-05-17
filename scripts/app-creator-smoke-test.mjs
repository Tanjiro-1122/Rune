import fs from "node:fs";

const lib = fs.readFileSync("lib/app-creator.ts", "utf8");
const route = fs.readFileSync("app/api/chat/route.ts", "utf8");
const ui = fs.readFileSync("components/chat.tsx", "utf8");
const css = fs.readFileSync("app/globals.css", "utf8");
const pkg = fs.readFileSync("package.json", "utf8");
const privateExecutor = fs.readFileSync("scripts/private-owner-deploy.mjs", "utf8");
const privateVerifier = fs.readFileSync("scripts/verify-private-owner-access.mjs", "utf8");
const ownerPreviewGate = fs.readFileSync("scripts/prepare-owner-preview.mjs", "utf8");
const ownerPreviewExecution = fs.readFileSync("scripts/execute-owner-preview.mjs", "utf8");
const protectedHostingProvider = fs.readFileSync("scripts/prepare-protected-hosting-provider.mjs", "utf8");
const ownerPreviewTokenContract = fs.readFileSync("scripts/prepare-owner-preview-token-contract.mjs", "utf8");

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ${message}`);
    process.exit(1);
  }
}

assert(/buildAppCreatorPlan/.test(lib), "App Creator must build a deterministic app plan.");
assert(/createAppCreatorProposal/.test(lib), "App Creator must create a controlled proposal.");
assert(/createApprovedAppScaffold/.test(lib), "App Creator must expose approved scaffold generation.");
assert(/runAppCreatorScaffoldBridge/.test(lib), "App Creator must expose scaffold execution bridge.");
assert(/previewAppCreatorProposal/.test(lib), "App Creator must expose preview loop.");
assert(/refineAppCreatorProposal/.test(lib), "App Creator must expose refinement loop.");
assert(/prepareAppCreatorPreviewHandoff/.test(lib), "App Creator must expose preview deployment handoff.");
assert(/queuePrivateAppCreatorDeploy/.test(lib), "App Creator must expose private production queue gate.");
assert(/buildAppScaffoldPatch/.test(lib), "App Creator must build deterministic scaffold patches.");
assert(/blueprint_only_no_files_changed_no_schema_no_deploy/.test(lib), "App Creator must enforce blueprint-only v1 safety.");
assert(/approved_scaffold_patch_no_merge_no_deploy/.test(lib), "App Creator scaffold must not merge or deploy.");
assert(/scaffold_bridge_no_merge_no_deploy_no_schema_mutation/.test(lib), "App Creator bridge must not merge, deploy, or mutate schema.");
assert(/preview_only_no_mutation/.test(lib), "App Creator preview must be read-only.");
assert(/refinement_required_rescaffold/.test(lib), "App Creator refinement must reset scaffold readiness.");
assert(/refined_preview_only_no_files_changed_no_schema_no_deploy/.test(lib), "App Creator refinement must not change files/schema/deploy.");
assert(/metadata_only_no_deploy_no_merge_no_schema_mutation/.test(lib), "App Creator preview handoff must be metadata-only.");
assert(/prepareRepoDeploymentHandoff/.test(lib), "App Creator preview handoff must wrap existing Repo Control deployment handoff.");
assert(/APPROVE PRIVATE JARVIS DEPLOY/.test(lib), "App Creator private deploy must require exact private approval phrase.");
assert(/queued_private_owner_only_executor_artifact_no_public_launch_no_merge_no_schema_mutation/.test(lib), "App Creator private deploy must be owner-only, artifact-only, and queue-only.");
assert(/authRequired: true/.test(lib) && /owner_only_authenticated_javier/.test(lib) && /owner_only_executor_v1/.test(lib), "App Creator private deploy must require owner auth metadata for owner-only execution.");
assert(/queueCliRunnerJob/.test(lib), "App Creator private deploy must queue through the trusted runner system.");
assert(/runRepoControlFlow/.test(lib), "App Creator bridge must route through Repo Control flow.");
assert(/Proposal must be approved before scaffolding/.test(lib), "App Creator scaffold must require proposal approval.");
assert(/createRepoActionProposal/.test(lib), "App Creator must route through Repo Control.");
assert(/create_app_proposal/.test(route), "Chat must expose create_app_proposal tool.");
assert(/approved_app_scaffold/.test(route), "Chat must expose approved_app_scaffold tool.");
assert(/run_app_creator_scaffold_bridge/.test(route), "Chat must expose run_app_creator_scaffold_bridge tool.");
assert(/preview_app_creator_proposal/.test(route), "Chat must expose preview_app_creator_proposal tool.");
assert(/refine_app_creator_proposal/.test(route), "Chat must expose refine_app_creator_proposal tool.");
assert(/prepare_app_creator_preview_handoff/.test(route), "Chat must expose prepare_app_creator_preview_handoff tool.");
assert(/queue_private_app_creator_deploy/.test(route), "Chat must expose queue_private_app_creator_deploy tool.");
assert(/does not edit files, create schemas, deploy, or open a PR/.test(route), "Tool description must state no direct mutation.");
assert(/Jarvis can create apps through the controlled App Creator workflow/.test(route), "System prompt must answer app creation accurately.");
assert(/AppCreatorCard/.test(ui), "Chat UI must render App Creator card.");
assert(/changedFiles/.test(ui), "App Creator card must surface generated scaffold files.");
assert(/repoFlow/.test(ui) && /prUrl/.test(ui), "App Creator card must surface bridge Repo Control and PR details.");
assert(/changedFields/.test(ui) && /revision/.test(ui), "App Creator card must surface refinement details.");
assert(/previewHandoff/.test(ui), "App Creator card must surface preview handoff details.");
assert(/taskId/.test(ui) && /Private App Creator deploy/.test(ui), "App Creator card/dashboard must surface private deploy runner jobs.");
assert(/tool-card--app-creator/.test(ui) && /tool-card--app-creator/.test(css), "App Creator UI styling must exist.");

console.log("✅ App Creator smoke test passed.");
