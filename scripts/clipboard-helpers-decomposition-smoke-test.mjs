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
const helpers = fs.readFileSync("components/chat/clipboard-helpers.ts", "utf8");

assert(helpers.includes("export function buildPastedTextValue") && helpers.includes("export function applyPastedTextToTextarea"), "pasted text value/cursor math lives in clipboard helper");
assert(helpers.includes("export function getClipboardImageItems"), "clipboard image filtering lives in clipboard helper");
assert(helpers.includes("export function getClipboardPlainText"), "clipboard plain text read lives in clipboard helper");
assert(chat.includes('./chat/clipboard-helpers'), "active chat imports clipboard helpers");
assert(inputBar.includes('./clipboard-helpers'), "split input bar imports clipboard helpers");
assert(!chat.includes("const items = Array.from(e.clipboardData?.items") && !inputBar.includes("const items = Array.from(e.clipboardData?.items"), "clipboard item array/filtering is not duplicated inline");
assert(!chat.includes('e.clipboardData?.getData("text/plain")') && !inputBar.includes('e.clipboardData?.getData("text/plain")'), "plain text clipboard reads use helper");
assert(chat.includes("applyPastedTextToTextarea({") && inputBar.includes("applyPastedTextToTextarea({"), "both paste text paths use shared cursor/value helper");
assert(chat.includes("getClipboardImageItems(e.clipboardData?.items)") && inputBar.includes("getClipboardImageItems(e.clipboardData?.items)"), "both paste image paths use shared image item helper");
assert(chat.includes("credentials: \"include\""), "active pasted image upload remains authenticated");
console.log("✅ Clipboard helper decomposition smoke test passed.");
