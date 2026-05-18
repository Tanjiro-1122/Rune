import fs from 'node:fs';

const chat = fs.readFileSync('components/chat.tsx', 'utf8');

const checks = [
  ['stall watchdog timeout constant exists', chat.includes('STREAM_STALL_WATCHDOG_MS = 18_000')],
  ['secondary recovery timeout exists', chat.includes('STREAM_STALL_SECONDARY_RECOVERY_MS = 10_000')],
  ['stall refs prevent duplicate recovery', chat.includes('streamStallWatchdogTimerRef') && chat.includes('streamStallRecoveryInFlightRef')],
  ['stall state is separate from finalization state', chat.includes('streamStallRecovered') && chat.includes('streamFinalizationRecovered')],
  ['stall path covers in-flight request with no visible assistant message', chat.includes('isStreamStalled = isChatRequestInFlight && streamStallRecovered && !hasVisibleAssistantMessage')],
  ['watchdog detects no visible assistant text', chat.includes('if (!isChatRequestInFlight || hasVisibleAssistantMessage)')],
  ['watchdog refreshes conversation history', chat.includes('loadConversation(sessionId, workspaceId, conversationId)')],
  ['watchdog refreshes tasks', chat.includes('refreshTasks(sessionId, workspaceId, conversationId)')],
  ['watchdog communicates recovery to Javier', chat.includes('Checking for completed answer…') && chat.includes('Response stalled. I refreshed saved chat state so you can continue.')],
  ['stall state unlocks loading lock', chat.includes('!isStreamStalled') && chat.includes('const isLoading = (isChatRequestInFlight && !isStreamFinalizing && !isStreamStalled) || isUploadingAttachment')],
  ['send button recovers to Send on stall', chat.includes('isStreamStalled ? "Send"')],
  ['typing indicator does not keep fake spinner alive after stall', chat.includes('isLoading && !isStreamStalled')],
  ['existing PR43 finalization guard remains', chat.includes('STREAM_FINALIZATION_RECOVERY_MS = 12_000') && chat.includes('Finalizing answer…')],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? '✅' : '❌'} ${name}`);
if (failed.length) process.exit(1);
console.log('✅ Stream stall watchdog smoke test passed.');
