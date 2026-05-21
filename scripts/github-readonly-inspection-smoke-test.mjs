import fs from 'node:fs';

const route = fs.readFileSync('app/api/chat/route.ts', 'utf8');
const cards = fs.readFileSync('components/chat/tool-cards.tsx', 'utf8');

const checks = [
  ['source inspection intent exists', route.includes('function isGitHubSourceInspectionIntent')],
  ['source intent prefers code search without forcing a loop', route.includes('prefer `searchRepositoryCode` first') && !route.includes('return { type: "tool", toolName: "searchRepositoryCode" };')],
  ['forced tool union does not include code search', !route.includes('| "searchRepositoryCode"')],
  ['web search excludes source inspection requests', route.includes('isGitHubSourceInspectionIntent(input) || isGitHubAnalysisIntent(input)')],
  ['routing hint forbids placeholder paths', route.includes('Never invent placeholder paths like path/to/sendMessage.js')],
  ['system prompt/routing requires source inspection discipline', route.includes('Never invent placeholder paths') && route.includes('searchRepositoryCode')],
  ['code search tool exists', route.includes('searchRepositoryCode: tool({')],
  ['code search uses GitHub code search endpoint', route.includes('https://api.github.com/search/code')],
  ['code search returns real paths and snippets', route.includes('matches.push({') && route.includes('snippet') && route.includes('path: item.path')],
  ['read file rejects placeholder paths', route.includes('isPlaceholderRepoPath(path)') && route.includes('Refusing to read a placeholder or invented path')],
  ['placeholder path helper catches path/to', route.includes('normalized.startsWith("path/to/")')],
  ['repo tree tool remains read-only', route.includes('listRepositoryTree: tool({') && route.includes('recursive: "true"')],
  ['tool labels exist for GitHub inspection', cards.includes('searchRepositoryCode: "Searching real GitHub code"') && cards.includes('readRepositoryFile: "Reading real GitHub source file"') && cards.includes('listRepositoryTree: "Listing GitHub repository files"')],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? '✅' : '❌'} ${name}`);
if (failed.length) process.exit(1);
console.log('✅ GitHub read-only inspection smoke test passed.');
