import fs from 'node:fs';
const source = fs.readFileSync('lib/orchestration.ts', 'utf8');
const route = fs.readFileSync('app/api/chat/route.ts', 'utf8');
const repoActions = fs.readFileSync('lib/repo-actions.ts', 'utf8');
const deploymentControl = fs.readFileSync('lib/deployment-control.ts', 'utf8');
const externalServicesHealth = fs.readFileSync('lib/external-services-health.ts', 'utf8');
const revenueCatReadOnly = fs.readFileSync('lib/revenuecat-readonly.ts', 'utf8');
const appStoreConnectReadOnly = fs.readFileSync('lib/app-store-connect-readonly.ts', 'utf8');
const googlePlayReadOnly = fs.readFileSync('lib/google-play-readonly.ts', 'utf8');
const googlePlayRoute = fs.readFileSync('app/api/google-play/route.ts', 'utf8');
const appHealthSnapshot = fs.readFileSync('lib/app-health-snapshot.ts', 'utf8');
const appHealthRoute = fs.readFileSync('app/api/app-health/route.ts', 'utf8');
const appStoreConnectRoute = fs.readFileSync('app/api/app-store-connect/route.ts', 'utf8');
const revenueCatRoute = fs.readFileSync('app/api/revenuecat/route.ts', 'utf8');
const buildIntelligence = fs.readFileSync('lib/build-intelligence.ts', 'utf8');

