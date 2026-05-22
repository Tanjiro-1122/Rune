import fs from "node:fs";

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ${message}`);
    process.exit(1);
  }
  console.log(`✅ ${message}`);
}

const pipeline = fs.readFileSync("lib/app-creator-pipeline.ts", "utf8");
const creator = fs.readFileSync("lib/app-creator.ts", "utf8");
const briefing = fs.readFileSync("lib/whatsapp-briefing.ts", "utf8");

for (const [label, source] of [["app creator pipeline", pipeline], ["app creator", creator], ["WhatsApp briefing", briefing]]) {
  assert(source.includes("getRuneRuntimeIdentity"), `${label} uses project runtime identity`);
}

assert(!pipeline.includes('repo: "Tanjiro-1122/Rune"'), "app creator pipeline no longer hardcodes Rune repo");
assert(!creator.includes('"Tanjiro-1122/Rune"'), "app creator no longer hardcodes Rune repo fallback");
assert(!pipeline.includes("https://mrruneai.vercel.app") && !pipeline.includes("mrruneai.vercel.app in ~2 minutes"), "app creator pipeline no longer hardcodes Rune live URL copy");
assert(!briefing.includes("mrruneai.vercel.app"), "WhatsApp briefing no longer hardcodes Rune live URL");
console.log("✅ Runtime identity app-creator/briefing smoke test passed.");
