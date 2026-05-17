import fs from 'node:fs';

const tasks = fs.readFileSync('lib/tasks.ts', 'utf8');
const jobs = fs.readFileSync('app/api/jobs/route.ts', 'utf8');
const cliRunnerJobs = fs.readFileSync('lib/cli-runner-jobs.ts', 'utf8');
const roadmap = fs.readFileSync('docs/jarvis-endgame-roadmap.md', 'utf8');
const externalRunnerSpec = fs.readFileSync('docs/external-runner-spec.md', 'utf8');
const trustedRunner = fs.readFileSync('scripts/trusted-runner.mjs', 'utf8');
const privateOwnerDeploy = fs.readFileSync('scripts/private-owner-deploy.mjs', 'utf8');
const privateAccessVerifier = fs.readFileSync('scripts/verify-private-owner-access.mjs', 'utf8');
const ownerPreviewGate = fs.readFileSync('scripts/prepare-owner-preview.mjs', 'utf8');
const ownerPreviewExecution = fs.readFileSync('scripts/execute-owner-preview.mjs', 'utf8');
const protectedHostingProvider = fs.readFileSync('scripts/prepare-protected-hosting-provider.mjs', 'utf8');
const ownerPreviewTokenContract = fs.readFileSync('scripts/prepare-owner-preview-token-contract.mjs', 'utf8');
const packageJson = fs.readFileSync('package.json', 'utf8');
const deploymentControl = fs.readFileSync('lib/deployment-control.ts', 'utf8');
const chatUi = fs.readFileSync('components/chat.tsx', 'utf8');
const css = fs.readFileSync('app/globals.css', 'utf8');
const chatRoute = fs.readFileSync('app/api/chat/route.ts', 'utf8');

