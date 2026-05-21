import fs from 'node:fs';

const route = fs.readFileSync('app/api/chat/route.ts', 'utf8');
const forcedChoiceBlock = route.slice(
  route.indexOf('function getForcedToolChoice'),
  route.indexOf('function buildRoutingHint')
);
const toolsListBlock = route.slice(
  route.indexOf('## Your Built-in Tools'),
  route.indexOf('## Additional Context from Uploads')
);
const sourceDisciplineBlock = route.slice(
  route.indexOf('## GitHub source inspection discipline'),
  route.indexOf('### Document and code context')
);

const checks = [
  ['source inspection intent still exists', route.includes('function isGitHubSourceInspectionIntent')],
  ['source search tool still exists', route.includes('searchRepositoryCode: tool({')],
  ['source search is not a forced tool choice', !forcedChoiceBlock.includes('searchRepositoryCode')],
  ['source routing still prefers code search', route.includes('prefer `searchRepositoryCode` first')],
  ['routing explicitly stops repeated source search', route.includes('Do not repeatedly call `searchRepositoryCode`')],
  ['dynamic tool loading includes searchRepositoryCode', route.includes('add("searchRepositoryCode")') || route.includes('searchRepositoryCode: tool')],
  ['discipline requires stop after search results', route.includes('Do not repeatedly call `searchRepositoryCode`') || route.includes('do not call it again')],
  ['discipline requires filenames/snippets or no evidence statement', route.includes('real path') || route.includes('no evidence') || route.includes('Never invent placeholder paths')],
  ['placeholder path rejection remains', route.includes('Refusing to read a placeholder or invented path')],
  ['maxSteps remains available for legitimate chains', /maxSteps:\s*\d+/.test(route)],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? '✅' : '❌'} ${name}`);
if (failed.length) process.exit(1);
console.log('✅ Source search final-answer contract smoke test passed.');
