import fs from "node:fs";

const repoActions = fs.readFileSync("lib/repo-actions.ts", "utf8");
const chatRoute = fs.readFileSync("app/api/chat/route.ts", "utf8");
const repoRoute = fs.readFileSync("app/api/repo-actions/route.ts", "utf8");

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ${message}`);
    process.exit(1);
  }
}

assert(repoActions.includes("export function isRepoActionProposalId"), "Repo Control must export proposal UUID validator.");
assert(repoActions.includes("GitHub Actions run ID, not a Repo Control proposal ID"), "Repo Control must explain GitHub run IDs are not proposal UUIDs.");
assert(repoActions.includes("proposal_id_validation"), "Repo Control flow must stop at proposal ID validation before Supabase lookup.");
assert(!repoActions.includes('const id = cleanText(options.id, 120);'), "Repo Control proposal lookups must not accept arbitrary string IDs.");
assert(!repoActions.includes('const proposalId = cleanText("id" in options ? options.id : options.proposalId, 120);'), "Repo Control flow/handoff must validate proposal IDs before Supabase lookup.");
assert(repoRoute.includes("isRepoActionProposalId(parsed.data.id)"), "Repo actions API must validate proposal IDs before dispatch.");
assert(repoRoute.includes("invalidProposalId: true"), "Repo actions API must return a structured invalidProposalId response.");
assert(chatRoute.includes("isRepoActionProposalId(proposalId)"), "Chat Repo Control tools must validate proposal IDs before running stages.");
assert(chatRoute.includes("Use a proposal UUID from the Repo Control card"), "Chat tools must give owner-friendly guidance for bad IDs.");

console.log("✅ Repo Control proposal ID smoke test passed.");
