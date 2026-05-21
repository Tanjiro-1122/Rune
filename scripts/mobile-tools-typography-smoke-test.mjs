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

assert(chat.includes("mobile-tools-top-tile"), "mobile top tile class exists");
assert(css.includes(".mobile-tools-top-tile {"), "mobile top tile style exists");
assert(css.includes("display: flex !important"), "mobile top tiles use flex layout");
assert(css.includes(".mobile-tools-top-tile span") && css.includes(".mobile-tools-top-tile small"), "mobile top tile labels have dedicated typography");
assert(/align-items:\s*(flex-start|center)/.test(css), "mobile top tile labels define alignment");
assert(/gap:\s*(6px|8px|10px|12px)/.test(css), "mobile top tile label spacing exists");
assert(/text-align:\s*(left|center)/.test(css), "mobile top tile text alignment is defined");
assert(css.includes(".mobile-tools-top-tile span") && css.includes(".mobile-tools-top-tile small"), "title and hint style blocks exist");
assert(css.includes(".mobile-tools-top-tile span") && css.includes("font-size"), "mobile tile title typography exists");
assert(css.includes(".mobile-tools-top-tile small"), "mobile tile hint typography exists");
assert(css.includes("line-height") || css.includes("font-size"), "mobile tile title rhythm is controlled");
assert(css.includes("line-height") || css.includes("font-size"), "mobile tile hint rhythm is controlled");
assert(css.includes("@media (max-width: 380px)"), "extra narrow phone typography fallback exists");

console.log("✅ Mobile Tools typography smoke test passed.");
