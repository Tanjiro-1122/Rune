import { getDeployHealthSnapshot, type DeployHealthSnapshot } from "@/lib/deploy-health";
import {
  JARVIS_APPROVAL_REQUIRED_ACTIONS,
  RUNE_CANONICAL_PROJECTS,
  JARVIS_NOT_CONNECTED_YET,
  JARVIS_REAL_CAPABILITIES,
} from "@/lib/project-registry";
import { logError } from "@/lib/errors";

export type CapabilityState = "verified" | "configured" | "partial" | "missing_setup" | "not_connected" | "requires_approval";

export type CapabilityTruthItem = {
  key: string;
  label: string;
  state: CapabilityState;
  detail: string;
  evidence?: string;
};

export type CapabilityTruthSnapshot = {
  generatedAt: string;
  identity: {
    mode: "private-owner-console";
    owner: "Javier";
    productIntent: string;
  };
  projects: typeof RUNE_CANONICAL_PROJECTS;
  summary: {
    verifiedCount: number;
    configuredCount: number;
    partialCount: number;
    missingSetupCount: number;
    notConnectedCount: number;
    approvalRequiredCount: number;
    deployHealthOverall: DeployHealthSnapshot["overall"] | "unavailable";
  };
  buckets: Record<CapabilityState, CapabilityTruthItem[]>;
  deployHealth: {
    overall: DeployHealthSnapshot["overall"] | "unavailable";
    generatedAt: string | null;
    missingRequired: Array<{ key: string; label: string; detail: string }>;
    warnings: Array<{ key: string; label: string; detail: string }>;
    unavailableReason?: string;
  };
  guidance: string[];
};

function envPresent(key: string) {
  return Boolean(process.env[key]?.trim());
}

function anyEnv(keys: string[]) {
  return keys.some(envPresent);
}

function item(key: string, label: string, state: CapabilityState, detail: string, evidence?: string): CapabilityTruthItem {
  return { key, label, state, detail, ...(evidence ? { evidence } : {}) };
}

function emptyBuckets(): Record<CapabilityState, CapabilityTruthItem[]> {
  return {
    verified: [],
    configured: [],
    partial: [],
    missing_setup: [],
    not_connected: [],
    requires_approval: [],
  };
}

function push(buckets: Record<CapabilityState, CapabilityTruthItem[]>, capability: CapabilityTruthItem) {
  buckets[capability.state].push(capability);
}

function deployHealthCapabilityItems(deployHealth: DeployHealthSnapshot | null, deployHealthError: string | null) {
  if (!deployHealth) {
    return {
      deployHealthSummary: {
        overall: "unavailable" as const,
        generatedAt: null,
        missingRequired: [],
        warnings: [],
        unavailableReason: deployHealthError || "Deploy Health could not be checked.",
      },
      missingItems: [],
      warningItems: [],
    };
  }

  const missingRequired = deployHealth.checks
    .filter((check) => check.required && (check.status === "missing" || check.status === "error"))
    .map((check) => ({ key: check.key, label: check.label, detail: check.detail }));

  const warnings = deployHealth.checks
    .filter((check) => check.status === "warning")
    .map((check) => ({ key: check.key, label: check.label, detail: check.detail }));

  return {
    deployHealthSummary: {
      overall: deployHealth.overall,
      generatedAt: deployHealth.generatedAt,
      missingRequired,
      warnings,
    },
    missingItems: missingRequired.map((check) =>
      item(`deploy.${check.key}`, check.label, "missing_setup", check.detail, "Deploy Health required check")
    ),
    warningItems: warnings.map((check) =>
      item(`deploy.${check.key}`, check.label, "partial", check.detail, "Deploy Health warning")
    ),
  };
}

