import { logActionEvent } from "@/lib/action-events";

export type PrivilegedOperationKind =
  | "merge"
  | "deploy"
  | "rollback"
  | "change_payments"
  | "grant_entitlements"
  | "mutate_schema"
  | "mutate_dns"
  | "mutate_customer_systems";

export type PrivilegedOperationDomain = "code" | "infrastructure" | "payments" | "entitlements" | "database" | "dns" | "customer_systems";

export interface PrivilegedOperationPolicy {
  kind: PrivilegedOperationKind;
  domain: PrivilegedOperationDomain;
  exactApprovalPhrase: string;
  riskLevel: "high";
  requiredEvidence: string[];
  requiredScopeFields: string[];
  dryRunRequired: boolean;
  auditRequired: boolean;
  defaultMode: "blocked_until_explicit_approval";
  forbiddenWithoutApproval: string[];
}

export interface PrivilegedOperationRequest {
  kind: PrivilegedOperationKind;
  approvalText?: string | null;
  scope?: Record<string, unknown> | null;
  evidence?: Record<string, unknown> | null;
  dryRun?: boolean;
  requestedBy?: string | null;
  projectKey?: string | null;
  workspaceId?: string | null;
  conversationId?: string | null;
}

export interface PrivilegedOperationGateResult {
  ok: boolean;
  approved: boolean;
  kind: PrivilegedOperationKind;
  domain: PrivilegedOperationDomain;
  exactApprovalPhrase: string;
  missingScope: string[];
  missingEvidence: string[];
  dryRunRequired: boolean;
  auditRequired: boolean;
  message: string;
  canExecute: boolean;
}

const POLICIES: Record<PrivilegedOperationKind, PrivilegedOperationPolicy> = {
  merge: {
    kind: "merge",
    domain: "code",
    exactApprovalPhrase: "APPROVE RUNE MERGE",
    riskLevel: "high",
    requiredEvidence: ["approved_pr_url", "passing_checks", "diff_summary", "rollback_plan"],
    requiredScopeFields: ["repo", "pr_number", "base_branch"],
    dryRunRequired: true,
    auditRequired: true,
    defaultMode: "blocked_until_explicit_approval",
    forbiddenWithoutApproval: ["merge pull request", "push to protected branch", "bypass required checks"],
  },
  deploy: {
    kind: "deploy",
    domain: "infrastructure",
    exactApprovalPhrase: "APPROVE RUNE DEPLOY",
    riskLevel: "high",
    requiredEvidence: ["build_passed", "target_environment", "release_summary", "rollback_plan"],
    requiredScopeFields: ["project", "environment", "commit_sha"],
    dryRunRequired: true,
    auditRequired: true,
    defaultMode: "blocked_until_explicit_approval",
    forbiddenWithoutApproval: ["production deploy", "environment promotion", "release alias change"],
  },
  rollback: {
    kind: "rollback",
    domain: "infrastructure",
    exactApprovalPhrase: "APPROVE RUNE ROLLBACK",
    riskLevel: "high",
    requiredEvidence: ["incident_summary", "current_deployment", "target_rollback_deployment", "blast_radius"],
    requiredScopeFields: ["project", "environment", "rollback_target"],
    dryRunRequired: true,
    auditRequired: true,
    defaultMode: "blocked_until_explicit_approval",
    forbiddenWithoutApproval: ["rollback production", "promote old deployment", "change live alias"],
  },
  change_payments: {
    kind: "change_payments",
    domain: "payments",
    exactApprovalPhrase: "APPROVE RUNE PAYMENT CHANGE",
    riskLevel: "high",
    requiredEvidence: ["payment_provider", "affected_products", "financial_impact", "reversal_plan"],
    requiredScopeFields: ["provider", "product_or_price_id", "change_type"],
    dryRunRequired: true,
    auditRequired: true,
    defaultMode: "blocked_until_explicit_approval",
    forbiddenWithoutApproval: ["create price", "change product", "refund", "cancel subscription", "modify checkout"],
  },
  grant_entitlements: {
    kind: "grant_entitlements",
    domain: "entitlements",
    exactApprovalPhrase: "APPROVE RUNE ENTITLEMENT GRANT",
    riskLevel: "high",
    requiredEvidence: ["user_identifier", "entitlement_name", "reason", "expiration_or_reversal_plan"],
    requiredScopeFields: ["user_id_or_email", "entitlement", "duration"],
    dryRunRequired: true,
    auditRequired: true,
    defaultMode: "blocked_until_explicit_approval",
    forbiddenWithoutApproval: ["grant premium", "extend subscription", "modify credits", "change customer access"],
  },
  mutate_schema: {
    kind: "mutate_schema",
    domain: "database",
    exactApprovalPhrase: "APPROVE RUNE SCHEMA MUTATION",
    riskLevel: "high",
    requiredEvidence: ["migration_sql", "backup_or_restore_plan", "affected_tables", "rollback_sql"],
    requiredScopeFields: ["database", "schema", "tables"],
    dryRunRequired: true,
    auditRequired: true,
    defaultMode: "blocked_until_explicit_approval",
    forbiddenWithoutApproval: ["run migration", "alter table", "drop column", "delete data", "change RLS"],
  },
  mutate_dns: {
    kind: "mutate_dns",
    domain: "dns",
    exactApprovalPhrase: "APPROVE RUNE DNS CHANGE",
    riskLevel: "high",
    requiredEvidence: ["domain", "record_diff", "provider", "rollback_record"],
    requiredScopeFields: ["domain", "record_name", "record_type"],
    dryRunRequired: true,
    auditRequired: true,
    defaultMode: "blocked_until_explicit_approval",
    forbiddenWithoutApproval: ["change A record", "change CNAME", "change MX", "change TXT", "delete DNS record"],
  },
  mutate_customer_systems: {
    kind: "mutate_customer_systems",
    domain: "customer_systems",
    exactApprovalPhrase: "APPROVE RUNE CUSTOMER SYSTEM CHANGE",
    riskLevel: "high",
    requiredEvidence: ["system_name", "affected_customers", "change_summary", "customer_impact", "rollback_plan"],
    requiredScopeFields: ["system", "customer_scope", "change_type"],
    dryRunRequired: true,
    auditRequired: true,
    defaultMode: "blocked_until_explicit_approval",
    forbiddenWithoutApproval: ["send customer message", "modify customer record", "bulk update", "delete customer data"],
  },
};

