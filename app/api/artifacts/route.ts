import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { saveArtifact, getConversationArtifacts } from "@/lib/db";
import { logError } from "@/lib/errors";

// 200 KB is generous for text-based artifacts while keeping the endpoint safe.
const MAX_ARTIFACT_CONTENT_LENGTH = 200_000;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const saveArtifactSchema = z.object({
  conversationId: z.string().regex(UUID_RE, "conversationId must be a UUID"),
  name: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(100),
  content: z.string().max(MAX_ARTIFACT_CONTENT_LENGTH),
  bytes: z.number().int().nonnegative(),
});

// ─── GET /api/artifacts?conversationId=<uuid> ─────────────────────────────────

export async function GET(req: NextRequest) {
  const conversationId = req.nextUrl.searchParams.get("conversationId");

  if (!conversationId) {
    return NextResponse.json(
      { error: "conversationId query parameter is required." },
      { status: 400 }
    );
  }

  if (!UUID_RE.test(conversationId)) {
    return NextResponse.json(
      { error: "Invalid conversationId format." },
      { status: 400 }
    );
  }

  const artifacts = await getConversationArtifacts(conversationId);
  return NextResponse.json({ artifacts });
}

// ─── POST /api/artifacts ──────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = saveArtifactSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid artifact data.", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { conversationId, name, mimeType, content, bytes } = parsed.data;

  const saved = await saveArtifact(conversationId, {
    name,
    mimeType,
    content,
    bytes,
  });

  if (!saved) {
    logError("api.artifacts.POST", new Error("saveArtifact returned null"));
    return NextResponse.json(
      { error: "Failed to persist artifact. Supabase may not be configured." },
      { status: 500 }
    );
  }

  return NextResponse.json({ artifact: saved }, { status: 201 });
}
