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

assert(drawer.includes("export function ArtifactDrawerSection"), "artifact drawer section component exists");
assert(drawer.includes("ArtifactList") && drawer.includes("ArtifactPreviewCard"), "artifact drawer composes list and preview card");
assert(drawer.includes("Generated files now persist per workspace"), "artifact drawer preserves explanatory copy");
assert(drawer.includes("createArtifact(...)"), "artifact drawer preserves empty-state copy");
assert(chat.includes("<ArtifactDrawerSection artifacts={artifacts}"), "chat renders extracted artifact drawer section");
assert(!chat.includes("<ArtifactList artifacts={artifacts}"), "chat no longer renders artifact list inline");
assert(!chat.includes("<ArtifactPreviewCard artifact={selectedArtifact}"), "chat no longer renders artifact preview inline");
assert(!chat.includes("Generated files now persist per workspace"), "chat no longer owns artifact drawer copy inline");
console.log("✅ Artifact drawer section smoke test passed.");
