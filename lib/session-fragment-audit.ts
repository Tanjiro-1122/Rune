import { getSupabaseClient } from "@/lib/supabase";
import { JARVIS_OWNER_SESSION_ID } from "@/lib/owner-session";

type ConversationRow = { id: string; session_id: string; created_at: string | null };
type MessageRow = { conversation_id: string; created_at: string | null };
type WorkspaceRow = { id: string; session_id: string; name: string | null; created_at: string | null; updated_at: string | null };
type ConversationWorkspaceRow = { conversation_id: string; workspace_id: string; updated_at: string | null };

export type SessionFragmentSummary = {
  sessionId: string;
  isOwnerSession: boolean;
  workspaceCount: number;
  conversationCount: number;
  mappedConversationCount: number;
  unmappedConversationCount: number;
  messageCount: number;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  sampleWorkspaceNames: string[];
};

export type SessionFragmentAuditResult = {
  success: boolean;
  readOnly: true;
  generatedAt: string;
  ownerSessionId: string;
  summary: string;
  totals: {
    sessions: number;
    fragmentedSessions: number;
    workspaces: number;
    conversations: number;
    messages: number;
    fragmentedConversations: number;
    fragmentedMessages: number;
  };
  sessions: SessionFragmentSummary[];
  recommendedNextStep: string;
  safeBoundaries: string[];
  limits: { maxConversations: number; maxMessages: number; maxWorkspaces: number };
  error?: string;
};

const MAX_CONVERSATIONS = 5000;
const MAX_MESSAGES = 20000;
const MAX_WORKSPACES = 2000;
const MAX_MAPPINGS = 5000;

function latestDate(left: string | null, right: string | null) {
  if (!left) return right;
  if (!right) return left;
  return left > right ? left : right;
}

function earliestDate(left: string | null, right: string | null) {
  if (!left) return right;
  if (!right) return left;
  return left < right ? left : right;
}

function blankSession(sessionId: string): SessionFragmentSummary {
  return {
    sessionId,
    isOwnerSession: sessionId === JARVIS_OWNER_SESSION_ID,
    workspaceCount: 0,
    conversationCount: 0,
    mappedConversationCount: 0,
    unmappedConversationCount: 0,
    messageCount: 0,
    firstSeenAt: null,
    lastSeenAt: null,
    sampleWorkspaceNames: [],
  };
}

function emptyResult(error: string): SessionFragmentAuditResult {
  return {
    success: false,
    readOnly: true,
    generatedAt: new Date().toISOString(),
    ownerSessionId: JARVIS_OWNER_SESSION_ID,
    summary: error,
    totals: { sessions: 0, fragmentedSessions: 0, workspaces: 0, conversations: 0, messages: 0, fragmentedConversations: 0, fragmentedMessages: 0 },
    sessions: [],
    recommendedNextStep: "Configure Supabase, then rerun the read-only fragmentation audit.",
    safeBoundaries: [
      "Read-only Supabase select queries only.",
      "No message content is returned.",
      "No merge, update, delete, insert, or schema mutation is performed.",
    ],
    limits: { maxConversations: MAX_CONVERSATIONS, maxMessages: MAX_MESSAGES, maxWorkspaces: MAX_WORKSPACES },
    error,
  };
}

/**
 * Read-only audit of historical browser-local Jarvis sessions.
 * This intentionally returns only counts/metadata. It never reads message
 * content and never mutates Supabase records.
 */
