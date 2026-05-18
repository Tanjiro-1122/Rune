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
 * Read-only audit of historical browser-local Rune sessions.
 * This intentionally returns only counts/metadata. It never reads message
 * content and never mutates Supabase records.
 */
export async function auditRuneSessionFragments(): Promise<SessionFragmentAuditResult> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return emptyResult("Supabase is not configured, so Rune cannot audit persisted session fragments yet.");
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
    ? "No old browser-local Rune session fragments were found in the sampled data."
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
      : "Use Rune normally across devices and confirm new messages appear under the unified owner session.",
    safeBoundaries: [
      "Read-only Supabase select queries only.",
      "No message content is returned.",
      "No merge, update, delete, insert, or schema mutation is performed.",
    ],
    limits: { maxConversations: MAX_CONVERSATIONS, maxMessages: MAX_MESSAGES, maxWorkspaces: MAX_WORKSPACES },
  };
}


export type SessionFragmentMergePlanResult = {
  success: boolean;
  dryRun: true;
  readOnly: true;
  generatedAt: string;
  ownerSessionId: string;
  summary: string;
  sourceSessionIds: string[];
  proposedChanges: {
    conversationsToReassign: number;
    workspaceMembershipsToAttach: number;
    workspaceOwnersToNormalize: number;
    messagesMadeVisibleViaConversationMove: number;
    conversationWorkspaceLinksPreserved: number;
    messageRowsUpdatedDirectly: 0;
    messageContentRead: false;
  };
  sessions: SessionFragmentSummary[];
  approvalRequired: {
    required: true;
    phrase: "APPROVE RUNE SESSION MERGE";
    reason: string;
  };
  executionBoundary: string;
  safeBoundaries: string[];
  nextStep: string;
  error?: string;
};

function blockedMergePlan(error: string): SessionFragmentMergePlanResult {
  return {
    success: false,
    dryRun: true,
    readOnly: true,
    generatedAt: new Date().toISOString(),
    ownerSessionId: JARVIS_OWNER_SESSION_ID,
    summary: error,
    sourceSessionIds: [],
    proposedChanges: {
      conversationsToReassign: 0,
      workspaceMembershipsToAttach: 0,
      workspaceOwnersToNormalize: 0,
      messagesMadeVisibleViaConversationMove: 0,
      conversationWorkspaceLinksPreserved: 0,
      messageRowsUpdatedDirectly: 0,
      messageContentRead: false,
    },
    sessions: [],
    approvalRequired: {
      required: true,
      phrase: "APPROVE RUNE SESSION MERGE",
      reason: "A separate approval is required before any Supabase rows are changed.",
    },
    executionBoundary: "Planner only. No merge executor is implemented by this tool.",
    safeBoundaries: [
      "Read-only Supabase select queries only.",
      "No message content is returned or read.",
      "No merge, update, delete, insert, upsert, RPC, or schema mutation is performed.",
      "This tool cannot execute the merge; it only prepares the plan.",
    ],
    nextStep: "Fix the audit blocker, then rerun the planner.",
    error,
  };
}

/**
 * Planner-only dry run for consolidating old browser-local Rune sessions.
 *
 * This does not execute the merge. It translates the read-only audit into a
 * human approval plan for a future, separate executor.
 */
