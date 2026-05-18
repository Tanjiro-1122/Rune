import fs from 'node:fs';

const route = fs.readFileSync('app/api/chat/route.ts', 'utf8');
const fnStart = route.indexOf('function buildCodeSnippet');
const fnBody = route.slice(fnStart, fnStart + 2200);

const checks = [
  // Core improvements
  ['contextLines default is 8', fnBody.includes('contextLines = 8')],
  ['term min length is 2 chars', fnBody.includes('.length >= 2')],
  ['up to 10 terms extracted', fnBody.includes('.slice(0, 10)')],
  ['lines are scored by term hit count', fnBody.includes('const hits =') && fnBody.includes('.filter(')],
  ['best match wins (score sort)', fnBody.includes('b.hits - a.hits')],
  ['up to 3 non-overlapping windows', fnBody.includes('windows.length >= 3')],
  ['windows sorted by file position', fnBody.includes('a.start - b.start')],
  ['windows joined with ellipsis separator', fnBody.includes('\\n…\\n')],
  // Fallbacks
  ['no-match fallback returns file header', fnBody.includes('no exact match for query terms')],
  ['no-terms fallback returns file header', fnBody.includes('No usable terms')],
  // Safety
  ['read-only: still no mutation', !route.includes('octokit.repos.createOrUpdateFileContents')],
  ['placeholder path rejection still present', route.includes('Refusing to read a placeholder')],
  ['max_results still capped at 10', route.includes('max_results: z.number().int().min(1).max(10)')],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? '✅' : '❌'} ${name}`);
if (failed.length) {
  console.error(`\n${failed.length} check(s) failed.`);
  process.exit(1);
}
console.log('\n✅ Source evidence quality smoke test passed.');
