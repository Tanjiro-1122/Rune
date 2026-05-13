/**
 * Computes a deterministic HMAC-SHA-256 token from the session signing secret.
 * Compatible with both the Edge (middleware) and Node.js (API route) runtimes.
 */
export async function computeToken(secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode("jarvis:authenticated")
  );
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function getAppPassword(): string | undefined {
  return process.env.APP_PASSWORD;
}

/**
 * Returns the session signing secret. SESSION_SECRET is preferred, AUTH_SECRET
 * is supported for backward compatibility, and APP_PASSWORD is the fallback so
 * APP_PASSWORD-only deployments still work.
 */
export function getSessionSecret(): string | undefined {
  return process.env.SESSION_SECRET ?? process.env.AUTH_SECRET ?? getAppPassword();
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
