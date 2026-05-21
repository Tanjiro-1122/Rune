import fs from "node:fs";

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ${message}`);
    process.exit(1);
  }
  console.log(`✅ ${message}`);
}

const structure = fs.readFileSync("lib/rune-app-structure.ts", "utf8");
const chat = fs.readFileSync("components/chat.tsx", "utf8");
const sidebar = fs.readFileSync("components/chat/BuilderSidebar.tsx", "utf8");

for (const label of ["Command Center", "Projects", "Tasks", "Memory", "Vault", "Tools", "Operator"]) {
  assert(structure.includes(label), `official app structure includes ${label}`);
}

assert(structure.includes("getRuneVisibleWorkspaceLabel"), "workspace display labels are centralized");
assert(chat.includes("getRuneVisibleWorkspaceLabel(selectedWorkspace?.name)"), "chat header uses coherent workspace label helper");
assert(chat.includes("Projects") && !chat.includes(">\n              Structure\n            </button>"), "main header uses Projects instead of Structure");
assert(chat.includes("Save task") && chat.includes("Save as operator task"), "composer background action is labeled as an operator task");
assert(sidebar.includes('label: "Projects"') && sidebar.includes('builder-sidebar-title">Projects'), "side panel is visibly Projects");
console.log("✅ Coherent app structure smoke test passed.");
