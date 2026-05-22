import fs from "node:fs";

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ${message}`);
    process.exit(1);
  }
  console.log(`✅ ${message}`);
}

const chat = fs.readFileSync("components/chat.tsx", "utf8");
const drawer = fs.readFileSync("components/chat/artifact-drawer-section.tsx", "utf8");
const card = fs.readFileSync("components/chat/artifact-preview-card.tsx", "utf8");

assert(card.includes("export function ArtifactPreviewCard"), "artifact preview card component exists");
assert(card.includes("buildArtifactDownloadHref(artifact)"), "artifact preview card owns download href rendering");
assert(card.includes("download={artifact.name}"), "artifact preview card preserves download filename");
assert(card.includes("formatTimestamp(artifact.createdAt)"), "artifact preview card preserves saved timestamp formatting");
assert(card.includes("<code>{artifact.content}</code>"), "artifact preview card preserves artifact content rendering");
assert(drawer.includes("<ArtifactPreviewCard artifact={selectedArtifact} formatTimestamp={formatTimestamp} />"), "artifact drawer renders extracted artifact preview card");
assert(chat.includes("<ArtifactDrawerSection artifacts={artifacts}"), "chat renders artifact drawer that owns the artifact preview card");
assert(!chat.includes("buildArtifactDownloadHref(selectedArtifact)"), "chat no longer builds selected artifact download href inline");
assert(!chat.includes('className="artifact-preview-card"'), "chat no longer owns artifact preview card markup inline");
console.log("✅ Artifact preview card smoke test passed.");
