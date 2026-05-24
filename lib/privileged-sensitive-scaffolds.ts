import {
  auditPrivilegedOperationGate,
  evaluatePrivilegedOperationGate,
  type PrivilegedOperationKind,
} from "@/lib/privileged-operations";
import { logError } from "@/lib/errors";

type SensitiveKind = "change_payments" | "grant_entitlements" | "mutate_schema" | "mutate_dns" | "mutate_customer_systems";

export interface PrivilegedSensitiveScaffoldInput {
  kind: SensitiveKind;
  approvalText?: string | null;
  dryRun?: boolean;
  scope?: Record<string, unknown> | null;
  evidence?: Record<string, unknown> | null;
  requestedBy?: string | null;
  projectKey?: string | null;
  workspaceId?: string | null;
  conversationId?: string | null;
}

export interface PrivilegedSensitiveScaffoldResult {
  ok: boolean;
  kind: SensitiveKind;
  dryRun: boolean;
  approved: boolean;
  canExecute: boolean;
  realMutationSupported: false;
  gateMessage: string;
  mutationPlan: string[];
  requiredNextStep: string;
  safety: string;
  message: string;
  error?: string;
}

const SENSITIVE_KINDS = new Set<PrivilegedOperationKind>([
  "change_payments",
  "grant_entitlements",
  "mutate_schema",
  "mutate_dns",
  "mutate_customer_systems",
]);

function defaultsFor(kind: SensitiveKind) {
  switch (kind) {
    case "change_payments":
      return {
        scope: { provider: "unset_provider", product_or_price_id: "unset_product_or_price_id", change_type: "unset_change_type" },
        evidence: { payment_provider: "unset_provider", affected_products: "unset_products", financial_impact: "unset_financial_impact", reversal_plan: "unset_reversal_plan" },
        plan: [
          "Validate provider, product/price IDs, financial impact, and reversal plan.",
          "Prepare provider-specific API request as a reviewed artifact only.",
          "Require a second implementation PR before any real payment mutation is possible.",
        ],
      };
    case "grant_entitlements":
      return {
        scope: { user_id_or_email: "unset_user", entitlement: "unset_entitlement", duration: "unset_duration" },
        evidence: { user_identifier: "unset_user", entitlement_name: "unset_entitlement", reason: "unset_reason", expiration_or_reversal_plan: "unset_expiration_or_reversal" },
        plan: [
          "Validate exact user identifier and entitlement name.",
          "Prepare an entitlement grant request preview with expiration/reversal details.",
          "Require a second implementation PR before any real access or credit change is possible.",
        ],
      };
    case "mutate_schema":
      return {
        scope: { database: "unset_database", schema: "unset_schema", tables: "unset_tables" },
        evidence: { migration_sql: "unset_migration_sql", backup_or_restore_plan: "unset_backup_restore", affected_tables: "unset_tables", rollback_sql: "unset_rollback_sql" },
        plan: [
          "Validate migration SQL, affected tables, backup/restore plan, and rollback SQL.",
          "Prepare migration files and dry-run instructions only.",
          "Require a second implementation PR and database-specific runner before any real schema mutation is possible.",
        ],
      };
    case "mutate_dns":
      return {
        scope: { domain: "unset_domain", record_name: "unset_record_name", record_type: "unset_record_type" },
        evidence: { domain: "unset_domain", record_diff: "unset_record_diff", provider: "unset_provider", rollback_record: "unset_rollback_record" },
        plan: [
          "Validate DNS provider, record diff, TTL/propagation risk, and rollback record.",
          "Prepare a provider-console checklist or API request preview only.",
          "Require a second implementation PR before any real DNS mutation is possible.",
        ],
      };
    case "mutate_customer_systems":
      return {
        scope: { system: "unset_system", customer_scope: "unset_customer_scope", change_type: "unset_change_type" },
        evidence: { system_name: "unset_system", affected_customers: "unset_customers", change_summary: "unset_change", customer_impact: "unset_impact", rollback_plan: "unset_rollback" },
        plan: [
          "Validate customer system, exact customer scope, customer impact, and rollback plan.",
          "Prepare a reviewed batch/customer change manifest only.",
          "Require a second implementation PR before any real customer-system mutation is possible.",
        ],
      };
  }
}

function mergeRecord(base: Record<string, unknown>, override?: Record<string, unknown> | null) {
  return { ...base, ...(override || {}) };
}

export function isSensitivePrivilegedKind(kind: string): kind is SensitiveKind {
  return SENSITIVE_KINDS.has(kind as PrivilegedOperationKind) && kind !== "merge" && kind !== "deploy" && kind !== "rollback";
}

export async function runPrivilegedSensitiveScaffold(input: PrivilegedSensitiveScaffoldInput): Promise<PrivilegedSensitiveScaffoldResult> {
  try {
    const defaults = defaultsFor(input.kind);
    const scope = mergeRecord(defaults.scope, input.scope);
    const evidence = mergeRecord(defaults.evidence, input.evidence);
    const dryRun = input.dryRun !== false;
    const gateInput = {
      kind: input.kind,
      approvalText: input.approvalText,
      dryRun: true,
      scope,
      evidence,
      requestedBy: input.requestedBy,
      projectKey: input.projectKey || "rune",
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
    };
    const gate = evaluatePrivilegedOperationGate(gateInput);
    const canExecute = false;
    await auditPrivilegedOperationGate(gateInput, { ...gate, canExecute });

    return {
      ok: true,
      kind: input.kind,
      dryRun,
      approved: gate.approved,
      canExecute,
      realMutationSupported: false,
      gateMessage: gate.message,
      mutationPlan: defaults.plan,
      requiredNextStep: "Open a separate implementation PR for the provider-specific executor, with tests, before any real external mutation can be enabled.",
      safety: "scaffold_only_no_external_mutation",
      message: gate.canExecute
        ? `${input.kind} gate passed, but real mutation is intentionally not implemented yet. Scaffold returned a reviewed plan only.`
        : `${input.kind} scaffold evaluated the gate and stayed dry-run/blocked. No external system was changed.`,
      error: gate.canExecute ? undefined : "Sensitive privileged operation remains scaffold-only or gate requirements are incomplete.",
    };
  } catch (error) {
    logError("privilegedSensitiveScaffold.run", error);
    return {
      ok: false,
      kind: input.kind,
      dryRun: input.dryRun !== false,
      approved: false,
      canExecute: false,
      realMutationSupported: false,
      gateMessage: "Sensitive privileged scaffold failed before completion.",
      mutationPlan: [],
      requiredNextStep: "Fix scaffold validation before considering any provider-specific executor.",
      safety: "failed_no_external_mutation",
      message: "Sensitive privileged scaffold failed. No external system was changed.",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
