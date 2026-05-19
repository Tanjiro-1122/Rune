import type { NextRequest } from "next/server";
import { getSessionSecret, SESSION_COOKIE, verifySessionCookie } from "@/lib/auth";

export const RUNE_OWNER_SESSION_ID = "owner:javier" as const;

const MAX_SESSION_ID_LENGTH = 160;
const FALLBACK_SESSION_PREFIX = "local-";

type RequestLike = Request | NextRequest;

function cleanClientSessionId(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_SESSION_ID_LENGTH) return null;
  return trimmed;
}

function getCookieHeader(req: RequestLike): string {
  return req.headers.get("cookie") ?? "";
}

function getCookieFromHeader(header: string, name: string): string | undefined {
  return header
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

function getSessionCookieValue(req: RequestLike): string | undefined {
  if ("cookies" in req && req.cookies && typeof req.cookies.get === "function") {
    return req.cookies.get(SESSION_COOKIE)?.value;
  }
  return getCookieFromHeader(getCookieHeader(req), SESSION_COOKIE);
}

/**
 * Resolve the durable workspace owner key.
 *
 * In production Rune is single-owner. Once the signed Rune auth cookie is
 * valid, workspace/conversation/message persistence must not depend on random
 * browser localStorage IDs. Safari, Chrome, and desktop should all load the same
 * owner-scoped workspace state.
 *
 * Local development can still fall back to the caller-provided session ID so
 * contributors can run without auth secrets.
 */
export async function resolveOwnerSessionId(
  req: RequestLike,
  clientSessionId?: string | null
): Promise<string> {
  const secret = getSessionSecret();
  const cookieValue = getSessionCookieValue(req);
  if (secret) {
    const verification = await verifySessionCookie(cookieValue, secret);
    if (verification.ok) return RUNE_OWNER_SESSION_ID;
  }

  const cleaned = cleanClientSessionId(clientSessionId);
  if (cleaned) return cleaned;

  return `${FALLBACK_SESSION_PREFIX}${RUNE_OWNER_SESSION_ID}`;
}
