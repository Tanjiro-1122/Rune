"use client";

import { buildArtifactDownloadHref } from "./attachment-artifacts";

export type ArtifactPreviewCardArtifact = {
  name: string;
  mimeType: string;
  content: string;
  createdAt: string;
};

type ArtifactPreviewCardProps = {
  artifact: ArtifactPreviewCardArtifact;
  formatTimestamp: (value: string) => string;
};

export function ArtifactPreviewCard({ artifact, formatTimestamp }: ArtifactPreviewCardProps) {
  return (
    <div className="artifact-preview-card">
      <div className="artifact-card-header">
        <span>{artifact.name}</span>
        <a
          className="artifact-link"
          href={buildArtifactDownloadHref(artifact)}
          download={artifact.name}
        >
          Download
        </a>
      </div>
      <div className="artifact-meta">
        Saved {formatTimestamp(artifact.createdAt)}
      </div>
      <pre className="execution-output">
        <code>{artifact.content}</code>
      </pre>
    </div>
  );
}
