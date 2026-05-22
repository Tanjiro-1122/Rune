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