export async function auditJarvisSessionFragments(): Promise<SessionFragmentAuditResult> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return emptyResult("Supabase is not configured, so Jarvis cannot audit persisted session fragments yet.");
  }

  const [conversationResponse, messageResponse, workspaceResponse, mappingResponse] = await Promise.all([
    supabase.from("conversations").select("id, session_id, created_at").order("created_at", { ascending: false }).limit(MAX_CONVERSATIONS),
    supabase.from("messages").select("conversation_id, created_at").order("created_at", { ascending: false }).limit(MAX_MESSAGES),
    supabase.from("workspaces").select("id, session_id, name, created_at, updated_at").order("updated_at", { ascending: false }).limit(MAX_WORKSPACES),
    supabase.from("conversation_workspaces").select("conversation_id, workspace_id, updated_at").order("updated_at", { ascending: false }).limit(MAX_MAPPINGS),
  ]);

  const firstError = conversationResponse.error ?? messageResponse.error ?? workspaceResponse.error ?? mappingResponse.error;
  if (firstError) return emptyResult(`Session fragmentation audit failed: ${firstError.message}`);

  const conversations = (conversationResponse.data ?? []) as ConversationRow[];
  const messages = (messageResponse.data ?? []) as MessageRow[];
  const workspaces = (workspaceResponse.data ?? []) as WorkspaceRow[];
  const mappings = (mappingResponse.data ?? []) as ConversationWorkspaceRow[];

  const sessions = new Map<string, SessionFragmentSummary>();
  const conversationSession = new Map<string, string>();
  const mappedConversationIds = new Set(mappings.map((mapping) => mapping.conversation_id).filter(Boolean));

  for (const conversation of conversations) {
    const sessionId = conversation.session_id;
    conversationSession.set(conversation.id, sessionId);
    const summary = sessions.get(sessionId) ?? blankSession(sessionId);
    summary.conversationCount += 1;
    summary.firstSeenAt = earliestDate(summary.firstSeenAt, conversation.created_at);
    summary.lastSeenAt = latestDate(summary.lastSeenAt, conversation.created_at);
    if (mappedConversationIds.has(conversation.id)) summary.mappedConversationCount += 1;
    else summary.unmappedConversationCount += 1;
    sessions.set(sessionId, summary);
  }

  for (const message of messages) {
    const sessionId = conversationSession.get(message.conversation_id);
    if (!sessionId) continue;
    const summary = sessions.get(sessionId) ?? blankSession(sessionId);
    summary.messageCount += 1;
    summary.firstSeenAt = earliestDate(summary.firstSeenAt, message.created_at);
    summary.lastSeenAt = latestDate(summary.lastSeenAt, message.created_at);
    sessions.set(sessionId, summary);
  }

  for (const workspace of workspaces) {
    const sessionId = workspace.session_id;
    const summary = sessions.get(sessionId) ?? blankSession(sessionId);
    summary.workspaceCount += 1;
    summary.firstSeenAt = earliestDate(summary.firstSeenAt, workspace.created_at);
    summary.lastSeenAt = latestDate(summary.lastSeenAt, workspace.updated_at ?? workspace.created_at);
    const name = workspace.name?.trim();
    if (name && summary.sampleWorkspaceNames.length < 3 && !summary.sampleWorkspaceNames.includes(name)) summary.sampleWorkspaceNames.push(name);
    sessions.set(sessionId, summary);
  }

  const orderedSessions = Array.from(sessions.values()).sort((left, right) => {
    if (left.isOwnerSession !== right.isOwnerSession) return left.isOwnerSession ? -1 : 1;
    return right.messageCount + right.conversationCount - (left.messageCount + left.conversationCount);
  });
  const fragmentedSessions = orderedSessions.filter((session) => !session.isOwnerSession);
  const fragmentedConversations = fragmentedSessions.reduce((total, session) => total + session.conversationCount, 0);
  const fragmentedMessages = fragmentedSessions.reduce((total, session) => total + session.messageCount, 0);
  const summary = fragmentedSessions.length === 0
    ? "No old browser-local Jarvis session fragments were found in the sampled data."
    : `Found ${fragmentedSessions.length} old browser-local session fragment${fragmentedSessions.length === 1 ? "" : "s"} with ${fragmentedConversations} conversation${fragmentedConversations === 1 ? "" : "s"} and ${fragmentedMessages} message record${fragmentedMessages === 1 ? "" : "s"}.`;

  return {
    success: true,
    readOnly: true,
    generatedAt: new Date().toISOString(),
    ownerSessionId: JARVIS_OWNER_SESSION_ID,
    summary,
    totals: {
      sessions: orderedSessions.length,
      fragmentedSessions: fragmentedSessions.length,
      workspaces: workspaces.length,
      conversations: conversations.length,
      messages: messages.length,
      fragmentedConversations,
      fragmentedMessages,
    },
    sessions: orderedSessions.slice(0, 20),
    recommendedNextStep: fragmentedSessions.length > 0
      ? "Review these counts first. If they look right, prepare a separate approval-gated merge plan."
      : "Use Jarvis normally across devices and confirm new messages appear under the unified owner session.",
    safeBoundaries: [
      "Read-only Supabase select queries only.",
      "No message content is returned.",
      "No merge, update, delete, insert, or schema mutation is performed.",
    ],
    limits: { maxConversations: MAX_CONVERSATIONS, maxMessages: MAX_MESSAGES, maxWorkspaces: MAX_WORKSPACES },
  };
}
