import { getSupabaseClient } from "@/lib/supabase";
import type { CodeExecutionArtifact } from "@/lib/code-execution";

const DEFAULT_WORKSPACE_NAME = "General workspace";
const LOCAL_WORKSPACE_PREFIX = "local-workspace-";
const LOCAL_CONVERSATION_PREFIX = "local-conversation-";
const MAX_STORED_TEXT_CHARS = 40_000;
const MAX_RETRIEVAL_HITS = 6;
const MAX_WORKSPACE_DOCUMENTS = 40;
const CHUNK_SIZE = 900;
const CHUNK_OVERLAP = 140;
const SHORT_TOKEN_MATCH_SCORE = 2;
const LONG_TOKEN_MATCH_SCORE = 3;
const WORKSPACE_ACCESS_ROLES = ["viewer", "editor", "owner"] as const;
const MAX_RETRIEVAL_CHUNK_CANDIDATES = 220;
const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_INPUT_MAX_CHARS = 2_400;
const SEMANTIC_SCORE_MULTIPLIER = 16;

interface WorkspaceRow {
  id: string;
  session_id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

interface ConversationRow {
  id: string;
  created_at: string;
}

interface ConversationWorkspaceRow {
  conversation_id: string;
  workspace_id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}

interface WorkspaceDocumentRow {
  id: string;
  workspace_id: string;
  conversation_id: string | null;
  name: string;
  content_type: string;
  source_kind: string;
  summary: string | null;
  created_at: string;
}

interface WorkspaceArtifactRow {
  id: string;
  workspace_id: string;
  conversation_id: string | null;
  name: string;
  mime_type: string;
  content: string;
  bytes: number;
  created_at: string;
}

interface WorkspaceChunkRow {
  id?: string;
  workspace_id: string;
  document_id: string;
  source_kind: string;
  source_label: string;
  chunk_index: number;
  content: string;
  embedding?: number[] | null;
  embedding_model?: string | null;
  embedding_generated_at?: string | null;
  created_at?: string;
}

export type WorkspaceAccessRole = (typeof WORKSPACE_ACCESS_ROLES)[number];
interface WorkspaceProjectFileRow {
  id: string;
  workspace_id: string;
  conversation_id: string | null;
  document_id: string | null;
  artifact_id: string | null;
  path: string;
  display_name: string;
  source_kind: string;
  mime_type: string;
  bytes: number;
  summary: string | null;
  storage_bucket?: string | null;
  storage_path?: string | null;
  public_url?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface WorkspaceConversationSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  accessRole: WorkspaceAccessRole;
  conversationCount: number;
  documentCount: number;
  artifactCount: number;
  conversations: WorkspaceConversationSummary[];
}

export interface WorkspaceDocumentSummary {
  id: string;
  conversationId: string | null;
  name: string;
  contentType: string;
  sourceKind: string;
  summary: string | null;
  createdAt: string;
}

export interface WorkspaceArtifactSummary {
  id: string;
  conversationId: string | null;
  name: string;
  mimeType: string;
  content: string;
  bytes: number;
  createdAt: string;
}

export interface WorkspaceBootstrapData {
  persistenceEnabled: boolean;
  schemaReady: boolean;
  notice: string | null;
  workspaces: WorkspaceSummary[];
  selectedWorkspaceId: string | null;
  selectedConversationId: string | null;
  projectFiles: WorkspaceProjectFileSummary[];
  documents: WorkspaceDocumentSummary[];
  artifacts: WorkspaceArtifactSummary[];
}

export interface WorkspaceProjectFileSummary {
  id: string;
  conversationId: string | null;
  path: string;
  displayName: string;
  sourceKind: string;
  mimeType: string;
  bytes: number;
  summary: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceRetrievalHit {
  sourceKind: "document" | "artifact" | "conversation";
  sourceLabel: string;
  excerpt: string;
  score: number;
}

interface AttachmentLike {
  name?: string | null;
  contentType?: string | null;
  url?: string | null;
}

function isLocalWorkspaceId(value?: string | null) {
  return Boolean(value && value.startsWith(LOCAL_WORKSPACE_PREFIX));
}

function isLocalConversationId(value?: string | null) {
  return Boolean(value && value.startsWith(LOCAL_CONVERSATION_PREFIX));
}

function buildLocalWorkspaceId(sessionId: string) {
  return `${LOCAL_WORKSPACE_PREFIX}${sessionId}`;
}

function buildLocalConversationId(sessionId: string) {
  return `${LOCAL_CONVERSATION_PREFIX}${sessionId}`;
}

function nowIso() {
  return new Date().toISOString();
}

function buildLocalBootstrap(sessionId: string): WorkspaceBootstrapData {
  const now = nowIso();
  const workspaceId = buildLocalWorkspaceId(sessionId);
  const conversationId = buildLocalConversationId(sessionId);

  return {
    persistenceEnabled: false,
    schemaReady: true,
    notice:
      "Supabase workspace persistence is not configured, so Rune is running in a single local workspace. Add the Supabase variables and schema from the README to unlock persistent projects, files, and artifacts.",
    workspaces: [
      {
        id: workspaceId,
        name: "Local workspace",
        description: "Single-session mode without Supabase persistence.",
        createdAt: now,
        updatedAt: now,
        accessRole: "owner",
        conversationCount: 1,
        documentCount: 0,
        artifactCount: 0,
        conversations: [
          {
            id: conversationId,
            title: "Current chat",
            createdAt: now,
            updatedAt: now,
          },
        ],
      },
    ],
    selectedWorkspaceId: workspaceId,
    selectedConversationId: conversationId,
    projectFiles: [],
    documents: [],
    artifacts: [],
  };
}

function cleanTitle(input: string | null | undefined, fallback: string) {
  const text = (input ?? "").trim();
  return text || fallback;
}

function isPersistedConversationId(conversationId?: string | null) {
  return Boolean(conversationId && !isLocalConversationId(conversationId));
}

function normalizeAccessRole(role: string | null | undefined): WorkspaceAccessRole | null {
  if (!role) return null;
  return WORKSPACE_ACCESS_ROLES.includes(role as WorkspaceAccessRole)
    ? (role as WorkspaceAccessRole)
    : null;
}

function roleAllows(required: WorkspaceAccessRole, actual: WorkspaceAccessRole) {
  const rank: Record<WorkspaceAccessRole, number> = {
    viewer: 1,
    editor: 2,
    owner: 3,
  };
  return rank[actual] >= rank[required];
}

async function resolveWorkspaceAccessRole(
  sessionId: string,
  workspaceId: string
): Promise<WorkspaceAccessRole | null> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return isLocalWorkspaceId(workspaceId) ? "owner" : null;
  }

