/** Single source of truth for the session cookie name. */
export const SESSION_COOKIE = "rune_session" as const;

const DEFAULT_SESSION_MAX_AGE_SECONDS = 60 * 60 * 12; // 12 hours
const MAX_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // hard cap: 7 days

/**
 * Computes an HMAC-SHA-256 token scoped to the given payload.
 * Compatible with both the Edge (middleware) and Node.js (API route) runtimes.
 */
export async function computeToken(secret: string, payload: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function getAppPassword(): string | undefined {
  return process.env.APP_PASSWORD;
}

/**
 * Returns the session signing secret. SESSION_SECRET is preferred, AUTH_SECRET
 * is supported for backward compatibility.
 */
export function getSessionSecret(): string | undefined {
  return process.env.SESSION_SECRET ?? process.env.AUTH_SECRET;
}

export function getSessionMaxAgeSeconds(): number {
  const configured = Number(process.env.RUNE_SESSION_MAX_AGE_SECONDS);
  if (Number.isFinite(configured) && configured > 0) {
    return Math.min(Math.floor(configured), MAX_SESSION_MAX_AGE_SECONDS);
  }
  return DEFAULT_SESSION_MAX_AGE_SECONDS;
}

export function getMissingAuthConfigVars(): string[] {
  const missing: string[] = [];

  if (!getAppPassword()) {
    missing.push("APP_PASSWORD");
  }

  if (!getSessionSecret()) {
    missing.push("SESSION_SECRET (or AUTH_SECRET)");
  }

  return missing;
}

/** Constant-time string equality to prevent timing attacks. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

export async function createSessionCookieValue(
  secret: string,
  nonce: string,
  expiresAtMs: number
): Promise<string> {
  const payload = `rune:authenticated:v2:${nonce}:${expiresAtMs}`;
  const token = await computeToken(secret, payload);
  return `v2.${nonce}.${expiresAtMs}.${token}`;
}

export type SessionVerificationResult =
  | { ok: true; nonce: string; expiresAtMs: number }
  | { ok: false; reason: "missing" | "malformed" | "expired" | "invalid" };

export async function verifySessionCookie(
  cookieValue: string | undefined,
  secret: string,
  nowMs = Date.now()
): Promise<SessionVerificationResult> {
  if (!cookieValue) return { ok: false, reason: "missing" };

  const parts = cookieValue.split(".");
  if (parts.length !== 4 || parts[0] !== "v2") {
    // Reject legacy nonce.hmac sessions so old relaxed cookies cannot persist.
    return { ok: false, reason: "malformed" };
  }

  const [, nonce, expiresAtRaw, provided] = parts;
  const expiresAtMs = Number(expiresAtRaw);
  if (!nonce || !provided || !Number.isFinite(expiresAtMs)) {
    return { ok: false, reason: "malformed" };
  }

  if (expiresAtMs <= nowMs) {
    return { ok: false, reason: "expired" };
  }

  const expected = await computeToken(
    secret,
    `rune:authenticated:v2:${nonce}:${expiresAtMs}`
  );

  if (!safeEqual(provided, expected)) {
    return { ok: false, reason: "invalid" };
  }

  return { ok: true, nonce, expiresAtMs };
}
