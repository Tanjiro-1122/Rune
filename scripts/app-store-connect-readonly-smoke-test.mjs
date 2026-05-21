import fs from "node:fs";

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ${message}`);
    process.exit(1);
  }
  console.log(`✅ ${message}`);
}

const source = fs.readFileSync("lib/app-store-connect-readonly.ts", "utf8");

assert(source.includes("Apple does not allow `sort`"), "documents Apple relationship endpoint sort restriction");
assert(!source.includes("/builds?fields[builds]=version,uploadedDate,processingState,expired,minOsVersion&limit=10&sort="), "build relationship request does not use forbidden sort parameter");
assert(!source.includes("/appStoreVersions?fields[appStoreVersions]=versionString,platform,appStoreState,appVersionState,createdDate&limit=10&sort="), "version relationship request does not use forbidden sort parameter");
assert(source.includes("uploadedDate") && source.includes("localeCompare"), "builds are sorted locally after fetch");
assert(source.includes("createdDate") && source.includes("localeCompare"), "versions are sorted locally after fetch");
console.log("✅ App Store Connect read-only smoke test passed.");