export async function planRuneSessionFragmentMerge(): Promise<SessionFragmentMergePlanResult> {
  const audit = await auditRuneSessionFragments();
  if (!audit.success) return blockedMergePlan(audit.error ?? audit.summary);

  const fragments = audit.sessions.filter((session) => !session.isOwnerSession);
  const sourceSessionIds = fragments.map((session) => session.sessionId);
  const conversationsToReassign = fragments.reduce((total, session) => total + session.conversationCount, 0);
  const workspaceOwnersToNormalize = fragments.reduce((total, session) => total + session.workspaceCount, 0);
  const messagesMadeVisibleViaConversationMove = fragments.reduce((total, session) => total + session.messageCount, 0);
  const conversationWorkspaceLinksPreserved = fragments.reduce((total, session) => total + session.mappedConversationCount, 0);

  const summary = fragments.length === 0
    ? "No fragmented browser-local sessions need merging."
    : `Dry-run plan prepared: ${fragments.length} old browser-local session${fragments.length === 1 ? "" : "s"} would be consolidated into ${JARVIS_OWNER_SESSION_ID}, making ${conversationsToReassign} conversation${conversationsToReassign === 1 ? "" : "s"} and ${messagesMadeVisibleViaConversationMove} message record${messagesMadeVisibleViaConversationMove === 1 ? "" : "s"} visible from the owner session.`;

  return {
    success: true,
    dryRun: true,
    readOnly: true,
    generatedAt: new Date().toISOString(),
    ownerSessionId: JARVIS_OWNER_SESSION_ID,
    summary,
    sourceSessionIds,
    proposedChanges: {
      conversationsToReassign,
      workspaceMembershipsToAttach: workspaceOwnersToNormalize,
      workspaceOwnersToNormalize,
      messagesMadeVisibleViaConversationMove,
      conversationWorkspaceLinksPreserved,
      messageRowsUpdatedDirectly: 0,
      messageContentRead: false,
    },
    sessions: fragments,
    approvalRequired: {
      required: true,
      phrase: "APPROVE RUNE SESSION MERGE",
      reason: "The real merge would reassign existing conversation/workspace ownership metadata to owner:javier, so it must be a separate explicitly approved action.",
    },
    executionBoundary: "Planner only. No merge executor is implemented by this tool.",
    safeBoundaries: [
      "Read-only Supabase select queries only.",
      "No message content is returned or read.",
      "No merge, update, delete, insert, upsert, RPC, or schema mutation is performed.",
      "Messages are not edited directly in the proposed design; they become visible through conversation ownership consolidation.",
      "A future executor must require the exact approval phrase before any Supabase mutation.",
    ],
    nextStep: fragments.length > 0
      ? "Review this dry-run plan. If it looks right, approve a separate merge executor using the required approval phrase."
      : "No merge executor is needed unless new fragments appear later.",
  };
}


export type SessionFragmentMergeExecutionResult = {
  success: boolean;
  executed: boolean;
  ownerSessionId: string;
  generatedAt: string;
  summary: string;
  requiredApprovalPhrase: "APPROVE RUNE SESSION MERGE";
  sourceSessionIds: string[];
  before?: SessionFragmentMergePlanResult;
  after?: SessionFragmentAuditResult;
  mutations: {
    conversationsReassigned: number;
    workspacesReassigned: number;
    workspaceMembershipsAttached: number;
    workspaceEventsReassigned: number;
    messageRowsUpdated: 0;
    messageContentRead: false;
    deletesPerformed: 0;
    schemaMutationsPerformed: 0;
  };
  safeBoundaries: string[];
  error?: string;
};

function blockedMergeExecution(error: string, sourceSessionIds: string[] = []): SessionFragmentMergeExecutionResult {
  return {
    success: false,
    executed: false,
    ownerSessionId: JARVIS_OWNER_SESSION_ID,
    generatedAt: new Date().toISOString(),
    summary: error,
    requiredApprovalPhrase: "APPROVE RUNE SESSION MERGE",
    sourceSessionIds,
    mutations: {
      conversationsReassigned: 0,
      workspacesReassigned: 0,
      workspaceMembershipsAttached: 0,
      workspaceEventsReassigned: 0,
      messageRowsUpdated: 0,
      messageContentRead: false,
      deletesPerformed: 0,
      schemaMutationsPerformed: 0,
    },
    safeBoundaries: [
      "Exact approval phrase required before any mutation.",
      "No message content is selected or returned.",
      "No message rows are updated.",
      "No rows are deleted.",
      "No schema changes are performed.",
    ],
    error,
  };
}

/**
 * Executes the approved Rune session metadata merge.
 *
 * Scope is intentionally narrow:
 * - reassign conversation.session_id to owner:javier
 * - reassign workspace.session_id to owner:javier
 * - add owner workspace memberships for those workspaces
 * - reassign workspace_events.session_id to owner:javier
 *
 * It never reads message content, never updates message rows, never deletes
 * rows, and never changes schema.
 */
