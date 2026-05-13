/**
 * Database service layer — typed helpers for all Supabase interactions.
 *
 * Centralises query logic so that API routes stay thin and so that
 * database behaviour (including error handling) can be changed in one place.
 */

import { getSupabaseClient } from "./supabase";
import { logError } from "./errors";

// ─── Domain types ─────────────────────────────────────────────────────────────

export interface DbMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

export interface DbArtifact {
  id: string;
  conversation_id: string;
  name: string;
  mime_type: string;
  content: string;
  bytes: number;
  created_at: string;
}

export interface DbConversation {
  id: string;
  session_id: string;
  workspace_id?: string | null;
  created_at: string;
}

export interface DbWorkspace {
  id: string;
  session_id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

// ─── Conversation helpers ─────────────────────────────────────────────────────

/**
 * Find the most recent conversation for a session, or create a new one.
 * Returns null when Supabase is not configured or on DB error.
 */
export async function getOrCreateConversation(
  sessionId: string,
  workspaceId?: string | null
): Promise<{ conversationId: string; isNew: boolean } | null> {
  const supabase = getSupabaseClient();
  if (!supabase) return null;

  const { data: existing, error: findError } = await supabase
    .from("conversations")
    .select("id")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (findError) {
    logError("db.getOrCreateConversation.find", findError);
    return null;
  }

  if (existing?.id) {
    return { conversationId: existing.id as string, isNew: false };
  }

  const insertRow: Record<string, string> = { session_id: sessionId };
  if (workspaceId) insertRow.workspace_id = workspaceId;

  const { data: created, error: createError } = await supabase
    .from("conversations")
    .insert(insertRow)
    .select("id")
    .single();

  if (createError || !created) {
    logError("db.getOrCreateConversation.create", createError);
    return null;
  }

  return { conversationId: created.id as string, isNew: true };
}

// ─── Message helpers ──────────────────────────────────────────────────────────

/**
 * Load all messages for a conversation in chronological order.
 * Returns an empty array when Supabase is unconfigured or on error.
 */
export async function getConversationMessages(
  conversationId: string
): Promise<DbMessage[]> {
  const supabase = getSupabaseClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("messages")
    .select("id, role, content")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  if (error) {
    logError("db.getConversationMessages", error);
    return [];
  }

  return (data ?? []) as DbMessage[];
}

/**
 * Persist a user + assistant message pair atomically.
 * Silently no-ops when Supabase is unconfigured or inputs are empty.
 */
export async function saveMessagePair(
  conversationId: string,
  userContent: string,
  assistantContent: string
): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase) return;
  if (!conversationId || !userContent.trim() || !assistantContent.trim()) return;

  const { error } = await supabase.from("messages").insert([
    { conversation_id: conversationId, role: "user", content: userContent },
    {
      conversation_id: conversationId,
      role: "assistant",
      content: assistantContent,
    },
  ]);

  if (error) {
    logError("db.saveMessagePair", error);
  }
}

// ─── Artifact helpers ─────────────────────────────────────────────────────────

/**
 * Persist a single artifact tied to a conversation.
 * Returns the saved record or null on failure/unconfigured.
 */
export async function saveArtifact(
  conversationId: string,
  artifact: {
    name: string;
    mimeType: string;
    content: string;
    bytes: number;
  }
): Promise<DbArtifact | null> {
  const supabase = getSupabaseClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("artifacts")
    .insert({
      conversation_id: conversationId,
      name: artifact.name,
      mime_type: artifact.mimeType,
      content: artifact.content,
      bytes: artifact.bytes,
    })
    .select("id, conversation_id, name, mime_type, content, bytes, created_at")
    .single();

  if (error) {
    logError("db.saveArtifact", error);
    return null;
  }

  return data as DbArtifact;
}

/**
 * Load all artifacts for a conversation in chronological order.
 */
export async function getConversationArtifacts(
  conversationId: string
): Promise<DbArtifact[]> {
  const supabase = getSupabaseClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("artifacts")
    .select("id, conversation_id, name, mime_type, content, bytes, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  if (error) {
    logError("db.getConversationArtifacts", error);
    return [];
  }

  return (data ?? []) as DbArtifact[];
}

// ─── Workspace helpers ────────────────────────────────────────────────────────

/**
 * List workspaces for a session, newest first.
 */
export async function getWorkspaces(sessionId: string): Promise<DbWorkspace[]> {
  const supabase = getSupabaseClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("workspaces")
    .select("id, session_id, name, created_at, updated_at")
    .eq("session_id", sessionId)
    .order("updated_at", { ascending: false });

  if (error) {
    logError("db.getWorkspaces", error);
    return [];
  }

  return (data ?? []) as DbWorkspace[];
}

/**
 * Create a new workspace for a session.
 */
export async function createWorkspace(
  sessionId: string,
  name: string
): Promise<DbWorkspace | null> {
  const supabase = getSupabaseClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("workspaces")
    .insert({ session_id: sessionId, name })
    .select("id, session_id, name, created_at, updated_at")
    .single();

  if (error) {
    logError("db.createWorkspace", error);
    return null;
  }

  return data as DbWorkspace;
}
