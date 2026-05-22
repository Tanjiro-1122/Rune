import fs from "node:fs";

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ${message}`);
    process.exit(1);
  }
  console.log(`✅ ${message}`);
}

const chat = fs.readFileSync("components/chat.tsx", "utf8");
const input = fs.readFileSync("components/chat/chat-input-bar.tsx", "utf8");
const helpers = fs.readFileSync("components/chat/clipboard-helpers.ts", "utf8");

assert(chat.includes("pastedAttachments") && chat.includes("setPastedAttachments"), "parent chat tracks pasted screenshots as attachments");
assert(chat.includes("setPastedAttachments((prev) => [...prev, attachment])"), "paste upload creates sendable attachment");
assert(chat.includes("hasPastedAttachments") && chat.includes("hasAnyAttachments"), "submit guard allows screenshot-only messages");
assert(chat.includes("experimental_attachments: safeAttachments.length > 0 ? safeAttachments : safeFileAttachments"), "submitted message includes pasted attachments");
assert(chat.includes("allowEmptySubmit: hasAnyAttachments && !input.trim()"), "empty screenshot-only submit is explicitly allowed");
assert(chat.includes("setPastedAttachments([])"), "clear attachments removes pasted screenshot state");
assert(input.includes("hasPastedAttachments") && input.includes("pastedAttachments.length === 0"), "split input bar also allows pasted-attachment-only submit");

assert(chat.includes("insertPastedTextAtCursor") && chat.includes("getClipboardPlainText") && helpers.includes('getData("text/plain")'), "parent chat manually inserts pasted text");
assert(chat.includes("onPaste={handleChatPaste}"), "parent textarea uses reliable paste handler");
assert(input.includes("insertPastedTextAtCursor") && input.includes("getClipboardPlainText") && helpers.includes('getData("text/plain")'), "split input bar manually inserts pasted text");
assert(input.includes("onPaste={handleChatPaste}"), "split input bar uses reliable paste handler");
console.log("✅ Pasted screenshot submit smoke test passed.");
