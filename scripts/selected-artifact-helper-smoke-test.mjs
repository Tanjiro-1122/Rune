import fs from "node:fs";

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ${message}`);
    process.exit(1);
  }
  console.log(`✅ ${message}`);
}

const chat = fs.readFileSync("components/chat.tsx", "utf8");
const helpers = fs.readFileSync("components/chat/attachment-artifacts.ts", "utf8");

assert(helpers.includes("export function getSelectedArtifact"), "selected artifact helper lives in artifact module");
assert(helpers.includes("export function getNextArtifactPreviewId"), "artifact preview id helper lives in artifact module");
assert(chat.includes("getSelectedArtifact(artifacts, artifactPreviewId)"), "chat uses selected artifact helper");
assert(chat.includes("getNextArtifactPreviewId(artifacts, artifactPreviewId)"), "chat uses artifact preview id helper");
assert(!chat.includes("artifacts.find((artifact) => artifact.id === artifactPreviewId)"), "chat no longer selects artifact inline");
assert(!chat.includes("artifacts.some((artifact) => artifact.id === artifactPreviewId)"), "chat no longer validates artifact preview id inline");
console.log("✅ Selected artifact helper smoke test passed.");
