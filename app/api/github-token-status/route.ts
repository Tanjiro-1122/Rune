import { NextResponse } from "next/server";
import { Octokit } from "@octokit/rest";

export const maxDuration = 15;

export async function GET() {
  const token = process.env.GITHUB_TOKEN || process.env.RUNE_GITHUB_TOKEN || process.env.JARVIS_GITHUB_TOKEN;
  if (!token) {
    return NextResponse.json({ expiry: "no token", configured: false });
  }

  try {
    const octokit = new Octokit({ auth: token });
    // HEAD request to /user — check for fine-grained PAT expiry header
    const res = await octokit.request("GET /user");
    const expiryHeader =
      (res.headers as Record<string, string | undefined>)["github-authentication-token-expiration"] ?? null;

    if (!expiryHeader) {
      // Classic OAuth token or no-expiry fine-grained PAT
      return NextResponse.json({ expiry: "✓ no expiry", configured: true, expires_at: null });
    }

    // expiryHeader is like "2025-01-01 00:00:00 UTC"
    const expiresAt = new Date(expiryHeader);
    const now = Date.now();
    const diffMs = expiresAt.getTime() - now;

    if (diffMs <= 0) {
      return NextResponse.json({ expiry: "expired", configured: true, expires_at: expiryHeader });
    }

    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    const label = diffDays <= 1 ? `${Math.ceil(diffMs / (1000 * 60 * 60))}h` : `${diffDays}d`;

    return NextResponse.json({ expiry: label, configured: true, expires_at: expiryHeader });
  } catch (e: any) {
    return NextResponse.json({ expiry: "check failed", configured: false, error: String(e?.message ?? e) });
  }
}
