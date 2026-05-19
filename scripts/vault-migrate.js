const https = require('https');
const crypto = require('crypto');
const SUPABASE_KEY = process.env.RUNE_SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_REST = 'https://hvvrbpvsgjxiicigkwhu.supabase.co/rest/v1';
const VAULT_KEY = crypto.createHash('sha256').update(SUPABASE_KEY).digest();
const B44_TOKEN = process.env.BASE44_SERVICE_TOKEN;
const APP_ID = '698530168894c6e66eafecda';

function encrypt(p) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', VAULT_KEY, iv);
  const e = Buffer.concat([c.update(p || '', 'utf8'), c.final()]);
  const t = c.getAuthTag();
  return { encrypted: Buffer.concat([e, t]).toString('base64'), iv: iv.toString('base64') };
}

function req(method, url, body, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = { hostname: u.hostname, path: u.pathname + u.search, method, headers: headers || {} };
    if (body) opts.headers['Content-Length'] = Buffer.byteLength(body);
    const r = https.request(opts, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

async function readPage(skip, limit) {
  const r = await req('GET', 'https://base44.app/api/apps/' + APP_ID + '/entities/Password?skip=' + skip + '&limit=' + limit, null, {
    'Authorization': 'Bearer ' + B44_TOKEN, 'app-id': APP_ID
  });
  if (r.status !== 200) throw new Error('B44 ' + r.status + ': ' + r.body.slice(0, 100));
  const d = JSON.parse(r.body);
  return d.records || d || [];
}

async function upsertBatch(rows) {
  const r = await req('POST', SUPABASE_REST + '/phrourio_vault', JSON.stringify(rows), {
    'Authorization': 'Bearer ' + SUPABASE_KEY, 'apikey': SUPABASE_KEY,
    'Content-Type': 'application/json', 'Prefer': 'return=minimal,resolution=merge-duplicates'
  });
  return r.status;
}

async function main() {
  let all = [];
  for (let skip = 0; skip <= 700; skip += 200) {
    try {
      const page = await readPage(skip, 200);
      console.log('Read skip=' + skip + ': ' + page.length + ' records');
      all.push(...page);
      if (page.length < 200) break;
    } catch(e) { console.error('Read error: ' + e.message); break; }
  }
  console.log('Total records: ' + all.length);
  let inserted = 0;
  for (let i = 0; i < all.length; i += 50) {
    const batch = all.slice(i, i + 50).map(r => {
      const { encrypted, iv } = encrypt(r.password || '');
      return { id: r.id, service_name: r.service_name || '', username: r.username || '',
        encrypted_password: encrypted, iv, url: r.url || '', category: r.category || 'Other',
        notes: r.notes || '', favorite: !!r.favorite, is_weak: !!r.is_weak };
    });
    const status = await upsertBatch(batch);
    if (status === 200 || status === 201) { inserted += batch.length; console.log('  batch ' + (Math.floor(i/50)+1) + ': ' + inserted + ' total'); }
    else { console.error('  batch error: ' + status); }
  }
  console.log('Done: ' + inserted + ' records inserted.');
  console.log('VAULT_KEY: ' + Buffer.from(VAULT_KEY).toString('base64'));
}
main().catch(e => { console.error(e); process.exit(1); });
