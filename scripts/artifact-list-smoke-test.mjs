import fs from "node:fs";

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ${message}`);
    process.exit(1);
  }
  console.log(`✅ ${message}`);
}

const chat = fs.readFileSync("components/chat.tsx", "utf8");
const list = fs.readFileSync("components/chat/artifact-list.tsx", "utf8");

assert(list.includes("export function ArtifactList"), "artifact list component exists");
assert(list.includes("saved-artifact-list"), "artifact list owns list container class");
assert(list.includes("saved-artifact-item--active"), "artifact list preserves active artifact class");
assert(list.includes("onSelectArtifact(artifact.id)"), "artifact list preserves artifact selection callback");
assert(list.includes("{artifact.mimeType} · {artifact.bytes} bytes"), "artifact list preserves artifact metadata rendering");
assert(chat.includes("<ArtifactList artifacts={artifacts}"), "chat renders extracted artifact list");
assert(!chat.includes("artifacts.map((artifact) =>"), "chat no longer maps artifact list inline");
assert(!chat.includes("saved-artifact-item--active"), "chat no longer owns active artifact row class inline");
console.log("✅ Artifact list smoke test passed.");
