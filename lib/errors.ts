/**
 * Jarvis application error types and utilities.
 * Provides consistent error handling across API routes and services.
 */

export type JarvisErrorCode =
  | "VALIDATION_ERROR"
  | "PERSISTENCE_ERROR"
  | "EXECUTION_ERROR"
  | "TOOL_ERROR"
  | "AUTH_ERROR"
  | "RATE_LIMIT_ERROR"
  | "NOT_FOUND_ERROR"
  | "UPSTREAM_ERROR"
  | "UNKNOWN_ERROR";

export class JarvisError extends Error {
  readonly code: JarvisErrorCode;
  readonly statusCode: number;
  readonly cause?: unknown;

  constructor(
    message: string,
    code: JarvisErrorCode = "UNKNOWN_ERROR",
    statusCode = 500,
    cause?: unknown
  ) {
    super(message);
    this.name = "JarvisError";
    this.code = code;
    this.statusCode = statusCode;
    this.cause = cause;
  }
}

/** Extract a safe human-readable error message from any thrown value. */
export function safeErrorMessage(
  err: unknown,
  fallback = "An unexpected error occurred."
): string {
  if (err instanceof JarvisError) return err.message;
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return fallback;
}

/** Log an error with structured context to stderr. */
export function logError(context: string, err: unknown): void {
  const msg = safeErrorMessage(err);
  const code = err instanceof JarvisError ? err.code : "UNKNOWN_ERROR";
  const extra =
    err instanceof Error && err.cause != null
      ? { cause: String(err.cause) }
      : undefined;
  if (extra) {
    console.error(`[Jarvis:${context}] ${code}: ${msg}`, extra);
  } else {
    console.error(`[Jarvis:${context}] ${code}: ${msg}`);
  }
}
