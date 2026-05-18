import fs from 'node:fs';

const orchestration = fs.readFileSync('lib/orchestration.ts', 'utf8');
const route = fs.readFileSync('app/api/chat/route.ts', 'utf8');
const chat = fs.readFileSync('components/chat.tsx', 'utf8');
const toolCards = fs.readFileSync('components/chat/tool-cards.tsx', 'utf8');
const chatUi = `${chat}\n${toolCards}`;
const build = fs.readFileSync('lib/build-intelligence.ts', 'utf8');
const diagnostic = fs.readFileSync('lib/tool-lifecycle-diagnostic.ts', 'utf8');

const checks = [
  ['tool lifecycle diagnostic intent exists', orchestration.includes('"tool_lifecycle_diagnostic"')],
  ['frozen intent helper is exported', orchestration.includes('export function isFrozenDiagnosticIntent')],
  ['freeze route uses lightweight diagnostic tool', orchestration.includes('forcedToolName: "get_tool_lifecycle_diagnostic"')],
  ['freeze route no longer forces full self-audit', !/isFrozenDiagnostic[\s\S]{0,260}forcedToolName:\s*"get_rune_self_audit_snapshot"/.test(orchestration)],
  ['route imports frozen diagnostic helper', route.includes('isFrozenDiagnosticIntent')],
  ['forced tool choice can return lifecycle diagnostic', route.includes('toolName: "get_tool_lifecycle_diagnostic"')],
  ['tool is registered in base agent tools', route.includes('get_tool_lifecycle_diagnostic: tool({')],
  ['prompt says not to call full self-audit for freeze reports', route.includes('Do not call full self-audit for those symptoms')],
  ['diagnostic has no-network/no-self-audit guard', diagnostic.includes('shouldRunFullSelfAudit: false')],
  ['diagnostic explicitly blocks fake load claims', diagnostic.includes('system load') && diagnostic.includes('backend lag')],
  ['chat label exists for lifecycle diagnostic', chatUi.includes('get_tool_lifecycle_diagnostic: "Checking Rune response lifecycle"')],
  ['lifecycle tool is long-form diagnostic for answer-follows UI', chatUi.includes('"get_tool_lifecycle_diagnostic"') && chatUi.includes('showLifecycleFallback')],
  ['lifecycle card removes indefinite spinner', chatUi.includes('so this card will not spin indefinitely')],
  ['capability dedupe includes lifecycle diagnostic', chat.includes('invocation.toolName === "get_tool_lifecycle_diagnostic"')],
  ['external intelligence timeout constant exists', build.includes('EXTERNAL_INTELLIGENCE_TIMEOUT_MS = 8_000')],
  ['external intelligence uses Promise.race timeout', build.includes('Promise.race') && build.includes('withIntelligenceTimeout')],
  ['github timeout returns partial snapshot', build.includes('GitHub intelligence timed out after')],
  ['vercel timeout returns partial snapshot', build.includes('Vercel intelligence timed out after')],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? '✅' : '❌'} ${name}`);
if (failed.length) process.exit(1);
console.log('✅ Freeze lifecycle final smoke test passed.');
