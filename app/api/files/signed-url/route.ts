import { NextRequest, NextResponse } from "next/server";
import { resolveOwnerSessionId } from "@/lib/owner-session";
import { z } from "zod";
import { getSupabaseClient } from "@/lib/supabase";
import { logActionEvent } from "@/lib/action-events";
import { logError } from "@/lib/errors";
import { assertWorkspaceAccess } from "@/lib/workspaces";

const SIGNED_URL_SECONDS = Number(process.env.RUNE_UPLOAD_SIGNED_URL_SECONDS || 60 * 60 * 24 * 7);

const SignedUrlSchema = z.object({
  projectFileId: z.string().uuid(),
  workspaceId: z.string().uuid().optional().nullable(),
  conversationId: z.string().uuid().optional().nullable(),
  sessionId: z.string().max(160).optional().nullable(),
});

export async function POST(req: NextRequest) {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase is not configured. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel." },
      { status: 503 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = SignedUrlSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid file request.", details: parsed.error.flatten() }, { status: 400 });
  }

  const { projectFileId, workspaceId, conversationId, sessionId: clientSessionId } = parsed.data;
  const sessionId = await resolveOwnerSessionId(req, clientSessionId);

  // Guard: if a workspaceId was provided, verify the caller owns it before returning any file URL.
  if (workspaceId && sessionId) {
    try {
      await assertWorkspaceAccess({ sessionId, workspaceId, requiredRole: "viewer" });
    } catch {
      return NextResponse.json({ error: "Workspace access denied." }, { status: 403 });
    }
  }

  try {
    let request = supabase
      .from("workspace_project_files")
      .select("id, workspace_id, conversation_id, display_name, storage_bucket, storage_path, public_url, mime_type, bytes")
      .eq("id", projectFileId)
      .limit(1);

    if (workspaceId) request = request.eq("workspace_id", workspaceId);

    const { data, error } = await request.single();
    if (error || !data) {
      return NextResponse.json({ error: "Stored file was not found." }, { status: 404 });
    }

    const bucket = data.storage_bucket;
    const storagePath = data.storage_path;

    if (!bucket || !storagePath) {
      if (data.public_url) {
        return NextResponse.json({
          url: data.public_url,
          expiresIn: null,
          name: data.display_name,
          mimeType: data.mime_type,
          bytes: data.bytes,
          fallback: true,
        });
      }
      return NextResponse.json({ error: "This file does not have storage metadata yet." }, { status: 409 });
    }

    const { data: signed, error: signedError } = await supabase.storage
      .from(bucket)
      .createSignedUrl(storagePath, SIGNED_URL_SECONDS);

    if (signedError || !signed?.signedUrl) {
      throw signedError ?? new Error("Supabase did not return a signed URL.");
    }

    await supabase
      .from("workspace_project_files")
      .update({ public_url: signed.signedUrl, updated_at: new Date().toISOString() })
      .eq("id", projectFileId);

    await logActionEvent({
      eventType: "workspace_file.signed_url_created",
      summary: `Opened stored file: ${data.display_name}`,
      status: "info",
      approvalStage: "none",
      riskLevel: "low",
      projectKey: "rune",
      sessionId: sessionId ?? null,
      workspaceId: data.workspace_id ?? workspaceId ?? null,
      conversationId: data.conversation_id ?? conversationId ?? null,
      metadata: { projectFileId, bucket, storagePath, expiresIn: SIGNED_URL_SECONDS },
    });

    return NextResponse.json({
      url: signed.signedUrl,
      expiresIn: SIGNED_URL_SECONDS,
      name: data.display_name,
      mimeType: data.mime_type,
      bytes: data.bytes,
      fallback: false,
    });
  } catch (error) {
    logError("files.signedUrl", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create file link." },
      { status: 500 }
    );
  }
}
