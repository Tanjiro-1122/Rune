import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  createSessionCookieValue,
  getAppPassword,
  getSessionCookieOptions,
  getMissingAuthConfigVars,
  getSessionMaxAgeSeconds,
  getSessionSecret,
  safeEqual,
  SESSION_COOKIE,
} from "@/lib/auth";
import { getClientIp, logSecurityEvent } from "@/lib/security";

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_LOCK_MS = 15 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 5;

interface LoginAttemptState {
  count: number;
  firstAttemptMs: number;
  lockedUntilMs?: number;
}

const loginAttempts = new Map<string, LoginAttemptState>();

function getAttemptState(key: string, now: number): LoginAttemptState {
  const current = loginAttempts.get(key);
  if (!current || now - current.firstAttemptMs > LOGIN_WINDOW_MS) {
    const fresh = { count: 0, firstAttemptMs: now };
    loginAttempts.set(key, fresh);
    return fresh;
  }
  return current;
}

function recordFailedAttempt(key: string, now: number): LoginAttemptState {
  const state = getAttemptState(key, now);
  state.count += 1;
  if (state.count >= MAX_FAILED_ATTEMPTS) {
    state.lockedUntilMs = now + LOGIN_LOCK_MS;
  }
  loginAttempts.set(key, state);
  return state;
}

export async function POST(req: NextRequest) {
  const ipAddress = getClientIp(req.headers);
  const userAgent = req.headers.get("user-agent");
  const now = Date.now();
  const attemptKey = ipAddress;
  const attemptState = getAttemptState(attemptKey, now);

  if (attemptState.lockedUntilMs && attemptState.lockedUntilMs > now) {
    await logSecurityEvent({
      eventType: "login_rate_limited",
      outcome: "blocked",
      ipAddress,
      userAgent,
      metadata: { retryAfterSeconds: Math.ceil((attemptState.lockedUntilMs - now) / 1000) },
    });
    return NextResponse.json(
      { error: "Too many sign-in attempts. Wait 15 minutes and try again." },
      { status: 429, headers: { "Retry-After": "900" } }
    );
  }

  let password: unknown;
  try {
    const body = await req.json();
    password = body?.password;
  } catch {
    await logSecurityEvent({
      eventType: "login_invalid_request",
      outcome: "failure",
      ipAddress,
      userAgent,
    });
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  if (typeof password !== "string" || !password) {
    await logSecurityEvent({
      eventType: "login_missing_password",
      outcome: "failure",
      ipAddress,
      userAgent,
    });
    return NextResponse.json({ error: "Password is required." }, { status: 400 });
  }

  const appPassword = getAppPassword();
  const sessionSecret = getSessionSecret();

  if (!appPassword || !sessionSecret) {
    const missingVars = getMissingAuthConfigVars();
    const missingMessage =
      missingVars.length > 0 ? ` Missing: ${missingVars.join(", ")}.` : "";
    await logSecurityEvent({
      eventType: "login_server_auth_misconfigured",
      outcome: "failure",
      ipAddress,
      userAgent,
      metadata: { missingVars },
    });
    return NextResponse.json(
      {
        error: `Server authentication is not configured.${missingMessage}`,
      },
      { status: 500 }
    );
  }

  if (!safeEqual(password, appPassword)) {
    const failedState = recordFailedAttempt(attemptKey, now);
    await logSecurityEvent({
      eventType: "login_failed",
      outcome: failedState.lockedUntilMs ? "blocked" : "failure",
      ipAddress,
      userAgent,
      metadata: { failedAttempts: failedState.count },
    });
    return NextResponse.json({ error: "Invalid password." }, { status: 401 });
  }

  loginAttempts.delete(attemptKey);

  const nonce = randomBytes(16).toString("hex");
  const maxAge = getSessionMaxAgeSeconds();
  const expiresAtMs = now + maxAge * 1000;
  const cookieValue = await createSessionCookieValue(sessionSecret, nonce, expiresAtMs);

  await logSecurityEvent({
    eventType: "login_success",
    outcome: "success",
    ipAddress,
    userAgent,
    sessionNonce: nonce,
    metadata: { expiresAt: new Date(expiresAtMs).toISOString() },
  });

  const response = NextResponse.json({ ok: true, expiresAt: new Date(expiresAtMs).toISOString() });
  response.cookies.set(SESSION_COOKIE, cookieValue, getSessionCookieOptions(maxAge));

  return response;
}
