import fs from "node:fs";
function assert(c,m){ if(!c){ console.error(`❌ ${m}`); process.exit(1);} console.log(`✅ ${m}`); }
const chat=fs.readFileSync("app/api/chat/route.ts","utf8");
assert(chat.includes("function isSimpleBuilderIntent"), "Simple Builder intent detector exists");
assert(chat.includes('add("simple_builder")'), "Simple Builder is attached for build/create/fix requests");
assert(chat.includes("use simple_builder first"), "system prompt routes build requests to Simple Builder first");
assert(chat.includes("inspect → diff → checks → PR"), "system prompt explains PR-first loop");
assert(!chat.includes("answer yes with precision: Rune can create apps through the controlled App Creator workflow"), "old App Creator guidance removed");
console.log("✅ Simple Builder routing smoke test passed.");
