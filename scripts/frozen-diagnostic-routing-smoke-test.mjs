import fs from 'node:fs';

const orchestration = fs.readFileSync('lib/orchestration.ts', 'utf8');
const route = fs.readFileSync('app/api/chat/route.ts', 'utf8');

const checks = [
  ['frozen diagnostic regex exists', /FROZEN_DIAGNOSTIC_PATTERN/.test(orchestration)],
  ['frozen questions route to lifecycle diagnostic intent', orchestration.includes('isFrozenDiagnosticIntent(options.input, options.messages ?? [])') && orchestration.includes('? "tool_lifecycle_diagnostic"')],
  ['frozen diagnostic forces lifecycle diagnostic tool', /forcedToolName:\s*"get_tool_lifecycle_diagnostic"/.test(orchestration)],
  ['frozen diagnostic route forbids generic load guessing', orchestration.includes('Do not guess generic load/lag')],
  ['frozen diagnostic route names verified vs unverified evidence', orchestration.includes('verified client/tool lifecycle evidence') && orchestration.includes('what remains unverified')],
  ['chat prompt forbids generic temporary processing claims', route.includes('Do not answer with generic claims like "temporary processing delay,"') || route.includes('do not answer with generic claims like "temporary processing delay,"')],
  ['chat prompt requires verified evidence first', route.includes('State the exact verified evidence')],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? '✅' : '❌'} ${name}`);
if (failed.length) process.exit(1);
console.log('✅ Frozen diagnostic lifecycle routing smoke test passed.');
