import fs from 'node:fs';

const vercel = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));
const manifest = JSON.parse(fs.readFileSync('public/manifest.json', 'utf8'));
const sw = fs.readFileSync('public/sw.js', 'utf8');
const cronRoute = fs.readFileSync('app/api/cron/daily-briefing/route.ts', 'utf8');
const pushRoute = fs.readFileSync('app/api/push/route.ts', 'utf8');
const pushNotify = fs.readFileSync('lib/push-notify.ts', 'utf8');
const pushSubscribe = fs.readFileSync('components/push-subscribe.tsx', 'utf8');
const layout = fs.readFileSync('app/layout.tsx', 'utf8');
const dailyCron = vercel.crons?.find((c) => c.path === '/api/cron/daily-briefing');

const checks = [
  ['vercel.json exists', fs.existsSync('vercel.json')],
  ['cron path is /api/cron/daily-briefing', Boolean(dailyCron)],
  ['cron schedule exists for daily briefing', typeof dailyCron?.schedule === 'string' && /\d+ \d+ \* \* \*/.test(dailyCron.schedule)],
  ['manifest has 192 icon', manifest.icons.some((i) => i.sizes === '192x192')],
  ['manifest has 512 icon', manifest.icons.some((i) => i.sizes === '512x512')],
  ['manifest display is standalone', manifest.display === 'standalone'],
  ['icon-192.png exists', fs.existsSync('public/icons/icon-192.png')],
  ['icon-512.png exists', fs.existsSync('public/icons/icon-512.png')],
  ['apple-touch-icon.png exists', fs.existsSync('public/icons/apple-touch-icon.png')],
  ['sw.js exists', fs.existsSync('public/sw.js')],
  ['sw.js handles push event', sw.includes("addEventListener('push'")],
  ['sw.js handles notificationclick', sw.includes("addEventListener('notificationclick'")],
  ['sw.js has cache name', sw.includes('rune-v1')],
  ['cron endpoint exists', fs.existsSync('app/api/cron/daily-briefing/route.ts')],
  ['cron checks CRON_SECRET', cronRoute.includes('CRON_SECRET')],
  ['cron returns 401 if unauthorized', cronRoute.includes('status: 401')],
  ['cron calls getDailyOperatorBriefing', cronRoute.includes('getDailyOperatorBriefing')],
  ['cron sends push notifications', cronRoute.includes('sendPushNotificationsToAll')],
  ['cron logs/sends briefing through configured persistence or delivery path', cronRoute.includes('supabase') || cronRoute.includes('briefing_log') || cronRoute.includes('sendPushNotificationsToAll')],
  ['push API exists', fs.existsSync('app/api/push/route.ts')],
  ['push API handles POST', pushRoute.includes('export async function POST')],
  ['push API handles DELETE', pushRoute.includes('export async function DELETE')],
  ['push API stores in push_subscriptions', pushRoute.includes('push_subscriptions')],
  ['push-notify lib exists', fs.existsSync('lib/push-notify.ts')],
  ['push-notify uses VAPID', pushNotify.includes('VAPID_PUBLIC_KEY')],
  ['push-notify cleans expired subs', pushNotify.includes('expired')],
  ['PushSubscribeButton exists', fs.existsSync('components/push-subscribe.tsx')],
  ['PushSubscribeButton requests permission', pushSubscribe.includes('requestPermission')],
  ['layout registers service worker', layout.includes('serviceWorker')],
  ['layout has apple-touch-icon', layout.includes('apple-touch-icon')],
  ['layout has apple-mobile-web-app-capable', layout.includes('apple-mobile-web-app-capable')],
  ['cron never merges code', !cronRoute.includes('merge')],
  ['cron never deploys', !cronRoute.includes('deploy')],
  ['push API is read-only for subscriptions only', !pushRoute.includes('github')],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? '✅' : '❌'} ${name}`);
if (failed.length) { console.error(`\n${failed.length} check(s) failed.`); process.exit(1); }
console.log('\n✅ PWA + cron smoke test passed.');
