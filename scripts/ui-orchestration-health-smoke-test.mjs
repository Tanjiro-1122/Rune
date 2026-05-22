import fs from "node:fs";

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ${message}`);
    process.exit(1);
  }
  console.log(`✅ ${message}`);
}

const chat = fs.readFileSync("components/chat.tsx", "utf8");
const model = fs.readFileSync("components/chat/orchestration-model.ts", "utf8");
const lineCount = chat.split(/\r?\n/).length;
const stateCount = (chat.match(/useState/g) || []).length;
const effectCount = (chat.match(/useEffect/g) || []).length;
const refCount = (chat.match(/useRef/g) || []).length;

assert(fs.existsSync("components/chat/orchestration-model.ts"), "chat orchestration model module exists");
assert(model.includes("PROJECT_SWITCHBOARD_OPTIONS") && model.includes("CABINET_DRAWERS"), "orchestration model owns projects and cabinet drawers");
assert(model.includes("getToolsShellClassName") && model.includes("getFilingCabinetTabClassName"), "orchestration model owns mobile/tool class helpers");
assert(chat.includes("./chat/orchestration-model"), "chat imports orchestration model");
assert(!chat.includes("const PROJECT_SWITCHBOARD_OPTIONS = [") && !chat.includes("const CABINET_DRAWERS"), "chat no longer declares static project/drawer model inline");
assert(lineCount <= 4060, `chat.tsx stays under first orchestration budget (${lineCount}/4060 lines)`);
assert(stateCount <= 76, `chat state count does not grow (${stateCount}/76 useState refs)`);
assert(effectCount <= 19, `chat effect count does not grow (${effectCount}/19 useEffect refs)`);
assert(refCount <= 18, `chat ref count does not grow (${refCount}/18 useRef refs)`);
console.log("✅ UI orchestration health smoke test passed.");
