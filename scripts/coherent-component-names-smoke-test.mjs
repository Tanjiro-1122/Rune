import fs from "node:fs";

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ${message}`);
    process.exit(1);
  }
  console.log(`✅ ${message}`);
}

const chat = fs.readFileSync("components/chat.tsx", "utf8");
const home = fs.readFileSync("components/command-center-home.tsx", "utf8");
const projects = fs.readFileSync("components/chat/ProjectsSidebar.tsx", "utf8");

assert(fs.existsSync("components/command-center-home.tsx"), "Command Center home component file exists");
assert(fs.existsSync("components/chat/ProjectsSidebar.tsx"), "Projects sidebar component file exists");
assert(home.includes("export function CommandCenterHome"), "home export uses CommandCenterHome");
assert(projects.includes("export function ProjectsSidebar"), "sidebar export uses ProjectsSidebar");
assert(chat.includes("CommandCenterHome") && chat.includes("ProjectsSidebar"), "chat imports coherent component names");
assert(!chat.includes("BuilderHome") && !chat.includes("BuilderSidebar") && !chat.includes("showBuilderSidebar"), "chat no longer uses builder component/state names");
console.log("✅ Coherent component naming smoke test passed.");
