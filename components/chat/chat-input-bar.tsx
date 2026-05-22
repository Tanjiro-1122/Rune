"use client";

import React, { useRef, useState } from "react";
import { ACCEPTED_ATTACHMENT_TYPES, MAX_ATTACHMENT_FILE_SIZE, MAX_ATTACHMENT_FILE_SIZE_MB } from "./attachment-prep";
import { applyPastedTextToTextarea, getClipboardImageItems, getClipboardPlainText } from "./clipboard-helpers";

export const ACCEPTED_TYPES = ACCEPTED_ATTACHMENT_TYPES;
export const MAX_FILE_SIZE_MB = MAX_ATTACHMENT_FILE_SIZE_MB;
export const MAX_FILE_SIZE = MAX_ATTACHMENT_FILE_SIZE;

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
  setPreviewUrls: (v: string[] | ((prev: string[]) => string[])) => void;
  setIsUploadingAttachment: (v: boolean) => void;
  pastedAttachments: LightweightAttachment[];
  setPastedAttachments: (updater: LightweightAttachment[] | ((prev: LightweightAttachment[]) => LightweightAttachment[])) => void;
  onQueueSubmit: () => void;
  onPlan?: () => void;
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
  pastedAttachments,
  setPastedAttachments,
  setFiles,
  setPreviewUrls,
  onQueueSubmit,
  onPlan,
}: ChatInputBarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const isLoaderActive = (isLoading && !isStreamFinalizing && !isStreamStalled) || isUploadingAttachment;
  const [isPlanLoading, setIsPlanLoading] = useState(false);

  async function handlePlan() {
    if (!input.trim() || isLoaderActive || !onPlan) return;
    setIsPlanLoading(true);
    try {
      await onPlan();
    } finally {
      setIsPlanLoading(false);
    }
  }

  function insertPastedTextAtCursor(textarea: HTMLTextAreaElement, text: string) {
    applyPastedTextToTextarea({ textarea, currentValue: input, pastedText: text, setValue: setInput });
  }

  const handleChatPaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const text = getClipboardPlainText(e.clipboardData);
    const imageItems = getClipboardImageItems(e.clipboardData?.items);

    if (text && imageItems.length === 0) {
      e.preventDefault();
      insertPastedTextAtCursor(e.currentTarget, text);
      setFileError("");
      return;
    }

    if (imageItems.length === 0) return;
    e.preventDefault();

    for (const item of imageItems) {
      const file = item.getAsFile();
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
        const data = await res.json() as { url?: string; name?: string; mimeType?: string; size?: number };
        if (data.url) {
          const uploadedUrl = data.url;
          setFileError("");
          setPastedAttachments((prev) => [
            ...prev,
            { url: uploadedUrl, name: data.name ?? file.name ?? "pasted-screenshot.png", mimeType: data.mimeType ?? file.type ?? "image/png", size: data.size ?? file.size },
          ]);
          setPreviewUrls((prev) => [...prev, uploadedUrl]);
        }
      } catch (err) {
        setFileError(err instanceof Error ? err.message : "Upload failed");
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
    const hasPastedAttachments = pastedAttachments.length > 0;
    if (isLoaderActive || (!input.trim() && (!files || files.length === 0) && !hasPastedAttachments)) return;
    if (files && files.length > 0) {
      setIsUploadingAttachment(true);
      try {
        const attachments = await Promise.all(Array.from(files).map(uploadImageAttachment));
        handleSubmit(e, { experimental_attachments: [...attachments, ...pastedAttachments] });
        setPastedAttachments([]);
      } catch (err) {
        setFileError(err instanceof Error ? err.message : "Upload failed");
      } finally {
        setIsUploadingAttachment(false);
        clearAttachments();
      }
    } else if (hasPastedAttachments) {
      handleSubmit(e, { experimental_attachments: pastedAttachments });
      setPastedAttachments([]);
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
            onPaste={handleChatPaste}
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
          {onPlan && (
            <button
              type="button"
              className={`chat-plan-btn${isPlanLoading ? " chat-plan-btn--loading" : ""}`}
              onClick={handlePlan}
              disabled={isLoaderActive || isPlanLoading || !input.trim()}
              title="Preview execution plan before running"
            >
              {isPlanLoading ? <span className="plan-btn-spinner" /> : "⚡ Plan"}
            </button>
          )}
          <button
            type="submit"
            className="chat-send-btn"
            disabled={isLoaderActive || (!input.trim() && (!files || files.length === 0) && pastedAttachments.length === 0)}
          >
            {isLoaderActive ? <span className="send-spinner" /> : "↑"}
          </button>
        </div>
      </form>
    </div>
  );
}
