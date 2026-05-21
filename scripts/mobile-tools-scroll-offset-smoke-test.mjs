import fs from "node:fs";

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ${message}`);
    process.exit(1);
  }
  console.log(`✅ ${message}`);
}

const css = ["app/chat-mobile.css", "app/operator.css", "app/ui-components.css", "app/globals.css"].map((file) => fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "").join("\n");
const chat = fs.readFileSync("components/chat.tsx", "utf8");

assert(chat.includes("mobileToolsTopRef"), "mobile top tile scroll ref still exists");
assert(chat.includes("mobileActiveDrawerRef"), "mobile active drawer scroll ref still exists");
assert(chat.includes("scrollIntoView"), "mobile drawer controls still use scrollIntoView");
assert(css.includes("scroll-padding-top: 96px"), "mobile drawer scroll padding top gives sticky header breathing room");
assert(css.includes("scroll-padding-bottom: calc(24px + env(safe-area-inset-bottom))"), "mobile drawer scroll padding respects bottom safe area");
assert(css.includes("padding: 0 2px calc(24px + env(safe-area-inset-bottom)) !important"), "mobile tile board has safe-area bottom padding");
assert(css.includes(".mobile-tools-top-tiles"), "mobile top tile grid CSS exists");
assert(css.includes("scroll-margin-top: 96px"), "mobile scroll targets have sticky-header scroll margin");
assert((css.match(/scroll-margin-top: 96px/g) || []).length >= 1, "mobile scroll targets receive sticky-header scroll margins");
assert(css.includes(".mobile-tools-active-label"), "mobile active drawer label CSS exists");

console.log("✅ Mobile Tools scroll offset smoke test passed.");
