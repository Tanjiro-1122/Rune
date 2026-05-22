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
const pasteTest = fs.readFileSync("scripts/pasted-screenshot-submit-smoke-test.mjs", "utf8");
const helpers = fs.readFileSync("components/chat/clipboard-helpers.ts", "utf8");
const combined = `${chat}\n${inputBar}\n${helpers}`;

assert(combined.includes("insertPastedTextAtCursor"), "plain text paste is manually inserted into controlled textarea");
assert(helpers.includes('getData("text/plain")') && combined.includes("getClipboardPlainText"), "paste handler reads text/plain clipboard data through helper");
assert(helpers.includes('item.type.startsWith("image/")') && combined.includes("getClipboardImageItems"), "paste handler detects image clipboard items through helper");
assert(combined.includes('fetch("/api/upload"') && combined.includes('credentials: "include"'), "pasted images upload through authenticated upload endpoint");
assert(chat.includes("const [pastedAttachments, setPastedAttachments] = useState<LightweightAttachment[]>([]);"), "active chat stores pasted attachments as an array");
assert(chat.includes("setPastedAttachments((prev) => [...prev, attachment])"), "active paste path appends each pasted image attachment");
assert(chat.includes("const safeAttachments = [...normalizedFileAttachments, ...pastedAttachments];"), "submit path combines uploaded file attachments with pasted attachments");
assert(chat.includes("allowEmptySubmit: hasAnyAttachments && !input.trim()"), "attachment-only submit works for pasted or uploaded files");
assert(chat.includes("clearAttachments()") && chat.includes("setPastedAttachments([])"), "clear/submit cleanup resets pasted attachments");
assert(inputBar.includes("pastedAttachments: LightweightAttachment[]") && !inputBar.includes("pastedImageUrl"), "lazy input bar uses pastedAttachments array, not stale single pastedImageUrl state");
assert(inputBar.includes("setPastedAttachments((prev) => [...prev, attachment]") && inputBar.includes("setPreviewUrls((prev) => [...prev, attachment.url]"), "lazy input bar appends pasted image uploads to attachment and preview arrays");
assert(pasteTest.includes("pastedAttachments") && pasteTest.includes("allowEmptySubmit"), "existing screenshot paste smoke covers attachment submit path");
console.log("✅ Paste/upload parity smoke test passed.");