const orchestration = fs.readFileSync('lib/orchestration.ts', 'utf8');
const explicitRepoProposalPattern = /const EXPLICIT_REPO_PROPOSAL_PATTERN/.test(orchestration);
const safeReviewOnlyPattern = /const SAFE_REVIEW_ONLY_PATTERN/.test(orchestration);
const narrowedDeployPattern = /Only route deployment as approval-required/.test(orchestration) && /deploy to production/.test(orchestration) && !orchestration.includes('const DEPLOY_ACTION_PATTERN = /\\b(deploy|deployment|rollback|redeploy)');
const chatRoute = fs.readFileSync('app/api/chat/route.ts', 'utf8');
const checks = [
  ['self-audit pattern exists', /SELF_AUDIT_PATTERN/.test(source)],
  ['no corrupted backspace word-boundary characters', !source.includes('\u0008') && !source.includes('=\b')],
  ['calculator requires explicit math/numeric expression', /EXPLICIT_CALC_PATTERN/.test(source) && /NUMERIC_EXPRESSION_PATTERN/.test(source)],
  ['repo inspection exported', /export function needsRepositoryInspection/.test(source)],
  ['agent work loop injected', /Agent Core Work Loop/.test(fs.readFileSync('lib/agent-work-loop.ts', 'utf8')) && /agentWorkLoopSection/.test(route)],
  ['chat can create repo proposals', /create_repo_action_proposal/.test(route)],
  ['chat can run repo action stages', /run_repo_action_stage/.test(route)],
  ['chat can run repo action ladder', /run_repo_action_ladder/.test(route)],
  ['repo targeting layer exists', fs.existsSync('lib/repo-targeting.ts') && /inferRepoActionTargets/.test(fs.readFileSync('lib/repo-targeting.ts', 'utf8'))],
  ['repo tree validation exists', /validateRepoActionTargets/.test(fs.readFileSync('lib/repo-targeting.ts', 'utf8')) && /repo_tree_verified/.test(fs.readFileSync('lib/repo-actions.ts', 'utf8'))],
  ['owner summary discipline exists', /Final response discipline/.test(route) && /never dump raw tool JSON/.test(route)],
  ['controlled executor exists', /runApprovedRepoActionExecutor/.test(fs.readFileSync('lib/repo-actions.ts', 'utf8')) && /run_approved_repo_action/.test(route)],
  ['repo control flow exists', /runRepoControlFlow/.test(repoActions) && /runApprovedRepoActionExecutor/.test(repoActions) && /approval_required_no_merge_no_deploy/.test(repoActions) && /pr_only_no_merge_no_deploy/.test(repoActions)],
  ['deployment control exists', fs.existsSync('lib/deployment-control.ts') && /deployment_control/.test(route) && /prepareDeploymentControlAction/.test(fs.readFileSync('lib/deployment-control.ts', 'utf8'))],
  ['deployment executor gate exists', /executeDeploymentControlAction/.test(deploymentControl) && /APPROVE JARVIS REDEPLOY/.test(deploymentControl) && /cli_runner_not_enabled/.test(deploymentControl) && /execute_redeploy/.test(route)],
  ['specific tool labels exist', /getToolDisplayLabel/.test(fs.readFileSync('components/chat.tsx', 'utf8')) && /Preparing rollback approval/.test(fs.readFileSync('components/chat.tsx', 'utf8'))],
  ['repo/deployment UI status details exist', /readinessSummary/.test(fs.readFileSync('components/chat.tsx', 'utf8')) && /Required phrase/.test(fs.readFileSync('components/chat.tsx', 'utf8')) && /repo-control-status/.test(fs.readFileSync('app/globals.css', 'utf8'))],
  ['repo proposal outranks deployment wording', explicitRepoProposalPattern && safeReviewOnlyPattern && narrowedDeployPattern && /capabilityDedupeKey/.test(fs.readFileSync('components/chat.tsx', 'utf8'))],
  ['repo ladder avoids calculator', /isRepoControlCommand/.test(chatRoute) && /withoutUuids/.test(chatRoute) && /Repo Control command detected; do not route to calculator/.test(chatRoute) && /safe repo control ladder/.test(orchestration)],
  ['jarvis voice layer exists', /Voice and personality/.test(chatRoute) && /private AI person/.test(chatRoute) && /not a compliance dashboard/.test(chatRoute) && /honest read/.test(chatRoute) && /Personality never overrides safety/.test(chatRoute)],
  ['external services health exists', /RevenueCat/.test(externalServicesHealth) && /App Store Connect/.test(externalServicesHealth) && /Google Play/.test(externalServicesHealth) && /externalServices/.test(buildIntelligence)],
  ['revenuecat read-only client exists', /getRevenueCatSubscriberReadOnly/.test(revenueCatReadOnly) && /method: \"GET\"/.test(revenueCatReadOnly) && !/method: \"POST\"|method: \"PATCH\"|method: \"DELETE\"|method: \"PUT\"/.test(revenueCatReadOnly) && /readOnly: true/.test(revenueCatRoute)],
  ['revenuecat chat tool exists', /lookup_revenuecat_subscriber/.test(route) && /getRevenueCatSubscriberReadOnly/.test(route) && /never grants entitlements/.test(route)],
  ['app store connect read-only client exists', /getAppStoreConnectReadOnlySummary/.test(appStoreConnectReadOnly) && /method: \"GET\"/.test(appStoreConnectReadOnly) && !/method: \"POST\"|method: \"PATCH\"|method: \"DELETE\"|method: \"PUT\"/.test(appStoreConnectReadOnly) && /readOnly: true/.test(appStoreConnectRoute)],
  ['app store connect chat tool exists', /lookup_app_store_connect_status/.test(route) && /getAppStoreConnectReadOnlySummary/.test(route) && /never imply release/.test(route)],
  ['google play read-only client exists', /getGooglePlayReadOnlySummary/.test(googlePlayReadOnly) && /method: \"GET\"/.test(googlePlayReadOnly) && /Release track visibility/.test(googlePlayReadOnly) && /readOnly: true/.test(googlePlayRoute)],
  ['google play chat tool exists', /lookup_google_play_status/.test(route) && /getGooglePlayReadOnlySummary/.test(route) && /release tracks are blocked/.test(route)],
  ['app health snapshot exists', /getAppHealthSnapshot/.test(appHealthSnapshot) && /getBuildIntelligenceSnapshot/.test(appHealthSnapshot) && /getAppStoreConnectReadOnlySummary/.test(appHealthSnapshot) && /getGooglePlayReadOnlySummary/.test(appHealthSnapshot) && /getAppHealthSnapshot/.test(appHealthRoute)],
  ['app health snapshot tool exists', /get_app_health_snapshot/.test(route) && /getAppHealthSnapshot/.test(route) && /never commits, deploys, releases, publishes/.test(route)],
  ['repo control flow chat tool exists', /run_repo_control_flow/.test(route) && /runRepoControlFlow/.test(route) && /never merges, deploys/.test(route)],
];
const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? '✅' : '❌'} ${name}`);
if (failed.length) process.exit(1);