  const workspaceResponse = await supabase
    .from("workspaces")
    .select("id, session_id")
    .eq("id", workspaceId)
    .maybeSingle();

  if (workspaceResponse.error || !workspaceResponse.data) {
    return null;
  }

  if (workspaceResponse.data.session_id === sessionId) {
    return "owner";
  }

  const membershipResponse = await supabase
    .from("workspace_memberships")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("session_id", sessionId)
    .maybeSingle();

  if (membershipResponse.error) {
    return null;
  }

  return normalizeAccessRole(membershipResponse.data?.role);
}

export async function assertWorkspaceAccess(options: {
  sessionId: string;
  workspaceId: string;
  requiredRole?: WorkspaceAccessRole;
}) {
  const { sessionId, workspaceId, requiredRole = "viewer" } = options;

  if (isLocalWorkspaceId(workspaceId)) {
    if (workspaceId !== buildLocalWorkspaceId(sessionId)) {
      throw new Error("Workspace access denied.");
    }
    return;
  }

  const role = await resolveWorkspaceAccessRole(sessionId, workspaceId);
  if (!role || !roleAllows(requiredRole, role)) {
    throw new Error("Workspace access denied.");
  }
}

export async function assertConversationAccess(options: {
  sessionId: string;
  conversationId: string;
  workspaceId?: string | null;
  requiredRole?: WorkspaceAccessRole;
}) {
  const { sessionId, conversationId, workspaceId, requiredRole = "viewer" } = options;

  // Local conversation IDs are in-memory only — skip any DB lookup, just
  // verify ownership the same way assertWorkspaceAccess does for local workspaces.
  if (isLocalConversationId(conversationId)) {
    if (conversationId !== buildLocalConversationId(sessionId)) {
      throw new Error("Conversation access denied.");
    }
    return;
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    throw new Error("Conversation access denied.");
  }

  const conversationResponse = await supabase
    .from("conversations")
    .select("id, session_id")
    .eq("id", conversationId)
    .maybeSingle();

  if (!conversationResponse.error && conversationResponse.data?.session_id === sessionId) {
    if (workspaceId) {
      const mappingResponse = await supabase
        .from("conversation_workspaces")
        .select("workspace_id")
        .eq("conversation_id", conversationId)
        .maybeSingle();

      // If the mapping table query errors (e.g. due to a schema issue), skip
      // the workspace cross-check — session ownership is already confirmed
      // by the conversations table above.
      if (!mappingResponse.error) {
        if (mappingResponse.data?.workspace_id && mappingResponse.data.workspace_id !== workspaceId) {
          throw new Error("Conversation access denied.");
        }
      } else {
        // Log so operators can see the underlying cause (e.g. missing column).
        console.warn(
          "assertConversationAccess: workspace mapping query failed; " +
            "skipping workspace cross-check because session ownership is confirmed. " +
            "Error: " + mappingResponse.error.message
        );
      }
    }
    return;
  }

  const mappingResponse = await supabase
    .from("conversation_workspaces")
    .select("workspace_id")
    .eq("conversation_id", conversationId)
    .maybeSingle();

  if (mappingResponse.error || !mappingResponse.data?.workspace_id) {
    throw new Error("Conversation access denied.");
  }

  if (workspaceId && workspaceId !== mappingResponse.data.workspace_id) {
    throw new Error("Conversation access denied.");
  }

  await assertWorkspaceAccess({
    sessionId,
    workspaceId: mappingResponse.data.workspace_id,
    requiredRole,
  });
}

function sortWorkspaceRows(workspaces: WorkspaceRow[]) {
  return [...workspaces].sort((left, right) => {
    const leftIsDefault = left.name === DEFAULT_WORKSPACE_NAME ? 0 : 1;
    const rightIsDefault = right.name === DEFAULT_WORKSPACE_NAME ? 0 : 1;
    if (leftIsDefault !== rightIsDefault) return leftIsDefault - rightIsDefault;
    return right.updated_at.localeCompare(left.updated_at);
  });
}

function dedupeWorkspaceRows(workspaces: WorkspaceRow[]) {
  const sorted = sortWorkspaceRows(workspaces);
  const seen = new Set<string>();
  const result: WorkspaceRow[] = [];

  for (const workspace of sorted) {
    const normalizedName = workspace.name.trim().toLowerCase();
    const key = workspace.name === DEFAULT_WORKSPACE_NAME
      ? `default:${workspace.session_id}`
      : `id:${workspace.id}:${normalizedName}`;

    if (seen.has(key)) continue;
    seen.add(key);
    result.push(workspace);
  }

  return result;
}


