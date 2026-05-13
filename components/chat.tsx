"use client";

import { useChat } from "ai/react";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";

const MAX_FILE_SIZE_MB = 10;
const MAX_FILE_SIZE = MAX_FILE_SIZE_MB * 1024 * 1024;
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
};

function getToolLabel(name: string) {
  return TOOL_LABELS[name] ?? `Running ${name.replace(/_/g, " ")}`;
}

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
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [historyLoaded, setHistoryLoaded] = useState(false);

  const {
    messages,
    input,
    handleInputChange,
    handleSubmit,
    status,
    setMessages,
    setInput,
  } = useChat({ body: { conversationId } });

  const [files, setFiles] = useState<FileList | undefined>();
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const [fileError, setFileError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Load or create a session ID and fetch conversation history on mount.
  useEffect(() => {
    let sessionId = localStorage.getItem("jarvis_session_id");
    if (!sessionId) {
      sessionId = crypto.randomUUID();
      localStorage.setItem("jarvis_session_id", sessionId);
    }

    fetch(`/api/history?sessionId=${encodeURIComponent(sessionId)}`)
      .then((r) => r.json())
      .then(
        ({
          conversationId: convId,
          messages: history,
        }: {
          conversationId: string | null;
          messages: { id: string; role: string; content: string }[];
        }) => {
          setConversationId(convId);
          if (history.length > 0) {
            setMessages(
              history.map((m) => ({
                id: m.id,
                role: m.role as "user" | "assistant",
                content: m.content,
                parts: [{ type: "text" as const, text: m.content }],
              }))
            );
          }
        }
      )
      .catch(() => {
        // History unavailable — continue without persistence.
      })
      .finally(() => {
        setHistoryLoaded(true);
      });
  }, [setMessages]);

  // Scroll to bottom when a response finishes or a new message is added.
  useEffect(() => {
    if (status === "ready" || status === "error") {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [status, messages.length]);

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

  return (
    <div className="chat">
      <div className="chat-header">
        <span className="chat-header-title">Jarvis</span>
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

      <div className="messages">
        {!historyLoaded ? (
          <div className="empty-state">
            <p>Loading…</p>
          </div>
        ) : messages.length === 0 ? (
          <div className="empty-state">
            <h2>Hello, I&apos;m Jarvis.</h2>
            <p>How can I help you today?</p>
            <div className="capability-pills">
              <span className="pill">🔢 Calculations</span>
              <span className="pill">📋 Task planning</span>
              <span className="pill">🕐 Date &amp; time</span>
              <span className="pill">📎 File analysis</span>
            </div>
            <div className="starter-actions">
              <button
                type="button"
                className="starter-button"
                onClick={() => fillStarterPrompt("Plan my day in 5 practical steps.")}
              >
                Plan my day
              </button>
              <button
                type="button"
                className="starter-button"
                onClick={() =>
                  fillStarterPrompt("Calculate 18% tip on $64.50 and total.")
                }
              >
                Quick calculation
              </button>
              <button
                type="button"
                className="starter-button"
                onClick={() =>
                  fillStarterPrompt(
                    "I need help reviewing a GitHub repo. What details should I share so you can help effectively?"
                  )
                }
              >
                Repo help prompt
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
                    return (
                      <p key={`${message.id}-${index}`}>{part.text}</p>
                    );
                  }
                  if (part.type === "tool-invocation") {
                    const inv = (
                      part as {
                        type: string;
                        toolInvocation: ToolInvocation;
                      }
                    ).toolInvocation;
                    return (
                      <ToolCallCard
                        key={`${message.id}-${index}`}
                        invocation={inv}
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
                    {message.experimental_attachments.map((att, idx) =>
                      att.contentType?.startsWith("image/") ? (
                        <img
                          key={idx}
                          src={att.url}
                          alt={att.name ?? "Attached image"}
                          className="attachment-image"
                        />
                      ) : (
                        <div key={idx} className="attachment-file">
                          📎 {att.name ?? "File"}
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
                  src={
                    previewUrls[idx]?.startsWith("blob:")
                      ? previewUrls[idx]
                      : ""
                  }
                  alt={file.name}
                  className="attachment-preview-img"
                />
              ) : (
                <span className="attachment-preview-file">
                  📎 {file.name}
                </span>
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
          placeholder="Ask Jarvis anything…"
          className="chat-input"
          rows={1}
        />
        <button type="submit" className="send-button" disabled={isLoading}>
          {isLoading ? "Working…" : "Send"}
        </button>
      </form>
    </div>
  );
}
