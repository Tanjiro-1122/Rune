import { NextRequest, NextResponse } from "next/server";
import { computeToken, getSessionSecret, safeEqual, SESSION_COOKIE } from "@/lib/auth";

async function verifyToken(cookieValue: string, secret: string): Promise<boolean> {
  const dotIndex = cookieValue.indexOf(".");
  if (dotIndex === -1) return false; // legacy fixed-token format — reject
  const nonce = cookieValue.slice(0, dotIndex);
  const provided = cookieValue.slice(dotIndex + 1);
  if (!nonce || !provided) return false;
  const expected = await computeToken(secret, nonce);
  return safeEqual(provided, expected);
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow login page and auth API routes through
  if (pathname.startsWith("/login") || pathname.startsWith("/api/auth")) {
    return NextResponse.next();
  }

  // Allow the private memory seed endpoint when a seed token is configured and
  // supplied. This keeps curl-based setup possible without exposing the route.
  if (pathname.startsWith("/api/memory/seed")) {
    const seedToken = process.env.JARVIS_MEMORY_SEED_TOKEN;
    const provided =
      request.headers.get("x-jarvis-seed-token") ??
      request.nextUrl.searchParams.get("token");
    if (seedToken && provided === seedToken) {
      return NextResponse.next();
    }
  }

  // Local development can run open for quick setup. Production must never run
  // without a signed session secret, otherwise the workspace would be exposed.
  const secret = getSessionSecret();
  if (!secret) {
    if (process.env.NODE_ENV !== "production") {
      return NextResponse.next();
    }

    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "Jarvis authentication is not configured. Set SESSION_SECRET." },
        { status: 503 }
      );
    }

    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("setup", "missing-session-secret");
    return NextResponse.redirect(loginUrl);
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;

  if (!token || !(await verifyToken(token, secret))) {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
