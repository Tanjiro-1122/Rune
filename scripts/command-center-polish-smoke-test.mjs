import fs from "node:fs";

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ${message}`);
    process.exit(1);
  }
  console.log(`✅ ${message}`);
}

const home = fs.readFileSync("components/builder-home.tsx", "utf8");
const chat = fs.readFileSync("components/chat.tsx", "utf8");
const sidebar = fs.readFileSync("components/chat/BuilderSidebar.tsx", "utf8");

assert(home.includes("What needs your attention?"), "empty state is Command Center oriented");
assert(home.includes("Ask Rune to check, fix, build, remember, or run something"), "prompt placeholder covers operator actions");
assert(home.includes("Command Center"), "empty state labels Rune as Command Center");
assert(!home.includes("What will you build next?"), "old builder-first headline removed");
assert(chat.includes('useState<CabinetDrawerKey>("tasks")'), "tools drawer defaults to tasks instead of operator auto-open");
assert(chat.includes("Open projects") && chat.includes(">\n              Projects\n            </button>"), "project button relabeled as Projects");
assert(sidebar.includes('builder-sidebar-title">Projects'), "sidebar title is Projects");
console.log("✅ Command Center polish smoke test passed.");
