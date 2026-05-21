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

assert(chat.includes('className="drawer-backdrop tools-drawer-backdrop"'), "tools drawer backdrop is rendered");
assert(chat.includes('context-sidebar context-sidebar--open'), "open tools drawer sidebar is rendered");
assert(chat.includes('mobile-tools-shell'), "mobile tools shell branch exists");
assert(css.includes("Mobile Tools drawer hard visibility fix"), "mobile visibility fix block exists");
assert(css.includes(".drawer-backdrop.tools-drawer-backdrop"), "mobile backdrop selector is explicit");
assert(css.includes("z-index: 5000 !important"), "mobile backdrop is forced above page");
assert(css.includes(".context-sidebar.context-sidebar--open"), "open tools drawer selector is explicit");
assert(css.includes("z-index: 5001 !important"), "mobile tools drawer is forced above backdrop");
assert(css.includes("position: fixed !important"), "mobile tools drawer uses fixed positioning override");
assert(css.includes("transform: translate3d(0, 0, 0) !important"), "mobile tools drawer transform is forced visible");
assert(css.includes("-webkit-transform: translate3d(0, 0, 0) !important"), "mobile Safari transform override exists");
assert(css.includes("visibility: visible !important"), "mobile drawer visibility is forced visible");
assert(css.includes("pointer-events: auto !important"), "mobile drawer accepts taps");
assert(css.includes("max-height: calc(100dvh - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 16px) !important"), "mobile drawer respects Safari safe-area viewport");
assert(css.includes(".context-sidebar.context-sidebar--open .context-panel"), "drawer content scroll container is targeted");
assert(css.includes("overflow-y: auto !important"), "drawer content can scroll on mobile");

console.log("✅ Mobile Tools drawer smoke test passed.");
