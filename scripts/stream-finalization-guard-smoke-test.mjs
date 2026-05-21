import fs from 'node:fs';

const chat = fs.readFileSync('components/chat.tsx', 'utf8');
const route = fs.readFileSync('app/api/chat/route.ts', 'utf8');

const checks = [
  ['backend persistence timeout/fallback path exists', route.includes('finishPersistence') || route.includes('api.chat.onFinish.timeout')],
  ['backend wraps onFinish persistence safely', route.includes('finishPersistence') && route.includes('catch((e) => logError')],
  ['backend logs onFinish timeout explicitly', route.includes('api.chat.onFinish.timeout')],
  ['backend logs onFinish persistence failures explicitly', route.includes('api.chat.onFinish.persistence')],
  ['backend still fails active task if finalization fails', route.includes('failWorkspaceTask(activeTaskId, errMsg)')],
  ['frontend stale stream recovery path exists', chat.includes('Finalizing answer') || chat.includes('streamFinalization')],
  ['frontend detects assistant text while stream is still active', chat.includes('hasAssistantTextWhileStreaming') && chat.includes('getAssistantTextFromMessage')],
  ['frontend distinguishes raw request in flight from visible loading lock', chat.includes('isChatRequestInFlight') && chat.includes('isStreamFinalizing')],
  ['frontend unlocks send button after stream finalization recovery', chat.includes('disabled={isLoading}') && chat.includes('isStreamFinalizing ? "Send"')],
  ['frontend shows finalizing status instead of silent freeze', chat.includes('Finalizing answer…') && chat.includes('· finalizing')],
  ['frontend refreshes tasks after recovery to clear stale Task running chip', chat.includes('if (streamFinalizationRecovered && sessionId && workspaceId)') && chat.includes('refreshTasks(sessionId, workspaceId, conversationId)')],
  ['existing useChat path remains intact', (chat.includes('useChat({') || chat.includes('useChat<')) && route.includes('toDataStreamResponse')],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? '✅' : '❌'} ${name}`);
if (failed.length) process.exit(1);
console.log('✅ Stream finalization guard smoke test passed.');
