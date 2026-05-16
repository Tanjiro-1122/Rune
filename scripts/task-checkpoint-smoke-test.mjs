import fs from 'node:fs';

const tasks = fs.readFileSync('lib/tasks.ts', 'utf8');
const jobs = fs.readFileSync('app/api/jobs/route.ts', 'utf8');
const cliRunnerJobs = fs.readFileSync('lib/cli-runner-jobs.ts', 'utf8');
const roadmap = fs.readFileSync('docs/jarvis-endgame-roadmap.md', 'utf8');
const externalRunnerSpec = fs.readFileSync('docs/external-runner-spec.md', 'utf8');
const trustedRunner = fs.readFileSync('scripts/trusted-runner.mjs', 'utf8');
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
  ['trusted runner script exists', /trusted runner starting/.test(trustedRunner) && /JARVIS_RUNNER_DRY_RUN/.test(trustedRunner) && /ALLOW_DRY_RUN_CLAIM/.test(trustedRunner) && /spawn\(command, args/.test(trustedRunner)],
  ['runner dashboard visibility exists', /runner-status-card/.test(chatUi) && /runnerMetadata\?\.job_kind/.test(chatUi) && /runner-command-preview/.test(css)],
  ['runner workspace handoff exists', /workspaceId: workspaceId \?\? null/.test(chatRoute) && /workspaceId: options\.workspaceId/.test(deploymentControl) && /conversationId: options\.conversationId/.test(deploymentControl)],
  ['external services UI exists', /externalServices/.test(chatUi) && /external-service-list/.test(css) && /RevenueCat, App Store Connect, and Google Play/.test(chatUi)],
  ['revenuecat lookup UI exists', /RevenueCatLookupCard/.test(chatUi) && /tool-card--revenuecat/.test(css) && /lookup_revenuecat_subscriber/.test(chatUi)],
  ['app store connect lookup UI exists', /AppStoreConnectLookupCard/.test(chatUi) && /tool-card--appstore/.test(css) && /lookup_app_store_connect_status/.test(chatUi)],
  ['google play lookup UI exists', /GooglePlayLookupCard/.test(chatUi) && /tool-card--googleplay/.test(css) && /lookup_google_play_status/.test(chatUi) && /release tracks blocked/.test(chatUi)],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? '✅' : '❌'} ${name}`);
if (failed.length) process.exit(1);
