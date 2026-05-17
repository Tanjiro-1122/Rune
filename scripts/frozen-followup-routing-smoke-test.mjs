import fs from 'node:fs';

const orchestration = fs.readFileSync('lib/orchestration.ts', 'utf8');
const route = fs.readFileSync('app/api/chat/route.ts', 'utf8');

const checks = [
  ['exact phrase why you were frozen is covered', orchestration.includes('why (you|jarvis) (were|are|got|became) (frozen|stuck|hung|stalled)')],
  ['lost you for a second wording is covered', orchestration.includes('lost you (there )?(for )?(a )?(second|sec|moment)')],
  ['frozen follow-up pattern exists', orchestration.includes('FROZEN_DIAGNOSTIC_FOLLOWUP_PATTERN')],
  ['build planner accepts recent messages', orchestration.includes('messages?: UIMessage[]') && route.includes('messages,' )],
  ['follow-ups can force self-audit intent', orchestration.includes('? "self_audit"') && orchestration.includes('isFrozenDiagnosticFollowup(options.input, options.messages ?? [])')],
  ['prompt blocks fake system load claims', route.includes('"system load," "high traffic," "resource allocation,"')],
  ['prompt blocks fake metrics review claims', route.includes('Never say "I reviewed system load,"')],
  ['prompt requires actual runtime/log/code-inspection tool result', route.includes('actual runtime/log/code-inspection tool result')],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? '✅' : '❌'} ${name}`);
if (failed.length) process.exit(1);
console.log('✅ Frozen follow-up routing smoke test passed.');
