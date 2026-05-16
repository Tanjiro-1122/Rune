import fs from 'node:fs';
const source = fs.readFileSync('lib/orchestration.ts', 'utf8');
const route = fs.readFileSync('app/api/chat/route.ts', 'utf8');

const orchestration = fs.readFileSync('lib/orchestration.ts', 'utf8');
const explicitRepoProposalPattern = /const EXPLICIT_REPO_PROPOSAL_PATTERN/.test(orchestration);
const safeReviewOnlyPattern = /const SAFE_REVIEW_ONLY_PATTERN/.test(orchestration);
const narrowedDeployPattern = /Only route deployment as approval-required/.test(orchestration) && /deploy to production/.test(orchestration) && !orchestration.includes('const DEPLOY_ACTION_PATTERN = /\\b(deploy|deployment|rollback|redeploy)');
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
  ['deployment control exists', fs.existsSync('lib/deployment-control.ts') && /deployment_control/.test(route) && /prepareDeploymentControlAction/.test(fs.readFileSync('lib/deployment-control.ts', 'utf8'))],
  ['specific tool labels exist', /getToolDisplayLabel/.test(fs.readFileSync('components/chat.tsx', 'utf8')) && /Preparing rollback approval/.test(fs.readFileSync('components/chat.tsx', 'utf8'))],
  ['repo proposal outranks deployment wording', explicitRepoProposalPattern && safeReviewOnlyPattern && narrowedDeployPattern && /capabilityDedupeKey/.test(fs.readFileSync('components/chat.tsx', 'utf8'))],
];
const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? '✅' : '❌'} ${name}`);
if (failed.length) process.exit(1);
