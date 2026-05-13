import { NextRequest, NextResponse } from "next/server";
import { computeToken, getSessionSecret, safeEqual } from "@/lib/auth";

const SESSION_COOKIE = "jarvis_session";

async function verifyToken(token: string, secret: string): Promise<boolean> {
  const expected = await computeToken(secret);
  return safeEqual(token, expected);
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow login page and auth API routes through
  if (pathname.startsWith("/login") || pathname.startsWith("/api/auth")) {
    return NextResponse.next();
  }

  // If SESSION_SECRET is not configured the app runs in open/local mode —
  // authentication is not enforced, so all routes are passed through.
  // This lets the local single-session workspace flow work without requiring
  // APP_PASSWORD + SESSION_SECRET to be set.
  const secret = getSessionSecret();
  if (!secret) {
    return NextResponse.next();
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
