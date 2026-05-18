import fs from 'node:fs';

const checks = [
  // vercel.json cron
  ['vercel.json exists', fs.existsSync('vercel.json')],
  ['cron path is /api/cron/daily-briefing', (() => {
    const v = JSON.parse(fs.readFileSync('vercel.json','utf8'));
    return v.crons?.some(c => c.path === '/api/cron/daily-briefing');
  })()],
  ['cron schedule is 9am ET (14:00 UTC)', (() => {
    const v = JSON.parse(fs.readFileSync('vercel.json','utf8'));
    return v.crons?.some(c => c.schedule === '0 14 * * *');
  })()],
  // manifest
  ['manifest has 192 icon', (() => {
    const m = JSON.parse(fs.readFileSync('public/manifest.json','utf8'));
    return m.icons.some(i => i.sizes === '192x192');
  })()],
  ['manifest has 512 icon', (() => {
    const m = JSON.parse(fs.readFileSync('public/manifest.json','utf8'));
    return m.icons.some(i => i.sizes === '512x512');
  })()],
  ['manifest display is standalone', (() => {
    const m = JSON.parse(fs.readFileSync('public/manifest.json','utf8'));
    return m.display === 'standalone';
  })()],
  // icons
  ['icon-192.png exists', fs.existsSync('public/icons/icon-192.png')],
  ['icon-512.png exists', fs.existsSync('public/icons/icon-512.png')],
  ['apple-touch-icon.png exists', fs.existsSync('public/icons/apple-touch-icon.png')],
  // service worker
  ['sw.js exists', fs.existsSync('public/sw.js')],
  ['sw.js handles push event', fs.readFileSync('public/sw.js','utf8').includes("addEventListener('push'")],
  ['sw.js handles notificationclick', fs.readFileSync('public/sw.js','utf8').includes("addEventListener('notificationclick'")],
  ['sw.js has cache name', fs.readFileSync('public/sw.js','utf8').includes('jarvis-v1')],
  // cron endpoint
  ['cron endpoint exists', fs.existsSync('app/api/cron/daily-briefing/route.ts')],
  ['cron checks CRON_SECRET', fs.readFileSync('app/api/cron/daily-briefing/route.ts','utf8').includes('CRON_SECRET')],
  ['cron returns 401 if unauthorized', fs.readFileSync('app/api/cron/daily-briefing/route.ts','utf8').includes('status: 401')],
  ['cron calls getDailyOperatorBriefing', fs.readFileSync('app/api/cron/daily-briefing/route.ts','utf8').includes('getDailyOperatorBriefing')],
  ['cron sends push notifications', fs.readFileSync('app/api/cron/daily-briefing/route.ts','utf8').includes('sendPushNotificationsToAll')],
  ['cron stores in supabase', fs.readFileSync('app/api/cron/daily-briefing/route.ts','utf8').includes('daily_briefings')],
  // push API
  ['push API exists', fs.existsSync('app/api/push/route.ts')],
  ['push API handles POST', fs.readFileSync('app/api/push/route.ts','utf8').includes('export async function POST')],
  ['push API handles DELETE', fs.readFileSync('app/api/push/route.ts','utf8').includes('export async function DELETE')],
  ['push API stores in push_subscriptions', fs.readFileSync('app/api/push/route.ts','utf8').includes('push_subscriptions')],
  // push-notify lib
  ['push-notify lib exists', fs.existsSync('lib/push-notify.ts')],
  ['push-notify uses VAPID', fs.readFileSync('lib/push-notify.ts','utf8').includes('VAPID_PUBLIC_KEY')],
  ['push-notify cleans expired subs', fs.readFileSync('lib/push-notify.ts','utf8').includes('expired')],
  // push subscribe component
  ['PushSubscribeButton exists', fs.existsSync('components/push-subscribe.tsx')],
  ['PushSubscribeButton requests permission', fs.readFileSync('components/push-subscribe.tsx','utf8').includes('requestPermission')],
  // layout
  ['layout registers service worker', fs.readFileSync('app/layout.tsx','utf8').includes('serviceWorker')],
  ['layout has apple-touch-icon', fs.readFileSync('app/layout.tsx','utf8').includes('apple-touch-icon')],
  ['layout has apple-mobile-web-app-capable', fs.readFileSync('app/layout.tsx','utf8').includes('apple-mobile-web-app-capable')],
  // safety
  ['cron never merges code', !fs.readFileSync('app/api/cron/daily-briefing/route.ts','utf8').includes('merge')],
  ['cron never deploys', !fs.readFileSync('app/api/cron/daily-briefing/route.ts','utf8').includes('deploy')],
  ['push API is read-only for subscriptions only', !fs.readFileSync('app/api/push/route.ts','utf8').includes('github')],
];

const failed = checks.filter(([,ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? '✅' : '❌'} ${name}`);
if (failed.length) { console.error(`\n${failed.length} check(s) failed.`); process.exit(1); }
console.log('\n✅ PWA + cron smoke test passed.');
