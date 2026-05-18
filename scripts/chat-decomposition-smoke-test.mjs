import fs from 'node:fs';

const chatPath = 'components/chat.tsx';
const toolCardsPath = 'components/chat/tool-cards.tsx';
const chat = fs.readFileSync(chatPath, 'utf8');
const toolCards = fs.readFileSync(toolCardsPath, 'utf8');
const chatLines = chat.split('\n').length;
const toolCardLines = toolCards.split('\n').length;

const checks = [
  ['chat.tsx is reduced below 4000 lines', chatLines < 4000],
  ['tool-cards module exists with substantial extracted rendering code', toolCardLines > 1000],
  ['chat.tsx imports ToolCallCard from extracted module', chat.includes('from "./chat/tool-cards"') && chat.includes('ToolCallCard')],
  ['extracted module exports ToolCallCard', toolCards.includes('export function ToolCallCard')],
  ['extracted module exports ToolInvocation type', toolCards.includes('export interface ToolInvocation')],
  ['extracted module exports AppHealthSnapshotResult type', toolCards.includes('export type AppHealthSnapshotResult')],
  ['chat.tsx no longer defines ToolCallCard inline', !chat.includes('function ToolCallCard({')],
  ['chat.tsx no longer carries tool label registry', !chat.includes('const TOOL_LABELS')],
  ['tool lifecycle diagnostic card behavior preserved', toolCards.includes('Checking Jarvis response lifecycle') && toolCards.includes('so this card will not spin indefinitely')],
  ['long-form diagnostic answer-follows guard preserved', toolCards.includes('LONG_FORM_DIAGNOSTIC_TOOLS') && toolCards.includes('showAnswerFollows')],
];

const failed = checks.filter(([, ok]) => !ok);
console.log(`chat.tsx lines: ${chatLines}`);
console.log(`tool-cards.tsx lines: ${toolCardLines}`);
for (const [name, ok] of checks) console.log(`${ok ? '✅' : '❌'} ${name}`);
if (failed.length) process.exit(1);
console.log('✅ Chat decomposition smoke test passed.');
