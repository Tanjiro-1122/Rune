"use client";

import { useState, useMemo } from "react";

// ── Types (mirrors what chat.tsx already has in state) ─────────────────────
export interface BFile {
  id: string;
  path: string;
  displayName: string;
  mimeType: string;
  sourceKind: string;
  bytes: number;
  summary: string | null;
  createdAt: string;
}

export interface BArtifact {
  id: string;
  name: string;
  mimeType: string;
  content: string;
  bytes: number;
  createdAt: string;
}

export interface BDocument {
  id: string;
  name: string;
  contentType: string;
  sourceKind: string;
  summary: string | null;
  createdAt: string;
}

export interface BuilderSidebarProps {
  files: BFile[];
  artifacts: BArtifact[];
  documents: BDocument[];
  isOpen: boolean;
  onClose: () => void;
  onOpenCanvas: (content: { code: string; language: string; title?: string; isHtml: boolean }) => void;
  onAskAbout: (prompt: string) => void;
}

// ── Helpers ────────────────────────────────────────────────────────────────
type SectionKey = "pages" | "components" | "styles" | "scripts" | "data" | "docs" | "other";

const MIME_SECTION: Record<string, SectionKey> = {
  "text/html": "pages",
  "application/jsx": "pages",
  "text/jsx": "pages",
  "text/tsx": "pages",
  "application/tsx": "pages",
  "text/css": "styles",
  "text/javascript": "scripts",
  "application/javascript": "scripts",
  "text/typescript": "scripts",
  "application/typescript": "scripts",
  "application/json": "data",
  "text/csv": "data",
  "text/markdown": "docs",
  "text/plain": "docs",
};

const EXT_SECTION: Record<string, SectionKey> = {
  html: "pages", htm: "pages", jsx: "pages", tsx: "pages",
  css: "styles", scss: "styles",
  js: "scripts", ts: "scripts", mjs: "scripts",
  json: "data", csv: "data", sql: "data",
  md: "docs", txt: "docs", pdf: "docs",
};

const SECTION_META: Record<SectionKey, { icon: string; label: string }> = {
  pages:      { icon: "🖥", label: "Pages & UI" },
  components: { icon: "🧩", label: "Components" },
  styles:     { icon: "🎨", label: "Styles" },
  scripts:    { icon: "⚙️", label: "Logic & Scripts" },
  data:       { icon: "🗄", label: "Data & Config" },
  docs:       { icon: "📄", label: "Docs & Notes" },
  other:      { icon: "📦", label: "Other" },
};

const CANVAS_LANGS = new Set(["html","htm","jsx","tsx","svg","css","js","javascript","ts","typescript"]);

function getSection(file: BFile): SectionKey {
  const ext = file.path.split(".").pop()?.toLowerCase() ?? "";
  if (EXT_SECTION[ext]) return EXT_SECTION[ext];
  if (MIME_SECTION[file.mimeType]) return MIME_SECTION[file.mimeType];
  if (file.path.includes("component") || file.path.includes("Component")) return "components";
  return "other";
}

function langFromPath(path: string): string {
  return path.split(".").pop()?.toLowerCase() ?? "code";
}

function isCanvasable(file: BFile): boolean {
  const ext = file.path.split(".").pop()?.toLowerCase() ?? "";
  return CANVAS_LANGS.has(ext) || CANVAS_LANGS.has(file.mimeType.split("/").pop() ?? "");
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
  } catch { return iso; }
}

