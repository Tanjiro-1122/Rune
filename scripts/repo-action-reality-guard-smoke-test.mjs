import fs from "node:fs";
function assert(condition, message) { if (!condition) { console.error(`❌ ${message}`); process.exit(1); } console.log(`✅ ${message}`); }
const chat = fs.readFileSync("app/api/chat/route.ts", "utf8");
const create = fs.readFileSync("lib/safe-file-create-flow.ts", "utf8");
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
assert(create.includes("runSafeFileCreateFlow"), "Safe file create helper exists");
assert(create.includes("APPROVE SAFE FILE CREATE"), "Safe file create has exact approval phrase");
assert(create.includes("completed: false"), "Safe file create does not claim completion for proposal/PR states");
assert(create.includes("pr_opened_not_merged"), "Safe file create labels PR-opened state as not merged");
assert(create.includes("is not on the default branch until merge"), "Safe file create explains default branch is unchanged until merge");
assert(create.includes("isRepoAllowed"), "Safe file create checks repo allowlist");
assert(chat.includes("run_safe_file_create_flow"), "Chat exposes safe file create tool");
assert(chat.includes("isSimpleSafeFileCreateIntent"), "Chat detects simple safe file create intent");
assert(chat.includes("/\\b(create|add|make|write)\\b/i"), "Simple file create detector uses real word boundaries");
assert(chat.includes("toolName: \"run_safe_file_create_flow\""), "Simple file creation forces safe file create tool");
assert(chat.includes("Never call calculate for repo/file mutation requests"), "Routing hint blocks calculate for repo/file mutations");
assert(chat.includes("Repo action proof rule"), "System prompt has repo action proof rule");
assert(chat.includes("not_completed_yet_do_not_claim_file_created"), "Tool result blocks false file-created claims");
assert(pkg.scripts["test:repo-action-reality-guard"] === "node scripts/repo-action-reality-guard-smoke-test.mjs", "Package exposes repo action reality guard test");
for (const forbidden of ["pulls.merge", "vercel deploy", "stripe.", "ALTER TABLE", "DROP TABLE", "dns.records.update", "sendCustomer"]){
  assert(!create.includes(forbidden), `Safe file create does not include ${forbidden}`);
}
console.log("✅ Repo action reality guard smoke test passed.");
