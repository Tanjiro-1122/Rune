"use client";

import { useState, useMemo, useEffect, useCallback } from "react";

// ── Types ──────────────────────────────────────────────────────────────────
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

// ── Schema types (from /api/schema-intel) ─────────────────────────────────
interface SchemaTableInfo {
  name: string;
  label: string;
  group: string;
  count: number | null;
  status: "ok" | "missing" | "error";
  error?: string;
}

interface SchemaIntelSnapshot {
  generatedAt: string;
  connected: boolean;
  tables: SchemaTableInfo[];
}

// ── Deploy pipeline types (from /api/deploy-health + /api/app-health) ─────
interface DeployCheck { key: string; label: string; status: string; detail: string; }
interface DeploySnapshot { overall: string; checks: DeployCheck[]; generatedAt?: string; }

// ── Helpers ────────────────────────────────────────────────────────────────
type SectionKey = "pages" | "components" | "styles" | "scripts" | "data" | "docs" | "other";

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

const GROUP_META: Record<string, { icon: string; label: string }> = {
  agent:     { icon: "🧠", label: "Agent memory" },
  workspace: { icon: "📁", label: "Workspace" },
  system:    { icon: "🔒", label: "System & audit" },
  apps:      { icon: "📱", label: "App data" },
};

const STATUS_COLORS: Record<string, string> = {
  ok: "#22c55e", warning: "#f59e0b", missing: "#9ca3af", error: "#ef4444",
};

function getSection(file: BFile): SectionKey {
  const ext = file.path.split(".").pop()?.toLowerCase() ?? "";
  if (EXT_SECTION[ext]) return EXT_SECTION[ext];
  if (file.path.includes("component") || file.path.includes("Component")) return "components";
  return "other";
}

function langFromPath(path: string): string {
  return path.split(".").pop()?.toLowerCase() ?? "code";
}

