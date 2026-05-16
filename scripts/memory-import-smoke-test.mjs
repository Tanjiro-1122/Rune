import fs from 'node:fs';

const importLib = fs.readFileSync('lib/memory-import.ts', 'utf8');
const importRoute = fs.readFileSync('app/api/memory/import/route.ts', 'utf8');
const roadmap = fs.readFileSync('docs/jarvis-endgame-roadmap.md', 'utf8');

const checks = [
  ['memory import lib exists', /previewOrImportMemories/.test(importLib)],
  ['dry run mode exists', /dry_run/.test(importLib) && /would_import/.test(importLib)],
  ['approved import required', /approved=true/.test(importLib) || /requires approved=true/.test(importLib)],
  ['secret guards exist', /SECRET_PATTERNS/.test(importLib) && /github token/.test(importLib) && /stripe key/.test(importLib)],
  ['raw chat guards exist', /RAW_CHAT_PATTERNS/.test(importLib) && /raw chat transcript/.test(importLib)],
  ['duplicate detection exists', /findMemoryDuplicate/.test(importLib)],
  ['action logging exists', /memory.import_previewed/.test(importLib) && /memory.imported_batch/.test(importLib)],
  ['import route exists', /ImportSchema/.test(importRoute) && /previewOrImportMemories/.test(importRoute)],
  ['roadmap exists', /Memory Independence/.test(roadmap) && /Hands Phase 1/.test(roadmap) && /Persistent Operator/.test(roadmap)],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? '✅' : '❌'} ${name}`);
if (failed.length) process.exit(1);
