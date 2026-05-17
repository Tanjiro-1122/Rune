import fs from 'node:fs';

const orchestration = fs.readFileSync('lib/orchestration.ts', 'utf8');
const route = fs.readFileSync('app/api/chat/route.ts', 'utf8');

const checks = [
  ['frozen diagnostic regex exists', /FROZEN_DIAGNOSTIC_PATTERN/.test(orchestration)],
  ['frozen questions route to self-audit intent', /SELF_AUDIT_PATTERN\.test\(lower\) \|\| FROZEN_DIAGNOSTIC_PATTERN\.test\(lower\)/.test(orchestration)],
  ['frozen diagnostic forces self-audit snapshot', /forcedToolName:\s*"get_jarvis_self_audit_snapshot"/.test(orchestration)],
  ['frozen diagnostic route forbids generic load guessing', orchestration.includes('Do not guess generic load/lag')],
  ['frozen diagnostic route names verified vs unverified evidence', orchestration.includes('what remains unverified without server logs')],
  ['chat prompt forbids generic temporary processing claims', route.includes('do not answer with generic claims like "temporary processing delay,"')],
  ['chat prompt requires verified evidence first', route.includes('State the exact verified evidence')],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? '✅' : '❌'} ${name}`);
if (failed.length) process.exit(1);
console.log('✅ Frozen diagnostic routing smoke test passed.');
