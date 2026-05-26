import fs from "node:fs";
function assert(c, m) {
  if (!c) {
    console.error(`❌ ${m}`);
    process.exit(1);
  }
  console.log(`✅ ${m}`);
}
const chat = fs.readFileSync("app/api/chat/route.ts", "utf8");
assert(chat.includes("function isImageIntent"), "image intent detector exists");
assert(/generate\|create\|make\|draw\|design/.test(chat), "image detector covers common create verbs");
assert(/image\|picture\|photo\|avatar\|logo\|mascot\|icon\|illustration\|graphic/.test(chat), "image detector covers visual nouns");
assert(chat.includes('add("generate_image")'), "selectToolsForRequest exposes generate_image for image prompts");
assert(chat.includes('toolName: "generate_image"'), "getForcedToolChoice can force generate_image");
assert(chat.includes('&& !/\\b(image|picture|photo|avatar|logo|mascot|icon|illustration)\\b/i.test(input)'), "Simple Builder excludes image prompts");
assert(chat.includes("isSimpleBuilderIntent(input) && !isImageIntent(input)"), "Simple Builder tool bundle is guarded against image prompts");
assert(chat.includes("maxSteps: isRepoControlCommand(latestUserText) ? 10 : 5"), "non-repo chat maxSteps is reduced to 5");
assert(chat.includes("Do not route image/avatar/logo/mascot/icon/illustration requests into repo/app-builder flows"), "routing hint prevents image-to-builder misroutes");
console.log("✅ Image routing smoke test passed.");
