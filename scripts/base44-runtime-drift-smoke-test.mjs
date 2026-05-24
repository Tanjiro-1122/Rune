import fs from "node:fs";
import path from "node:path";
const allowed = new Set([
  "README.md",
  "docs/jarvis-endgame-roadmap.md",
  "docs/jarvis-master-blueprint.md",
  "docs/setup.md",
  "app/ui-components.css",
  "scripts/migration_schema.sql",
  "scripts/base44-runtime-drift-smoke-test.mjs",
  "scripts/base44-shutdown-drill-report.mjs",
]);
const banned = [/api\.base44\.com/i, /base44\.app\/api/i, /BASE44_API_KEY/, /RUNE_BASE44_API_KEY/, /base44List\(/, /base44\.entities/i, /@\/api\/entities/];
function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if ([".git", "node_modules", ".next", "dist", "build"].includes(entry.name)) return [];
      return walk(full);
    }
    return [full];
  });
}
const offenders = [];
for (const file of walk(".")) {
  const rel = file.replace(/^\.\//, "");
  if (allowed.has(rel)) continue;
  if (!/\.(ts|tsx|js|jsx|mjs|json|yml|yaml)$/.test(rel)) continue;
  const text = fs.readFileSync(file, "utf8");
  for (const pattern of banned) {
    if (pattern.test(text)) offenders.push(`${rel} :: ${pattern}`);
  }
}
if (offenders.length) {
  console.error("❌ Active Base44 runtime references found:\n" + offenders.join("\n"));
  process.exit(1);
}
console.log("✅ No active Base44 runtime references detected.");
