import fs from "node:fs";

const buildIntelligence = fs.readFileSync("lib/build-intelligence.ts", "utf8");
const projectRegistry = fs.readFileSync("lib/project-registry.ts", "utf8");
const appHealth = fs.readFileSync("lib/app-health-snapshot.ts", "utf8");

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ${message}`);
    process.exit(1);
  }
}

assert(
  projectRegistry.includes('key: "unfiltr"') && projectRegistry.includes('repo: "Tanjiro-1122/UniltrbyJavierbackup"'),
  "Project registry must map Unfiltr to Tanjiro-1122/UniltrbyJavierbackup."
);

assert(
  buildIntelligence.includes('from "@/lib/project-registry"') && buildIntelligence.includes('getProjectByKey'),
  "Build intelligence must import the canonical project registry."
);

assert(
  buildIntelligence.includes('options.repo || getProjectByKey(options.projectKey)?.repo || null'),
  "Build intelligence must resolve GitHub repo from projectKey when no repo override is provided."
);

assert(
  !buildIntelligence.includes('getGitHubIntelligence(options.repo), getVercelIntelligence()'),
  "Build intelligence must not call GitHub intelligence with only options.repo because that causes projectKey fallback to Jarvis."
);

assert(
  appHealth.includes('getBuildIntelligenceSnapshot({ projectKey, repo: options.repo })'),
  "App health snapshot must pass projectKey into build intelligence."
);

console.log("✅ App health project routing smoke test passed.");
