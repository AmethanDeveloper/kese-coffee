// Офлайн-кэш оболочки приложения. Данные (меню, заказы) всегда берутся из сети.
// После обновления файлов на хостинге увеличьте номер версии ниже.
const VERSION = 'cafe-v14';
const SHELL = ['./', 'index.html', 'css/style.css?v=14', 'js/config.js?v=14', 'js/api.js?v=14', 'js/map.js?v=14', 'js/photo.js?v=14', 'js/app.js?v=14', 'js/admin.js?v=14',
  'js/vendor/supabase-2.117.2.js', 'js/vendor/qrcode-1.4.4.js', 'assets/hero.jpg', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // Supabase, шрифты — напрямую
  if (url.pathname.indexOf('/push/') >= 0) return;                          // сервер уведомлений — без кэша
  // сеть в приоритете, кэш — если интернета нет
  e.respondWith(
    fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(VERSION).then(c => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request).then(r => r || caches.match('index.html')))
  );
});

// ---------------------------------------------------------------------
// Push-уведомления (их присылает сервер kese-push):
//   персоналу — о новых заказах, гостю — «заказ готов», «курьер выехал» и т. п.
// ---------------------------------------------------------------------
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = { title: 'Kese Coffee', body: e.data ? e.data.text() : '' }; }
  const loud = d.type === 'new_order' || d.urgent === true;
  const opts = {
    body: d.body || '',
    tag: d.tag || 'kese',
    renotify: true,
    icon: 'icons/icon-192.png',
    badge: 'icons/badge-96.png',
    vibrate: loud ? [250, 120, 250, 120, 400] : [200],
    requireInteraction: loud,
    data: { url: d.url || (d.type === 'guest' ? './' : './#admin') }
  };
  e.waitUntil(self.registration.showNotification(d.title || 'Kese Coffee', opts));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  const toPanel = target.indexOf('#admin') >= 0;
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const mine = list.filter(c => c.url.indexOf(self.registration.scope) === 0);
    const inPanel = c => c.url.indexOf('#admin') >= 0;
    // персоналу — открытая панель, гостю — открытая вкладка сайта (не панель)
    const win = toPanel ? (mine.find(inPanel) || mine[0]) : (mine.find(c => !inPanel(c)) || mine[0]);
    if (win) {
      const stay = win.url === target || (toPanel && inPanel(win)) || !win.navigate;
      return (stay ? Promise.resolve(win) : win.navigate(target).catch(() => win)).then(c => (c || win).focus());
    }
    return clients.openWindow(target);
  }));
});