// ── Main component ─────────────────────────────────────────────────────────
export function BuilderSidebar({
  files,
  artifacts,
  documents,
  isOpen,
  onClose,
  onOpenCanvas,
  onAskAbout,
}: BuilderSidebarProps) {
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<"structure" | "artifacts" | "docs">("structure");
  const [expandedSections, setExpandedSections] = useState<Set<SectionKey>>(
    new Set(["pages", "components", "scripts"])
  );
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);

  // Group files by section
  const grouped = useMemo<Partial<Record<SectionKey, BFile[]>>>(() => {
    const q = search.toLowerCase();
    const filtered = files.filter(
      (f) => !q || f.path.toLowerCase().includes(q) || f.displayName.toLowerCase().includes(q)
    );
    const out: Partial<Record<SectionKey, BFile[]>> = {};
    for (const f of filtered) {
      const s = getSection(f);
      if (!out[s]) out[s] = [];
      out[s]!.push(f);
    }
    return out;
  }, [files, search]);

  const filteredArtifacts = useMemo(() => {
    const q = search.toLowerCase();
    return artifacts.filter((a) => !q || a.name.toLowerCase().includes(q));
  }, [artifacts, search]);

  const filteredDocs = useMemo(() => {
    const q = search.toLowerCase();
    return documents.filter((d) => !q || d.name.toLowerCase().includes(q));
  }, [documents, search]);

  const sectionOrder: SectionKey[] = ["pages", "components", "styles", "scripts", "data", "docs", "other"];

  function toggleSection(key: SectionKey) {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function handleFileClick(file: BFile) {
    setSelectedFileId(file.id === selectedFileId ? null : file.id);
  }

  function handleOpenInCanvas(file: BFile) {
    const lang = langFromPath(file.path);
    // We only have the artifact content for actual artifacts; for project files, prompt Rune
    onAskAbout(`Show me the contents of ${file.path} and open it in the canvas.`);
  }

  function handleArtifactCanvas(artifact: BArtifact) {
    const lang = artifact.mimeType.split("/").pop()?.replace("x-", "") ?? "code";
    const isHtml = CANVAS_LANGS.has(lang) && ["html","htm","jsx","tsx","js","javascript","css","svg"].includes(lang);
    onOpenCanvas({ code: artifact.content, language: lang, title: artifact.name, isHtml });
  }

  const totalItems = files.length + artifacts.length + documents.length;

  return (
    <>
      {/* Backdrop on mobile */}
      {isOpen && (
        <button
          type="button"
          className="builder-sidebar-backdrop"
          aria-label="Close builder sidebar"
          onClick={onClose}
        />
      )}

      <aside className={`builder-sidebar${isOpen ? " builder-sidebar--open" : ""}`} aria-label="Project structure">
        {/* Header */}
        <div className="builder-sidebar-header">
          <div className="builder-sidebar-title-row">
            <span className="builder-sidebar-icon">🏗</span>
            <div>
              <span className="builder-sidebar-title">Builder</span>
              <span className="builder-sidebar-count">{totalItems} items</span>
            </div>
          </div>
          <button type="button" className="builder-sidebar-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {/* Search */}
        <div className="builder-sidebar-search-wrap">
          <input
            className="builder-sidebar-search"
            placeholder="Search files…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button type="button" className="builder-search-clear" onClick={() => setSearch("")}>✕</button>
          )}
        </div>

        {/* Tab bar */}
        <div className="builder-tab-bar" role="tablist">
          {(["structure", "artifacts", "docs"] as const).map((tab) => (
            <button
              key={tab}
              role="tab"
              type="button"
              className={`builder-tab${activeTab === tab ? " builder-tab--active" : ""}`}
              onClick={() => setActiveTab(tab)}
            >
              {tab === "structure" ? "Structure" : tab === "artifacts" ? `Artifacts${artifacts.length ? ` (${artifacts.length})` : ""}` : `Docs${documents.length ? ` (${documents.length})` : ""}`}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="builder-sidebar-body">

          {/* ── Structure tab ── */}
          {activeTab === "structure" && (
            <div className="builder-tree">
              {files.length === 0 && (
                <div className="builder-empty">
                  <span>🏗</span>
                  <p>No project files yet.</p>
                  <small>Ask Rune to build something — files will appear here as it works.</small>
                </div>
              )}
              {sectionOrder.map((key) => {
                const sectionFiles = grouped[key];
                if (!sectionFiles?.length) return null;
                const meta = SECTION_META[key];
                const isExpanded = expandedSections.has(key);
                return (
                  <div key={key} className="builder-section">
                    <button
                      type="button"
                      className="builder-section-header"
                      onClick={() => toggleSection(key)}
                      aria-expanded={isExpanded}
                    >
                      <span className="builder-section-chevron">{isExpanded ? "▾" : "▸"}</span>
                      <span className="builder-section-icon">{meta.icon}</span>
                      <span className="builder-section-label">{meta.label}</span>
                      <span className="builder-section-count">{sectionFiles.length}</span>
                    </button>

                    {isExpanded && (
                      <div className="builder-file-list">
                        {sectionFiles.map((file) => {
                          const isSelected = file.id === selectedFileId;
                          const canCanvas = isCanvasable(file);
                          return (
                            <div key={file.id} className={`builder-file-item${isSelected ? " builder-file-item--selected" : ""}`}>
                              <button
                                type="button"
                                className="builder-file-row"
                                onClick={() => handleFileClick(file)}
                              >
                                <span className="builder-file-ext">{langFromPath(file.path).toUpperCase().slice(0, 3)}</span>
                                <div className="builder-file-info">
                                  <span className="builder-file-name">{file.displayName || file.path.split("/").pop()}</span>
                                  <span className="builder-file-path">{file.path}</span>
                                </div>
                                <span className="builder-file-size">{fmtBytes(file.bytes)}</span>
                              </button>

                              {isSelected && (
                                <div className="builder-file-detail">
                                  {file.summary && <p className="builder-file-summary">{file.summary}</p>}
                                  <div className="builder-file-meta-row">
                                    <span>{fmtDate(file.createdAt)}</span>
                                    <span>{file.sourceKind}</span>
                                  </div>
                                  <div className="builder-file-actions">
                                    <button
                                      type="button"
                                      className="builder-action-btn"
                                      onClick={() => onAskAbout(`Explain what ${file.path} does.`)}
                                    >
                                      Explain
                                    </button>
                                    <button
                                      type="button"
                                      className="builder-action-btn"
                                      onClick={() => onAskAbout(`Review ${file.path} and suggest improvements.`)}
                                    >
                                      Review
                                    </button>
                                    {canCanvas && (
                                      <button
                                        type="button"
                                        className="builder-action-btn builder-action-btn--canvas"
                                        onClick={() => handleOpenInCanvas(file)}
                                      >
                                        🖼 Canvas
                                      </button>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* ── Artifacts tab ── */}
          {activeTab === "artifacts" && (
            <div className="builder-artifact-list">
              {filteredArtifacts.length === 0 && (
                <div className="builder-empty">
                  <span>⚡</span>
                  <p>No artifacts yet.</p>
                  <small>Generated code, charts, and files from Rune appear here.</small>
                </div>
              )}
              {filteredArtifacts.map((artifact) => {
                const lang = artifact.mimeType.split("/").pop()?.replace("x-", "") ?? "code";
                const isHtml = CANVAS_LANGS.has(lang) && ["html","htm","jsx","tsx","js","javascript","css","svg"].includes(lang);
                return (
                  <div key={artifact.id} className="builder-artifact-item">
                    <div className="builder-artifact-header">
                      <span className="builder-artifact-icon">
                        {isHtml ? "🖼" : lang === "json" || lang === "csv" ? "🗄" : "📄"}
                      </span>
                      <div className="builder-artifact-info">
                        <span className="builder-artifact-name">{artifact.name}</span>
                        <span className="builder-artifact-meta">{lang.toUpperCase()} · {fmtBytes(artifact.bytes)} · {fmtDate(artifact.createdAt)}</span>
                      </div>
                    </div>
                    <div className="builder-artifact-actions">
                      <button
                        type="button"
                        className="builder-action-btn"
                        onClick={() => onAskAbout(`Explain the artifact "${artifact.name}" and what it does.`)}
                      >
                        Explain
                      </button>
                      {isHtml && (
                        <button
                          type="button"
                          className="builder-action-btn builder-action-btn--canvas"
                          onClick={() => handleArtifactCanvas(artifact)}
                        >
                          🖼 Canvas
                        </button>
                      )}
                      <button
                        type="button"
                        className="builder-action-btn"
                        onClick={() => {
                          navigator.clipboard.writeText(artifact.content);
                        }}
                      >
                        Copy
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* ── Docs tab ── */}
          {activeTab === "docs" && (
            <div className="builder-doc-list">
              {filteredDocs.length === 0 && (
                <div className="builder-empty">
                  <span>📄</span>
                  <p>No documents yet.</p>
                  <small>Uploaded files and generated docs appear here.</small>
                </div>
              )}
              {filteredDocs.map((doc) => (
                <div key={doc.id} className="builder-doc-item">
                  <div className="builder-doc-icon">
                    {doc.contentType.includes("markdown") ? "📝" :
                     doc.contentType.includes("pdf") ? "📕" :
                     doc.contentType.includes("csv") ? "📊" : "📄"}
                  </div>
                  <div className="builder-doc-info">
                    <span className="builder-doc-name">{doc.name}</span>
                    {doc.summary && <p className="builder-doc-summary">{doc.summary}</p>}
                    <span className="builder-doc-meta">{doc.sourceKind} · {fmtDate(doc.createdAt)}</span>
                  </div>
                  <button
                    type="button"
                    className="builder-action-btn"
                    onClick={() => onAskAbout(`Summarize the document "${doc.name}" and tell me the key points.`)}
                  >
                    Ask
                  </button>
                </div>
              ))}
            </div>
          )}

        </div>

        {/* Footer — quick ask bar */}
        <div className="builder-sidebar-footer">
          <button
            type="button"
            className="builder-footer-btn"
            onClick={() => onAskAbout("What have you built so far? Give me a full overview of all files, artifacts, and docs in this workspace.")}
          >
            📋 Project overview
          </button>
          <button
            type="button"
            className="builder-footer-btn"
            onClick={() => onAskAbout("Audit the current project structure. What's missing? What should we build next?")}
          >
            🔍 Audit structure
          </button>
        </div>
      </aside>
    </>
  );
}
