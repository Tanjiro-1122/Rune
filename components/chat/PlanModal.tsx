"use client";

import { useState } from "react";

export interface PlanStep {
  key: string;
  label: string;
  detail: string;
}

export interface PlanResult {
  intent: string;
  intentLabel: string;
  reasoningRoute: string;
  routeLabel: string;
  steps: PlanStep[];
  estimatedTime: string;
  riskLevel: "low" | "medium" | "high";
  forcedTool: string | null;
}

interface PlanModalProps {
  plan: PlanResult;
  originalInput: string;
  onRun: (input: string) => void;
  onEdit: () => void;
  onClose: () => void;
}

const RISK_CONFIG = {
  low:    { label: "Low risk",    dot: "#22c55e", bg: "rgba(34,197,94,0.08)",   border: "rgba(34,197,94,0.25)"   },
  medium: { label: "Medium risk", dot: "#f59e0b", bg: "rgba(245,158,11,0.08)", border: "rgba(245,158,11,0.25)" },
  high:   { label: "High risk",   dot: "#ef4444", bg: "rgba(239,68,68,0.08)",  border: "rgba(239,68,68,0.25)"  },
};

const STEP_ICONS: Record<string, string> = {
  capture_request:         "📥",
  retrieve_workspace_context: "🔍",
  execute_plan:            "⚡",
  persist_results:         "💾",
};

export function PlanModal({ plan, originalInput, onRun, onEdit, onClose }: PlanModalProps) {
  const [notes, setNotes] = useState("");
  const [running, setRunning] = useState(false);
  const risk = RISK_CONFIG[plan.riskLevel];

  function handleRun() {
    setRunning(true);
    const finalInput = notes.trim()
      ? `${originalInput}\n\n[Additional context: ${notes.trim()}]`
      : originalInput;
    onRun(finalInput);
  }

  return (
    <div className="plan-modal-backdrop" onClick={onClose}>
      <div className="plan-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="plan-modal-header">
          <div className="plan-modal-title-row">
            <span className="plan-modal-icon">⚡</span>
            <div>
              <h2 className="plan-modal-title">Execution Plan</h2>
              <p className="plan-modal-subtitle">Review before Rune starts</p>
            </div>
          </div>
          <button className="plan-modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {/* Intent + Route + Risk row */}
        <div className="plan-modal-meta">
          <div className="plan-meta-chip plan-meta-chip--intent">
            <span className="plan-meta-label">Intent</span>
            <strong>{plan.intentLabel}</strong>
          </div>
          <div className="plan-meta-chip plan-meta-chip--route">
            <span className="plan-meta-label">Route</span>
            <strong>{plan.routeLabel}</strong>
          </div>
          <div className="plan-meta-chip plan-meta-chip--time">
            <span className="plan-meta-label">Est. time</span>
            <strong>{plan.estimatedTime}</strong>
          </div>
          <div
            className="plan-meta-chip plan-meta-chip--risk"
            style={{ background: risk.bg, border: `1px solid ${risk.border}` }}
          >
            <span className="plan-risk-dot" style={{ background: risk.dot }} />
            <strong style={{ color: risk.dot }}>{risk.label}</strong>
          </div>
        </div>

        {/* Request preview */}
        <div className="plan-request-preview">
          <span className="plan-preview-label">Your request</span>
          <p className="plan-preview-text">{originalInput}</p>
        </div>

        {/* Steps */}
        <div className="plan-steps">
          <div className="plan-steps-label">Execution steps</div>
          <ol className="plan-step-list">
            {plan.steps.map((step, i) => (
              <li key={step.key} className="plan-step-item">
                <div className="plan-step-number">{i + 1}</div>
                <div className="plan-step-icon">{STEP_ICONS[step.key] ?? "▸"}</div>
                <div className="plan-step-body">
                  <strong className="plan-step-label">{step.label}</strong>
                  <p className="plan-step-detail">{step.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>

        {/* Optional notes */}
        <div className="plan-notes-section">
          <label className="plan-notes-label" htmlFor="plan-notes">
            Add constraints or context <span>(optional)</span>
          </label>
          <textarea
            id="plan-notes"
            className="plan-notes-input"
            placeholder="e.g. Don't touch the auth layer. Keep the PR small. Focus on mobile only."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
          />
        </div>

        {/* Actions */}
        <div className="plan-modal-actions">
          <button className="plan-btn plan-btn--edit" onClick={onEdit} disabled={running}>
            ✏️ Edit request
          </button>
          <button className="plan-btn plan-btn--run" onClick={handleRun} disabled={running}>
            {running ? (
              <><span className="plan-run-spinner" /> Starting…</>
            ) : (
              <>⚡ Run plan</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
