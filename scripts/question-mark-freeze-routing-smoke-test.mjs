import fs from 'node:fs';

const orchestration = fs.readFileSync('lib/orchestration.ts', 'utf8');
const route = fs.readFileSync('app/api/chat/route.ts', 'utf8');

const checks = [
  ['question-mark freeze symptom is covered', orchestration.includes('it freezes?( then)? when i (put|send|type)')],
  ['freezes until question mark is covered', orchestration.includes('freezes? until i (put|send|type)')],
  ['answer appears after question mark is covered', orchestration.includes('answer (only )?(appears|shows up|comes through|comes back) after i')],
  ['lone question mark can be a frozen follow-up', orchestration.includes('const FROZEN_DIAGNOSTIC_FOLLOWUP_PATTERN = /^(\\s*\\?\\s*)$') || orchestration.includes('const FROZEN_DIAGNOSTIC_FOLLOWUP_PATTERN = /^(\s*\?\s*)$') || /FROZEN_DIAGNOSTIC_FOLLOWUP_PATTERN = \/\^\(\\s\*\\\?\\s\*\)\$/.test(orchestration)],
  ['prompt names question-mark delayed answer symptom', route.includes('answer appears only after sending a question mark')],
  ['prompt keeps question mark followup in context', route.includes('"?," "fix it,"')],
  ['prompt still blocks fake load claims', route.includes('"system load," "high traffic," "resource allocation,"')],
  ['prompt still requires evidence before metrics claims', route.includes('actual runtime/log/code-inspection tool result')],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? '✅' : '❌'} ${name}`);
if (failed.length) process.exit(1);
console.log('✅ Question-mark freeze routing smoke test passed.');
