"use client";

import { useState, useCallback } from "react";

export type CanvasMode = "preview" | "code" | "split";

export interface CanvasContent {
  code: string;
  language: string;
  title?: string;
  isHtml: boolean;
}

interface CanvasPaneProps {
  content: CanvasContent;
  onClose: () => void;
  onEdit?: (newCode: string) => void;
}

function isHtmlLike(lang: string, code: string): boolean {
  const htmlLangs = ["html", "htm", "jsx", "tsx", "svg", "xml"];
  if (htmlLangs.includes(lang.toLowerCase())) return true;
  // Heuristic: has doctype or html root tags
  return /<(!DOCTYPE|html|body|head|div|svg)/i.test(code.slice(0, 400));
}

function buildSandboxHtml(code: string, lang: string): string {
  const lower = lang.toLowerCase();
  // JSX/TSX — wrap in a basic React CDN sandbox
  if (lower === "jsx" || lower === "tsx") {
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <style>body{margin:0;font-family:sans-serif;background:#fff}</style>
  <script crossorigin src="https://unpkg.com/react@18/umd/react.development.js"></script>
  <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
</head>
<body>
  <div id="root"></div>
  <script type="text/babel">
    ${code}
    // Try to find a default export or App component
    if (typeof App !== "undefined") {
      const root = ReactDOM.createRoot(document.getElementById("root"));
      root.render(React.createElement(App));
    }
  </script>
</body>
</html>`;
  }
  // Plain HTML — return as-is
  if (lower === "html" || lower === "htm") return code;
  // SVG — wrap in HTML
  if (lower === "svg") {
    return `<!DOCTYPE html><html><body style="margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#f8f9fa">${code}</body></html>`;
  }
  // CSS — create a demo page
  if (lower === "css") {
    return `<!DOCTYPE html><html><head><style>${code}</style></head><body><div class="demo"><h1>CSS Preview</h1><p>This is a preview of your styles.</p><button>Button</button></div></body></html>`;
  }
  // JavaScript — run it with output capture
  return `<!DOCTYPE html>
<html>
<head><style>
  body{margin:0;font-family:monospace;background:#111;color:#e2e8f0;padding:16px}
  .out-line{padding:2px 0;border-bottom:1px solid rgba(255,255,255,0.05)}
  .err{color:#f87171}
</style></head>
<body>
  <div id="output"></div>
  <script>
    const out = document.getElementById("output");
    const origLog = console.log;
    console.log = (...args) => {
      const div = document.createElement("div");
      div.className = "out-line";
      div.textContent = args.map(a => typeof a === "object" ? JSON.stringify(a, null, 2) : String(a)).join(" ");
      out.appendChild(div);
      origLog(...args);
    };
    try {
      ${code}
    } catch(e) {
      const div = document.createElement("div");
      div.className = "out-line err";
      div.textContent = "Error: " + e.message;
      out.appendChild(div);
    }
  </script>
</body>
</html>`;
}

export function CanvasPane({ content, onClose, onEdit }: CanvasPaneProps) {
  const [mode, setMode] = useState<CanvasMode>(content.isHtml ? "split" : "code");
  const [editableCode, setEditableCode] = useState(content.code);
  const [copyLabel, setCopyLabel] = useState("Copy");
  const [iframeKey, setIframeKey] = useState(0);

  const sandboxHtml = buildSandboxHtml(editableCode, content.language);
  const iframeSrc = content.isHtml
    ? `data:text/html;charset=utf-8,${encodeURIComponent(sandboxHtml)}`
    : null;

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(editableCode).then(() => {
      setCopyLabel("Copied!");
      setTimeout(() => setCopyLabel("Copy"), 2000);
    });
  }, [editableCode]);

  const handleRefresh = () => setIframeKey((k) => k + 1);

  const showPreview = content.isHtml && (mode === "preview" || mode === "split");
  const showCode = mode === "code" || mode === "split";

  return (
    <div className="canvas-backdrop" onClick={onClose}>
      <div className="canvas-pane" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="canvas-header">
          <div className="canvas-title-row">
            <span className="canvas-icon">🖼</span>
            <div>
              <span className="canvas-title">{content.title || `${content.language.toUpperCase()} Canvas`}</span>
              <span className="canvas-lang-badge">{content.language}</span>
            </div>
          </div>

          <div className="canvas-controls">
            {/* Mode tabs */}
            {content.isHtml && (
              <div className="canvas-mode-tabs" role="tablist">
                {(["preview", "split", "code"] as CanvasMode[]).map((m) => (
                  <button
                    key={m}
                    role="tab"
                    type="button"
                    className={`canvas-mode-tab${mode === m ? " canvas-mode-tab--active" : ""}`}
                    onClick={() => setMode(m)}
                  >
                    {m === "preview" ? "Preview" : m === "split" ? "⊞ Split" : "Code"}
                  </button>
                ))}
              </div>
            )}

            {showPreview && (
              <button type="button" className="canvas-ctrl-btn" onClick={handleRefresh} title="Refresh preview">↺</button>
            )}
            <button type="button" className="canvas-ctrl-btn" onClick={handleCopy} title="Copy code">{copyLabel}</button>
            {onEdit && (
              <button type="button" className="canvas-ctrl-btn canvas-ctrl-btn--save"
                onClick={() => onEdit(editableCode)} title="Save edits">Save</button>
            )}
            <button type="button" className="canvas-close-btn" onClick={onClose} aria-label="Close canvas">✕</button>
          </div>
        </div>

        {/* Body */}
        <div className={`canvas-body canvas-body--${mode}`}>
          {/* Code panel */}
          {showCode && (
            <div className="canvas-code-panel">
              <textarea
                className="canvas-code-editor"
                value={editableCode}
                onChange={(e) => setEditableCode(e.target.value)}
                spellCheck={false}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
              />
            </div>
          )}

          {/* Preview panel */}
          {showPreview && iframeSrc && (
            <div className="canvas-preview-panel">
              <div className="canvas-preview-bar">
                <span className="canvas-preview-dot canvas-preview-dot--red" />
                <span className="canvas-preview-dot canvas-preview-dot--yellow" />
                <span className="canvas-preview-dot canvas-preview-dot--green" />
                <span className="canvas-preview-url">sandbox://preview</span>
              </div>
              <iframe
                key={iframeKey}
                src={iframeSrc}
                className="canvas-iframe"
                sandbox="allow-scripts"
                title="Live preview"
              />
            </div>
          )}

          {/* Non-HTML code-only view */}
          {!content.isHtml && (
            <div className="canvas-code-panel canvas-code-panel--full">
              <textarea
                className="canvas-code-editor"
                value={editableCode}
                onChange={(e) => setEditableCode(e.target.value)}
                spellCheck={false}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
