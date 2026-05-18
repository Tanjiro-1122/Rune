import fs from 'node:fs';

const chat = fs.readFileSync('components/chat.tsx', 'utf8');
const toolCards = fs.readFileSync('components/chat/tool-cards.tsx', 'utf8');
const chatUi = `${chat}\n${toolCards}`;
const route = fs.readFileSync('app/api/chat/route.ts', 'utf8');

const checks = [
  ['long-form diagnostic tool set exists', chatUi.includes('LONG_FORM_DIAGNOSTIC_TOOLS')],
  ['self-audit is treated as long-form diagnostic', chatUi.includes('"get_rune_self_audit_snapshot"') && chatUi.includes('isLongFormDiagnosticTool')],
  ['tool card receives assistant text context', chat.includes('assistantHasText={Boolean(messageText.trim())}')],
  ['pending diagnostic card can show answer-follows state', chatUi.includes('tool-card--answer-follows')],
  ['answer-follows state removes spinner', chatUi.includes('isPending && !showAnswerFollows') || chatUi.includes('!showAnswerFollows && !showLifecycleFallback')],
  ['answer-follows copy explains summarizing below', chatUi.includes('summarizing the result below')],
  ['self-audit prompt forbids verified-all contradiction', route.includes('never say "all capabilities are verified" if any setup/integration/configuration gaps exist')],
  ['self-audit prompt requires lifecycle explanation for delayed tool cards', route.includes('tool call started, result/summary rendering lagged')],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? '✅' : '❌'} ${name}`);
if (failed.length) process.exit(1);
console.log('✅ Self-audit lifecycle smoke test passed.');
