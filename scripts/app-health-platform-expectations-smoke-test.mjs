import fs from "node:fs";
function assert(condition, message) {
  if (!condition) { console.error(`❌ ${message}`); process.exit(1); }
  console.log(`✅ ${message}`);
}
const registry = fs.readFileSync("lib/project-registry.ts", "utf8");
const snapshot = fs.readFileSync("lib/app-health-snapshot.ts", "utf8");
const runeBlock = registry.slice(registry.indexOf('key: "rune"'), registry.indexOf('key: "unfiltr"'));
const unfiltrBlock = registry.slice(registry.indexOf('key: "unfiltr"'), registry.indexOf('key: "swh"'));
const familyBlock = registry.slice(registry.indexOf('key: "family"'));
assert(runeBlock.includes('platforms: ["web"]') && !runeBlock.includes('"app_store_connect"') && !runeBlock.includes('"google_play"'), "Rune health profile excludes store checks");
assert(unfiltrBlock.includes('"app_store_connect"') && !unfiltrBlock.includes('"google_play"'), "Unfiltr health checks ASC but not Google Play");
assert(familyBlock.includes('platforms: ["web"]') && !familyBlock.includes('"app_store_connect"') && !familyBlock.includes('"google_play"'), "Unfiltr Family health profile excludes store checks");
assert(snapshot.includes('shouldCheckAppStoreConnect') && snapshot.includes('healthChecks.includes("app_store_connect")'), "snapshot gates ASC by project healthChecks");
assert(snapshot.includes('shouldCheckGooglePlay') && snapshot.includes('healthChecks.includes("google_play")'), "snapshot gates Google Play by project healthChecks");
assert(snapshot.includes('App Store Connect: not applicable for this project health profile.'), "snapshot reports skipped ASC as not applicable");
assert(snapshot.includes('Google Play: not applicable for this project health profile.'), "snapshot reports skipped Play as not applicable");
assert(snapshot.includes('shouldCheckAppStoreConnect ? getKnownRemediationActions') && snapshot.includes('shouldCheckGooglePlay ? getKnownRemediationActions'), "snapshot only recommends actions for active checks");
assert(snapshot.includes('appStoreConnectOk: shouldCheckAppStoreConnect ? appStoreConnect.ok : null'), "action log records skipped ASC as null");
assert(snapshot.includes('googlePlayOk: shouldCheckGooglePlay ? googlePlay.ok : null'), "action log records skipped Play as null");
console.log("✅ App health platform expectations smoke test passed.");
