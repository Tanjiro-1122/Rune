import { NextRequest, NextResponse } from "next/server";
import { computeToken, safeEqual } from "@/lib/auth";

const SESSION_COOKIE = "jarvis_session";

async function verifyToken(token: string): Promise<boolean> {
  const secret = process.env.AUTH_SECRET;
  if (!secret) return false;
  const expected = await computeToken(secret);
  return safeEqual(token, expected);
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow login page and auth API routes through
  if (pathname.startsWith("/login") || pathname.startsWith("/api/auth")) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;

  if (!token || !(await verifyToken(token))) {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
