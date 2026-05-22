export const ACCEPTED_ATTACHMENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "text/plain",
  "text/csv",
  "text/markdown",
];

export const MAX_ATTACHMENT_FILE_SIZE_MB = 10;
export const MAX_ATTACHMENT_FILE_SIZE = MAX_ATTACHMENT_FILE_SIZE_MB * 1024 * 1024;

export function validateAttachmentFiles(fileList: FileList): string {
  for (const file of Array.from(fileList)) {
    if (file.size > MAX_ATTACHMENT_FILE_SIZE) {
      return `"${file.name}" exceeds the ${MAX_ATTACHMENT_FILE_SIZE_MB} MB limit.`;
    }
    if (!ACCEPTED_ATTACHMENT_TYPES.includes(file.type)) {
      return `"${file.name}" type not supported. Accepted: images (JPEG, PNG, GIF, WEBP) and text files.`;
    }
  }
  return "";
}

export function splitImageAndPassthroughFiles(fileList: FileList) {
  const selectedFiles = Array.from(fileList);
  const imageFiles = selectedFiles.filter((file) => file.type.startsWith("image/"));
  const passthroughFiles = selectedFiles.filter((file) => !file.type.startsWith("image/"));
  return { selectedFiles, imageFiles, passthroughFiles };
}

export type UploadResponsePayload = {
  url?: string;
  name?: string;
  mimeType?: string;
  size?: number;
  error?: string;
};

export type ChatUploadAttachment = {
  name: string;
  contentType: string;
  url: string;
};

export type InputBarUploadAttachment = {
  url: string;
  name: string;
  mimeType: string;
  size: number;
};

export function requireUploadUrl(payload: UploadResponsePayload, status: number) {
  if (!payload.url) {
    throw new Error(payload.error ?? `Upload failed with status ${status}`);
  }
  return payload.url;
}

export function normalizeChatUploadAttachment(options: {
  payload: UploadResponsePayload;
  file: File;
  fallbackName?: string;
  fallbackMimeType?: string;
}) {
  return {
    name: options.payload.name ?? options.file.name ?? options.fallbackName ?? "attachment",
    contentType: options.payload.mimeType ?? options.file.type ?? options.fallbackMimeType ?? "application/octet-stream",
    url: requireUploadUrl(options.payload, 200),
  } satisfies ChatUploadAttachment;
}

export function normalizeInputBarUploadAttachment(options: {
  payload: UploadResponsePayload;
  file: File;
  fallbackName?: string;
  fallbackMimeType?: string;
}) {
  return {
    url: requireUploadUrl(options.payload, 200),
    name: options.payload.name ?? options.file.name ?? options.fallbackName ?? "attachment",
    mimeType: options.payload.mimeType ?? options.file.type ?? options.fallbackMimeType ?? "application/octet-stream",
    size: options.payload.size ?? options.file.size,
  } satisfies InputBarUploadAttachment;
}