function isCanvasable(file: BFile): boolean {
  const ext = file.path.split(".").pop()?.toLowerCase() ?? "";
  return CANVAS_LANGS.has(ext);
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

function fmtDate(iso: string): string {
  try { return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" }); }
  catch { return iso; }
}

function fmtCount(n: number | null): string {
  if (n === null) return "–";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

// ── Inline code editor state per-file ─────────────────────────────────────
function FileEditorDrawer({
  file, onAskAbout, onOpenCanvas,
}: { file: BFile; onAskAbout: (p: string) => void; onOpenCanvas: (c: { code: string; language: string; title?: string; isHtml: boolean }) => void }) {
  const [editMode, setEditMode] = useState(false);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [fetchedContent, setFetchedContent] = useState<string | null>(null);
  const lang = langFromPath(file.path);
  const canCanvas = isCanvasable(file);
  const isHtml = ["html","htm","jsx","tsx","js","javascript","css","svg"].includes(lang);

  async function loadContent() {
    if (fetchedContent !== null) { setEditMode(true); return; }
    setLoading(true);
    try {
      // Ask Rune via prompt — content comes back in the chat stream
      // For inline edit we use a direct file-signed-url fetch if available
      const res = await fetch(`/api/files/signed-url?path=${encodeURIComponent(file.path)}`, { credentials: "include" });
      if (res.ok) {
        const { url } = await res.json() as { url?: string };
        if (url) {
          const fileRes = await fetch(url);
          const text = await fileRes.text();
          setFetchedContent(text);
          setDraft(text);
          setEditMode(true);
          return;
        }
      }
    } catch { /* fallback to ask */ }
    finally { setLoading(false); }
    // Fallback: ask Rune
    onAskAbout(`Show me the full contents of ${file.path} so I can review and edit it.`);
  }

  function openInCanvas() {
    if (fetchedContent) {
      onOpenCanvas({ code: fetchedContent, language: lang, title: file.displayName, isHtml });
    } else {
      onAskAbout(`Show me the contents of ${file.path} and open it in the canvas.`);
    }
  }

  return (
    <div className="builder-file-detail">
      {file.summary && <p className="builder-file-summary">{file.summary}</p>}
      <div className="builder-file-meta-row">
        <span>{fmtDate(file.createdAt)}</span>
        <span>{file.sourceKind}</span>
        <span>{fmtBytes(file.bytes)}</span>
      </div>

      {editMode && fetchedContent !== null ? (
        <div className="builder-inline-editor">
          <div className="builder-inline-editor-header">
            <span className="builder-inline-editor-lang">{lang}</span>
            <div style={{ display: "flex", gap: 5 }}>
              {canCanvas && (
                <button type="button" className="builder-action-btn builder-action-btn--canvas"
                  onClick={openInCanvas}>🖼 Canvas</button>
              )}
              <button type="button" className="builder-action-btn"
                onClick={() => { navigator.clipboard.writeText(draft); }}>Copy</button>
              <button type="button" className="builder-action-btn"
                onClick={() => onAskAbout(`I edited ${file.path}. Here is the new version:\n\n\`\`\`${lang}\n${draft}\n\`\`\`\n\nPlease save this to the workspace and confirm.`)}>
                💾 Save via Rune
              </button>
              <button type="button" className="builder-action-btn"
                onClick={() => setEditMode(false)}>Close</button>
            </div>
          </div>
          <textarea
            className="builder-inline-code-editor"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
          />
        </div>
      ) : (
        <div className="builder-file-actions">
          <button type="button" className="builder-action-btn"
            onClick={() => onAskAbout(`Explain what ${file.path} does.`)}>Explain</button>
          <button type="button" className="builder-action-btn"
            onClick={() => onAskAbout(`Review ${file.path} and suggest improvements.`)}>Review</button>
          <button type="button" className={`builder-action-btn${loading ? " builder-action-btn--loading" : ""}`}
            onClick={loadContent} disabled={loading}>
            {loading ? "Loading…" : "✏️ Edit"}
          </button>
          {canCanvas && (
            <button type="button" className="builder-action-btn builder-action-btn--canvas"
              onClick={openInCanvas}>🖼 Canvas</button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Deploy pipeline card ───────────────────────────────────────────────────
function DeployPipelineCard({ onRefresh }: { onRefresh: () => void }) {
  const [snap, setSnap] = useState<DeploySnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastFetched, setLastFetched] = useState<string | null>(null);

  const fetch_ = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/deploy-health", { credentials: "include" });
      if (res.ok) {
        const data = await res.json() as DeploySnapshot;
        setSnap(data);
        setLastFetched(new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
      }
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void fetch_(); }, [fetch_]);

  const statusColor = snap ? (STATUS_COLORS[snap.overall] ?? "#9ca3af") : "#9ca3af";
  const statusLabel = snap?.overall?.toUpperCase() ?? "–";

  // Pipeline stages derived from checks
  const stages = [
    { key: "env", label: "Env", icon: "⚙️" },
    { key: "table", label: "DB", icon: "🗄" },
    { key: "build", label: "Build", icon: "🔨" },
    { key: "deploy", label: "Deploy", icon: "🚀" },
  ];

  function stageStatus(key: string): string {
    if (!snap) return "unknown";
    const checks = snap.checks.filter((c) => c.key.startsWith(key));
    if (!checks.length) return "ok";
    if (checks.some((c) => c.status === "error")) return "error";
    if (checks.some((c) => c.status === "missing")) return "missing";
    if (checks.some((c) => c.status === "warning")) return "warning";
    return "ok";
  }

  return (
    <div className="deploy-pipeline-card">
      <div className="deploy-pipeline-header">
        <div className="deploy-pipeline-title">
          <span>🚀</span>
          <strong>Deploy Pipeline</strong>
          <span className="deploy-pipeline-badge" style={{ background: `${statusColor}1a`, color: statusColor, border: `1px solid ${statusColor}40` }}>
            {statusLabel}
          </span>
        </div>
        <button type="button" className="deploy-pipeline-refresh" onClick={fetch_} disabled={loading} title="Refresh">
          {loading ? <span className="pipeline-spin" /> : "↺"}
        </button>
      </div>

      {/* Pipeline stages strip */}
      <div className="deploy-pipeline-stages">
        {stages.map((stage, i) => {
          const st = stageStatus(stage.key);
          const col = STATUS_COLORS[st] ?? "#9ca3af";
          return (
            <div key={stage.key} className="deploy-pipeline-stage">
              <div className="deploy-stage-dot" style={{ background: col, boxShadow: st === "ok" ? `0 0 6px ${col}60` : "none" }} />
              <span className="deploy-stage-icon">{stage.icon}</span>
              <span className="deploy-stage-label">{stage.label}</span>
              {i < stages.length - 1 && (
                <span className="deploy-stage-arrow" style={{ color: col }}>→</span>
              )}
            </div>
          );
        })}
      </div>

      {/* Checks list */}
      {snap?.checks && (
        <div className="deploy-checks-list">
          {snap.checks.filter((c) => c.status !== "ok").slice(0, 4).map((c) => (
            <div key={c.key} className="deploy-check-row">
              <span className="deploy-check-dot" style={{ background: STATUS_COLORS[c.status] ?? "#9ca3af" }} />
              <span className="deploy-check-label">{c.label}</span>
              <span className="deploy-check-detail">{c.detail}</span>
            </div>
          ))}
          {snap.checks.every((c) => c.status === "ok") && (
            <p className="deploy-all-ok">✓ All checks passing</p>
          )}
        </div>
      )}

      {lastFetched && <p className="deploy-pipeline-time">Last checked {lastFetched}</p>}
    </div>
  );
}

// ── Schema viewer ──────────────────────────────────────────────────────────
function SchemaViewer({ onAskAbout }: { onAskAbout: (p: string) => void }) {
  const [snap, setSnap] = useState<SchemaIntelSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(["workspace", "apps"]));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/schema-intel", { credentials: "include" });
      if (res.ok) setSnap(await res.json() as SchemaIntelSnapshot);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const grouped = useMemo(() => {
    if (!snap) return {};
    const out: Record<string, SchemaTableInfo[]> = {};
    for (const t of snap.tables) {
      if (!out[t.group]) out[t.group] = [];
      out[t.group].push(t);
    }
    return out;
  }, [snap]);

  if (!snap && loading) {
    return <div className="schema-loading"><span className="pipeline-spin" /> Loading schema…</div>;
  }

  if (!snap?.connected) {
    return (
      <div className="builder-empty">
        <span>🗄</span>
        <p>Supabase not connected</p>
        <small>Configure SUPABASE_URL + SUPABASE_ANON_KEY to see your live schema.</small>
      </div>
    );
  }

  const totalRows = snap.tables.reduce((acc, t) => acc + (t.count ?? 0), 0);

  return (
    <div className="schema-viewer">
      <div className="schema-summary-row">
        <span className="schema-summary-chip">{snap.tables.filter(t => t.status === "ok").length} tables live</span>
        <span className="schema-summary-chip">{fmtCount(totalRows)} total rows</span>
        <button type="button" className="schema-refresh-btn" onClick={load} disabled={loading} title="Refresh">
          {loading ? <span className="pipeline-spin" /> : "↺"}
        </button>
      </div>

      {(["agent", "workspace", "apps", "system"] as const).map((group) => {
        const tables = grouped[group];
        if (!tables?.length) return null;
        const meta = GROUP_META[group] ?? { icon: "📦", label: group };
        const isExpanded = expandedGroups.has(group);
        const liveCount = tables.filter(t => t.status === "ok").length;
        return (
          <div key={group} className="schema-group">
            <button type="button" className="schema-group-header"
              onClick={() => setExpandedGroups((prev) => { const n = new Set(prev); isExpanded ? n.delete(group) : n.add(group); return n; })}>
              <span className="builder-section-chevron">{isExpanded ? "▾" : "▸"}</span>
              <span>{meta.icon}</span>
              <span className="schema-group-label">{meta.label}</span>
              <span className="schema-group-badge">{liveCount}/{tables.length}</span>
            </button>

            {isExpanded && (
              <div className="schema-table-list">
                {tables.map((t) => {
                  const col = STATUS_COLORS[t.status] ?? "#9ca3af";
                  return (
                    <button key={t.name} type="button" className="schema-table-row"
                      onClick={() => onAskAbout(`Query the ${t.name} table and tell me what's in it. Show me the most recent 5 records.`)}>
                      <span className="schema-table-dot" style={{ background: col }} />
                      <span className="schema-table-label">{t.label}</span>
                      <span className="schema-table-count" style={{ color: t.status === "ok" ? "#6b7280" : col }}>
                        {t.status === "missing" ? "missing" : t.status === "error" ? "error" : fmtCount(t.count)}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}


// ── Main BuilderSidebar ────────────────────────────────────────────────────
export function BuilderSidebar({
  files, artifacts, documents, isOpen, onClose, onOpenCanvas, onAskAbout,
}: BuilderSidebarProps) {
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<"structure" | "artifacts" | "docs" | "schema" | "deploy">("structure");
  const [expandedSections, setExpandedSections] = useState<Set<SectionKey>>(new Set(["pages", "components", "scripts"]));
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);

  const grouped = useMemo<Partial<Record<SectionKey, BFile[]>>>(() => {
    const q = search.toLowerCase();
    const filtered = files.filter((f) => !q || f.path.toLowerCase().includes(q) || f.displayName.toLowerCase().includes(q));
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
  const totalItems = files.length + artifacts.length + documents.length;

  const tabs = [
    { key: "structure", label: "Structure" },
    { key: "artifacts", label: `Artifacts${artifacts.length ? ` (${artifacts.length})` : ""}` },
    { key: "docs",      label: `Docs${documents.length ? ` (${documents.length})` : ""}` },
    { key: "schema",    label: "Schema" },
    { key: "deploy",    label: "Deploy" },
  ] as const;

  return (
    <>
      {isOpen && (
        <button type="button" className="builder-sidebar-backdrop" aria-label="Close builder sidebar" onClick={onClose} />
      )}

      <aside className={`builder-sidebar${isOpen ? " builder-sidebar--open" : ""}`} aria-label="Project structure">
        {/* Header */}
        <div className="builder-sidebar-header">
          <div className="builder-sidebar-title-row">
            <span className="builder-sidebar-icon">▦</span>
            <div>
              <span className="builder-sidebar-title">Structure</span>
              <span className="builder-sidebar-count">{totalItems} items</span>
            </div>
          </div>
          <button type="button" className="builder-sidebar-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {/* Search (only visible on file tabs) */}
        {["structure","artifacts","docs"].includes(activeTab) && (
          <div className="builder-sidebar-search-wrap">
            <input className="builder-sidebar-search" placeholder="Search files…"
              value={search} onChange={(e) => setSearch(e.target.value)} />
            {search && <button type="button" className="builder-search-clear" onClick={() => setSearch("")}>✕</button>}
          </div>
        )}

        {/* Tab bar */}
        <div className="builder-tab-bar" role="tablist">
          {tabs.map((tab) => (
            <button key={tab.key} role="tab" type="button"
              className={`builder-tab${activeTab === tab.key ? " builder-tab--active" : ""}`}
              onClick={() => setActiveTab(tab.key)}>
              {tab.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="builder-sidebar-body">

          {/* Structure */}
          {activeTab === "structure" && (
            <div className="builder-tree">
              {files.length === 0 && (
                <div className="builder-empty">
                  <span>🏗</span>
                  <p>No project files yet.</p>
                  <small>Ask Rune to build something — files appear here as it works.</small>
                </div>
              )}
              {sectionOrder.map((key) => {
                const sectionFiles = grouped[key];
                if (!sectionFiles?.length) return null;
                const meta = SECTION_META[key];
                const isExpanded = expandedSections.has(key);
                return (
                  <div key={key} className="builder-section">
                    <button type="button" className="builder-section-header"
                      onClick={() => setExpandedSections((prev) => { const n = new Set(prev); isExpanded ? n.delete(key) : n.add(key); return n; })}
                      aria-expanded={isExpanded}>
                      <span className="builder-section-chevron">{isExpanded ? "▾" : "▸"}</span>
                      <span className="builder-section-icon">{meta.icon}</span>
                      <span className="builder-section-label">{meta.label}</span>
                      <span className="builder-section-count">{sectionFiles.length}</span>
                    </button>
                    {isExpanded && (
                      <div className="builder-file-list">
                        {sectionFiles.map((file) => {
                          const isSelected = file.id === selectedFileId;
                          return (
                            <div key={file.id} className={`builder-file-item${isSelected ? " builder-file-item--selected" : ""}`}>
                              <button type="button" className="builder-file-row"
                                onClick={() => setSelectedFileId(file.id === selectedFileId ? null : file.id)}>
                                <span className="builder-file-ext">{langFromPath(file.path).toUpperCase().slice(0, 3)}</span>
                                <div className="builder-file-info">
                                  <span className="builder-file-name">{file.displayName || file.path.split("/").pop()}</span>
                                  <span className="builder-file-path">{file.path}</span>
                                </div>
                                <span className="builder-file-size">{fmtBytes(file.bytes)}</span>
                              </button>
                              {isSelected && (
                                <FileEditorDrawer file={file} onAskAbout={onAskAbout} onOpenCanvas={onOpenCanvas} />
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

          {/* Artifacts */}
          {activeTab === "artifacts" && (
            <div className="builder-artifact-list">
              {filteredArtifacts.length === 0 && (
                <div className="builder-empty">
                  <span>⚡</span><p>No artifacts yet.</p>
                  <small>Generated code, charts, and files from Rune appear here.</small>
                </div>
              )}
              {filteredArtifacts.map((artifact) => {
                const lang = artifact.mimeType.split("/").pop()?.replace("x-", "") ?? "code";
                const isHtml = CANVAS_LANGS.has(lang) && ["html","htm","jsx","tsx","js","javascript","css","svg"].includes(lang);
                return (
                  <div key={artifact.id} className="builder-artifact-item">
                    <div className="builder-artifact-header">
                      <span className="builder-artifact-icon">{isHtml ? "🖼" : lang === "json" || lang === "csv" ? "🗄" : "📄"}</span>
                      <div className="builder-artifact-info">
                        <span className="builder-artifact-name">{artifact.name}</span>
                        <span className="builder-artifact-meta">{lang.toUpperCase()} · {fmtBytes(artifact.bytes)} · {fmtDate(artifact.createdAt)}</span>
                      </div>
                    </div>
                    <div className="builder-artifact-actions">
                      <button type="button" className="builder-action-btn"
                        onClick={() => onAskAbout(`Explain the artifact "${artifact.name}" and what it does.`)}>Explain</button>
                      {isHtml && (
                        <button type="button" className="builder-action-btn builder-action-btn--canvas"
                          onClick={() => onOpenCanvas({ code: artifact.content, language: lang, title: artifact.name, isHtml })}>🖼 Canvas</button>
                      )}
                      <button type="button" className="builder-action-btn"
                        onClick={() => navigator.clipboard.writeText(artifact.content)}>Copy</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Docs */}
          {activeTab === "docs" && (
            <div className="builder-doc-list">
              {filteredDocs.length === 0 && (
                <div className="builder-empty">
                  <span>📄</span><p>No documents yet.</p>
                  <small>Uploaded files and generated docs appear here.</small>
                </div>
              )}
              {filteredDocs.map((doc) => (
                <div key={doc.id} className="builder-doc-item">
                  <div className="builder-doc-icon">
                    {doc.contentType.includes("markdown") ? "📝" : doc.contentType.includes("pdf") ? "📕" : doc.contentType.includes("csv") ? "📊" : "📄"}
                  </div>
                  <div className="builder-doc-info">
                    <span className="builder-doc-name">{doc.name}</span>
                    {doc.summary && <p className="builder-doc-summary">{doc.summary}</p>}
                    <span className="builder-doc-meta">{doc.sourceKind} · {fmtDate(doc.createdAt)}</span>
                  </div>
                  <button type="button" className="builder-action-btn"
                    onClick={() => onAskAbout(`Summarize the document "${doc.name}" and tell me the key points.`)}>Ask</button>
                </div>
              ))}
            </div>
          )}

          {/* Schema */}
          {activeTab === "schema" && <SchemaViewer onAskAbout={onAskAbout} />}

          {/* Deploy */}
          {activeTab === "deploy" && <DeployPipelineCard onRefresh={() => {}} />}

        </div>

        {/* Footer */}
        <div className="builder-sidebar-footer">
          <button type="button" className="builder-footer-btn"
            onClick={() => onAskAbout("What have you built so far? Give me a full overview of all files, artifacts, and docs in this workspace.")}>
            📋 Project overview
          </button>
          <button type="button" className="builder-footer-btn"
            onClick={() => onAskAbout("Audit the current project structure. What's missing? What should we build next?")}>
            🔍 Audit structure
          </button>
        </div>
      </aside>
    </>
  );
}