function sortWorkspaceSummaries(workspaces: WorkspaceSummary[]) {
  return [...workspaces].sort((left, right) => {
    const leftIsDefault = left.name === DEFAULT_WORKSPACE_NAME ? 0 : 1;
    const rightIsDefault = right.name === DEFAULT_WORKSPACE_NAME ? 0 : 1;
    if (leftIsDefault !== rightIsDefault) return leftIsDefault - rightIsDefault;
    return right.updatedAt.localeCompare(left.updatedAt);
  });
}

function getDefaultWorkspaceId(workspaces: WorkspaceRow[]) {
  const generalWorkspace = sortWorkspaceRows(workspaces).find(
    (workspace) => workspace.name === DEFAULT_WORKSPACE_NAME
  );
  if (generalWorkspace) return generalWorkspace.id;

  return sortWorkspaceRows(workspaces)[0]?.id;
}

function getSchemaNotice(message: string) {
  return `Rune workspace tables are not available yet (${message}). Run the updated SQL from the README to enable persistent workspaces, indexed files, and saved artifacts.`;
}

function sanitizeText(input: string, maxChars = MAX_STORED_TEXT_CHARS) {
  const truncationSuffix = "\n\n[truncated for storage]";
  const trimmed = input.replace(/\u0000/g, "").trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, Math.max(0, maxChars - truncationSuffix.length))}${truncationSuffix}`;
}

function summarizeText(input: string, maxChars = 180) {
  const compact = input.replace(/\s+/g, " ").trim();
  if (!compact) return null;
  return compact.length <= maxChars
    ? compact
    : `${compact.slice(0, Math.max(0, maxChars - 1))}…`;
}

function tokenize(text: string) {
  return Array.from(
    new Set(
      text
        .toLowerCase()
        .match(/[a-z0-9._-]{2,}/g)
        ?.filter((token) => token.length > 2 && /[a-z0-9]/.test(token)) ?? []
    )
  );
}

function computeScore(query: string, content: string) {
  const queryTokens = tokenize(query);
  if (!queryTokens.length) return 0;

  const haystack = content.toLowerCase();
  let score = 0;
  for (const token of queryTokens) {
    if (haystack.includes(token)) {
      score += token.length > 6 ? LONG_TOKEN_MATCH_SCORE : SHORT_TOKEN_MATCH_SCORE;
    }
  }

  const queryPhrase = query.trim().toLowerCase();
  if (queryPhrase.length > 6 && haystack.includes(queryPhrase)) {
    score += 5;
  }

  return score;
}

function parseEmbeddingVector(value: unknown): number[] | null {
  if (!value) return null;
  if (Array.isArray(value)) {
    const vector = value.filter((item): item is number => typeof item === "number");
    return vector.length ? vector : null;
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parseEmbeddingVector(parsed);
    } catch {
      return null;
    }
  }
  return null;
}

function cosineSimilarity(left: number[], right: number[]) {
  if (left.length !== right.length) return 0;
  const size = left.length;
  if (size === 0) return 0;

  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < size; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] * left[index];
    rightNorm += right[index] * right[index];
  }

  if (!leftNorm || !rightNorm) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

async function embedTexts(input: string[]) {
  const apiKey = process.env.OPENAI_API_KEY;
  const text = input
    .map((entry) => sanitizeText(entry, EMBEDDING_INPUT_MAX_CHARS))
    .filter(Boolean);
  if (!apiKey || text.length === 0) return null;

  try {
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: text,
      }),
    });

    if (!response.ok) return null;
    const payload = (await response.json()) as {
      data?: Array<{ embedding?: number[] }>;
    };
    const vectors =
      payload.data
        ?.map((row) => row.embedding)
        .filter((vector): vector is number[] => Array.isArray(vector)) ?? [];
    return vectors.length === text.length ? vectors : null;
  } catch {
    return null;
  }
}

function toProjectPath(prefix: string, rawName: string) {
  const cleaned = rawName
    .trim()
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/[/\\]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .toLowerCase()
    .slice(0, 96);
  const safeNameCandidate = (cleaned || "item")
    .split(".")
    .filter((segment) => segment && segment !== "..")
    .join(".");
  const safeName = safeNameCandidate.replace(/^[-/.]+/, "") || "item";
  return `${prefix}/${safeName}`;
}

function chunkText(content: string) {
  const normalized = sanitizeText(content);
  if (!normalized) return [] as string[];

  const chunks: string[] = [];
  let cursor = 0;
  while (cursor < normalized.length) {
    const chunk = normalized.slice(cursor, cursor + CHUNK_SIZE).trim();
    if (chunk) chunks.push(chunk);
    if (cursor + CHUNK_SIZE >= normalized.length) break;
    cursor += CHUNK_SIZE - CHUNK_OVERLAP;
  }
  return chunks;
}

async function touchWorkspace(workspaceId: string) {
  const supabase = getSupabaseClient();
  if (!supabase || isLocalWorkspaceId(workspaceId)) return;

  await supabase
    .from("workspaces")
    .update({ updated_at: nowIso() })
    .eq("id", workspaceId);
}

async function touchConversation(conversationId: string, title?: string) {
  const supabase = getSupabaseClient();
  if (!supabase || isLocalConversationId(conversationId)) return;

  const payload: Record<string, string> = { updated_at: nowIso() };
  if (title) payload.title = title;

  await supabase
    .from("conversation_workspaces")
    .update(payload)
    .eq("conversation_id", conversationId);
}

async function ensureWorkspaceRows(sessionId: string) {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return {
      persistenceEnabled: false,
      schemaReady: true,
      notice: null,
      workspaces: [] as WorkspaceRow[],
    };
  }

  const workspaceResponse = await supabase
    .from("workspaces")
    .select("id, session_id, name, description, created_at, updated_at")
    .eq("session_id", sessionId)
    .order("updated_at", { ascending: false });

  if (workspaceResponse.error) {
    return {
      persistenceEnabled: true,
      schemaReady: false,
      notice: getSchemaNotice(workspaceResponse.error.message),
      workspaces: [] as WorkspaceRow[],
    };
  }

  let workspaces = (workspaceResponse.data ?? []) as WorkspaceRow[];

  const membershipResponse = await supabase
    .from("workspace_memberships")
    .select("workspace_id")
    .eq("session_id", sessionId);

  if (!membershipResponse.error) {
    const membershipWorkspaceIds = Array.from(
      new Set(
        ((membershipResponse.data ?? []) as Array<{ workspace_id: string }>)
          .map((row) => row.workspace_id)
          .filter(Boolean)
      )
    );

    const sharedWorkspaceIds = membershipWorkspaceIds.filter(
      (workspaceId) => !workspaces.some((workspace) => workspace.id === workspaceId)
    );

    if (sharedWorkspaceIds.length > 0) {
      const sharedResponse = await supabase
        .from("workspaces")
        .select("id, session_id, name, description, created_at, updated_at")
        .in("id", sharedWorkspaceIds)
        .order("updated_at", { ascending: false });

      if (!sharedResponse.error) {
        workspaces = [
          ...workspaces,
          ...(((sharedResponse.data ?? []) as WorkspaceRow[]).filter(
            (workspace) => workspace.session_id !== sessionId
          ) as WorkspaceRow[]),
        ];
      }
    }
  }

  if (workspaces.length === 0) {
    const inserted = await supabase
      .from("workspaces")
      .insert({
        session_id: sessionId,
        name: DEFAULT_WORKSPACE_NAME,
        description: "Default workspace for this Rune session.",
      })
      .select("id, session_id, name, description, created_at, updated_at")
      .single();

    if (inserted.error || !inserted.data) {
      return {
        persistenceEnabled: true,
        schemaReady: false,
        notice: getSchemaNotice(inserted.error?.message ?? "failed to create workspace"),
        workspaces: [] as WorkspaceRow[],
      };
    }

    await supabase.from("workspace_memberships").upsert(
      {
        workspace_id: inserted.data.id,
        session_id: sessionId,
        role: "owner",
      },
      { onConflict: "workspace_id,session_id" }
    );

    workspaces = [inserted.data as WorkspaceRow];
  }

  return {
    persistenceEnabled: true,
    schemaReady: true,
    notice: null,
    workspaces: dedupeWorkspaceRows(workspaces),
  };
}

async function mapLegacyConversations(sessionId: string, fallbackWorkspaceId: string) {
  const supabase = getSupabaseClient();
  if (!supabase) return;

  const [conversationResponse, mappingResponse] = await Promise.all([
    supabase
      .from("conversations")
      .select("id, created_at")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: false }),
    supabase
      .from("conversation_workspaces")
      .select("conversation_id"),
  ]);

  if (conversationResponse.error || mappingResponse.error) return;

  const mappedConversationIds = new Set(
    ((mappingResponse.data ?? []) as { conversation_id: string }[]).map(
      (row) => row.conversation_id
    )
  );

  const unmapped = ((conversationResponse.data ?? []) as ConversationRow[])
    .filter((row) => !mappedConversationIds.has(row.id))
    .map((row) => ({
      conversation_id: row.id,
      workspace_id: fallbackWorkspaceId,
      title: "Imported chat",
    }));

  if (unmapped.length > 0) {
    await supabase.from("conversation_workspaces").insert(unmapped);
  }
}

export async function getWorkspaceBootstrap(
  sessionId: string,
  requestedWorkspaceId?: string | null
): Promise<WorkspaceBootstrapData> {
  const ensured = await ensureWorkspaceRows(sessionId);
  if (!ensured.persistenceEnabled) {
    return buildLocalBootstrap(sessionId);
  }

  if (!ensured.schemaReady) {
    const local = buildLocalBootstrap(sessionId);
    return {
      ...local,
      persistenceEnabled: true,
      schemaReady: false,
      notice: ensured.notice,
    };
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    return buildLocalBootstrap(sessionId);
  }

  const workspaces = dedupeWorkspaceRows(ensured.workspaces);
  const defaultWorkspaceId = getDefaultWorkspaceId(workspaces);
  if (!defaultWorkspaceId) {
    return buildLocalBootstrap(sessionId);
  }

  await mapLegacyConversations(sessionId, defaultWorkspaceId);

  const workspaceIds = workspaces.map((workspace) => workspace.id);
  const selectedWorkspaceId =
    requestedWorkspaceId && workspaceIds.includes(requestedWorkspaceId)
      ? requestedWorkspaceId
      : defaultWorkspaceId;

  const [
    conversationResponse,
    mappingResponse,
    documentResponse,
    artifactMetaResponse,
    membershipResponse,
    projectFileResponse,
  ] =
    await Promise.all([
      supabase
        .from("conversations")
        .select("id, created_at")
        .eq("session_id", sessionId)
        .order("created_at", { ascending: false }),
      supabase
        .from("conversation_workspaces")
        .select("conversation_id, workspace_id, title, created_at, updated_at")
        .in("workspace_id", workspaceIds),
      supabase
        .from("workspace_documents")
        .select(
          "id, workspace_id, conversation_id, name, content_type, source_kind, summary, created_at"
        )
        .in("workspace_id", workspaceIds)
        .order("created_at", { ascending: false }),
      supabase
        .from("workspace_artifacts")
        .select("id, workspace_id, conversation_id, name, mime_type, bytes, created_at")
        .in("workspace_id", workspaceIds)
        .order("created_at", { ascending: false }),
      supabase
        .from("workspace_memberships")
        .select("workspace_id, role")
        .eq("session_id", sessionId)
        .in("workspace_id", workspaceIds),
      supabase
        .from("workspace_project_files")
        .select(
          "id, workspace_id, conversation_id, document_id, artifact_id, path, display_name, source_kind, mime_type, bytes, summary, storage_bucket, storage_path, public_url, metadata, created_at, updated_at"
        )
        .in("workspace_id", workspaceIds)
        .order("updated_at", { ascending: false }),
    ]);

  if (
    conversationResponse.error ||
      mappingResponse.error ||
      documentResponse.error ||
      artifactMetaResponse.error ||
      membershipResponse.error ||
      projectFileResponse.error
  ) {
    const local = buildLocalBootstrap(sessionId);
    return {
      ...local,
      persistenceEnabled: true,
      schemaReady: false,
      notice: getSchemaNotice(
        conversationResponse.error?.message ??
          mappingResponse.error?.message ??
          documentResponse.error?.message ??
          artifactMetaResponse.error?.message ??
          membershipResponse.error?.message ??
          projectFileResponse.error?.message ??
          "workspace query failed"
      ),
    };
  }

  const conversations = (conversationResponse.data ?? []) as ConversationRow[];
  const mappings = (mappingResponse.data ?? []) as ConversationWorkspaceRow[];
  const documents = (documentResponse.data ?? []) as WorkspaceDocumentRow[];
  const artifactMeta =
    (artifactMetaResponse.data ?? []) as Array<
      Omit<WorkspaceArtifactRow, "content"> & { content?: string }
    >;
  const membershipByWorkspace = new Map(
    ((membershipResponse.data ?? []) as Array<{ workspace_id: string; role: string }>).map(
      (row) => [row.workspace_id, normalizeAccessRole(row.role)]
    )
  );
  const projectFiles = (projectFileResponse.data ?? []) as WorkspaceProjectFileRow[];

  const conversationById = new Map(conversations.map((item) => [item.id, item]));

  const workspacesWithCounts = dedupeWorkspaceRows(workspaces)
    .map((workspace) => {
      const accessRole =
        workspace.session_id === sessionId
          ? "owner"
          : membershipByWorkspace.get(workspace.id) ?? null;
      if (!accessRole) return null;

      const workspaceMappings = mappings
        .filter((mapping) => mapping.workspace_id === workspace.id)
        .map((mapping) => {
          const conversation = conversationById.get(mapping.conversation_id);
          return {
            id: mapping.conversation_id,
            title: cleanTitle(mapping.title, "Untitled chat"),
            createdAt: conversation?.created_at ?? mapping.created_at,
            updatedAt: mapping.updated_at,
          } satisfies WorkspaceConversationSummary;
        })
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

      return {
        id: workspace.id,
        name: workspace.name,
        description: workspace.description,
        createdAt: workspace.created_at,
        updatedAt: workspace.updated_at,
        accessRole,
        conversationCount: workspaceMappings.length,
        documentCount: documents.filter((document) => document.workspace_id === workspace.id).length,
        artifactCount: artifactMeta.filter((artifact) => artifact.workspace_id === workspace.id).length,
        conversations: workspaceMappings,
      } satisfies WorkspaceSummary;
    })
    .filter((workspace): workspace is WorkspaceSummary => Boolean(workspace));

  let selectedArtifacts: WorkspaceArtifactSummary[] = [];
  if (selectedWorkspaceId) {
    const artifactResponse = await supabase
      .from("workspace_artifacts")
      .select(
        "id, workspace_id, conversation_id, name, mime_type, content, bytes, created_at"
      )
      .eq("workspace_id", selectedWorkspaceId)
      .order("created_at", { ascending: false })
      .limit(25);

    if (!artifactResponse.error) {
      selectedArtifacts = ((artifactResponse.data ?? []) as WorkspaceArtifactRow[]).map(
        (artifact) => ({
          id: artifact.id,
          conversationId: artifact.conversation_id,
          name: artifact.name,
          mimeType: artifact.mime_type,
          content: artifact.content,
          bytes: artifact.bytes,
          createdAt: artifact.created_at,
        })
      );
    }
  }

  const selectedDocuments = documents
    .filter((document) => document.workspace_id === selectedWorkspaceId)
    .slice(0, MAX_WORKSPACE_DOCUMENTS)
    .map((document) => ({
      id: document.id,
      conversationId: document.conversation_id,
      name: document.name,
      contentType: document.content_type,
      sourceKind: document.source_kind,
      summary: document.summary,
      createdAt: document.created_at,
    }));

  const selectedProjectFiles = projectFiles
    .filter((file) => file.workspace_id === selectedWorkspaceId)
    .slice(0, 120)
    .map((file) => ({
      id: file.id,
      conversationId: file.conversation_id,
      path: file.path,
      displayName: file.display_name,
      sourceKind: file.source_kind,
      mimeType: file.mime_type,
      bytes: file.bytes,
      summary: file.summary,
      url: file.public_url,
      storageBucket: file.storage_bucket ?? null,
      storagePath: file.storage_path ?? null,
      metadata: file.metadata ?? null,
      createdAt: file.created_at,
      updatedAt: file.updated_at,
    }));

  const selectedWorkspace = workspacesWithCounts.find(
    (workspace) => workspace.id === selectedWorkspaceId
  );

  return {
    persistenceEnabled: true,
    schemaReady: true,
    notice: null,
    workspaces: sortWorkspaceSummaries(workspacesWithCounts),
    selectedWorkspaceId,
    selectedConversationId: selectedWorkspace?.conversations[0]?.id ?? null,
    projectFiles: selectedProjectFiles,
    documents: selectedDocuments,
    artifacts: selectedArtifacts,
  };
}

export function deriveConversationTitle(input: string) {
  const compact = input.replace(/\s+/g, " ").trim();
  if (!compact) return "Untitled chat";
  if (compact.length <= 60) return compact;
  return `${compact.slice(0, 57)}…`;
}

export async function createWorkspace(options: {
  sessionId: string;
  name?: string | null;
  description?: string | null;
}) {
  const { sessionId, name, description } = options;
  const supabase = getSupabaseClient();
  if (!supabase) {
    const now = nowIso();
    return {
      id: `${LOCAL_WORKSPACE_PREFIX}${crypto.randomUUID()}`,
      name: cleanTitle(name, "Untitled workspace"),
      description: description?.trim() || null,
      createdAt: now,
      updatedAt: now,
    };
  }

  const response = await supabase
    .from("workspaces")
    .insert({
      session_id: sessionId,
      name: cleanTitle(name, "Untitled workspace"),
      description: description?.trim() || null,
    })
    .select("id, name, description, created_at, updated_at")
    .single();

  if (response.error || !response.data) {
    throw new Error(response.error?.message ?? "Failed to create workspace.");
  }

  await supabase.from("workspace_memberships").upsert(
    {
      workspace_id: response.data.id,
      session_id: sessionId,
      role: "owner",
    },
    { onConflict: "workspace_id,session_id" }
  );

  return {
    id: response.data.id,
    name: response.data.name,
    description: response.data.description,
    createdAt: response.data.created_at,
    updatedAt: response.data.updated_at,
  };
}

export async function createConversation(options: {
  sessionId: string;
  workspaceId: string;
  title?: string | null;
}) {
  const { sessionId, workspaceId, title } = options;
  const supabase = getSupabaseClient();
  const derivedTitle = cleanTitle(title, "New chat");
  if (!supabase || isLocalWorkspaceId(workspaceId)) {
    const now = nowIso();
    return {
      id: `${LOCAL_CONVERSATION_PREFIX}${crypto.randomUUID()}`,
      title: derivedTitle,
      createdAt: now,
      updatedAt: now,
    };
  }

  await assertWorkspaceAccess({
    sessionId,
    workspaceId,
    requiredRole: "editor",
  });

  const conversationResponse = await supabase
    .from("conversations")
    .insert({ session_id: sessionId })
    .select("id, created_at")
    .single();

  if (conversationResponse.error || !conversationResponse.data) {
    throw new Error(
      conversationResponse.error?.message ?? "Failed to create conversation."
    );
  }

  const mappingResponse = await supabase
    .from("conversation_workspaces")
    .insert({
      conversation_id: conversationResponse.data.id,
      workspace_id: workspaceId,
      title: derivedTitle,
    })
    .select("updated_at")
    .single();

  if (mappingResponse.error) {
    throw new Error(mappingResponse.error.message);
  }

  await touchWorkspace(workspaceId);

  return {
    id: conversationResponse.data.id,
    title: derivedTitle,
    createdAt: conversationResponse.data.created_at,
    updatedAt: mappingResponse.data?.updated_at ?? conversationResponse.data.created_at,
  };
}

export async function getConversationHistory(options: {
  sessionId: string;
  workspaceId?: string | null;
  conversationId?: string | null;
}) {
  const { sessionId, workspaceId, conversationId } = options;
  const supabase = getSupabaseClient();

  if (!supabase || isLocalConversationId(conversationId) || isLocalWorkspaceId(workspaceId)) {
    return {
      conversationId: conversationId ?? buildLocalConversationId(sessionId),
      messages: [] as { id: string; role: string; content: string }[],
    };
  }

  if (workspaceId) {
    await assertWorkspaceAccess({ sessionId, workspaceId, requiredRole: "viewer" });
  }

  let resolvedConversationId = conversationId ?? null;

  if (!resolvedConversationId && workspaceId) {
    const mappingResponse = await supabase
      .from("conversation_workspaces")
      .select("conversation_id")
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (mappingResponse.error) {
      throw new Error(mappingResponse.error.message);
    }

    resolvedConversationId = mappingResponse.data?.conversation_id ?? null;
  }

  if (!resolvedConversationId) {
    return { conversationId: null, messages: [] as { id: string; role: string; content: string }[] };
  }

  await assertConversationAccess({
    sessionId,
    workspaceId,
    conversationId: resolvedConversationId,
    requiredRole: "viewer",
  });

  const messageResponse = await supabase
    .from("messages")
    .select("id, role, content")
    .eq("conversation_id", resolvedConversationId)
    .order("created_at", { ascending: true });

  if (messageResponse.error) {
    throw new Error(messageResponse.error.message);
  }

  return {
    conversationId: resolvedConversationId,
    messages: (messageResponse.data ?? []) as { id: string; role: string; content: string }[],
  };
}

export async function saveConversationExchange(options: {
  conversationId?: string | null;
  workspaceId?: string | null;
  userContent: string;
  assistantContent: string;
  preferredTitle?: string | null;
}) {
  const { conversationId, workspaceId, userContent, assistantContent, preferredTitle } = options;
  const supabase = getSupabaseClient();
  if (!supabase || !conversationId || isLocalConversationId(conversationId)) return;

  const rows = [
    { conversation_id: conversationId, role: "user", content: userContent },
    { conversation_id: conversationId, role: "assistant", content: assistantContent },
  ].filter((row) => row.content.trim());

  if (rows.length === 0) return;

  await supabase.from("messages").insert(rows);
  await touchConversation(conversationId, preferredTitle ?? undefined);
  if (workspaceId) {
    await touchWorkspace(workspaceId);
  }
}

async function decodeAttachmentText(attachment: AttachmentLike) {
  const url = attachment.url?.trim();
  if (!url) return null;

  try {
    if (!url.startsWith("data:")) return null;
    const match = url.match(/^data:([^;,]+)?(;base64)?,([\s\S]*)$/);
    if (!match) return null;
    const data = match[3] ?? "";
    return match[2]
      ? Buffer.from(data, "base64").toString("utf-8")
      : decodeURIComponent(data);
  } catch {
    return null;
  }
}

function isTextAttachment(attachment: AttachmentLike) {
  const contentType = attachment.contentType?.toLowerCase() ?? "";
  return (
    contentType.startsWith("text/") ||
    contentType === "application/json" ||
    contentType === "application/javascript" ||
    contentType === "application/x-typescript"
  );
}

async function insertDocumentWithChunks(options: {
  workspaceId: string;
  conversationId?: string | null;
  name: string;
  contentType: string;
  sourceKind: string;
  content: string;
}) {
  const { workspaceId, conversationId, name, contentType, sourceKind, content } = options;
  const supabase = getSupabaseClient();
  if (!supabase || isLocalWorkspaceId(workspaceId)) return null;

  const storedContent = sanitizeText(content);
  if (!storedContent) return null;

  const documentResponse = await supabase
    .from("workspace_documents")
    .insert({
      workspace_id: workspaceId,
      conversation_id: isPersistedConversationId(conversationId) ? conversationId : null,
      name,
      content_type: contentType,
      source_kind: sourceKind,
      summary: summarizeText(storedContent),
      content_text: storedContent,
    })
    .select("id")
    .single();

  if (documentResponse.error || !documentResponse.data) {
    return null;
  }

  const chunks: WorkspaceChunkRow[] = chunkText(storedContent).map((chunk, index) => ({
    workspace_id: workspaceId,
    document_id: documentResponse.data.id,
    source_kind: sourceKind,
    source_label: name,
    chunk_index: index,
    content: chunk,
  }));

  const embeddings = await embedTexts(chunks.map((chunk) => chunk.content));
  const now = nowIso();
  if (embeddings && embeddings.length === chunks.length) {
    for (let index = 0; index < chunks.length; index += 1) {
      chunks[index].embedding = embeddings[index];
      chunks[index].embedding_model = EMBEDDING_MODEL;
      chunks[index].embedding_generated_at = now;
    }
  }

  if (chunks.length > 0) {
    await supabase.from("workspace_chunks").insert(chunks);
  }

  return documentResponse.data.id;
}

async function upsertProjectFile(options: {
  workspaceId: string;
  conversationId?: string | null;
  documentId?: string | null;
  artifactId?: string | null;
  path: string;
  displayName: string;
  sourceKind: string;
  mimeType: string;
  bytes: number;
  summary?: string | null;
}) {
  const supabase = getSupabaseClient();
  if (!supabase || isLocalWorkspaceId(options.workspaceId)) return;

  try {
    await supabase.from("workspace_project_files").upsert(
      {
        workspace_id: options.workspaceId,
        conversation_id: isPersistedConversationId(options.conversationId)
          ? options.conversationId
          : null,
        document_id: options.documentId ?? null,
        artifact_id: options.artifactId ?? null,
        path: options.path,
        display_name: options.displayName,
        source_kind: options.sourceKind,
        mime_type: options.mimeType,
        bytes: options.bytes,
        summary: options.summary ?? null,
        updated_at: nowIso(),
      },
      { onConflict: "workspace_id,path" }
    );
  } catch {
    // Ignore schema-mismatch errors so retrieval/doc persistence remains functional.
  }
}

export async function persistWorkspaceAttachments(options: {
  workspaceId?: string | null;
  conversationId?: string | null;
  attachments?: AttachmentLike[] | null;
}) {
  const { workspaceId, conversationId, attachments } = options;
  if (!workspaceId || isLocalWorkspaceId(workspaceId) || !attachments?.length) return;

  let storedAny = false;
  for (const attachment of attachments) {
    if (!isTextAttachment(attachment)) continue;
    const content = await decodeAttachmentText(attachment);
    if (!content?.trim()) continue;

    const inserted = await insertDocumentWithChunks({
      workspaceId,
      conversationId,
      name: cleanTitle(attachment.name, "Uploaded document"),
      contentType: attachment.contentType ?? "text/plain",
      sourceKind: "upload",
      content,
    });

    if (inserted) {
      storedAny = true;
      const displayName = cleanTitle(attachment.name, "Uploaded document");
      await upsertProjectFile({
        workspaceId,
        conversationId,
        documentId: inserted,
        path: toProjectPath("uploads", displayName),
        displayName,
        sourceKind: "upload",
        mimeType: attachment.contentType ?? "text/plain",
        bytes: Buffer.byteLength(content, "utf-8"),
        summary: summarizeText(content),
      });
    }
  }

  if (storedAny) {
    await touchWorkspace(workspaceId);
  }
}

export async function persistWorkspaceArtifacts(options: {
  workspaceId?: string | null;
  conversationId?: string | null;
  artifacts: CodeExecutionArtifact[];
}) {
  const { workspaceId, conversationId, artifacts } = options;
  const supabase = getSupabaseClient();
  if (!supabase || !workspaceId || isLocalWorkspaceId(workspaceId) || artifacts.length === 0) {
    return;
  }

  for (const artifact of artifacts) {
    const artifactResponse = await supabase
      .from("workspace_artifacts")
      .insert({
        workspace_id: workspaceId,
        conversation_id: isPersistedConversationId(conversationId) ? conversationId : null,
        name: artifact.name,
        mime_type: artifact.mimeType,
        content: artifact.content,
        bytes: artifact.bytes,
      })
      .select("id")
      .single();

    if (!artifactResponse.error) {
      const documentId = await insertDocumentWithChunks({
        workspaceId,
        conversationId,
        name: artifact.name,
        contentType: artifact.mimeType,
        sourceKind: "artifact",
        content: artifact.content,
      });
      await upsertProjectFile({
        workspaceId,
        conversationId,
        artifactId: artifactResponse.data?.id ?? null,
        documentId,
        path: toProjectPath("artifacts", artifact.name),
        displayName: artifact.name,
        sourceKind: "artifact",
        mimeType: artifact.mimeType,
        bytes: artifact.bytes,
        summary: summarizeText(artifact.content),
      });
    }
  }

  await touchWorkspace(workspaceId);
  if (conversationId) {
    await touchConversation(conversationId);
  }
}

export async function recordWorkspaceEvent(options: {
  sessionId: string;
  workspaceId?: string | null;
  conversationId?: string | null;
  eventType: string;
  status: "started" | "success" | "failure";
  details?: Record<string, unknown>;
}) {
  const { sessionId, workspaceId, conversationId, eventType, status, details } = options;
  const supabase = getSupabaseClient();
  if (!supabase || !workspaceId || isLocalWorkspaceId(workspaceId)) return;

  await supabase.from("workspace_events").insert({
    workspace_id: workspaceId,
    conversation_id: isPersistedConversationId(conversationId) ? conversationId : null,
    session_id: sessionId,
    event_type: eventType,
    status,
    details: details ?? {},
  });
}

export async function getWorkspaceRetrievalContext(options: {
  workspaceId?: string | null;
  query: string;
}) {
  const { workspaceId, query } = options;
  const supabase = getSupabaseClient();
  if (!supabase || !workspaceId || isLocalWorkspaceId(workspaceId) || !query.trim()) {
    return [] as WorkspaceRetrievalHit[];
  }

  const [chunkResponse, mappingResponse] = await Promise.all([
    supabase
      .from("workspace_chunks")
      .select("source_kind, source_label, content, embedding")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(MAX_RETRIEVAL_CHUNK_CANDIDATES),
    supabase
      .from("conversation_workspaces")
      .select("conversation_id, title")
      .eq("workspace_id", workspaceId),
  ]);

  if (chunkResponse.error || mappingResponse.error) {
    return [] as WorkspaceRetrievalHit[];
  }

  const conversationTitles = new Map(
    ((mappingResponse.data ?? []) as Array<{ conversation_id: string; title: string | null }>).map(
      (row) => [row.conversation_id, cleanTitle(row.title, "Untitled chat")]
    )
  );

  const conversationIds = [...conversationTitles.keys()];
  const messageResponse = conversationIds.length
    ? await supabase
        .from("messages")
        .select("conversation_id, role, content")
        .in("conversation_id", conversationIds)
        .order("created_at", { ascending: false })
        .limit(120)
    : { data: [], error: null };

  if (messageResponse.error) {
    return [] as WorkspaceRetrievalHit[];
  }

  const queryEmbedding = (await embedTexts([query]))?.[0] ?? null;

  const chunkHits = ((chunkResponse.data ?? []) as Array<{
    source_kind: string;
    source_label: string;
    content: string;
    embedding?: unknown;
  }>)
    .map((row) => {
      const lexicalScore = computeScore(query, row.content);
      const chunkEmbedding = parseEmbeddingVector(row.embedding);
      const semanticScore =
        queryEmbedding && chunkEmbedding
          ? cosineSimilarity(queryEmbedding, chunkEmbedding) * SEMANTIC_SCORE_MULTIPLIER
          : 0;

      return {
        sourceKind: row.source_kind === "artifact" ? "artifact" : "document",
        sourceLabel: row.source_label,
        excerpt: summarizeText(row.content, 260) ?? row.content,
        score: lexicalScore + semanticScore,
      };
    })
    .filter((hit) => hit.score > 0);

  const messageHits = ((messageResponse.data ?? []) as Array<{
    conversation_id: string;
    role: string;
    content: string;
  }>)
    .map((row) => ({
      sourceKind: "conversation" as const,
      sourceLabel: `Chat · ${conversationTitles.get(row.conversation_id) ?? "Untitled chat"}`,
      excerpt: summarizeText(`${row.role}: ${row.content}`, 260) ?? row.content,
      score: computeScore(query, row.content),
    }))
    .filter((hit) => hit.score > 0);

  return [...chunkHits, ...messageHits]
    .sort((left, right) => right.score - left.score)
    .slice(0, MAX_RETRIEVAL_HITS);
}
