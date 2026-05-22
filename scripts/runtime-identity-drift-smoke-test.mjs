import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const scannedRoots = ["app", "components", "lib", "scripts"];
const extensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".md"]);
const allowedFiles = new Set([
  "lib/project-registry.ts",
  "lib/project-runtime.ts",
  "scripts/project-registry-source-smoke-test.mjs",
  "scripts/project-runtime-glue-smoke-test.mjs",
  "scripts/runtime-identity-build-deploy-repo-smoke-test.mjs",
  "scripts/runtime-identity-app-creator-briefing-smoke-test.mjs",
  "scripts/runtime-identity-drift-smoke-test.mjs",
]);

const forbidden = [
  { pattern: "prj_C8yIrPTBitcCIkW745Gx80LBB6CA", label: "Rune Vercel project ID" },
  { pattern: "https://mrruneai.vercel.app", label: "Rune live URL with protocol" },
  { pattern: "mrruneai.vercel.app", label: "Rune live host" },
  { pattern: "const DEFAULT_REPO = \"Tanjiro-1122/Rune\"", label: "hardcoded Rune DEFAULT_REPO" },
  { pattern: "repo: \"Tanjiro-1122/Rune\"", label: "hardcoded Rune repo field" },
  { pattern: "?? \"Tanjiro-1122/Rune\"", label: "hardcoded Rune nullish fallback" },
  { pattern: "|| \"Tanjiro-1122/Rune\"", label: "hardcoded Rune OR fallback" },
];

function walk(dir) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  const out = [];
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".next" || entry.name === ".git") continue;
    const full = path.join(abs, entry.name);
    const rel = path.relative(ROOT, full).replace(/\\/g, "/");
    if (entry.isDirectory()) out.push(...walk(rel));
    else if (extensions.has(path.extname(entry.name))) out.push(rel);
  }
  return out;
}

const failures = [];
for (const file of scannedRoots.flatMap(walk)) {
  if (allowedFiles.has(file)) continue;
  const text = fs.readFileSync(path.join(ROOT, file), "utf8");
  for (const rule of forbidden) {
    if (text.includes(rule.pattern)) failures.push(`${file}: ${rule.label} (${rule.pattern})`);
  }
}

if (failures.length) {
  console.error("❌ Runtime identity drift detected:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("✅ No runtime identity drift detected outside registry/runtime/test contracts.");
