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

assert(prep.includes("export type UploadResponsePayload"), "upload response payload type lives in attachment prep module");
assert(prep.includes("export function requireUploadUrl"), "upload URL guard lives in attachment prep module");
assert(prep.includes("export function normalizeChatUploadAttachment"), "active chat upload normalizer lives in attachment prep module");
assert(prep.includes("export function normalizeInputBarUploadAttachment"), "split input bar upload normalizer lives in attachment prep module");
assert(chat.includes("normalizeChatUploadAttachment"), "active chat uses upload response normalizer");
assert(inputBar.includes("normalizeInputBarUploadAttachment"), "split input bar uses upload response normalizer");
assert(!chat.includes("contentType: data.mimeType") && !chat.includes("contentType: payload.mimeType"), "active chat no longer hand-builds contentType from upload payload inline");
assert(!inputBar.includes("mimeType: data.mimeType") && !inputBar.includes("size: data.size"), "split input bar no longer hand-builds mimeType/size from upload payload inline");
assert(chat.includes("credentials: \"include\"") && inputBar.includes("credentials: \"include\""), "upload calls remain authenticated");
console.log("✅ Upload response normalization smoke test passed.");
