"use client";

import { useChat } from "ai/react";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";

const MAX_FILE_SIZE_MB = 10;
const MAX_FILE_SIZE = MAX_FILE_SIZE_MB * 1024 * 1024;
const CODE_PREVIEW_MAX_LENGTH = 220;
const CODE_PREVIEW_TRUNCATION_LENGTH = 2;
const ACCEPTED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "text/plain",
  "text/csv",
  "text/markdown",
];

// ─── Tool display helpers ────────────────────────────────────────────────────

const TOOL_LABELS: Record<string, string> = {
  get_current_datetime: "Checking date & time",
  calculate: "Calculating",
  create_task_plan: "Planning task",
  web_search: "Searching the web",
  analyze_github_repo: "Analyzing GitHub repo",
  execute_code: "Running code",
};

function getToolLabel(name: string) {
  return TOOL_LABELS[name] ?? `Running ${name.replace(/_/g, " ")}`;
}

const EXECUTION_FAILURE_LABELS: Record<string, string> = {
  disabled: "Execution disabled in deployment",
  empty_snippet: "No executable snippet provided",
  snippet_too_large: "Snippet exceeds source limit",
  blocked_import_export: "Blocked: import/export",
  blocked_modules: "Blocked: external modules",
  blocked_host_global: "Blocked: host globals",
  blocked_network: "Blocked: network access",
  blocked_runtime_api: "Blocked: filesystem/process/runtime APIs",
  compilation_error: "TypeScript compilation error",
  timeout: "Timed out",
  worker_error: "Sandbox worker error",
  runtime_error: "Runtime error",
};

interface ToolInvocation {
  state: "partial-call" | "call" | "result";
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  result?: unknown;
}

function TaskPlanCard({
  result,
}: {
  result: { task: string; steps: string[] };
}) {
  return (
    <div className="tool-card tool-card--plan">
      <div className="tool-card-header">
        <span className="tool-card-icon">🗺️</span>
        <span className="tool-card-title">{result.task}</span>
      </div>
      <ol className="task-plan-steps">
        {result.steps.map((step, i) => (
          <li key={i} className="task-plan-step">
            {step}
          </li>
        ))}
      </ol>
    </div>
  );
}

function CalculateCard({
  args,
  result,
}: {
  args: { expression?: string };
  result?: { expression: string; result?: string; error?: string };
}) {
  return (
    <div className="tool-card tool-card--calc">
      <div className="tool-card-header">
        <span className="tool-card-icon">��</span>
        <span className="tool-card-title">Calculate</span>
      </div>
      <div className="tool-card-body">
        <code className="tool-expr">{args.expression}</code>
        {result && (
          <span className="tool-result-value">
            {result.error ? (
              <span className="tool-error">{result.error}</span>
            ) : (
              <>= {result.result}</>
            )}
          </span>
        )}
      </div>
    </div>
  );
}

function DatetimeCard({ result }: { result?: { readable: string } }) {
  return (
    <div className="tool-card tool-card--datetime">
      <div className="tool-card-header">
        <span className="tool-card-icon">🕐</span>
        <span className="tool-card-title">
          {result ? result.readable : "Fetching date & time…"}
        </span>
      </div>
    </div>
  );
}

interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

interface WebSearchToolResult {
  query: string;
  answer?: string | null;
  results?: WebSearchResult[];
  error?: string;
  configured?: boolean;
}

