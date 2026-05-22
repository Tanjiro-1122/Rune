export type DownloadableArtifact = {
  mimeType: string;
  content: string;
};

export function buildArtifactDownloadHref(artifact: DownloadableArtifact) {
  return `data:${artifact.mimeType};charset=utf-8,${encodeURIComponent(artifact.content)}`;
}

export function getDocumentKindLabel(sourceKind: string) {
  return sourceKind === "artifact" ? "Artifact" : sourceKind === "upload" ? "Upload" : "Context";
}

export function getSafeAttachmentImageUrl(
  url: string | undefined,
  allowedProtocols: Array<"blob:" | "https:">
) {
  if (!url) return undefined;

  try {
    const parsed = new URL(url);
    return allowedProtocols.some((protocol) => parsed.protocol === protocol) ? url : undefined;
  } catch {
    return undefined;
  }
}
