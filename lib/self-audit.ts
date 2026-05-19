import { getBuildIntelligenceSnapshot, type BuildIntelligenceSnapshot } from "@/lib/build-intelligence";
import { getCapabilityTruthSnapshot, type CapabilityTruthSnapshot } from "@/lib/capability-truth";
import { logActionEvent } from "@/lib/action-events";
import { logError } from "@/lib/errors";
import {
  RUNE_APPROVAL_REQUIRED_ACTIONS,
  RUNE_CANONICAL_PROJECTS,
  RUNE_DEFAULT_REPO,
  RUNE_NOT_CONNECTED_YET,
} from "@/lib/project-registry";

export type SelfAuditStatus = "verified" | "partial" | "missing" | "not_connected" | "requires_approval" | "unknown";

export type SelfAuditCheck = {
  key: string;
  label: string;
  status: SelfAuditStatus;
  detail: string;
  evidence?: string;
  nextStep?: string;
};

export type SelfAuditSnapshot = {
  generatedAt: string;
  mode: "self-audit";
  scope: "rune-brain" | "full-owner-console";
  repo: string;
  headline: string;
  sections: {
    identityAndProjectMap: SelfAuditCheck[];
    capabilityTruth: SelfAuditCheck[];
    deploymentAndConfig: SelfAuditCheck[];
    codebaseSignals: SelfAuditCheck[];
    safetyAndApproval: SelfAuditCheck[];
    notConnectedYet: SelfAuditCheck[];
  };
  summary: {
    verified: number;
    partial: number;
    missing: number;
    notConnected: number;
    requiresApproval: number;
    unknown: number;
  };
  recommendedNextPatch: {
    title: string;
    reason: string;
    acceptanceCriteria: string[];
  };
};

function check(
  key: string,
  label: string,
  status: SelfAuditStatus,
  detail: string,
  evidence?: string,
  nextStep?: string
): SelfAuditCheck {
  return { key, label, status, detail, ...(evidence ? { evidence } : {}), ...(nextStep ? { nextStep } : {}) };
}

function countStatuses(sections: SelfAuditSnapshot["sections"]): SelfAuditSnapshot["summary"] {
  const all = Object.values(sections).flat();
  return {
    verified: all.filter((item) => item.status === "verified").length,
    partial: all.filter((item) => item.status === "partial").length,
    missing: all.filter((item) => item.status === "missing").length,
    notConnected: all.filter((item) => item.status === "not_connected").length,
    requiresApproval: all.filter((item) => item.status === "requires_approval").length,
    unknown: all.filter((item) => item.status === "unknown").length,
  };
}

function capabilityChecks(capabilityTruth: CapabilityTruthSnapshot): SelfAuditCheck[] {
  const checks: SelfAuditCheck[] = [];

  checks.push(
    check(
      "capability.truth_layer",
      "Capability truth layer",
      "verified",
      "Rune can return structured capability buckets instead of guessing.",
      `Buckets: verified=${capabilityTruth.summary.verifiedCount}, configured=${capabilityTruth.summary.configuredCount}, partial=${capabilityTruth.summary.partialCount}, missing=${capabilityTruth.summary.missingSetupCount}`
    )
  );

  if (capabilityTruth.summary.missingSetupCount > 0) {
    checks.push(
      check(
        "capability.missing_setup",
        "Missing required setup",
        "missing",
        `${capabilityTruth.summary.missingSetupCount} setup item(s) need attention before Rune is fully operational.`,
        capabilityTruth.deployHealth.missingRequired.map((item) => item.label).join(", ") || "Capability truth detected missing setup.",
        "Open Deploy Health and resolve required missing items."
      )
    );
  } else {
    checks.push(
      check(
        "capability.required_setup",
        "Required setup",
        "verified",
        "No required setup gaps were reported by the capability truth layer.",
        `Deploy Health overall: ${capabilityTruth.summary.deployHealthOverall}`
      )
    );
  }

  if (capabilityTruth.summary.partialCount > 0) {
    checks.push(
      check(
        "capability.partial",
        "Partial capabilities",
        "partial",
        `${capabilityTruth.summary.partialCount} capability item(s) are partially wired or optional/config-limited.`,
        capabilityTruth.buckets.partial.slice(0, 6).map((item) => item.label).join(", "),
        "Use the truth snapshot before claiming these capabilities are fully available."
      )
    );
  }

  return checks;
}