function WebSearchCard({
  args,
  result,
}: {
  args: { query?: string };
  result?: WebSearchToolResult;
}) {
  const isPending = !result;
  return (
    <div className={`tool-card tool-card--search ${isPending ? "tool-card--pending" : ""}`}>
      <div className="tool-card-header">
        <span className="tool-card-icon">🔍</span>
        <span className="tool-card-title">
          {isPending ? `Searching: ${args.query ?? "…"}` : `Search: ${result.query}`}
        </span>
        {isPending && <span className="tool-spinner" />}
      </div>
      {result && !result.error && (
        <div className="tool-card-body">
          {result.answer && (
            <p className="search-answer">{result.answer}</p>
          )}
          {result.results && result.results.length > 0 && (
            <ul className="search-results">
              {result.results.map((r, i) => (
                <li key={r.url || i} className="search-result-item">
                  <a
                    href={r.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="search-result-title"
                  >
                    {r.title}
                  </a>
                  <span className="search-result-url">{r.url}</span>
                  <span className="search-result-snippet">{r.snippet}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {result?.error && (
        <div className="tool-card-body">
          <span className="tool-error">{result.error}</span>
        </div>
      )}
    </div>
  );
}

interface GitHubRepoToolResult {
  name?: string;
  description?: string | null;
  primary_language?: string | null;
  stars?: number;
  forks?: number;
  open_issues?: number;
  topics?: string[];
  license?: string | null;
  url?: string;
  updated_at?: string;
  file_tree?: string[];
  file_tree_note?: string;
  error?: string;
  repo?: string;
}

interface CodeExecutionArtifact {
  name: string;
  mimeType: string;
  content: string;
  bytes: number;
}

interface CodeExecutionToolResult {
  available: boolean;
  language: "javascript" | "typescript";
  success: boolean;
  failureKind?: string;
  failureGuidance?: string;
  durationMs: number;
  logs: string[];
  errors: string[];
  artifacts: CodeExecutionArtifact[];
  result?: string;
  resultType?: string;
  error?: string;
  limits: {
    timeoutMs: number;
    maxSourceLength: number;
    maxOutputChars: number;
    maxArtifacts: number;
    maxArtifactBytes: number;
    memoryLimitMb: number;
  };
}

interface WorkspaceConversationSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

interface WorkspaceSummary {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  conversationCount: number;
  documentCount: number;
  artifactCount: number;
  conversations: WorkspaceConversationSummary[];
}

interface WorkspaceDocumentSummary {
  id: string;
  conversationId: string | null;
  name: string;
  contentType: string;
  sourceKind: string;
  summary: string | null;
  createdAt: string;
}

interface WorkspaceArtifactSummary {
  id: string;
  conversationId: string | null;
  name: string;
  mimeType: string;
  content: string;
  bytes: number;
  createdAt: string;
}

interface WorkspaceBootstrapResponse {
  persistenceEnabled: boolean;
  schemaReady: boolean;
  notice: string | null;
  workspaces: WorkspaceSummary[];
  selectedWorkspaceId: string | null;
  selectedConversationId: string | null;
  documents: WorkspaceDocumentSummary[];
  artifacts: WorkspaceArtifactSummary[];
}

function formatTimestamp(value: string) {
  try {
    return new Date(value).toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return value;
  }
}

function buildArtifactDownloadHref(artifact: WorkspaceArtifactSummary | CodeExecutionArtifact) {
  return `data:${artifact.mimeType};charset=utf-8,${encodeURIComponent(artifact.content)}`;
}

function getDocumentKindLabel(sourceKind: string) {
  return sourceKind === "artifact" ? "Artifact" : sourceKind === "upload" ? "Upload" : "Context";
}

function GitHubRepoCard({
  args,
  result,
}: {
  args: { repo?: string };
  result?: GitHubRepoToolResult;
}) {
  const isPending = !result;
  const displayName = result?.name ?? args.repo ?? "repository";
  return (
    <div className={`tool-card tool-card--github ${isPending ? "tool-card--pending" : ""}`}>
      <div className="tool-card-header">
        <span className="tool-card-icon">🐙</span>
        <span className="tool-card-title">
          {isPending ? `Analyzing ${displayName}…` : displayName}
        </span>
        {isPending && <span className="tool-spinner" />}
      </div>
      {result && !result.error && (
        <div className="tool-card-body">
          {result.description && (
            <p className="github-description">{result.description}</p>
          )}
          <div className="github-meta">
            {result.primary_language && (
              <span className="github-badge">🔤 {result.primary_language}</span>
            )}
            {typeof result.stars === "number" && (
              <span className="github-badge">⭐ {result.stars.toLocaleString()}</span>
            )}
            {typeof result.forks === "number" && (
              <span className="github-badge">🍴 {result.forks.toLocaleString()}</span>
            )}
            {result.license && (
              <span className="github-badge">📄 {result.license}</span>
            )}
          </div>
          {result.topics && result.topics.length > 0 && (
            <div className="github-topics">
              {result.topics.slice(0, 8).map((t) => (
                <span key={t} className="github-topic">{t}</span>
              ))}
            </div>
          )}
          {result.file_tree && result.file_tree.length > 0 && (
            <details className="github-tree">
              <summary>File structure ({result.file_tree.length} entries)</summary>
              <ul className="github-tree-list">
                {result.file_tree.map((entry, i) => (
                  <li key={`${entry}-${i}`} className="github-tree-entry">{entry}</li>
                ))}
              </ul>
              {result.file_tree_note && (
                <p className="github-tree-note">{result.file_tree_note}</p>
              )}
            </details>
          )}
          {result.url && (
            <a
              href={result.url}
              target="_blank"
              rel="noopener noreferrer"
              className="github-link"
            >
              View on GitHub ↗
            </a>
          )}
        </div>
      )}
      {result?.error && (
        <div className="tool-card-body">
          <span className="tool-error">{result.error}</span>
        </div>
      )}
    </div>
  );
}

function CodeExecutionCard({
  args,
  result,
}: {
  args: { code?: string; language?: "javascript" | "typescript" };
  result?: CodeExecutionToolResult;
}) {
  const isPending = !result;
  const preview = args.code?.trim() || "";
  const codePreview =
    preview.length > CODE_PREVIEW_MAX_LENGTH
      ? `${preview.slice(0, Math.max(0, CODE_PREVIEW_MAX_LENGTH - CODE_PREVIEW_TRUNCATION_LENGTH))}\n…`
      : preview || "Preparing snippet…";
  const failureLabel =
    result && !result.success && result.failureKind
      ? EXECUTION_FAILURE_LABELS[result.failureKind] ?? result.failureKind
      : null;

  return (
    <div className={`tool-card tool-card--execution ${isPending ? "tool-card--pending" : ""}`}>
      <div className="tool-card-header">
        <span className="tool-card-icon">🧪</span>
        <span className="tool-card-title">
          {isPending
            ? `Running ${args.language ?? "typescript"} snippet…`
            : `${result.language} sandbox`}
        </span>
        {isPending && <span className="tool-spinner" />}
      </div>
      <div className="tool-card-body tool-card-body--stacked">
        <pre className="tool-code-block">
          <code>{codePreview}</code>
        </pre>
        {result && (
          <>
            <div className="execution-meta">
              <span className={`execution-badge ${result.success ? "execution-badge--success" : "execution-badge--error"}`}>
                {result.success ? "Completed" : "Failed"}
              </span>
              {!result.success && failureLabel && (
                <span className="execution-badge execution-badge--error">
                  {failureLabel}
                </span>
              )}
              <span className="execution-badge">{result.durationMs} ms</span>
              <span className="execution-badge">{result.limits.timeoutMs} ms timeout</span>
              <span className="execution-badge">{result.limits.memoryLimitMb} MB worker</span>
            </div>

            {!result.success && result.failureGuidance && (
              <p className="execution-guidance">{result.failureGuidance}</p>
            )}

            {result.result && (
              <div className="execution-section">
                <div className="execution-section-title">
                  Result{result.resultType ? ` · ${result.resultType}` : ""}
                </div>
                <pre className="execution-output">
                  <code>{result.result}</code>
                </pre>
              </div>
            )}

            {result.logs.length > 0 && (
              <div className="execution-section">
                <div className="execution-section-title">Logs</div>
                <pre className="execution-output">
                  <code>{result.logs.join("\n")}</code>
                </pre>
              </div>
            )}

            {(result.errors.length > 0 || result.error) && (
              <div className="execution-section">
                <div className="execution-section-title">Errors</div>
                <pre className="execution-output execution-output--error">
                  <code>{[...result.errors, result.error].filter(Boolean).join("\n")}</code>
                </pre>
              </div>
            )}

            {result.artifacts.length > 0 && (
              <div className="execution-section">
                <div className="execution-section-title">Artifacts</div>
                <div className="artifact-list">
                  {result.artifacts.map((artifact, index) => (
                    <div key={`${artifact.name}-${index}`} className="artifact-card">
                      <div className="artifact-card-header">
                        <span>{artifact.name}</span>
                        <a
                          className="artifact-link"
                          href={`data:${artifact.mimeType};charset=utf-8,${encodeURIComponent(artifact.content)}`}
                          download={artifact.name}
                        >
                          Download
                        </a>
                      </div>
                      <div className="artifact-meta">
                        {artifact.mimeType} · {artifact.bytes} bytes
                      </div>
                      <pre className="execution-output">
                        <code>{artifact.content}</code>
                      </pre>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function ToolCallCard({ invocation }: { invocation: ToolInvocation }) {
  const isPending =
    invocation.state === "partial-call" || invocation.state === "call";

  if (
    invocation.toolName === "create_task_plan" &&
    invocation.state === "result"
  ) {
    return (
      <TaskPlanCard
        result={invocation.result as { task: string; steps: string[] }}
      />
    );
  }

  if (invocation.toolName === "calculate") {
    return (
      <CalculateCard
        args={invocation.args as { expression?: string }}
        result={
          invocation.state === "result"
            ? (invocation.result as {
                expression: string;
                result?: string;
                error?: string;
              })
            : undefined
        }
      />
    );
  }

  if (invocation.toolName === "get_current_datetime") {
    return (
      <DatetimeCard
        result={
          invocation.state === "result"
            ? (invocation.result as { readable: string })
            : undefined
        }
      />
    );
  }

  if (invocation.toolName === "web_search") {
    return (
      <WebSearchCard
        args={invocation.args as { query?: string }}
        result={
          invocation.state === "result"
            ? (invocation.result as WebSearchToolResult)
            : undefined
        }
      />
    );
  }

  if (invocation.toolName === "analyze_github_repo") {
    return (
      <GitHubRepoCard
        args={invocation.args as { repo?: string }}
        result={
          invocation.state === "result"
            ? (invocation.result as GitHubRepoToolResult)
            : undefined
        }
      />
    );
  }

  if (invocation.toolName === "execute_code") {
    return (
      <CodeExecutionCard
        args={invocation.args as {
          code?: string;
          language?: "javascript" | "typescript";
        }}
        result={
          invocation.state === "result"
            ? (invocation.result as CodeExecutionToolResult)
            : undefined
        }
      />
    );
  }

  // Generic fallback card
  return (
    <div className={`tool-card ${isPending ? "tool-card--pending" : ""}`}>
      <div className="tool-card-header">
        <span className="tool-card-icon">{isPending ? "⚙️" : "✅"}</span>
        <span className="tool-card-title">{getToolLabel(invocation.toolName)}</span>
        {isPending && <span className="tool-spinner" />}
      </div>
    </div>
  );
}

// ─── Main Chat component ─────────────────────────────────────────────────────

export function Chat() {
  const router = useRouter();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [documents, setDocuments] = useState<WorkspaceDocumentSummary[]>([]);
  const [artifacts, setArtifacts] = useState<WorkspaceArtifactSummary[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [persistenceEnabled, setPersistenceEnabled] = useState(false);
  const [schemaReady, setSchemaReady] = useState(true);
  const [workspaceNotice, setWorkspaceNotice] = useState<string | null>(null);
  const [workspaceError, setWorkspaceError] = useState("");
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [newWorkspaceDescription, setNewWorkspaceDescription] = useState("");
  const [artifactPreviewId, setArtifactPreviewId] = useState<string | null>(null);

  const {
    messages,
    input,
    handleInputChange,
    handleSubmit,
    status,
    setMessages,
    setInput,
  } = useChat({ body: { conversationId, workspaceId } });

  const [files, setFiles] = useState<FileList | undefined>();
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const [fileError, setFileError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const selectedWorkspace =
    workspaces.find((workspace) => workspace.id === workspaceId) ?? null;
  const selectedArtifact =
    artifacts.find((artifact) => artifact.id === artifactPreviewId) ?? artifacts[0] ?? null;
  const canManageWorkspaces = persistenceEnabled && schemaReady;

  async function fetchWorkspaceData(
    activeSessionId: string,
    nextWorkspaceId?: string | null
  ): Promise<WorkspaceBootstrapResponse> {
    const search = new URLSearchParams({ sessionId: activeSessionId });
    if (nextWorkspaceId) {
      search.set("workspaceId", nextWorkspaceId);
    }

    const response = await fetch(`/api/workspaces?${search.toString()}`);
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(payload.error ?? "Failed to load workspace data.");
    }
    return (await response.json()) as WorkspaceBootstrapResponse;
  }

  function applyWorkspaceData(data: WorkspaceBootstrapResponse) {
    setWorkspaces(data.workspaces);
    setDocuments(data.documents);
    setArtifacts(data.artifacts);
    setPersistenceEnabled(data.persistenceEnabled);
    setSchemaReady(data.schemaReady);
    setWorkspaceNotice(data.notice);
  }

  async function loadConversation(
    activeSessionId: string,
    nextWorkspaceId: string | null,
    nextConversationId: string | null
  ) {
    setHistoryLoaded(false);
    try {
      if (!nextConversationId) {
        setMessages([]);
        return;
      }

      const search = new URLSearchParams({ sessionId: activeSessionId });
      if (nextWorkspaceId) search.set("workspaceId", nextWorkspaceId);
      search.set("conversationId", nextConversationId);
      const response = await fetch(`/api/history?${search.toString()}`);
      if (!response.ok) {
        throw new Error("Failed to load conversation history.");
      }

      const payload = (await response.json()) as {
        conversationId: string | null;
        messages: { id: string; role: string; content: string }[];
      };

      setConversationId(payload.conversationId ?? nextConversationId);
      setMessages(
        (payload.messages ?? []).map((message) => ({
          id: message.id,
          role: message.role as "user" | "assistant",
          content: message.content,
          parts: [{ type: "text" as const, text: message.content }],
        }))
      );
    } finally {
      setHistoryLoaded(true);
    }
  }

  async function createConversationForWorkspace(
    activeSessionId: string,
    nextWorkspaceId: string
  ) {
    const response = await fetch("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: activeSessionId,
        workspaceId: nextWorkspaceId,
      }),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(payload.error ?? "Failed to create a new chat.");
    }

    const payload = (await response.json()) as {
      conversation: WorkspaceConversationSummary;
    };
    return payload.conversation;
  }

  async function syncWorkspaceSelection(
    nextWorkspaceId?: string | null,
    preferredConversationId?: string | null
  ) {
    if (!sessionId) return;

    setWorkspaceBusy(true);
    setWorkspaceError("");

    try {
      let workspaceData = await fetchWorkspaceData(sessionId, nextWorkspaceId);
      applyWorkspaceData(workspaceData);

      const resolvedWorkspaceId =
        workspaceData.selectedWorkspaceId ??
        nextWorkspaceId ??
        workspaceData.workspaces[0]?.id ??
        null;
      const resolvedWorkspace = workspaceData.workspaces.find(
        (workspace) => workspace.id === resolvedWorkspaceId
      );

      let resolvedConversationId =
        preferredConversationId &&
        resolvedWorkspace?.conversations.some(
          (conversation) => conversation.id === preferredConversationId
        )
          ? preferredConversationId
          : resolvedWorkspace?.conversations[0]?.id ?? null;

      if (!resolvedConversationId && resolvedWorkspaceId) {
        const createdConversation = await createConversationForWorkspace(
          sessionId,
          resolvedWorkspaceId
        );
        workspaceData = await fetchWorkspaceData(sessionId, resolvedWorkspaceId);
        applyWorkspaceData(workspaceData);
        resolvedConversationId = createdConversation.id;
      }

      setWorkspaceId(resolvedWorkspaceId);
      setConversationId(resolvedConversationId);
      if (resolvedWorkspaceId) {
        localStorage.setItem("jarvis_workspace_id", resolvedWorkspaceId);
      }
      if (resolvedConversationId) {
        localStorage.setItem("jarvis_conversation_id", resolvedConversationId);
      }

      await loadConversation(sessionId, resolvedWorkspaceId, resolvedConversationId);
    } catch (error) {
      setWorkspaceError(
        error instanceof Error ? error.message : "Failed to load workspace data."
      );
      setHistoryLoaded(true);
    } finally {
      setWorkspaceBusy(false);
    }
  }

  useEffect(() => {
    let active = true;
    const activeSessionId =
      localStorage.getItem("jarvis_session_id") ?? crypto.randomUUID();
    localStorage.setItem("jarvis_session_id", activeSessionId);
    setSessionId(activeSessionId);

    const preferredWorkspaceId = localStorage.getItem("jarvis_workspace_id");
    const preferredConversationId = localStorage.getItem("jarvis_conversation_id");

    if (active) {
      void syncWorkspaceSelection(preferredWorkspaceId, preferredConversationId);
    }

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Scroll to bottom when a response finishes or a new message is added.
  useEffect(() => {
    if (status === "ready" || status === "error") {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [status, messages.length]);

  useEffect(() => {
    if (status === "ready" && sessionId && workspaceId) {
      void (async () => {
        try {
          const data = await fetchWorkspaceData(sessionId, workspaceId);
          applyWorkspaceData(data);
        } catch {
          // Keep the current UI state if the refresh fails.
        }
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, sessionId, workspaceId]);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  const isLoading = status === "submitted" || status === "streaming";

  // Determine the active tool name while streaming
  const activeToolName = isLoading
    ? (() => {
        const last = messages[messages.length - 1];
        if (!last || last.role !== "assistant") return null;
        const pending = (last.parts ?? []).findLast(
          (p) =>
            p.type === "tool-invocation" &&
            (p as { type: string; toolInvocation: ToolInvocation })
              .toolInvocation.state !== "result"
        );
        if (!pending) return null;
        return getToolLabel(
          (
            pending as {
              type: string;
              toolInvocation: ToolInvocation;
            }
          ).toolInvocation.toolName
        );
      })()
    : null;

  // Revoke object URLs when they change or component unmounts
  useEffect(() => {
    return () => {
      previewUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [previewUrls]);

  useEffect(() => {
    if (!artifacts.length) {
      setArtifactPreviewId(null);
      return;
    }
    if (!artifactPreviewId || !artifacts.some((artifact) => artifact.id === artifactPreviewId)) {
      setArtifactPreviewId(artifacts[0].id);
    }
  }, [artifacts, artifactPreviewId]);

  function validateFiles(fileList: FileList): string {
    for (const file of Array.from(fileList)) {
      if (file.size > MAX_FILE_SIZE) {
        return `"${file.name}" exceeds the ${MAX_FILE_SIZE_MB} MB limit.`;
      }
      if (!ACCEPTED_TYPES.includes(file.type)) {
        return `"${file.name}" type not supported. Accepted: images (JPEG, PNG, GIF, WEBP) and text files.`;
      }
    }
    return "";
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    previewUrls.forEach((url) => URL.revokeObjectURL(url));

    const selected = e.target.files;
    if (!selected || selected.length === 0) {
      setFiles(undefined);
      setPreviewUrls([]);
      setFileError("");
      return;
    }

    const error = validateFiles(selected);
    if (error) {
      setFileError(error);
      setFiles(undefined);
      setPreviewUrls([]);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } else {
      setFileError("");
      setFiles(selected);
      setPreviewUrls(Array.from(selected).map((f) => URL.createObjectURL(f)));
    }
  }

  function clearAttachments() {
    previewUrls.forEach((url) => URL.revokeObjectURL(url));
    setFiles(undefined);
    setPreviewUrls([]);
    setFileError("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleFormSubmit(e: React.FormEvent<HTMLFormElement>) {
    if (isLoading) {
      e.preventDefault();
      return;
    }
    const hasFiles = files != null && files.length > 0;
    if (!input.trim() && !hasFiles) {
      e.preventDefault();
      return;
    }
    handleSubmit(e, {
      experimental_attachments: files,
      allowEmptySubmit: hasFiles && !input.trim(),
    });
    clearAttachments();
  }

  const showTypingIndicator =
    isLoading && messages[messages.length - 1]?.role !== "assistant";

  function fillStarterPrompt(prompt: string) {
    if (isLoading) return;
    setInput(prompt);
  }

  async function handleWorkspaceSelect(nextWorkspaceId: string) {
    if (workspaceBusy || nextWorkspaceId === workspaceId) return;
    await syncWorkspaceSelection(nextWorkspaceId, null);
  }

  async function handleConversationSelect(nextConversationId: string) {
    if (!sessionId || !workspaceId || nextConversationId === conversationId) return;
    setWorkspaceError("");
    setConversationId(nextConversationId);
    localStorage.setItem("jarvis_conversation_id", nextConversationId);
    await loadConversation(sessionId, workspaceId, nextConversationId);
  }

  async function handleCreateWorkspace(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!sessionId || !canManageWorkspaces || workspaceBusy) return;

    setWorkspaceBusy(true);
    setWorkspaceError("");
    try {
      const response = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          name: newWorkspaceName,
          description: newWorkspaceDescription,
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? "Failed to create workspace.");
      }

      const payload = (await response.json()) as {
        workspace: { id: string };
      };
      setNewWorkspaceName("");
      setNewWorkspaceDescription("");
      await syncWorkspaceSelection(payload.workspace.id, null);
    } catch (error) {
      setWorkspaceError(
        error instanceof Error ? error.message : "Failed to create workspace."
      );
    } finally {
      setWorkspaceBusy(false);
    }
  }

  async function handleNewChat() {
    if (!sessionId || !workspaceId || workspaceBusy || !canManageWorkspaces) return;
    setWorkspaceBusy(true);
    setWorkspaceError("");
    try {
      const conversation = await createConversationForWorkspace(sessionId, workspaceId);
      await syncWorkspaceSelection(workspaceId, conversation.id);
      setMessages([]);
    } catch (error) {
      setWorkspaceError(
        error instanceof Error ? error.message : "Failed to start a new chat."
      );
    } finally {
      setWorkspaceBusy(false);
    }
  }

  return (
    <div className="workspace-app">
      <aside className="workspace-sidebar">
        <div className="workspace-sidebar-top">
          <div className="workspace-brand">
            <span className="workspace-brand-mark">J</span>
            <div>
              <div className="workspace-brand-title">Jarvis</div>
              <p className="workspace-brand-subtitle">AI workspace</p>
            </div>
          </div>

          <form className="workspace-create-form" onSubmit={handleCreateWorkspace}>
            <input
              value={newWorkspaceName}
              onChange={(e) => setNewWorkspaceName(e.target.value)}
              className="workspace-field"
              placeholder="New workspace name"
              disabled={!canManageWorkspaces || workspaceBusy}
            />
            <textarea
              value={newWorkspaceDescription}
              onChange={(e) => setNewWorkspaceDescription(e.target.value)}
              className="workspace-field workspace-field--multiline"
              placeholder="What is this project for?"
              rows={2}
              disabled={!canManageWorkspaces || workspaceBusy}
            />
            <button
              type="submit"
              className="workspace-create-button"
              disabled={!canManageWorkspaces || workspaceBusy}
            >
              {workspaceBusy ? "Working…" : "Create workspace"}
            </button>
          </form>

          {workspaceNotice && (
            <div className="workspace-notice">
              <strong>Workspace status</strong>
              <p>{workspaceNotice}</p>
            </div>
          )}
          {workspaceError && <div className="workspace-error">{workspaceError}</div>}
        </div>

        <div className="workspace-list">
          {workspaces.map((workspace) => {
            const isActive = workspace.id === workspaceId;
            return (
              <button
                key={workspace.id}
                type="button"
                className={`workspace-list-item ${isActive ? "workspace-list-item--active" : ""}`}
                onClick={() => handleWorkspaceSelect(workspace.id)}
              >
                <div className="workspace-list-item-header">
                  <span>{workspace.name}</span>
                  <span className="workspace-count-pill">
                    {workspace.artifactCount + workspace.documentCount}
                  </span>
                </div>
                {workspace.description && (
                  <p className="workspace-list-item-description">
                    {workspace.description}
                  </p>
                )}
                <div className="workspace-list-item-meta">
                  <span>{workspace.conversationCount} chats</span>
                  <span>{workspace.documentCount} docs</span>
                  <span>{workspace.artifactCount} artifacts</span>
                </div>
              </button>
            );
          })}
        </div>

        <div className="conversation-sidebar">
          <div className="conversation-sidebar-header">
            <div>
              <div className="side-section-label">Chats</div>
              <p className="side-section-copy">
                Keep project-specific threads separated by workspace.
              </p>
            </div>
            <button
              type="button"
              className="secondary-button"
              onClick={handleNewChat}
              disabled={!canManageWorkspaces || workspaceBusy}
            >
              New chat
            </button>
          </div>

          <div className="conversation-list">
            {selectedWorkspace?.conversations.length ? (
              selectedWorkspace.conversations.map((conversation) => (
                <button
                  key={conversation.id}
                  type="button"
                  className={`conversation-list-item ${
                    conversation.id === conversationId
                      ? "conversation-list-item--active"
                      : ""
                  }`}
                  onClick={() => handleConversationSelect(conversation.id)}
                >
                  <span className="conversation-list-title">
                    {conversation.title}
                  </span>
                  <span className="conversation-list-meta">
                    {formatTimestamp(conversation.updatedAt)}
                  </span>
                </button>
              ))
            ) : (
              <div className="conversation-empty">
                Start a new chat to separate work within this workspace.
              </div>
            )}
          </div>
        </div>
      </aside>

      <section className="chat-panel">
        <div className="chat-header chat-header--workspace">
          <div className="chat-header-copy">
            <span className="chat-header-title">
              {selectedWorkspace?.name ?? "Jarvis workspace"}
            </span>
            <p className="chat-header-subtitle">
              {selectedWorkspace?.description ??
                "Organize chats, uploaded files, and artifacts by project."}
            </p>
          </div>
          <div className="chat-header-right">
            {isLoading && (
              <span className="status-badge">
                <span className="status-dot" />
                {activeToolName ?? "Thinking…"}
              </span>
            )}
            <button className="logout-button" onClick={handleLogout}>
              Sign out
            </button>
          </div>
        </div>

        <div className="workspace-summary-bar">
          <span className="summary-chip">
            {selectedWorkspace?.conversations.length ?? 0} chats
          </span>
          <span className="summary-chip">{documents.length} indexed files</span>
          <span className="summary-chip">{artifacts.length} saved artifacts</span>
          <span className="summary-chip">
            {persistenceEnabled && schemaReady ? "Persistent" : "Single-session"}
          </span>
        </div>

        <div className="messages">
          {!historyLoaded ? (
            <div className="empty-state">
              <p>Loading workspace…</p>
            </div>
          ) : messages.length === 0 ? (
            <div className="empty-state empty-state--workspace">
              <h2>Work inside {selectedWorkspace?.name ?? "Jarvis"}</h2>
              <p className="empty-state-copy">
                Jarvis keeps project chats, uploaded text/code files, generated
                artifacts, and retrieved context grouped together here.
              </p>
              <div className="capability-pills">
                <span className="pill">Workspace retrieval</span>
                <span className="pill">Persistent artifacts</span>
                <span className="pill">Web search</span>
                <span className="pill">GitHub analysis</span>
                <span className="pill">Code execution</span>
                <span className="pill">File analysis</span>
              </div>
              <div className="starter-actions">
                <button
                  type="button"
                  className="starter-button"
                  onClick={() =>
                    fillStarterPrompt("Search the web for the latest news in AI today.")
                  }
                >
                  Latest AI news
                </button>
                <button
                  type="button"
                  className="starter-button"
                  onClick={() =>
                    fillStarterPrompt(
                      "Analyze the GitHub repository vercel/next.js and summarize its purpose, structure, and key features."
                    )
                  }
                >
                  Analyze a repo
                </button>
                <button
                  type="button"
                  className="starter-button"
                  onClick={() =>
                    fillStarterPrompt(
                      "Run a TypeScript snippet that creates a CSV artifact summarizing quarterly revenue."
                    )
                  }
                >
                  Generate an artifact
                </button>
                <button
                  type="button"
                  className="starter-button"
                  onClick={() =>
                    fillStarterPrompt(
                      "Review the uploaded document and answer questions using prior workspace context."
                    )
                  }
                >
                  Use retrieved context
                </button>
              </div>
            </div>
          ) : (
            messages.map((message) => (
              <div
                key={message.id}
                className={`message ${message.role === "user" ? "user" : "assistant"}`}
              >
                <div className="message-role">
                  {message.role === "user" ? "You" : "Jarvis"}
                </div>
                <div className="message-content">
                  {message.parts.map((part, index) => {
                    if (part.type === "text") {
                      if (message.role === "assistant") {
                        return (
                          <div
                            key={`${message.id}-${index}`}
                            className="markdown-body"
                          >
                            <ReactMarkdown>{part.text}</ReactMarkdown>
                          </div>
                        );
                      }
                      return <p key={`${message.id}-${index}`}>{part.text}</p>;
                    }

                    if (part.type === "tool-invocation") {
                      const invocation = (
                        part as {
                          type: string;
                          toolInvocation: ToolInvocation;
                        }
                      ).toolInvocation;
                      return (
                        <ToolCallCard
                          key={`${message.id}-${index}`}
                          invocation={invocation}
                        />
                      );
                    }

                    return null;
                  })}
                </div>
                {message.role === "user" &&
                  message.experimental_attachments &&
                  message.experimental_attachments.length > 0 && (
                    <div className="message-attachments">
                      {message.experimental_attachments.map((attachment, index) =>
                        attachment.contentType?.startsWith("image/") ? (
                          <img
                            key={index}
                            src={attachment.url}
                            alt={attachment.name ?? "Attached image"}
                            className="attachment-image"
                          />
                        ) : (
                          <div key={index} className="attachment-file">
                            📎 {attachment.name ?? "File"}
                          </div>
                        )
                      )}
                    </div>
                  )}
              </div>
            ))
          )}

          {showTypingIndicator && (
            <div className="message assistant message--typing">
              <div className="message-role">Jarvis</div>
              <div
                className="typing-indicator"
                role="status"
                aria-live="polite"
                aria-label="Jarvis is thinking"
              >
                <span />
                <span />
                <span />
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {files != null && files.length > 0 && (
          <div className="attachment-preview">
            {Array.from(files).map((file, idx) => (
              <div key={idx} className="attachment-preview-item">
                {file.type.startsWith("image/") ? (
                  <img
                    src={previewUrls[idx]?.startsWith("blob:") ? previewUrls[idx] : ""}
                    alt={file.name}
                    className="attachment-preview-img"
                  />
                ) : (
                  <span className="attachment-preview-file">📎 {file.name}</span>
                )}
              </div>
            ))}
            <button
              type="button"
              className="attachment-clear"
              onClick={clearAttachments}
              aria-label="Clear attachments"
            >
              ✕
            </button>
          </div>
        )}

        {fileError && <div className="file-error">{fileError}</div>}

        <form ref={formRef} className="input-form" onSubmit={handleFormSubmit}>
          <label className="attach-button" title="Attach image or text file">
            📎
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={ACCEPTED_TYPES.join(",")}
              onChange={handleFileChange}
              className="file-input-hidden"
            />
          </label>
          <label htmlFor="chat-message-input" className="sr-only">
            Message input
          </label>
          <span id="chat-input-help" className="sr-only">
            Press Enter to send. Press Shift plus Enter for a new line.
          </span>
          <textarea
            id="chat-message-input"
            aria-describedby="chat-input-help"
            name="message"
            value={input}
            onChange={handleInputChange}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                formRef.current?.requestSubmit();
              }
            }}
            placeholder="Ask Jarvis anything for this workspace…"
            className="chat-input"
            rows={1}
          />
          <button type="submit" className="send-button" disabled={isLoading}>
            {isLoading ? "Working…" : "Send"}
          </button>
        </form>
      </section>

      <aside className="context-sidebar">
        <div className="context-panel">
          <div className="context-panel-section">
            <div className="context-panel-header">
              <div>
                <div className="side-section-label">Artifacts</div>
                <p className="side-section-copy">
                  Generated files now persist per workspace and can be
                  downloaded later.
                </p>
              </div>
            </div>

            {artifacts.length ? (
              <>
                <div className="saved-artifact-list">
                  {artifacts.map((artifact) => (
                    <button
                      key={artifact.id}
                      type="button"
                      className={`saved-artifact-item ${
                        artifact.id === selectedArtifact?.id
                          ? "saved-artifact-item--active"
                          : ""
                      }`}
                      onClick={() => setArtifactPreviewId(artifact.id)}
                    >
                      <span className="saved-artifact-name">{artifact.name}</span>
                      <span className="saved-artifact-meta">
                        {artifact.mimeType} · {artifact.bytes} bytes
                      </span>
                    </button>
                  ))}
                </div>
                {selectedArtifact && (
                  <div className="artifact-preview-card">
                    <div className="artifact-card-header">
                      <span>{selectedArtifact.name}</span>
                      <a
                        className="artifact-link"
                        href={buildArtifactDownloadHref(selectedArtifact)}
                        download={selectedArtifact.name}
                      >
                        Download
                      </a>
                    </div>
                    <div className="artifact-meta">
                      Saved {formatTimestamp(selectedArtifact.createdAt)}
                    </div>
                    <pre className="execution-output">
                      <code>{selectedArtifact.content}</code>
                    </pre>
                  </div>
                )}
              </>
            ) : (
              <div className="context-empty">
                Run code that calls <code>createArtifact(...)</code> to keep a
                downloadable record in this workspace.
              </div>
            )}
          </div>

          <div className="context-panel-section">
            <div className="context-panel-header">
              <div>
                <div className="side-section-label">Indexed files</div>
                <p className="side-section-copy">
                  Uploaded text, code, markdown, CSV, and generated artifacts
                  feed workspace retrieval.
                </p>
              </div>
            </div>

            {documents.length ? (
              <div className="document-list">
                {documents.map((document) => (
                  <div key={document.id} className="document-card">
                    <div className="document-card-header">
                      <span>{document.name}</span>
                      <span className="document-kind-pill">
                        {getDocumentKindLabel(document.sourceKind)}
                      </span>
                    </div>
                    <div className="document-meta">
                      {document.contentType} · {formatTimestamp(document.createdAt)}
                    </div>
                    {document.summary && (
                      <p className="document-summary">{document.summary}</p>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="context-empty">
                Upload a text/code document or generate an artifact to strengthen
                future workspace retrieval.
              </div>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}
