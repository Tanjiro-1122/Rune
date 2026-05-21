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

assert(chat.includes("pastedAttachments") && chat.includes("setPastedAttachments"), "parent chat tracks pasted screenshots as attachments");
assert(chat.includes("setPastedAttachments((prev) => [...prev, attachment])"), "paste upload creates sendable attachment");
assert(chat.includes("hasPastedAttachments") && chat.includes("hasAnyAttachments"), "submit guard allows screenshot-only messages");
assert(chat.includes("experimental_attachments: safeAttachments.length > 0 ? safeAttachments : safeFileAttachments"), "submitted message includes pasted attachments");
assert(chat.includes("allowEmptySubmit: hasAnyAttachments && !input.trim()"), "empty screenshot-only submit is explicitly allowed");
assert(chat.includes("setPastedAttachments([])"), "clear attachments removes pasted screenshot state");
assert(input.includes("hasPastedImage") && input.includes("!pastedImageUrl"), "split input bar also allows pasted-image-only submit");
console.log("✅ Pasted screenshot submit smoke test passed.");
