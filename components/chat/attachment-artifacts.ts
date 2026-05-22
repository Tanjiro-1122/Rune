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

export type SelectableArtifact = {
  id: string;
};

export function getSelectedArtifact<TArtifact extends SelectableArtifact>(
  artifacts: TArtifact[],
  selectedArtifactId: string | null
) {
  return artifacts.find((artifact) => artifact.id === selectedArtifactId) ?? artifacts[0] ?? null;
}

export function getNextArtifactPreviewId<TArtifact extends SelectableArtifact>(
  artifacts: TArtifact[],
  selectedArtifactId: string | null
) {
  if (!artifacts.length) return null;
  if (!selectedArtifactId || !artifacts.some((artifact) => artifact.id === selectedArtifactId)) return artifacts[0].id;
  return selectedArtifactId;
}
