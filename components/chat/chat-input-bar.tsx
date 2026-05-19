"use client";

import React, { useRef } from "react";

export const ACCEPTED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "text/plain",
  "text/csv",
  "text/markdown",
];
export const MAX_FILE_SIZE_MB = 10;
export const MAX_FILE_SIZE = MAX_FILE_SIZE_MB * 1024 * 1024;

export interface LightweightAttachment {
  url: string;
  name: string;
  mimeType: string;
  size: number;
}

interface ChatInputBarProps {
  input: string;
  isLoading: boolean;
  isStreamFinalizing: boolean;
  isStreamStalled: boolean;
  isUploadingAttachment: boolean;
  files: FileList | undefined;
  previewUrls: string[];
  fileError: string;
  pendingToolLabel: string | null;
  workspaceId: string | null;
  conversationId: string | null;
  sessionId: string | null;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  handleInputChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  handleSubmit: (e: React.FormEvent, opts?: { experimental_attachments?: LightweightAttachment[] }) => void;
  handleFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  clearAttachments: () => void;
  setInput: (v: string | ((prev: string) => string)) => void;
  setFileError: (v: string) => void;
  setFiles: (v: FileList | undefined) => void;
  setPreviewUrls: (v: string[]) => void;
  setIsUploadingAttachment: (v: boolean) => void;
  pastedImageUrl?: string | null;
  setPastedImageUrl: (url: string | null) => void;
  onQueueSubmit: () => void;
}

export function ChatInputBar({
  input,
  isLoading,
  isStreamFinalizing,
  isStreamStalled,
  isUploadingAttachment,
  files,
  previewUrls,
  fileError,
  pendingToolLabel,
  workspaceId,
  conversationId,
  sessionId,
  textareaRef,
  handleInputChange,
  handleSubmit,
  handleFileChange,
  clearAttachments,
  setInput,
  setFileError,
  setIsUploadingAttachment,
  pastedImageUrl,
  setPastedImageUrl,
  setFiles,
  setPreviewUrls,
  onQueueSubmit,
}: ChatInputBarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const isLoaderActive = (isLoading && !isStreamFinalizing && !isStreamStalled) || isUploadingAttachment;

  const handleScreenshotPaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf("image") !== -1) {
        e.preventDefault();
        const file = items[i].getAsFile();
        if (!file) continue;
        if (file.size > MAX_FILE_SIZE) { setFileError(`File exceeds ${MAX_FILE_SIZE_MB}MB`); continue; }
        const fd = new FormData();
        fd.append("file", file);
        if (workspaceId) fd.append("workspaceId", workspaceId);
        if (conversationId) fd.append("conversationId", conversationId);
        if (sessionId) fd.append("sessionId", sessionId);
        try {
          const res = await fetch("/api/upload", { method: "POST", body: fd, credentials: "include" });
          if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
          const data = await res.json() as { url?: string };
          if (data.url) {
            setFileError("");
            // Show as inline image preview chip instead of raw markdown text
            setPastedImageUrl(data.url);
          }
        } catch (err) {
          setFileError(err instanceof Error ? err.message : "Upload failed");
        }
      }
    }
  };

  async function uploadImageAttachment(file: File): Promise<LightweightAttachment> {
    const fd = new FormData();
    fd.append("file", file);
    if (workspaceId) fd.append("workspaceId", workspaceId);
    if (conversationId) fd.append("conversationId", conversationId);
    if (sessionId) fd.append("sessionId", sessionId);
    const res = await fetch("/api/upload", { method: "POST", body: fd, credentials: "include" });
    if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
    const data = await res.json() as { url: string; name?: string; mimeType?: string; size?: number };
    return { url: data.url, name: file.name, mimeType: file.type, size: file.size };
  }

  async function handleFormSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (isLoaderActive || (!input.trim() && (!files || files.length === 0))) return;
    if (files && files.length > 0) {
      setIsUploadingAttachment(true);
      try {
        const attachments = await Promise.all(Array.from(files).map(uploadImageAttachment));
        const pastedAttachment = pastedImageUrl ? [{ url: pastedImageUrl, name: "screenshot.png", mimeType: "image/png" }] : [];
        handleSubmit(e, { experimental_attachments: [...attachments, ...pastedAttachment] });
        setPastedImageUrl(null);
      } catch (err) {
        setFileError(err instanceof Error ? err.message : "Upload failed");
      } finally {
        setIsUploadingAttachment(false);
        clearAttachments();
      }
    } else if (pastedImageUrl) {
      handleSubmit(e, { experimental_attachments: [{ url: pastedImageUrl, name: "screenshot.png", mimeType: "image/png" }] });
      setPastedImageUrl(null);
    } else {
      handleSubmit(e);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      formRef.current?.requestSubmit();
    }
  }

  return (
    <div className="chat-input-area">
      {fileError && <div className="file-error-message">{fileError}</div>}
      {isStreamFinalizing && !isStreamStalled && (
        <div className="stream-finalizing-indicator">Finalizing answer…</div>
      )}
      {isStreamStalled && (
        <div className="stream-finalizing-indicator stream-stalled-indicator">Checking for completed answer…</div>
      )}
      {pendingToolLabel && isLoaderActive && (
        <div className="pending-tool-label">{pendingToolLabel}</div>
      )}
      {previewUrls.length > 0 && (
        {pastedImageUrl && (
        <div className="pasted-image-preview">
          <img src={pastedImageUrl} alt="pasted screenshot" className="pasted-img-thumb" />
          <button type="button" className="clear-pasted-btn" onClick={() => setPastedImageUrl(null)}>✕</button>
        </div>
      )}
      <div className="attachment-previews">
          {previewUrls.map((url, i) => (
            <div key={i} className="attachment-preview-item">
              <img src={url} alt={`attachment ${i + 1}`} className="attachment-preview-img" />
            </div>
          ))}
          <button type="button" className="clear-attachments-btn" onClick={clearAttachments}>✕ clear</button>
        </div>
      )}
      <form ref={formRef} onSubmit={handleFormSubmit} className="chat-form">
        <div className="chat-input-row">
          <label className="file-attach-label" title="Attach file">
            <input
              ref={fileInputRef}
              type="file"
              className="file-input-hidden"
              accept={ACCEPTED_TYPES.join(",")}
              multiple
              onChange={handleFileChange}
            />
            <span className="file-attach-icon">📎</span>
          </label>
          <textarea
            ref={textareaRef as React.RefObject<HTMLTextAreaElement>}
            className="chat-textarea"
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onPaste={handleScreenshotPaste}
            placeholder={isLoaderActive ? "Rune is thinking…" : "Message Rune…"}
            rows={1}
            disabled={isLoaderActive}
          />
          <button
            type="button"
            className="chat-queue-btn"
            onClick={onQueueSubmit}
            disabled={isLoaderActive || !input.trim()}
            title="Queue"
          >
            ⏭
          </button>
          <button
            type="submit"
            className="chat-send-btn"
            disabled={isLoaderActive || (!input.trim() && (!files || files.length === 0))}
          >
            {isLoaderActive ? <span className="send-spinner" /> : "↑"}
          </button>
        </div>
      </form>
    </div>
  );
}
