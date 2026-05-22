"use client";

export type ArtifactListItem = {
  id: string;
  name: string;
  mimeType: string;
  bytes: number;
};

type ArtifactListProps = {
  artifacts: ArtifactListItem[];
  selectedArtifactId: string | null;
  onSelectArtifact: (artifactId: string) => void;
};

export function ArtifactList({ artifacts, selectedArtifactId, onSelectArtifact }: ArtifactListProps) {
  return (
    <div className="saved-artifact-list">
      {artifacts.map((artifact) => (
        <button
          key={artifact.id}
          type="button"
          className={`saved-artifact-item ${artifact.id === selectedArtifactId ? "saved-artifact-item--active" : ""}`}
          onClick={() => onSelectArtifact(artifact.id)}
        >
          <span className="saved-artifact-name">{artifact.name}</span>
          <span className="saved-artifact-meta">
            {artifact.mimeType} · {artifact.bytes} bytes
          </span>
        </button>
      ))}
    </div>
  );
}