const checks = [
  ['checkpoint input type exists', /WorkspaceTaskCheckpointInput/.test(tasks)],
  ['checkpoint writer exists', /addWorkspaceTaskCheckpoint/.test(tasks)],
  ['latest checkpoint reader exists', /getLatestWorkspaceTaskCheckpoint/.test(tasks)],
  ['uses runner metadata for checkpoints', /runner_metadata/.test(tasks) && /latest_checkpoint/.test(tasks)],
  ['checkpoint route action exists', /CheckpointJobSchema/.test(jobs) && /action: z\.literal\("checkpoint"\)/.test(jobs)],
  ['latest checkpoint route action exists', /LatestCheckpointSchema/.test(jobs) && /latest_checkpoint/.test(jobs)],
  ['checkpoint action events logged', /job\.checkpoint_saved/.test(jobs) && /job\.checkpoint_blocked/.test(jobs)],
  ['persistent operator phase documented', /Persistent Operator/.test(roadmap) && /resumable work plans and checkpoints/.test(roadmap)],
  ['checkpoint UI exists', /latest_checkpoint/.test(chatUi) && /Latest checkpoint/.test(chatUi) && /task-checkpoint-card/.test(css)],
  ['chat auto-checkpoint exists', /addWorkspaceTaskCheckpoint/.test(chatRoute) && /Chat task completed/.test(chatRoute) && /Chat task interrupted/.test(chatRoute)],
  ['cli runner queued jobs exist', /queueCliRunnerJob/.test(cliRunnerJobs) && /queued_only_no_local_execution/.test(cliRunnerJobs) && /intent: \"cli_runner\"/.test(cliRunnerJobs)],
  ['external runner spec exists', /External Runner Spec v1/.test(externalRunnerSpec) && /JARVIS_RUNNER_TOKEN/.test(externalRunnerSpec) && /APPROVE JARVIS ROLLBACK/.test(externalRunnerSpec) && /must not execute/.test(externalRunnerSpec)],
  ['private app creator runner spec exists', /private_app_creator_deploy/.test(externalRunnerSpec) && /APPROVE PRIVATE JARVIS DEPLOY/.test(externalRunnerSpec) && /owner_only_authenticated_javier/.test(externalRunnerSpec) && /owner-only artifact executor/.test(externalRunnerSpec) && /Private access verification v1.8/.test(externalRunnerSpec) && /Owner-only hosted preview gate v1.9/.test(externalRunnerSpec) && /Protected owner preview execution v1.10/.test(externalRunnerSpec) && /Protected hosting provider adapter v1.11/.test(externalRunnerSpec) && /Signed owner preview token contract v1.12/.test(externalRunnerSpec)],
  ['trusted runner script exists', /trusted runner starting/.test(trustedRunner) && /JARVIS_RUNNER_DRY_RUN/.test(trustedRunner) && /ALLOW_DRY_RUN_CLAIM/.test(trustedRunner) && /spawn\(command, args/.test(trustedRunner)],
  ['private app creator dry-run validator exists', /validatePrivateAppCreatorDeployMetadata/.test(trustedRunner) && /Private App Creator deploy dry-run passed/.test(trustedRunner) && /owner_only_not_true/.test(trustedRunner) && /executor_mode_not_allowed_private_owner_mode/.test(trustedRunner)],
  ['private owner executor exists', /private-owner-deploy/.test(packageJson) && /JARVIS_PRIVATE_OWNER_EXECUTOR_MODE/.test(trustedRunner) && /JARVIS_PRIVATE_DEPLOY_METADATA_BASE64/.test(trustedRunner) && /private_owner_executor_artifact_only_no_public_launch_no_prod_deploy/.test(privateOwnerDeploy)],
  ['private owner executor blocks public deploy', !/--prod/.test(privateOwnerDeploy) && !/vercel deploy/.test(privateOwnerDeploy) && /publicLaunch: false/.test(privateOwnerDeploy) && /customerFacing: false/.test(privateOwnerDeploy)],
  ['private access verifier exists', /verify-private-owner-access/.test(packageJson) && /validatePrivateOwnerAccessManifest/.test(privateAccessVerifier) && /private_access_verified_owner_only_no_public_launch/.test(privateAccessVerifier) && /private-access-verifications/.test(privateAccessVerifier)],
  ['private access verifier blocks public deploy', !/--prod/.test(privateAccessVerifier) && !/vercel deploy/.test(privateAccessVerifier) && /deployed_publicly_must_be_false/.test(privateAccessVerifier) && /vercel_prod_must_be_false/.test(privateAccessVerifier)],
  ['owner preview gate exists', /prepare-owner-preview/.test(packageJson) && /owner_only_hosted_preview_gate_prepared_no_public_preview/.test(ownerPreviewGate) && /private-preview-gates/.test(ownerPreviewGate) && /APPROVE OWNER PREVIEW HOSTING/.test(ownerPreviewGate)],
  ['owner preview gate blocks public preview', !/--prod/.test(ownerPreviewGate) && !/vercel deploy/.test(ownerPreviewGate) && /publicPreviewUrl: null/.test(ownerPreviewGate) && /hostedPreviewCreated: false/.test(ownerPreviewGate) && /deployCommandPrepared: false/.test(ownerPreviewGate)],
  ['protected owner preview execution exists', /execute-owner-preview/.test(packageJson) && /protected_owner_preview_execution_recorded_no_hosting_no_public_url/.test(ownerPreviewExecution) && /private-preview-executions/.test(ownerPreviewExecution) && /APPROVE OWNER PREVIEW HOSTING/.test(ownerPreviewExecution)],
  ['protected owner preview execution blocks hosting', !/--prod/.test(ownerPreviewExecution) && !/vercel deploy/.test(ownerPreviewExecution) && /publicPreviewUrl: null/.test(ownerPreviewExecution) && /protectedPreviewUrl: null/.test(ownerPreviewExecution) && /deployCommandExecuted: false/.test(ownerPreviewExecution)],
  ['protected hosting provider adapter exists', /prepare-protected-hosting-provider/.test(packageJson) && /protected_hosting_provider_adapter_prepared_no_deploy_no_public_url/.test(protectedHostingProvider) && /protected-hosting-providers/.test(protectedHostingProvider) && /jarvis_signed_owner_proxy/.test(protectedHostingProvider)],
  ['protected hosting provider adapter blocks hosting', !/--prod/.test(protectedHostingProvider) && !/vercel deploy/.test(protectedHostingProvider) && /rawProviderUrlExposed: false/.test(protectedHostingProvider) && /publicPreviewUrl: null/.test(protectedHostingProvider) && /protectedPreviewUrl: null/.test(protectedHostingProvider) && /deployCommandExecuted: false/.test(protectedHostingProvider)],
  ['owner preview token contract exists', /prepare-owner-preview-token-contract/.test(packageJson) && /owner_preview_token_contract_prepared_no_token_no_route_no_url/.test(ownerPreviewTokenContract) && /owner-preview-token-contracts/.test(ownerPreviewTokenContract) && /APPROVE OWNER PREVIEW TOKEN ROUTE/.test(ownerPreviewTokenContract)],
  ['owner preview token contract blocks token route and urls', !/--prod/.test(ownerPreviewTokenContract) && !/vercel deploy/.test(ownerPreviewTokenContract) && /tokenGenerated: false/.test(ownerPreviewTokenContract) && /tokenRouteCreated: false/.test(ownerPreviewTokenContract) && /livePreviewRouteCreated: false/.test(ownerPreviewTokenContract) && /publicPreviewUrl: null/.test(ownerPreviewTokenContract) && /protectedPreviewUrl: null/.test(ownerPreviewTokenContract)],
  ['runner dashboard visibility exists', /runner-status-card/.test(chatUi) && /runnerMetadata\?\.job_kind/.test(chatUi) && /runner-command-preview/.test(css)],
  ['runner workspace handoff exists', /workspaceId: workspaceId \?\? null/.test(chatRoute) && /workspaceId: options\.workspaceId/.test(deploymentControl) && /conversationId: options\.conversationId/.test(deploymentControl)],
  ['external services UI exists', /externalServices/.test(chatUi) && /external-service-list/.test(css) && /RevenueCat, App Store Connect, and Google Play/.test(chatUi)],
  ['revenuecat lookup UI exists', /RevenueCatLookupCard/.test(chatUi) && /tool-card--revenuecat/.test(css) && /lookup_revenuecat_subscriber/.test(chatUi)],
  ['app store connect lookup UI exists', /AppStoreConnectLookupCard/.test(chatUi) && /tool-card--appstore/.test(css) && /lookup_app_store_connect_status/.test(chatUi)],
  ['google play lookup UI exists', /GooglePlayLookupCard/.test(chatUi) && /tool-card--googleplay/.test(css) && /lookup_google_play_status/.test(chatUi) && /release tracks blocked/.test(chatUi)],
  ['app health snapshot UI exists', /AppHealthSnapshotCard/.test(chatUi) && /tool-card--app-health/.test(css) && /get_app_health_snapshot/.test(chatUi) && /Read-only only/.test(chatUi)],
  ['repo control flow UI exists', /RepoControlFlowCard/.test(chatUi) && /tool-card--repo-flow/.test(css) && /run_repo_control_flow/.test(chatUi) && /no merge/.test(chatUi)],
  ['deployment handoff UI exists', /DeploymentHandoffCard/.test(chatUi) && /tool-card--deployment-handoff/.test(css) && /prepare_repo_deployment_handoff/.test(chatUi) && /Metadata-only/.test(chatUi)],
  ['operator console UI exists', /operator-console-panel/.test(chatUi) && /refreshOperatorConsole/.test(chatUi) && /operator-summary-grid/.test(css) && /Read-only operator view/.test(chatUi)],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? '✅' : '❌'} ${name}`);
if (failed.length) process.exit(1);
