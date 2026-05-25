import fs from 'node:fs';

const route = fs.readFileSync('app/api/chat/route.ts', 'utf8');
const readme = fs.readFileSync('README.md', 'utf8');

const checks = [
  ['repoFileCountIntent guard exists', route.includes('repoFileCountIntent')],
  ['explicit math excludes repo file counts', route.includes('const explicitMath = !repoFileCountIntent')],
  ['calculator selection excludes repo/source count questions', route.includes('Never expose the calculator for repo/source counting questions')],
  ['prompt forbids calculate for README word counts', route.includes('especially README word counts') && route.includes('do not use calculate')],
  ['prompt requires source proof fields', route.includes('repo + branch/commit SHA + file path + counting rule')],
  ['source-count final answers require proof', route.includes('For source-count answers, the final answer must include source proof')],
];

const exactJarvis = (readme.match(/Jarvis/g) || []).length;
const exactJARVIS = (readme.match(/JARVIS/g) || []).length;
const exactLower = (readme.match(/jarvis/g) || []).length;
const caseInsensitive = (readme.match(/jarvis/gi) || []).length;
checks.push(['README exact Jarvis count is deterministic', exactJarvis === 12]);
checks.push(['README exact JARVIS count is deterministic', exactJARVIS === 12]);
checks.push(['README lowercase jarvis count is deterministic', exactLower === 1]);
checks.push(['README case-insensitive jarvis count is deterministic', caseInsensitive === 25]);

for (const [name, ok] of checks) console.log(`${ok ? '✅' : '❌'} ${name}`);
const failed = checks.filter(([, ok]) => !ok);
if (failed.length) {
  console.error('Source truth count guard failed:', failed.map(([name]) => name).join(', '));
  process.exit(1);
}
console.log('✅ Source truth count guard smoke test passed.');
