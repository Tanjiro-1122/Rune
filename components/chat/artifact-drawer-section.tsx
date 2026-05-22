"use client";

import { ArtifactList, type ArtifactListItem } from "./artifact-list";
import { ArtifactPreviewCard, type ArtifactPreviewCardArtifact } from "./artifact-preview-card";

type ArtifactDrawerSectionProps = {
  artifacts: ArtifactListItem[];
  selectedArtifact: ArtifactPreviewCardArtifact | null;
  onSelectArtifact: (artifactId: string) => void;
  formatTimestamp: (value: string) => string;
};

export function ArtifactDrawerSection({
  artifacts,
  selectedArtifact,
  onSelectArtifact,
  formatTimestamp,
}: ArtifactDrawerSectionProps) {
  return (
    <div className="context-panel-section filing-cabinet-content">
      <div className="context-panel-header">
        <div>
          <div className="side-section-label">Artifacts</div>
          <p className="side-section-copy">Generated files now persist per workspace and can be downloaded later.</p>
        </div>
      </div>

      {artifacts.length ? (
        <>
          <ArtifactList artifacts={artifacts} selectedArtifactId={selectedArtifact?.id ?? null} onSelectArtifact={onSelectArtifact} />
          {selectedArtifact && <ArtifactPreviewCard artifact={selectedArtifact} formatTimestamp={formatTimestamp} />}
        </>
      ) : (
        <div className="context-empty">Run code that calls <code>createArtifact(...)</code> to keep a downloadable record in this workspace.</div>
      )}
    </div>
  );
}