export async function getCapabilityTruthSnapshot(): Promise<CapabilityTruthSnapshot> {
  const buckets = emptyBuckets();
  const generatedAt = new Date().toISOString();

  for (const capability of JARVIS_REAL_CAPABILITIES) {
    push(buckets, item(`real.${capability.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`, capability, "verified", "Implemented in the Rune codebase."));
  }

  push(
    buckets,
    item(
      "config.openai",
      "OpenAI chat model",
      envPresent("OPENAI_API_KEY") ? "configured" : "missing_setup",
      envPresent("OPENAI_API_KEY") ? "OPENAI_API_KEY is configured." : "OPENAI_API_KEY is missing; chat generation will not work in production.",
      "Environment readiness check"
    )
  );
  push(
    buckets,
    item(
      "config.auth_password",
      "Owner login password",
      envPresent("APP_PASSWORD") ? "configured" : "missing_setup",
      envPresent("APP_PASSWORD") ? "APP_PASSWORD is configured." : "APP_PASSWORD is missing; owner login is not fully configured.",
      "Environment readiness check"
    )
  );
  push(
    buckets,
    item(
      "config.session_secret",
      "Session signing secret",
      envPresent("SESSION_SECRET") ? "configured" : "missing_setup",
      envPresent("SESSION_SECRET") ? "SESSION_SECRET is configured." : "SESSION_SECRET is missing; secure signed sessions are incomplete.",
      "Environment readiness check"
    )
  );
  push(
    buckets,
    item(
      "config.supabase",
      "Supabase persistence",
      envPresent("SUPABASE_URL") && anyEnv(["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY", "SUPABASE_ANON_KEY"]) ? "configured" : "missing_setup",
      envPresent("SUPABASE_URL") && anyEnv(["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY", "SUPABASE_ANON_KEY"])
        ? "Supabase URL and key are configured. Server-side writes should prefer the service role key."
        : "Supabase URL/key is missing; persistence, memory, files, and audit logs may fail.",
      "Environment readiness check"
    )
  );
  push(
    buckets,
    item(
      "config.github",
      "GitHub repository access",
      anyEnv(["GITHUB_TOKEN", "RUNE_GITHUB_TOKEN"]) ? "configured" : "partial",
      anyEnv(["GITHUB_TOKEN", "RUNE_GITHUB_TOKEN"])
        ? "GitHub token is configured for repo inspection and private repository access."
        : "No GitHub token is configured; public repo inspection may work, private repos and higher rate limits will not.",
      "Environment readiness check"
    )
  );
  push(
    buckets,
    item(
      "config.vercel",
      "Vercel deployment intelligence",
      anyEnv(["VERCEL_TOKEN", "RUNE_VERCEL_TOKEN"]) ? "configured" : "partial",
      anyEnv(["VERCEL_TOKEN", "RUNE_VERCEL_TOKEN"])
        ? "Vercel token is configured for deployment intelligence."
        : "Vercel token is optional but missing; deployment intelligence may be limited.",
      "Environment readiness check"
    )
  );
  push(
    buckets,
    item(
      "config.runner",
      "External runner token",
      envPresent("RUNE_RUNNER_TOKEN") ? "configured" : "partial",
      envPresent("RUNE_RUNNER_TOKEN")
        ? "RUNE_RUNNER_TOKEN is configured for external worker claims."
        : "Runner API exists, but long-running external execution needs RUNE_RUNNER_TOKEN and a real runner process.",
      "Environment readiness check"
    )
  );
  push(
    buckets,
    item(
      "config.upload_bucket",
      "Private upload bucket",
      "configured",
      `Upload bucket name resolves to ${process.env.RUNE_UPLOAD_BUCKET || "rune-uploads"}. Bucket existence is verified by Deploy Health/storage operations, not by exposing secrets.`,
      "Configuration default check"
    )
  );

  for (const capability of JARVIS_NOT_CONNECTED_YET) {
    push(buckets, item(`missing.${capability.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`, capability, "not_connected", "Not wired as a real integration yet. Do not claim this is available."));
  }

  for (const action of JARVIS_APPROVAL_REQUIRED_ACTIONS) {
    push(buckets, item(`approval.${action.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`, action, "requires_approval", "Requires explicit Javier approval before execution."));
  }

  let deployHealth: DeployHealthSnapshot | null = null;
  let deployHealthError: string | null = null;
  try {
    deployHealth = await getDeployHealthSnapshot();
  } catch (error) {
    deployHealthError = error instanceof Error ? error.message : "Unknown Deploy Health error";
    logError("capabilityTruth.deployHealth", error);
  }

  const deploy = deployHealthCapabilityItems(deployHealth, deployHealthError);
  for (const missing of deploy.missingItems) push(buckets, missing);
  for (const warning of deploy.warningItems) push(buckets, warning);

  const summary = {
    verifiedCount: buckets.verified.length,
    configuredCount: buckets.configured.length,
    partialCount: buckets.partial.length,
    missingSetupCount: buckets.missing_setup.length,
    notConnectedCount: buckets.not_connected.length,
    approvalRequiredCount: buckets.requires_approval.length,
    deployHealthOverall: deploy.deployHealthSummary.overall,
  };

  return {
    generatedAt,
    identity: {
      mode: "private-owner-console",
      owner: "Javier",
      productIntent:
        "Not for sale. Built as Javier's private operating system for apps, projects, customer support, and eventually sensitive owner-only services.",
    },
    projects: RUNE_CANONICAL_PROJECTS,
    summary,
    buckets,
    deployHealth: deploy.deployHealthSummary,
    guidance: [
      "Answer capability questions from this snapshot, not from assumptions.",
      "If a capability is partial, explain the missing setup before offering next steps.",
      "If a capability is not_connected, do not imply Rune can perform it yet.",
      "Sensitive actions stay behind Findings → Plan → Approval → Action.",
    ],
  };
}
