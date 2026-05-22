import fs from "node:fs";

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ${message}`);
    process.exit(1);
  }
  console.log(`✅ ${message}`);
}

const chat = fs.readFileSync("components/chat.tsx", "utf8");
const chips = fs.readFileSync("components/chat/follow-up-chips.tsx", "utf8");
assert(chips.includes("export function deriveFollowUpChips"), "follow-up derivation lives in extracted module");
assert(chips.includes("export function FollowUpChips"), "follow-up chip UI lives in extracted module");
assert(chat.includes("./chat/follow-up-chips"), "chat imports follow-up chips module");
assert(!chat.includes("function deriveFollowUpChips") && !chat.includes("function FollowUpChips"), "chat no longer defines follow-up chip logic inline");
console.log("✅ Follow-up chips decomposition smoke test passed.");
