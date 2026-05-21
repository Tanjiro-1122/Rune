export type OperatorFailureClass =
  | "transient_network"
  | "github_rate_limit"
  | "npm_install_timeout"
  | "temp_workspace_timeout"
  | "vercel_status_pending"
  | "approval_missing"
  | "repo_not_allowlisted"
  | "unsafe_diff"
  | "permission_denied"
  | "invalid_patch"
  | "build_compile_error"
  | "test_failure"
  | "missing_target_file"
  | "unknown_failure";

export type OperatorFailureDisposition = "retryable" | "blocked" | "non_retryable";

export interface OperatorFailureClassification {
  failureClass: OperatorFailureClass;
  disposition: OperatorFailureDisposition;
  retryable: boolean;
  requiresHuman: boolean;
  reason: string;
}

export interface OperatorRetryDecision {
  shouldRetry: boolean;
  nextRetryDelayMs: number | null;
  nextRetryAt: string | null;
  maxAttempts: number;
  attempt: number;
  classification: OperatorFailureClassification;
}

const RETRYABLE_PATTERNS: Array<[OperatorFailureClass, RegExp, string]> = [
  ["github_rate_limit", /rate limit|secondary rate|abuse detection|api rate/i, "GitHub rate limiting is usually temporary."],
  ["transient_network", /ETIMEDOUT|ECONNRESET|EAI_AGAIN|ENOTFOUND|network|fetch failed|socket hang up|temporar/i, "Network/API instability is usually retryable."],
  ["npm_install_timeout", /npm ci|npm install|install failed|dependency install failed|timed out.*npm/i, "Dependency install failures can be transient when registries are slow."],
  ["temp_workspace_timeout", /temporary workspace|sandbox.*timeout|timed out|exit code 124|code 124/i, "Temporary workspace timeouts can be retried safely."],
  ["vercel_status_pending", /vercel.*pending|deployment.*building|status.*pending/i, "Pending deployment/status checks can settle after a retry."],
];

const BLOCKED_PATTERNS: Array<[OperatorFailureClass, RegExp, string]> = [
  ["approval_missing", /must be approved|approval|not approved|approve/i, "Approval is a human/safety boundary, not a retry target."],
  ["repo_not_allowlisted", /not allowlisted|allowlist/i, "Repo allowlist failures require configuration/owner action."],
  ["permission_denied", /permission denied|forbidden|unauthorized|401|403|not authorized/i, "Permission failures require credential or owner action."],
  ["unsafe_diff", /unsafe|blocked.*diff|forbidden file|outside allow/i, "Unsafe diff failures must not be retried blindly."],
];

const NON_RETRYABLE_PATTERNS: Array<[OperatorFailureClass, RegExp, string]> = [
  ["missing_target_file", /not found|missing target|file does not exist|path.*not found/i, "Missing files require a corrected remediation plan."],
  ["invalid_patch", /patch did not apply|git apply|no parseable diff|invalid patch|diff generation failed/i, "Invalid patches require code/planning remediation."],
  ["build_compile_error", /typescript|type error|failed to compile|compile error|next build|build failed/i, "Compile/build failures require code changes, not blind retries."],
  ["test_failure", /test failed|jest|vitest|playwright|assertion|lint/i, "Test/lint failures require code changes, not blind retries."],
];

export function classifyOperatorFailure(error: unknown): OperatorFailureClassification {
  const message = error instanceof Error ? error.message : String(error ?? "");

  for (const [failureClass, pattern, reason] of BLOCKED_PATTERNS) {
    if (pattern.test(message)) return { failureClass, disposition: "blocked", retryable: false, requiresHuman: true, reason };
  }
  for (const [failureClass, pattern, reason] of NON_RETRYABLE_PATTERNS) {
    if (pattern.test(message)) return { failureClass, disposition: "non_retryable", retryable: false, requiresHuman: false, reason };
  }
  for (const [failureClass, pattern, reason] of RETRYABLE_PATTERNS) {
    if (pattern.test(message)) return { failureClass, disposition: "retryable", retryable: true, requiresHuman: false, reason };
  }

  return {
    failureClass: "unknown_failure",
    disposition: "non_retryable",
    retryable: false,
    requiresHuman: true,
    reason: "Unknown failures are preserved and escalated instead of retried blindly.",
  };
}

export function getOperatorRetryDecision(input: {
  error: unknown;
  attempt: number;
  maxAttempts?: number;
  baseDelayMs?: number;
}): OperatorRetryDecision {
  const classification = classifyOperatorFailure(input.error);
  const maxAttempts = Math.max(1, Math.min(input.maxAttempts ?? 3, 5));
  const attempt = Math.max(1, input.attempt);
  const shouldRetry = classification.retryable && attempt < maxAttempts;
  const nextRetryDelayMs = shouldRetry ? Math.min((input.baseDelayMs ?? 750) * 2 ** (attempt - 1), 5000) : null;
  const nextRetryAt = nextRetryDelayMs === null ? null : new Date(Date.now() + nextRetryDelayMs).toISOString();

  return { shouldRetry, nextRetryDelayMs, nextRetryAt, maxAttempts, attempt, classification };
}
