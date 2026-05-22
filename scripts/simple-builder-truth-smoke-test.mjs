import fs from "node:fs";
function assert(c,m){ if(!c){ console.error(`❌ ${m}`); process.exit(1); } console.log(`✅ ${m}`); }
const chat=fs.readFileSync("app/api/chat/route.ts","utf8");
assert(chat.includes("simple_builder: tool"), "Simple Builder tool exists");
assert(chat.includes("createRepoActionProposal"), "Simple Builder creates Repo Control proposals");
assert(chat.includes("simple_builder_pr_first"), "Simple Builder identifies PR-first mode");
assert(chat.includes("No live preview runtime yet"), "Simple Builder states live-preview limit");
assert(chat.includes("No auto-merge") && chat.includes("No auto-deploy"), "Simple Builder blocks merge/deploy claims");
assert(!chat.includes("Use this as the PRIMARY tool when Javier says 'build me X'"), "Old overclaiming App Creator primary-tool language removed");
assert(!chat.includes("plan → scaffold → PR → deploy in clear stages"), "Old deploy-stage builder claim removed from chat tool");
console.log("✅ Simple Builder truth smoke test passed.");
