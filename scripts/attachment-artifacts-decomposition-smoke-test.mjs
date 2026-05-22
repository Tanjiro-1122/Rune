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

for (const name of ["buildArtifactDownloadHref", "getDocumentKindLabel", "getSafeAttachmentImageUrl"]) {
  assert(helpers.includes(`export function ${name}`), `${name} lives in attachment/artifact helper module`);
  assert(!chat.includes(`function ${name}`), `${name} is not defined inline in chat.tsx`);
}
assert(chat.includes('./chat/attachment-artifacts'), "chat imports attachment/artifact helpers");
assert(helpers.includes('allowedProtocols: Array<"blob:" | "https:">'), "attachment image URL helper keeps protocol allow-list");
assert(helpers.includes("encodeURIComponent(artifact.content)"), "artifact download href safely encodes content");
console.log("✅ Attachment/artifact helper decomposition smoke test passed.");
