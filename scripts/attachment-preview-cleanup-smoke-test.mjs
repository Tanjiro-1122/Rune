import fs from "node:fs";

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ${message}`);
    process.exit(1);
  }
  console.log(`✅ ${message}`);
}

const chat = fs.readFileSync("components/chat.tsx", "utf8");
const prep = fs.readFileSync("components/chat/attachment-prep.ts", "utf8");

assert(prep.includes("export function revokeAttachmentPreviewUrls"), "preview URL revoke helper lives in attachment prep module");
assert(prep.includes("export function createAttachmentPreviewUrls"), "preview URL creation helper lives in attachment prep module");
assert(prep.includes("URL.revokeObjectURL(url)"), "revoke helper still uses URL.revokeObjectURL");
assert(prep.includes("URL.createObjectURL(file)"), "preview helper still uses URL.createObjectURL");
assert(chat.includes("revokeAttachmentPreviewUrls(previewUrls)"), "chat uses shared preview revoke helper");
assert(chat.includes("createAttachmentPreviewUrls(selected)"), "chat uses shared preview creation helper");
assert(!chat.includes("URL.revokeObjectURL") && !chat.includes("URL.createObjectURL"), "chat no longer owns object URL browser calls inline");
console.log("✅ Attachment preview cleanup smoke test passed.");
