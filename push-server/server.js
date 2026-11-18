/* =====================================================================
   Kese Coffee: сервер push-уведомлений.
   Персоналу — о новых заказах, гостю — «заказ готов», «курьер выехал» и т. п.
   Supabase (pg_net) присылает сюда текст и список подписанных
   телефонов, сервер шифрует и отправляет уведомления (Web Push, VAPID).
   Запускается deploy.sh как служба kese-push, слушает только 127.0.0.1;
   снаружи доступен через Caddy по адресу /push/*.

   Переменные (файл /etc/kese-push.env):
     VAPID_PUBLIC, VAPID_PRIVATE  — ключи (deploy.sh создаёт один раз)
     VAPID_SUBJECT                — адрес сайта или mailto:
     PUSH_SECRET                  — общий секрет с базой (set_push_config)
     SUPABASE_URL, SUPABASE_KEY   — чтобы сообщать базе об устаревших подписках
     PUSH_PORT                    — порт, по умолчанию 8787
   Создать ключи вручную:  node server.js --keys
   ===================================================================== */
'use strict';
const http = require('http');
const crypto = require('crypto');
const webpush = require('web-push');

if (process.argv[2] === '--keys') {
  const k = webpush.generateVAPIDKeys();
  process.stdout.write('VAPID_PUBLIC=' + k.publicKey + '\nVAPID_PRIVATE=' + k.privateKey + '\n');
  process.exit(0);
}

const env = process.env;
const PORT = Number(env.PUSH_PORT || 8787);
const SECRET = env.PUSH_SECRET || '';
const log = (...a) => console.log(new Date().toISOString(), ...a);

if (!env.VAPID_PUBLIC || !env.VAPID_PRIVATE || SECRET.length < 16) {
  console.error('Нет ключей VAPID или секрета. Запустите deploy.sh ещё раз.');
  process.exit(1);
}
webpush.setVapidDetails(env.VAPID_SUBJECT || 'mailto:owner@example.com', env.VAPID_PUBLIC, env.VAPID_PRIVATE);

function sameSecret(a) {
  const x = Buffer.from(String(a || '')), y = Buffer.from(SECRET);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0; const parts = [];
    req.on('data', c => { size += c.length; if (size > limit) { reject(new Error('too large')); req.destroy(); } else parts.push(c); });
    req.on('end', () => resolve(Buffer.concat(parts).toString('utf8')));
    req.on('error', reject);
  });
}
function send(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

/* Рассылка одного уведомления на список подписок */
async function deliver(payload, subs, sender) {
  const body = JSON.stringify(payload);
  const urgent = !!payload && (payload.urgent === true || payload.type === 'new_order' || payload.type === 'test');
  const results = await Promise.allSettled(subs.map(s => (sender || webpush.sendNotification)(
    { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body,
    { TTL: urgent ? 900 : 3600, urgency: urgent ? 'high' : 'normal', timeout: 10000 })));
  const ok = [], gone = [], failed = [];
  results.forEach((r, i) => {
    const ep = subs[i].endpoint;
    if (r.status === 'fulfilled') ok.push(ep);
    else if (r.reason && (r.reason.statusCode === 404 || r.reason.statusCode === 410)) gone.push(ep);
    else failed.push({ endpoint: ep.slice(0, 60), error: String((r.reason && (r.reason.statusCode || r.reason.message)) || r.reason) });
  });
  return { ok, gone, failed };
}

async function report(ok, gone) {
  if (typeof fetch !== 'function' || !env.SUPABASE_URL || !env.SUPABASE_KEY || (!ok.length && !gone.length)) return;
  try {
    const r = await fetch(env.SUPABASE_URL.replace(/\/$/, '') + '/rest/v1/rpc/push_report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: env.SUPABASE_KEY },
      body: JSON.stringify({ p_secret: SECRET, p_ok: ok, p_gone: gone })
    });
    if (!r.ok) log('report: Supabase ответил', r.status);
  } catch (e) { log('report: не удалось', e.message); }
}

function makeServer(sender) {
  return http.createServer(async (req, res) => {
    const url = (req.url || '').split('?')[0];
    try {
      if (req.method === 'GET' && url === '/push/key') return send(res, 200, { publicKey: env.VAPID_PUBLIC });
      if (req.method === 'GET' && url === '/push/health') return send(res, 200, { ok: true });
      if (req.method === 'POST' && url === '/push/order') {
        if (!sameSecret(req.headers['x-kese-secret'])) return send(res, 403, { error: 'forbidden' });
        let data;
        try { data = JSON.parse(await readBody(req, 256 * 1024)); } catch (e) { return send(res, 400, { error: 'bad json' }); }
        const subs = Array.isArray(data.subs) ? data.subs.filter(s => s && /^https:\/\//.test(s.endpoint || '') && s.p256dh && s.auth).slice(0, 200) : [];
        if (!subs.length || !data.payload) return send(res, 200, { sent: 0 });
        const r = await deliver(data.payload, subs, sender);
        log((data.payload.type || 'push') + ':', (data.payload.title || '').slice(0, 60), '→ доставлено', r.ok.length, 'устарело', r.gone.length, 'ошибок', r.failed.length);
        if (r.failed.length) log('ошибки:', JSON.stringify(r.failed));
        report(r.ok, r.gone);
        return send(res, 200, { sent: r.ok.length, gone: r.gone.length, failed: r.failed.length });
      }
      send(res, 404, { error: 'not found' });
    } catch (e) {
      log('ошибка:', e.message);
      send(res, 500, { error: 'server error' });
    }
  });
}

if (require.main === module) {
  makeServer().listen(PORT, '127.0.0.1', () => log('kese-push слушает 127.0.0.1:' + PORT));
}
module.exports = { makeServer, deliver };
