import fs from "node:fs";

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ${message}`);
    process.exit(1);
  }
  console.log(`✅ ${message}`);
}

const chat = fs.readFileSync("components/chat.tsx", "utf8");
const inputBar = fs.readFileSync("components/chat/chat-input-bar.tsx", "utf8");
const prep = fs.readFileSync("components/chat/attachment-prep.ts", "utf8");

assert(prep.includes("export const ACCEPTED_ATTACHMENT_TYPES"), "accepted attachment types live in shared prep module");
assert(prep.includes("export const MAX_ATTACHMENT_FILE_SIZE_MB = 10"), "max attachment file size lives in shared prep module");
assert(prep.includes("export function validateAttachmentFiles"), "file validation lives in shared prep module");
assert(prep.includes("export function splitImageAndPassthroughFiles"), "image/text split helper lives in shared prep module");
assert(chat.includes('./chat/attachment-prep'), "chat imports shared attachment prep helpers");
assert(inputBar.includes('./attachment-prep'), "split input bar imports shared attachment prep constants");
assert(!chat.includes("function validateFiles"), "chat no longer defines file validation inline");
assert(!chat.includes("const ACCEPTED_TYPES = ["), "chat no longer owns accepted attachment types inline");
assert(!inputBar.includes("export const ACCEPTED_TYPES = ["), "split input bar no longer duplicates accepted attachment types inline");
assert(chat.includes("validateAttachmentFiles(selected)"), "active file input uses shared validation helper");
assert(chat.includes("splitImageAndPassthroughFiles(fileList)"), "active upload prep uses shared image/text splitter");
assert(chat.includes("credentials: \"include\""), "active upload path still uses authenticated upload calls");
console.log("✅ Attachment prep decomposition smoke test passed.");