export async function executeRuneSessionFragmentMerge(approvalPhrase: string): Promise<SessionFragmentMergeExecutionResult> {
  if (approvalPhrase !== "APPROVE RUNE SESSION MERGE") {
    return blockedMergeExecution("Blocked: exact approval phrase was not provided.");
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    return blockedMergeExecution("Supabase is not configured, so Rune cannot execute the session merge.");
  }

  const before = await planRuneSessionFragmentMerge();
  if (!before.success) {
    return { ...blockedMergeExecution(before.error ?? before.summary, before.sourceSessionIds), before };
  }

  const sourceSessionIds = before.sourceSessionIds.filter((sessionId) => sessionId && sessionId !== JARVIS_OWNER_SESSION_ID);
  if (sourceSessionIds.length === 0) {
    const after = await auditRuneSessionFragments();
    return {
      success: true,
      executed: false,
      ownerSessionId: JARVIS_OWNER_SESSION_ID,
      generatedAt: new Date().toISOString(),
      summary: "No fragmented sessions needed merging.",
      requiredApprovalPhrase: "APPROVE RUNE SESSION MERGE",
      sourceSessionIds: [],
      before,
      after,
      mutations: {
        conversationsReassigned: 0,
        workspacesReassigned: 0,
        workspaceMembershipsAttached: 0,
        workspaceEventsReassigned: 0,
        messageRowsUpdated: 0,
        messageContentRead: false,
        deletesPerformed: 0,
        schemaMutationsPerformed: 0,
      },
      safeBoundaries: [
        "No fragmented sessions were present.",
        "No message content was selected or returned.",
        "No message rows were updated.",
        "No rows were deleted.",
        "No schema changes were performed.",
      ],
    };
  }

  const workspaceLookup = await supabase
    .from("workspaces")
    .select("id, session_id")
    .in("session_id", sourceSessionIds);
  if (workspaceLookup.error) {
    return { ...blockedMergeExecution(`Workspace lookup failed: ${workspaceLookup.error.message}`, sourceSessionIds), before };
  }

  const workspaceIds = Array.from(new Set((workspaceLookup.data ?? []).map((workspace) => workspace.id).filter(Boolean)));

  let workspaceMembershipsAttached = 0;
  if (workspaceIds.length > 0) {
    const membershipRows = workspaceIds.map((workspaceId) => ({
      workspace_id: workspaceId,
      session_id: JARVIS_OWNER_SESSION_ID,
      role: "owner",
    }));
    const membershipResponse = await supabase
      .from("workspace_memberships")
      .upsert(membershipRows, { onConflict: "workspace_id,session_id" })
      .select("workspace_id");
    if (membershipResponse.error) {
      return { ...blockedMergeExecution(`Owner workspace membership attach failed: ${membershipResponse.error.message}`, sourceSessionIds), before };
    }
    workspaceMembershipsAttached = membershipResponse.data?.length ?? workspaceIds.length;
  }

  const conversationUpdate = await supabase
    .from("conversations")
    .update({ session_id: JARVIS_OWNER_SESSION_ID })
    .in("session_id", sourceSessionIds)
    .select("id");
  if (conversationUpdate.error) {
    return { ...blockedMergeExecution(`Conversation reassignment failed: ${conversationUpdate.error.message}`, sourceSessionIds), before };
  }

  const workspaceUpdate = await supabase
    .from("workspaces")
    .update({ session_id: JARVIS_OWNER_SESSION_ID })
    .in("session_id", sourceSessionIds)
    .select("id");
  if (workspaceUpdate.error) {
    return { ...blockedMergeExecution(`Workspace reassignment failed: ${workspaceUpdate.error.message}`, sourceSessionIds), before };
  }

  const eventUpdate = await supabase
    .from("workspace_events")
    .update({ session_id: JARVIS_OWNER_SESSION_ID })
    .in("session_id", sourceSessionIds)
    .select("id");
  if (eventUpdate.error) {
    return { ...blockedMergeExecution(`Workspace event reassignment failed: ${eventUpdate.error.message}`, sourceSessionIds), before };
  }

  const after = await auditRuneSessionFragments();
  const conversationsReassigned = conversationUpdate.data?.length ?? before.proposedChanges.conversationsToReassign;
  const workspacesReassigned = workspaceUpdate.data?.length ?? before.proposedChanges.workspaceOwnersToNormalize;
  const workspaceEventsReassigned = eventUpdate.data?.length ?? 0;

  return {
    success: true,
    executed: true,
    ownerSessionId: JARVIS_OWNER_SESSION_ID,
    generatedAt: new Date().toISOString(),
    summary: `Approved metadata merge executed: ${conversationsReassigned} conversation${conversationsReassigned === 1 ? "" : "s"} and ${workspacesReassigned} workspace${workspacesReassigned === 1 ? "" : "s"} were reassigned to ${JARVIS_OWNER_SESSION_ID}. Message rows were not edited.`,
    requiredApprovalPhrase: "APPROVE RUNE SESSION MERGE",
    sourceSessionIds,
    before,
    after,
    mutations: {
      conversationsReassigned,
      workspacesReassigned,
      workspaceMembershipsAttached,
      workspaceEventsReassigned,
      messageRowsUpdated: 0,
      messageContentRead: false,
      deletesPerformed: 0,
      schemaMutationsPerformed: 0,
    },
    safeBoundaries: [
      "Executed only after exact approval phrase matched.",
      "Only session ownership metadata was updated.",
      "No message content was selected or returned.",
      "No message rows were updated.",
      "No rows were deleted.",
      "No schema changes were performed.",
    ],
  };
}