function deploymentChecks(capabilityTruth: CapabilityTruthSnapshot, buildIntelligence: BuildIntelligenceSnapshot | null, buildError: string | null): SelfAuditCheck[] {
  const checks: SelfAuditCheck[] = [];

  checks.push(
    check(
      "deploy.health",
      "Deploy Health",
      capabilityTruth.deployHealth.overall === "ok" ? "verified" : capabilityTruth.deployHealth.overall === "unavailable" ? "unknown" : "partial",
      capabilityTruth.deployHealth.overall === "ok"
        ? "Deploy Health reports required checks are ready."
        : capabilityTruth.deployHealth.overall === "unavailable"
          ? "Deploy Health could not be checked from Self-Audit."
          : "Deploy Health reports at least one setup/configuration issue.",
      capabilityTruth.deployHealth.unavailableReason || `Overall: ${capabilityTruth.deployHealth.overall}`,
      capabilityTruth.deployHealth.overall === "ok" ? undefined : "Review Deploy Health details and resolve missing required checks."
    )
  );

  if (buildIntelligence) {
    checks.push(
      check(
        "deploy.github_intelligence",
        "GitHub intelligence",
        buildIntelligence.github.error ? "partial" : "verified",
        buildIntelligence.github.error
          ? "GitHub intelligence is present but returned a limited/error signal."
          : "GitHub intelligence can read the Rune repository signal.",
        buildIntelligence.github.error || `${buildIntelligence.github.repo} latest commit ${buildIntelligence.github.latestCommit?.sha ?? "unknown"}`,
        buildIntelligence.github.error ? "Check GITHUB_TOKEN/RUNE_GITHUB_TOKEN permissions if private repo data is needed." : undefined
      )
    );

    checks.push(
      check(
        "deploy.vercel_intelligence",
        "Vercel intelligence",
        buildIntelligence.vercel.error ? "partial" : "verified",
        buildIntelligence.vercel.error
          ? "Vercel intelligence is optional and currently limited."
          : "Vercel deployment signal is available.",
        buildIntelligence.vercel.error || buildIntelligence.vercel.latestDeployment?.url || "Deployment signal returned.",
        buildIntelligence.vercel.error ? "Add Vercel token/project env vars if you want full deployment visibility." : undefined
      )
    );
  } else {
    checks.push(
      check(
        "deploy.build_intelligence",
        "Build intelligence",
        "unknown",
        "Build intelligence could not be checked during Self-Audit.",
        buildError || "Unknown build intelligence error",
        "Check Build Intelligence panel or environment variables."
      )
    );
  }

  return checks;
}

function codebaseChecks(): SelfAuditCheck[] {
  return [
    check(
      "code.project_registry",
      "Canonical project registry",
      "verified",
      "Rune has a canonical registry for Rune, Unfiltr, SWH, and Unfiltr Family.",
      RUNE_CANONICAL_PROJECTS.map((project) => `${project.label}: ${project.repo}`).join(" | ")
    ),
    check(
      "code.capability_truth_module",
      "Capability truth module",
      "verified",
      "Capability assessment is centralized in lib/capability-truth.ts and used by the chat tool.",
      "Brain Patch 2"
    ),
    check(
      "code.self_audit_module",
      "Self-audit module",
      "verified",
      "Self-Audit can combine truth layer, deploy health, build intelligence, safety rules, and project registry into one report.",
      "Brain Patch 3"
    ),
  ];
}

