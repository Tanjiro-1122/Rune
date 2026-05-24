import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const ignoreDirs = new Set([".git", ".next", "node_modules", "coverage", "dist", "build"]);
const allowDocs = new Set([
  "docs/self-owned-superagent-buildout-audit.md",
  "docs/reports/supabase-persistence-proof-contract-v1.md",
  "docs/reports/branch-reconciliation-v1.md",
  "docs/jarvis-endgame-roadmap.md",
  "docs/jarvis-master-blueprint.md",
  "docs/setup.md",
  "docs/external-runner-spec.md",
  "README.md",
]);
const allowedCodeRefs = new Set([
  "scripts/base44-runtime-drift-smoke-test.mjs",
  "scripts/base44-shutdown-drill-report.mjs",
  "scripts/project-resolver-smoke-test.mjs",
  "scripts/project-registry-source-smoke-test.mjs",
]);

const activeBannedPatterns = [
  /api\.base44\.com/i,
  /base44\.app\/api/i,
  /BASE44_API_KEY/,
  /RUNE_BASE44_API_KEY/,
  /base44List\(/,
  /base44\.entities/i,
  /@\/api\/entities/,
];

const referencePattern = /base44|Base44|BASE44/g;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignoreDirs.has(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    const rel = path.relative(root, abs).replaceAll(path.sep, "/");
    if (entry.isDirectory()) walk(abs, out);
    else if (/\.(ts|tsx|js|mjs|md|json|sql|css|txt)$/.test(entry.name)) out.push(rel);
  }
  return out;
}

const files = walk(root);
const banned = [];
const references = [];
for (const rel of files) {
  const text = fs.readFileSync(path.join(root, rel), "utf8");
  const skipActivePatternScan = allowedCodeRefs.has(rel) || allowDocs.has(rel) || rel.startsWith("docs/reports/");
  if (!skipActivePatternScan) {
    for (const pattern of activeBannedPatterns) {
      if (pattern.test(text)) banned.push({ file: rel, pattern: String(pattern) });
    }
  }
  if (referencePattern.test(text)) {
    const allowed = allowDocs.has(rel) || allowedCodeRefs.has(rel) || rel.includes("base44-runtime-drift") || rel.includes("base44-shutdown-drill");
    references.push({ file: rel, allowed });
  }
}

const drift = spawnSync(process.execPath, ["scripts/base44-runtime-drift-smoke-test.mjs"], { cwd: root, encoding: "utf8" });
const report = [];
report.push("# Base44 shutdown drill report");
report.push("");
report.push(`Generated: ${new Date().toISOString()}`);
report.push("");
report.push("## Result");
report.push("");
report.push(banned.length === 0 && drift.status === 0 ? "- Runtime Base44 dependency scan: PASS" : "- Runtime Base44 dependency scan: FAIL");
report.push(`- Base44 reference files found: ${references.length}`);
report.push(`- Allowed documentation/test references: ${references.filter(r => r.allowed).length}`);
report.push(`- Needs review references: ${references.filter(r => !r.allowed).length}`);
report.push("");
report.push("## Runtime drift test output");
report.push("");
report.push("```text");
report.push((drift.stdout || drift.stderr || "").trim());
report.push("```");
report.push("");
report.push("## Active banned runtime patterns");
report.push("");
if (banned.length === 0) report.push("None detected.");
else for (const item of banned) report.push(`- ${item.file}: ${item.pattern}`);
report.push("");
report.push("## Base44 reference inventory");
report.push("");
for (const item of references.sort((a, b) => a.file.localeCompare(b.file))) {
  report.push(`- ${item.allowed ? "allowed" : "review"}: ${item.file}`);
}
report.push("");
report.push("## Cancellation gate");
report.push("");
report.push("This report only proves source-level runtime drift. Base44 cancellation still requires live proof for Rune chat, Supabase persistence, external command channel, GitHub/Vercel repo operations, and customer app health.");

const outPath = path.join(root, "docs/reports/base44-shutdown-drill-latest.md");
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, report.join("\n") + "\n");

if (banned.length || drift.status !== 0) {
  console.error(report.join("\n"));
  process.exit(1);
}
console.log(`Base44 shutdown drill report passed: ${outPath}`);
console.log(`References: ${references.length}, needs review: ${references.filter(r => !r.allowed).length}`);
