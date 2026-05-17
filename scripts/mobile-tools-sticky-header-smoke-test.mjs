import fs from "node:fs";

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ${message}`);
    process.exit(1);
  }
  console.log(`✅ ${message}`);
}

const css = fs.readFileSync("app/globals.css", "utf8");
const chat = fs.readFileSync("components/chat.tsx", "utf8");

assert(chat.includes("mobile-tools-titlebar"), "mobile titlebar class exists in drawer markup");
assert(chat.includes("mobile-tools-tile-board"), "mobile tile board class exists in drawer markup");
assert(css.includes(".mobile-tools-titlebar"), "mobile titlebar CSS exists");
assert(css.includes("position: sticky !important"), "mobile titlebar is explicitly sticky");
assert(css.includes("top: 0 !important"), "mobile sticky titlebar anchors to top of drawer");
assert(css.includes("z-index: 24 !important"), "mobile sticky titlebar stays above content");
assert(css.includes("margin: -12px -12px 8px !important"), "mobile titlebar reserves space below sticky header");
assert(css.includes("background: rgba(255, 255, 255, 0.94) !important"), "mobile titlebar background is opaque enough over content");
assert(css.includes("box-shadow: 0 14px 28px"), "mobile titlebar has separation shadow");
assert(css.includes("scroll-padding-top: 88px"), "mobile tile board has scroll padding for sticky header");
assert(css.includes(".mobile-tools-titlebar::after"), "mobile titlebar fade spacer exists");
assert(css.includes("pointer-events: none"), "titlebar fade spacer does not block taps");

console.log("✅ Mobile Tools sticky header smoke test passed.");
