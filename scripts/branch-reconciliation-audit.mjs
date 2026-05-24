#!/usr/bin/env node
import { execFileSync } from "node:child_process";

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

const mainRef = process.argv[2] || "origin/main";
const rawBranches = git(["for-each-ref", "--format=%(refname:short)", "refs/remotes/origin"])
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean)
  .filter((branch) => branch !== "origin/HEAD" && branch !== mainRef && !branch.startsWith("origin/pr/"));

const rows = [];
for (const branch of rawBranches) {
  const ahead = Number(git(["rev-list", "--count", `${mainRef}..${branch}`]) || 0);
  const behind = Number(git(["rev-list", "--count", `${branch}..${mainRef}`]) || 0);
  if (!ahead) continue;
  const [sha, subject, date] = git(["log", "-1", "--format=%h%x09%s%x09%ci", branch]).split("\t");
  let recommendation = "review";
  if (behind >= 50 && ahead >= 50) recommendation = "likely stale/divergent — do not merge wholesale";
  if (/copilot\//.test(branch)) recommendation = "copilot branch — inspect manually before salvage";
  if (/feature\/repo-action-completion-verifier|repo-action-reality-guard|repo-completion-proof/.test(branch)) recommendation = "likely superseded by proof-loop main — verify then close/delete";
  rows.push({ branch, ahead, behind, sha, subject, date, recommendation });
}

rows.sort((a, b) => b.ahead - a.ahead || b.behind - a.behind || a.branch.localeCompare(b.branch));

console.log(`# Branch reconciliation audit`);
console.log(``);
console.log(`Base ref: \`${mainRef}\``);
console.log(`Branches ahead of base: ${rows.length}`);
console.log(``);
console.log(`| branch | ahead | behind | latest | recommendation |`);
console.log(`| --- | ---: | ---: | --- | --- |`);
for (const row of rows) {
  const latest = `\`${row.sha}\` ${row.subject.replace(/\|/g, "\\|")}`;
  console.log(`| \`${row.branch}\` | ${row.ahead} | ${row.behind} | ${latest} | ${row.recommendation} |`);
}
