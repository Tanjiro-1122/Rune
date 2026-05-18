export type ToolLifecycleDiagnostic = {
  mode: "tool_lifecycle_diagnostic";
  generatedAt: string;
  symptom: string;
  verifiedFindings: string[];
  unverifiedClaimsToAvoid: string[];
  likelyRootCause: string;
  productFixPath: string[];
  shouldRunFullSelfAudit: false;
};

export function getToolLifecycleDiagnostic(symptom = "freeze/stuck/question-mark delayed answer"): ToolLifecycleDiagnostic {
  return {
    mode: "tool_lifecycle_diagnostic",
    generatedAt: new Date().toISOString(),
    symptom,
    verifiedFindings: [
      "Frozen/stuck/question-mark reports are routed to this lightweight diagnostic instead of the full Rune self-audit.",
      "The visible symptom is a pending tool/status card lifecycle issue: the UI can show a tool as running while the answer stream is delayed, not reconciled, or waiting for a follow-up render.",
      "This diagnostic intentionally avoids external Vercel/GitHub/Supabase health checks so it cannot hang on network visibility work.",
      "A lone question mark after recent frozen/stuck context is treated as a diagnostic follow-up, not a new generic chat request.",
    ],
    unverifiedClaimsToAvoid: [
      "system load",
      "high traffic",
      "backend lag",
      "resource allocation",
      "caching opportunities",
      "excessive logging",
      "reviewed performance metrics",
    ],
    likelyRootCause:
      "Tool-call lifecycle and stream/UI reconciliation: Rune previously routed this symptom into the full self-audit, which can perform external health checks and leave a pending card visible if the stream/tool state does not reconcile cleanly.",
    productFixPath: [
      "Use this lightweight diagnostic route for freeze/stuck/question-mark symptoms.",
      "Keep full self-audit only for explicit audit/readiness/system-health requests.",
      "Show stale diagnostic tool cards as answer-follows instead of indefinite running.",
      "Add hard timeout wrappers around optional external health checks used by full self-audit.",
    ],
    shouldRunFullSelfAudit: false,
  };
}
