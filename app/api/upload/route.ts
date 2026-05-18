import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";
import { logActionEvent } from "@/lib/action-events";
import { logError } from "@/lib/errors";
import { resolveOwnerSessionId } from "@/lib/owner-session";

const MAX_UPLOAD_BYTES = Number(process.env.RUNE_MAX_UPLOAD_BYTES || 8 * 1024 * 1024);
const DEFAULT_BUCKET = "rune-uploads";
const SIGNED_URL_SECONDS = Number(process.env.RUNE_UPLOAD_SIGNED_URL_SECONDS || 60 * 60 * 24 * 7);
const SAFE_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

function cleanText(value: unknown, maxChars = 500) {
  const text = String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
}

function safeFileName(value: string) {
  const cleaned = value
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  return cleaned || "upload.png";
}

function extensionFor(type: string, fallbackName: string) {
  const fromName = fallbackName.match(/\.[a-z0-9]{2,5}$/i)?.[0];
  if (fromName) return fromName.toLowerCase();
  if (type === "image/jpeg") return ".jpg";
  if (type === "image/webp") return ".webp";
  if (type === "image/gif") return ".gif";
  return ".png";
}

async function ensureBucket(bucket: string) {
  const supabase = getSupabaseClient();
  if (!supabase) return { ok: false, error: "Supabase is not configured. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel." };

  const { data: buckets, error: listError } = await supabase.storage.listBuckets();
  if (listError) return { ok: false, error: listError.message };
  if (buckets?.some((item) => item.name === bucket)) return { ok: true, supabase };

  const { error: createError } = await supabase.storage.createBucket(bucket, {
    public: false,
    fileSizeLimit: MAX_UPLOAD_BYTES,
    allowedMimeTypes: Array.from(SAFE_IMAGE_TYPES),
  });
  if (createError) return { ok: false, error: createError.message };
  return { ok: true, supabase };
}

export async function POST(req: NextRequest) {
  const bucket = process.env.RUNE_UPLOAD_BUCKET || DEFAULT_BUCKET;
  const configured = await ensureBucket(bucket);
  if (!configured.ok || !configured.supabase) {
    return NextResponse.json(
      { error: configured.error ?? "Image upload storage is not configured." },
      { status: 503 }
    );
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid upload form data." }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Upload requires a file." }, { status: 400 });
  }
  if (!SAFE_IMAGE_TYPES.has(file.type)) {
    return NextResponse.json({ error: "Only PNG, JPEG, WebP, or GIF images can be uploaded here." }, { status: 415 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: `File is too large. Limit is ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB.` }, { status: 413 });
  }

  const workspaceId = cleanText(formData.get("workspaceId"), 120) || null;
  const conversationId = cleanText(formData.get("conversationId"), 120) || null;
  const clientSessionId = cleanText(formData.get("sessionId"), 160) || null;
  const sessionId = await resolveOwnerSessionId(req, clientSessionId);
  const originalName = safeFileName(file.name || `pasted-screenshot${extensionFor(file.type, file.name || "")}`);
  const ext = extensionFor(file.type, originalName);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const scope = workspaceId || sessionId || "general";
  const storagePath = `${scope}/uploads/${timestamp}-${crypto.randomUUID()}${ext}`;

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const { error: uploadError } = await configured.supabase.storage
      .from(bucket)
      .upload(storagePath, buffer, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadError) throw uploadError;

    const { data: signed, error: signedError } = await configured.supabase.storage
      .from(bucket)
      .createSignedUrl(storagePath, SIGNED_URL_SECONDS);
    if (signedError) throw signedError;

    let projectFileId: string | null = null;
    if (workspaceId) {
      const displayName = originalName;
      const path = `uploads/${timestamp}-${crypto.randomUUID()}-${displayName}`;
      const { data: projectFile, error: projectFileError } = await configured.supabase
        .from("workspace_project_files")
        .upsert(
          {
            workspace_id: workspaceId,
            conversation_id: conversationId,
            path,
            display_name: displayName,
            source_kind: "upload",
            mime_type: file.type,
            bytes: file.size,
            summary: `Image upload stored in Supabase Storage: ${storagePath}`,
            storage_bucket: bucket,
            storage_path: storagePath,
            public_url: signed.signedUrl,
            metadata: { originalName, uploadedAt: new Date().toISOString(), signedUrlExpiresIn: SIGNED_URL_SECONDS },
            updated_at: new Date().toISOString(),
          },
          { onConflict: "workspace_id,path" }
        )
        .select("id")
        .single();

      if (projectFileError) {
        logError("upload.projectFile", projectFileError);
      } else {
        projectFileId = projectFile?.id ?? null;
      }
    }

    await logActionEvent({
      eventType: "workspace_file.uploaded",
      summary: `Uploaded image: ${originalName}`,
      status: "info",
      approvalStage: "none",
      riskLevel: "low",
      projectKey: "rune",
      sessionId,
      workspaceId,
      conversationId,
      metadata: { bucket, storagePath, mimeType: file.type, bytes: file.size, projectFileId },
    });

    return NextResponse.json({
      url: signed.signedUrl,
      storagePath,
      bucket,
      name: originalName,
      mimeType: file.type,
      bytes: file.size,
      projectFileId,
    });
  } catch (error) {
    logError("upload.image", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to upload image." },
      { status: 500 }
    );
  }
}
