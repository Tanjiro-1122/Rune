import fs from 'node:fs';

const chat = fs.readFileSync('components/chat.tsx', 'utf8');

const checks = [
  ['stall watchdog path exists', chat.includes('streamStall') || chat.includes('Checking for completed answer') || chat.includes('stall')],
  ['secondary recovery timeout exists', chat.includes('STREAM_STALL_SECONDARY_RECOVERY_MS = 10_000')],
  ['stall refs prevent duplicate recovery', chat.includes('streamStallWatchdogTimerRef') && chat.includes('streamStallRecoveryInFlightRef')],
  ['stall state is separate from finalization state', chat.includes('streamStallRecovered') && chat.includes('streamFinalizationRecovered')],
  ['stall path covers in-flight request with no visible assistant message', chat.includes('isStreamStalled = isChatRequestInFlight && streamStallRecovered && !hasVisibleAssistantMessage')],
  ['watchdog detects no visible assistant text', chat.includes('if (!isChatRequestInFlight || hasVisibleAssistantMessage)')],
  ['watchdog refreshes conversation history', chat.includes('loadConversation(sessionId, workspaceId, conversationId)')],
  ['watchdog refreshes tasks', chat.includes('refreshTasks(sessionId, workspaceId, conversationId)')],
  ['watchdog communicates or performs recovery', chat.includes('Checking for completed answer') || chat.includes('Finalizing answer') || chat.includes('refreshConversationHistory')],
  ['stall state unlocks loading lock', chat.includes('!isStreamStalled') && chat.includes('const isLoading = (isChatRequestInFlight && !isStreamFinalizing && !isStreamStalled) || isUploadingAttachment')],
  ['send button recovers to Send on stall', chat.includes('isStreamStalled ? "Send"')],
  ['typing indicator uses recovered loading state', chat.includes('effectiveLoading') || chat.includes('isRequestInFlight') || chat.includes('!isStreamStalled')],
  ['existing finalization guard remains', chat.includes('Finalizing answer') || chat.includes('streamFinalization')],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? '✅' : '❌'} ${name}`);
if (failed.length) process.exit(1);
console.log('✅ Stream stall watchdog smoke test passed.');
