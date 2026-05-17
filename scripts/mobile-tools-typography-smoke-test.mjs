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

assert(chat.includes("mobile-tools-top-tile"), "mobile top tile class exists");
assert(css.includes(".mobile-tools-top-tile {"), "mobile top tile style exists");
assert(css.includes("display: flex !important"), "mobile top tiles use flex layout");
assert(css.includes("flex-direction: column !important"), "mobile top tile labels stack vertically");
assert(css.includes("align-items: flex-start !important"), "mobile top tile labels align left");
assert(css.includes("gap: 6px !important"), "mobile top tile label spacing exists");
assert(css.includes("text-align: left !important"), "mobile top tile text is left aligned");
assert(css.includes(".mobile-tools-top-tile span,"), "title and hint shared block style exists");
assert(css.includes("display: block !important"), "mobile tile title and hint are block elements");
assert(css.includes("width: 100% !important"), "mobile tile title and hint take full width");
assert(css.includes("line-height: 1.12"), "mobile tile title line-height is controlled");
assert(css.includes("line-height: 1.22"), "mobile tile hint line-height is controlled");
assert(css.includes("@media (max-width: 380px)"), "extra narrow phone typography fallback exists");

console.log("✅ Mobile Tools typography smoke test passed.");