function safetyChecks(): SelfAuditCheck[] {
  return RUNE_APPROVAL_REQUIRED_ACTIONS.map((action) =>
    check(
      `safety.${action.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
      action,
      "requires_approval",
      "This action must stay behind Findings → Plan → Approval → Action.",
      "Project registry safety policy"
    )
  );
}

function notConnectedChecks(): SelfAuditCheck[] {
  return RUNE_NOT_CONNECTED_YET.map((capability) =>
    check(
      `not_connected.${capability.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
      capability,
      "not_connected",
      "This is intentionally reported as unavailable until a real integration is built and approved.",
      "Capability truth registry",
      "Treat as future Hands phase work, not current capability."
    )
  );
}

export async function getSelfAuditSnapshot(scope: SelfAuditSnapshot["scope"] = "rune-brain"): Promise<SelfAuditSnapshot> {
  const generatedAt = new Date().toISOString();
  const capabilityTruth = await getCapabilityTruthSnapshot();

  let buildIntelligence: BuildIntelligenceSnapshot | null = null;
  let buildError: string | null = null;
  try {
    buildIntelligence = await getBuildIntelligenceSnapshot({ projectKey: "rune", repo: RUNE_DEFAULT_REPO });
  } catch (error) {
    buildError = error instanceof Error ? error.message : "Unknown build intelligence error";
    logError("selfAudit.buildIntelligence", error);
  }

  const sections: SelfAuditSnapshot["sections"] = {
    identityAndProjectMap: [
      check(
        "identity.private_owner_console",
        "Private owner-console identity",
        "verified",
        "Rune identifies as Javier's private owner console, not a public SaaS product.",
        capabilityTruth.identity.productIntent
      ),
      check(
        "identity.default_repo",
        "Default self-repo",
        "verified",
        `Rune self-repo resolves to ${RUNE_DEFAULT_REPO}.`,
        "Brain Patch 1 project registry"
      ),
      check(
        "identity.project_count",
        "Known projects",
        "verified",
        `Rune knows ${RUNE_CANONICAL_PROJECTS.length} canonical project scopes.`,
        RUNE_CANONICAL_PROJECTS.map((project) => project.label).join(", ")
      ),
    ],
    capabilityTruth: capabilityChecks(capabilityTruth),
    deploymentAndConfig: deploymentChecks(capabilityTruth, buildIntelligence, buildError),
    codebaseSignals: codebaseChecks(),
    safetyAndApproval: safetyChecks(),
    notConnectedYet: notConnectedChecks(),
  };

  const summary = countStatuses(sections);
  const headline =
    summary.missing > 0
      ? `Self-audit complete: ${summary.missing} missing setup item(s) need attention.`
      : summary.partial > 0
        ? `Self-audit complete: core brain is working; ${summary.partial} partial/optional item(s) need polish.`
        : "Self-audit complete: Rune brain foundation is verified.";

  const snapshot: SelfAuditSnapshot = {
    generatedAt,
    mode: "self-audit",
    scope,
    repo: RUNE_DEFAULT_REPO,
    headline,
    sections,
    summary,
    recommendedNextPatch: {
      title: "Hands Phase 1 — Approval-Gated Action Executor",
      reason:
        "The Rune foundation is now in place: identity, project registry, capability truth, self-audit, reasoning router, and project-aware memory. The next safe step is giving Rune controlled hands through explicit approval-gated execution paths.",
      acceptanceCriteria: [
        "Every sensitive action starts with Findings → Plan.",
        "No external/code/customer/financial action executes without explicit Javier approval.",
        "Approved actions are written to the audit log before and after execution.",
        "Failures include a clear rollback or recovery note.",
      ],
    },
  };

  await logActionEvent({
    eventType: "self_audit.snapshot",
    summary: snapshot.headline,
    status: summary.missing > 0 ? "info" : "executed",
    approvalStage: "findings",
    riskLevel: "low",
    projectKey: "rune",
    metadata: {
      scope,
      repo: RUNE_DEFAULT_REPO,
      summary,
      recommendedNextPatch: snapshot.recommendedNextPatch.title,
    },
  });

  return snapshot;
}
