import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionCookie, getSessionSecret, getExpiredSessionCookieOptions } from "@/lib/auth";
import { getClientIp, logSecurityEvent } from "@/lib/security";

export async function POST(req: NextRequest) {
  const secret = getSessionSecret();
  const cookieValue = req.cookies.get(SESSION_COOKIE)?.value;
  const verification = secret
    ? await verifySessionCookie(cookieValue, secret)
    : { ok: false as const, reason: "missing" as const };

  await logSecurityEvent({
    eventType: "logout",
    outcome: "success",
    ipAddress: getClientIp(req.headers),
    userAgent: req.headers.get("user-agent"),
    sessionNonce: verification.ok ? verification.nonce : null,
  });

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", getExpiredSessionCookieOptions());
  return response;
}