export function listPrivilegedOperationPolicies() {
  return Object.values(POLICIES);
}

export function getPrivilegedOperationPolicy(kind: PrivilegedOperationKind) {
  return POLICIES[kind] ?? null;
}

function hasValue(record: Record<string, unknown> | null | undefined, key: string) {
  const value = record?.[key];
  if (Array.isArray(value)) return value.length > 0;
  return value !== undefined && value !== null && String(value).trim() !== "";
}

export function evaluatePrivilegedOperationGate(input: PrivilegedOperationRequest): PrivilegedOperationGateResult {
  const policy = getPrivilegedOperationPolicy(input.kind);
  if (!policy) {
    return {
      ok: false,
      approved: false,
      kind: input.kind,
      domain: "code",
      exactApprovalPhrase: "",
      missingScope: [],
      missingEvidence: [],
      dryRunRequired: true,
      auditRequired: true,
      message: "Unknown privileged operation.",
      canExecute: false,
    };
  }

  const missingScope = policy.requiredScopeFields.filter((key) => !hasValue(input.scope, key));
  const missingEvidence = policy.requiredEvidence.filter((key) => !hasValue(input.evidence, key));
  const approved = String(input.approvalText || "").trim() === policy.exactApprovalPhrase;
  const dryRunSatisfied = policy.dryRunRequired ? input.dryRun === true : true;
  const canExecute = approved && dryRunSatisfied && missingScope.length === 0 && missingEvidence.length === 0;

  return {
    ok: true,
    approved,
    kind: policy.kind,
    domain: policy.domain,
    exactApprovalPhrase: policy.exactApprovalPhrase,
    missingScope,
    missingEvidence,
    dryRunRequired: policy.dryRunRequired,
    auditRequired: policy.auditRequired,
    message: canExecute
      ? `${policy.kind} passed the privileged operation gate. Executor may proceed only within the declared scope.`
      : `${policy.kind} is blocked until exact approval, dry-run evidence, required scope, and audit metadata are present.`,
    canExecute,
  };
}

export async function auditPrivilegedOperationGate(input: PrivilegedOperationRequest, result: PrivilegedOperationGateResult) {
  await logActionEvent({
    eventType: `privileged_operation.${input.kind}.gate`,
    summary: result.message,
    status: result.canExecute ? "approved" : "blocked",
    approvalStage: result.canExecute ? "approval" : "plan",
    riskLevel: "high",
    projectKey: input.projectKey || "rune",
    workspaceId: input.workspaceId || null,
    conversationId: input.conversationId || null,
    metadata: {
      kind: input.kind,
      domain: result.domain,
      approved: result.approved,
      canExecute: result.canExecute,
      dryRun: input.dryRun === true,
      missingScope: result.missingScope,
      missingEvidence: result.missingEvidence,
      scope: input.scope || {},
      requestedBy: input.requestedBy || null,
    },
  });
}
