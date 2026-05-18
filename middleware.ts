import { NextRequest, NextResponse } from "next/server";
import { getSessionSecret, SESSION_COOKIE, verifySessionCookie } from "@/lib/auth";

function withSecurityHeaders(response: NextResponse): NextResponse {
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "same-origin");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}

function redirectToLogin(request: NextRequest, reason?: string): NextResponse {
  const loginUrl = new URL("/login", request.url);
  if (reason) loginUrl.searchParams.set("reason", reason);
  return withSecurityHeaders(NextResponse.redirect(loginUrl));
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow login page and auth API routes through.
  if (pathname.startsWith("/login") || pathname.startsWith("/api/auth")) {
    return withSecurityHeaders(NextResponse.next());
  }

  // Allow the private memory seed endpoint when a seed token is configured and
  // supplied. This keeps curl-based setup possible without exposing the route.
  if (pathname.startsWith("/api/memory/seed")) {
    const seedToken = process.env.RUNE_MEMORY_SEED_TOKEN;
    const provided =
      request.headers.get("x-jarvis-seed-token") ??
      request.nextUrl.searchParams.get("token");
    if (seedToken && provided === seedToken) {
      return withSecurityHeaders(NextResponse.next());
    }
  }

  // Allow an external isolated runner to poll the runner API with a dedicated
  // bearer token. This route still remains closed unless RUNE_RUNNER_TOKEN is set.
  if (pathname.startsWith("/api/runner")) {
    const runnerToken = process.env.RUNE_RUNNER_TOKEN;
    const authHeader = request.headers.get("authorization") ?? "";
    const provided = authHeader.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
    if (runnerToken && provided === runnerToken) {
      return withSecurityHeaders(NextResponse.next());
    }
  }

  // Local development can run open for quick setup. Production must never run
  // without a signed session secret, otherwise the workspace would be exposed.
  const secret = getSessionSecret();
  if (!secret) {
    if (process.env.NODE_ENV !== "production") {
      return withSecurityHeaders(NextResponse.next());
    }

    if (pathname.startsWith("/api/")) {
      return withSecurityHeaders(
        NextResponse.json(
          { error: "Jarvis authentication is not configured. Set SESSION_SECRET." },
          { status: 503 }
        )
      );
    }

    return redirectToLogin(request, "missing-session-secret");
  }

  const verification = await verifySessionCookie(
    request.cookies.get(SESSION_COOKIE)?.value,
    secret
  );

  if (!verification.ok) {
    if (pathname.startsWith("/api/")) {
      return withSecurityHeaders(
        NextResponse.json(
          { error: verification.reason === "expired" ? "Session expired." : "Authentication required." },
          { status: 401 }
        )
      );
    }
    return redirectToLogin(request, verification.reason);
  }

  return withSecurityHeaders(NextResponse.next());
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icons/|images/|manifest.json|sw.js).*)"],
};
