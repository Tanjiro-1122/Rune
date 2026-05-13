import { NextRequest, NextResponse } from "next/server";
import { computeToken, safeEqual } from "@/lib/auth";

const SESSION_COOKIE = "jarvis_session";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

export async function POST(req: NextRequest) {
  let password: unknown;
  try {
    const body = await req.json();
    password = body?.password;
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  if (typeof password !== "string" || !password) {
    return NextResponse.json({ error: "Password is required." }, { status: 400 });
  }

  const appPassword = process.env.APP_PASSWORD;
  const authSecret = process.env.AUTH_SECRET;

  if (!appPassword || !authSecret) {
    return NextResponse.json(
      { error: "Server is not configured for authentication." },
      { status: 500 }
    );
  }

  if (!safeEqual(password, appPassword)) {
    return NextResponse.json({ error: "Invalid password." }, { status: 401 });
  }

  const token = await computeToken(authSecret);

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: COOKIE_MAX_AGE,
    path: "/",
  });

  return response;
}
