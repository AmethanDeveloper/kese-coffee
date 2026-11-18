/* =====================================================================
   Слой данных. Один интерфейс, две реализации:
   - live: Supabase (база, вход, живые обновления)
   - demo: всё хранится в localStorage этого браузера
   ===================================================================== */
(function () {
  'use strict';
  const CFG = window.APP_CONFIG || {};

  /* ------------------------------ утилиты ------------------------------ */
  const U = {};
  U.money = n => (Number(n) || 0).toLocaleString('ru-RU') + ' ₸';
  U.esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  U.uuid = () => (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); });
  U.digits = s => String(s || '').replace(/\D/g, '');
  U.phoneFmt = p => {
    const d = U.digits(p);
    if (d.length === 11) return '+' + d[0] + ' ' + d.slice(1, 4) + ' ' + d.slice(4, 7) + ' ' + d.slice(7, 9) + ' ' + d.slice(9);
    return p || '';
  };
  U.normPhone = p => { let d = U.digits(p); if (d.length === 10) d = '7' + d; if (d.length === 11 && d[0] === '8') d = '7' + d.slice(1); return d ? '+' + d : ''; };
  U.store = {
    get(k, def) { try { const v = localStorage.getItem(k); return v == null ? def : JSON.parse(v); } catch (e) { return def; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* приватный режим */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { } }
  };
  U.plural = (n, a, b, c) => { const m10 = n % 10, m100 = n % 100; if (m10 === 1 && m100 !== 11) return a; if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return b; return c; };
  /* push: ключ сервера (base64url) → байты; совпадает ли ключ у уже готовой подписки */
  U.b64u = s => { const p = '='.repeat((4 - s.length % 4) % 4), b = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); const a = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a; };
  U.sameKey = (buf, arr) => { if (!buf) return false; const a = new Uint8Array(buf); return a.length === arr.length && a.every((v, i) => v === arr[i]); };
  U.isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  U.standalone = () => (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;

  /* время в часовом поясе кофейни */
  function parts(date, tz) {
    const f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    const o = {}; f.formatToParts(date).forEach(p => { if (p.type !== 'literal') o[p.type] = Number(p.value); });
    if (o.hour === 24) o.hour = 0;
    return o;
  }
  function offsetMin(date, tz) {
    const p = parts(date, tz);
    return (Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(date.getTime() / 1000) * 1000) / 60000;
  }
  U.tzNow = (tz) => { const p = parts(new Date(), tz); return { y: p.year, m: p.month, d: p.day, mins: p.hour * 60 + p.minute }; };
  U.zoned = (y, m, d, mins, tz) => {
    const guess = Date.UTC(y, m - 1, d, Math.floor(mins / 60), mins % 60);
    let t = guess - offsetMin(new Date(guess), tz) * 60000;
    const off2 = offsetMin(new Date(t), tz);
    t = guess - off2 * 60000;
    return new Date(t);
  };
  U.ds = (y, m, d) => y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  U.addDays = (str, n) => { const [y, m, d] = str.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1, d + n)); return U.ds(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()); };
  U.todayStr = (tz) => { const n = U.tzNow(tz); return U.ds(n.y, n.m, n.d); };
  U.daysBetween = (a, b) => { const p = s => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); }; return Math.round((p(b) - p(a)) / 86400000); };
  U.weekday = (str) => { const [y, m, d] = str.split('-').map(Number); return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; }; // 0 = Пн
  U.hourIn = (iso, tz) => Number(U.timeIn(iso, tz).slice(0, 2));
  U.hm = s => { const [h, m] = String(s || '00:00').split(':').map(Number); return h * 60 + (m || 0); };
  U.hhmm = t => String(Math.floor(t / 60) % 24).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0');
  U.timeIn = (iso, tz) => { const p = parts(new Date(iso), tz); return String(p.hour).padStart(2, '0') + ':' + String(p.minute).padStart(2, '0'); };
  U.dayLabel = (iso, tz) => {
    const p = parts(new Date(iso), tz), n = U.tzNow(tz);
    const a = Date.UTC(p.year, p.month - 1, p.day), b = Date.UTC(n.y, n.m - 1, n.d);
    const diff = Math.round((a - b) / 86400000);
    if (diff === 0) return 'сегодня';
    if (diff === 1) return 'завтра';
    if (diff === -1) return 'вчера';
    return String(p.day).padStart(2, '0') + '.' + String(p.month).padStart(2, '0');
  };
  U.shopState = (s) => {
    const n = U.tzNow(s.timezone), o = U.hm(s.open_time), c = U.hm(s.close_time);
    return { now: n, open: o, close: c, isOpen: n.mins >= o && n.mins < c, beforeOpen: n.mins < o };
  };
  /* Слоты времени: «как можно скорее» + ближайшие времена шагом 5 минут */
  U.slots = (s, fulfillment, count) => {
    const st = U.shopState(s), lead = fulfillment === 'delivery' ? s.delivery_minutes : s.prep_minutes;
    const canNow = st.isOpen && st.now.mins + s.prep_minutes <= st.close - 5 && s.accepting_orders;
    let day = 0, start;
    if (canNow) start = Math.ceil((st.now.mins + lead) / 5) * 5 + 5;
    else if (st.beforeOpen) start = st.open + (fulfillment === 'delivery' ? lead : 0);
    else { day = 1; start = st.open + (fulfillment === 'delivery' ? lead : 0); }
    const base = new Date(Date.UTC(st.now.y, st.now.m - 1, st.now.d + day));
    const Y = base.getUTCFullYear(), M = base.getUTCMonth() + 1, D = base.getUTCDate();
    const list = [];
    if (canNow) list.push({ key: 'asap', asap: true, label: 'Как можно скорее', sub: '~' + lead + ' мин' });
    for (let t = start; list.length < (count || 9) && t <= st.close - 5; t += (t - start >= 30 ? 15 : 5)) {
      list.push({ key: String(day) + ':' + t, asap: false, label: U.hhmm(t), sub: '', iso: U.zoned(Y, M, D, t, s.timezone).toISOString() });
    }
    return { list, day, canNow, lead, Y, M, D };
  };
  U.isoFor = (s, day, hhmmStr) => {
    const n = U.tzNow(s.timezone);
    const base = new Date(Date.UTC(n.y, n.m - 1, n.d + day));
    return U.zoned(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), U.hm(hhmmStr), s.timezone).toISOString();
  };

  /* цена позиции на клиенте (только для показа; итог всегда считает сервер) */
  U.indexMenu = (menu) => {
    const mods = {}, groups = {}, products = {};
    menu.groups.forEach(g => { groups[g.id] = g; g.modifiers.forEach(m => { mods[m.id] = m; }); });
    menu.products.forEach(p => { products[p.id] = p; });
    return { mods, groups, products };
  };
  U.unitPrice = (p, size, modIds, idx) => {
    let price = (p.sizes && p.sizes.length) ? ((p.sizes.find(z => z.label === size) || p.sizes[0]).price) : (p.price || 0);
    (modIds || []).forEach(id => { const m = idx.mods[id]; if (m) price += m.price; });
    return price;
  };
  U.minPrice = p => (p.sizes && p.sizes.length) ? Math.min(...p.sizes.map(z => Number(z.price))) : (p.price || 0);
  U.modsText = (mods) => (mods || []).filter(m => !(m.is_default && !m.price)).map(m => m.name).join(', ');
  U.itemLine = (it) => [it.size, U.modsText(it.modifiers)].filter(Boolean).join(' · ');

  U.STATUS = {
    new: 'Новый', accepted: 'Готовится', ready: 'Готов', on_the_way: 'В пути', completed: 'Выдан', cancelled: 'Отменён'
  };
  U.PAY = { kaspi: 'Kaspi', place: 'На месте', online: 'Онлайн' };
  U.PAY_STATUS = { unpaid: 'Не оплачен', invoice_sent: 'Счёт выставлен', paid: 'Оплачен', refunded: 'Возврат' };

  /* ------------------------------ стартовое меню (демо) ------------------------------ */
  function seedMenu() {
    const id = U.uuid;
    const c = { coffee: id(), nocoffee: id(), cold: id(), food: id() };
    const g = { milk: id(), syrup: id(), extra: id() };
    const S3 = (a, b, d) => [{ label: 'S', volume: '300 мл', price: a }, { label: 'M', volume: '400 мл', price: b }, { label: 'L', volume: '500 мл', price: d }];
    const S2 = (b, d) => [{ label: 'M', volume: '400 мл', price: b }, { label: 'L', volume: '500 мл', price: d }];
    const mod = (group_id, name, price, is_default, sort) => ({ id: id(), group_id, name, price, is_default: !!is_default, active: true, sort });
    let n = 0;
    const IMG = { 'Эспрессо': 'espresso', 'Американо': 'americano', 'Капучино': 'cappuccino', 'Латте': 'latte', 'Флэт уайт': 'flatwhite', 'Раф ванильный': 'raf', 'Какао': 'cocoa' };
    const prod = (category_id, name, description, price, sizes, groups) => ({ id: id(), category_id, name, description, image_url: IMG[name] ? 'assets/products/' + IMG[name] + '.jpg' : null, badge: name === 'Эспрессо' ? 'Хит' : '', price: sizes ? null : price, sizes: sizes || [], modifier_group_ids: groups || [], available: true, active: true, sort: ++n });
    return {
      categories: [
        { id: c.coffee, name: 'Кофе', sort: 1, active: true }, { id: c.nocoffee, name: 'Не кофе', sort: 2, active: true },
        { id: c.cold, name: 'Холодное', sort: 3, active: true }, { id: c.food, name: 'К кофе', sort: 4, active: true }
      ],
      groups: [
        { id: g.milk, name: 'Молоко', multi: false, sort: 1 }, { id: g.syrup, name: 'Сироп', multi: false, sort: 2 }, { id: g.extra, name: 'Дополнительно', multi: true, sort: 3 }
      ],
      modifiers: [
        mod(g.milk, 'Обычное', 0, true, 1), mod(g.milk, 'Овсяное', 300, false, 2), mod(g.milk, 'Миндальное', 300, false, 3), mod(g.milk, 'Безлактозное', 200, false, 4),
        mod(g.syrup, 'Без сиропа', 0, true, 1), mod(g.syrup, 'Ваниль', 200, false, 2), mod(g.syrup, 'Карамель', 200, false, 3), mod(g.syrup, 'Лесной орех', 200, false, 4), mod(g.syrup, 'Солёная карамель', 200, false, 5),
        mod(g.extra, 'Доп. шот эспрессо', 300, false, 1), mod(g.extra, 'Сливки', 200, false, 2)
      ],
      products: [
        prod(c.coffee, 'Эспрессо', 'Классический вкус и насыщенный аромат, 40 мл', 700, null, [g.extra]),
        prod(c.coffee, 'Американо', 'Эспрессо и горячая вода', 0, S3(900, 1100, 1300), [g.milk, g.syrup, g.extra]),
        prod(c.coffee, 'Капучино', 'Густая молочная пена, эспрессо и нежный вкус', 0, S3(1200, 1400, 1600), [g.milk, g.syrup, g.extra]),
        prod(c.coffee, 'Латте', 'Больше молока, мягкий вкус', 0, S3(1300, 1500, 1700), [g.milk, g.syrup, g.extra]),
        prod(c.coffee, 'Флэт уайт', 'Двойной эспрессо, тонкая пена, 200 мл', 1500, null, [g.milk]),
        prod(c.coffee, 'Раф ванильный', 'Сливки, эспрессо и ванильный сахар', 0, S3(1500, 1700, 1900), [g.syrup]),
        prod(c.nocoffee, 'Какао', 'На молоке', 0, S3(1100, 1300, 1500), [g.milk, g.syrup]),
        prod(c.nocoffee, 'Матча латте', 'Японский зелёный чай с молоком', 0, S3(1500, 1700, 1900), [g.milk, g.syrup]),
        prod(c.nocoffee, 'Чай', 'Чёрный, зелёный или травяной, укажите в комментарии', 0, S3(700, 800, 900), []),
        prod(c.cold, 'Айс-латте', 'Эспрессо, молоко, лёд', 0, S2(1600, 1800), [g.milk, g.syrup, g.extra]),
        prod(c.cold, 'Эспрессо-тоник', 'Тоник, лёд и двойной эспрессо', 1700, null, []),
        prod(c.cold, 'Лимонад', 'Цитрус и мята', 0, S2(1300, 1500), []),
        prod(c.food, 'Круассан', 'Сливочный, печём утром', 900, null, []),
        prod(c.food, 'Синнабон', 'Корица и сливочный крем', 1100, null, []),
        prod(c.food, 'Чизкейк', 'Нью-Йорк, кусочек', 1400, null, []),
        prod(c.food, 'Печенье', 'Шоколадное, большое', 600, null, [])
      ]
    };
  }
  const DEFAULT_SETTINGS = {
    id: 1, name: 'Kese Coffee', address: 'Астана, ул. Лепсы, 42/1', whatsapp: '79033274496', kaspi_phone: '+7 707 281 68 89',
    timezone: 'Asia/Almaty', open_time: '08:00', close_time: '21:00', prep_minutes: 10, accepting_orders: true,
    pickup_enabled: true, pay_kaspi: true, pay_place: true, pay_online: false,
    delivery_enabled: false, delivery_fee: 500, delivery_min_order: 3000, delivery_minutes: 30, delivery_zone: '',
    shop_lat: 51.15036, shop_lng: 71.527513, delivery_radius_km: 2, delivery_free_from: 0
  };
  /* партнёры: ссылка ?p=code действует столько часов после сканирования QR */
  U.PARTNER_HOURS = 12;
  U.partnerFee = (pt, qty) => (Number(pt.delivery_free_qty) > 0 && qty >= Number(pt.delivery_free_qty)) ? 0 : Number(pt.delivery_fee);
  U.monthStart = (str) => String(str).slice(0, 7) + '-01';
  U.addMonths = (str, n) => { const [y, m] = str.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1 + n, 1)); return U.ds(t.getUTCFullYear(), t.getUTCMonth() + 1, 1); };
  U.MONTHS_FULL = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
  U.monthLabel = (str) => { const [y, m] = str.split('-').map(Number); return U.MONTHS_FULL[m - 1] + ' ' + y; };
  /* код партнёра из названия: «Tez Auto» → tez-auto, «Шиномонтаж» → shinomontazh */
  U.slug = (s) => {
    const map = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya', ә: 'a', ғ: 'g', қ: 'k', ң: 'n', ө: 'o', ұ: 'u', ү: 'u', һ: 'h', і: 'i' };
    const r = String(s || '').toLowerCase().split('').map(c => map[c] != null ? map[c] : c).join('')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24).replace(/-+$/, '');
    return r.length >= 2 ? r : '';
  };
  U.partnerMonth = (p, orders, payouts, month) => {
    const d1 = U.monthStart(month), d2 = U.addMonths(d1, 1);
    const os = orders.filter(o => o.partner_id === p.id && o.business_date >= d1 && o.business_date < d2);
    const done = os.filter(o => o.status === 'completed');
    const qtyOf = o => (o.items || []).reduce((a, i) => a + i.qty, 0);
    const qty = done.reduce((a, o) => a + qtyOf(o), 0), sub = done.reduce((a, o) => a + o.subtotal, 0);
    const rate = Number(p.high_from_qty) > 0 && qty >= Number(p.high_from_qty) ? Number(p.rate_high_pct) : Number(p.rate_pct);
    const paid = (payouts || []).find(x => x.partner_id === p.id && x.period === d1);
    const byDay = {};
    done.forEach(o => { const x = byDay[o.business_date] || (byDay[o.business_date] = { date: o.business_date, orders: 0, qty: 0, subtotal: 0 }); x.orders++; x.qty += qtyOf(o); x.subtotal += o.subtotal; });
    return {
      month: d1, orders: done.length, qty, subtotal: sub,
      in_progress: os.filter(o => ['new', 'accepted', 'ready', 'on_the_way'].includes(o.status)).length,
      cancelled: os.filter(o => o.status === 'cancelled').length,
      rate, payout: Math.floor(sub * rate / 100), rate_pct: Number(p.rate_pct), rate_high_pct: Number(p.rate_high_pct), high_from_qty: Number(p.high_from_qty),
      paid: paid ? { amount: paid.amount, paid_at: paid.paid_at, note: paid.note || '' } : null,
      days: Object.keys(byDay).sort().map(k => byDay[k])
    };
  };
  U.kmBetween = (a, b) => {
    const R = 6371, rad = x => x * Math.PI / 180, dLat = rad(b[0] - a[0]), dLng = rad(b[1] - a[1]);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  };
  U.km = n => (Math.round(n * 10) / 10).toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '\u00a0км';
  U.deliveryFee = (s, sub) => (Number(s.delivery_free_from) > 0 && sub >= Number(s.delivery_free_from)) ? 0 : Number(s.delivery_fee);
  U.hasZone = s => s.shop_lat != null && s.shop_lng != null && s.shop_lat !== '' && s.shop_lng !== '';

  /* Примерные заказы за прошлые дни — только для демо-статистики */
  function sampleHistory(db, days) {
    let seed = 20261018;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const pick = (arr, w) => { let t = w.reduce((a, b) => a + b, 0), r = rnd() * t; for (let i = 0; i < arr.length; i++) { r -= w[i]; if (r <= 0) return arr[i]; } return arr[arr.length - 1]; };
    const tz = 'Asia/Almaty';
    const byName = {}; db.products.forEach(p => { byName[p.name] = p; });
    const names = ['Капучино', 'Латте', 'Американо', 'Раф ванильный', 'Флэт уайт', 'Айс-латте', 'Эспрессо', 'Матча латте', 'Какао', 'Чай', 'Круассан', 'Синнабон', 'Чизкейк', 'Печенье', 'Лимонад', 'Эспрессо-тоник'];
    const nw = [30, 24, 18, 10, 7, 8, 5, 6, 5, 4, 12, 7, 5, 6, 3, 2];
    const oat = db.modifiers.find(m => m.name === 'Овсяное'), syr = db.modifiers.find(m => m.name === 'Ваниль'), shot = db.modifiers.find(m => m.name === 'Доп. шот эспрессо');
    // часы: утренний пик, обед, вечер
    const hours = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
    const hw = [16, 20, 11, 6, 7, 9, 6, 5, 6, 9, 8, 5, 2];
    const reasons = ['Не успеваем', 'Закончились ингредиенты', 'Гость попросил отменить', 'Не дозвонились'];
    const today = U.todayStr(tz), out = [];
    for (let k = days; k >= 1; k--) {
      const bd = U.addDays(today, -k), wd = U.weekday(bd);
      const growth = 0.6 + 0.4 * (days - k) / days;           // постепенный рост
      const base = wd >= 5 ? 9 : 14;                            // в выходные меньше
      const n = Math.max(2, Math.round(base * growth + (rnd() - 0.4) * 6));
      const [y, m, d] = bd.split('-').map(Number);
      const dayStart = out.length;
      for (let i = 1; i <= n; i++) {
        const h = pick(hours, wd >= 5 ? [3, 8, 12, 12, 10, 9, 8, 7, 7, 6, 5, 3, 2] : hw);
        const min = Math.floor(rnd() * 12) * 5;
        const ready = U.zoned(y, m, d, h * 60 + min, tz);
        const lead = 10 + Math.floor(rnd() * 25);
        const created = new Date(ready.getTime() - lead * 60000);
        const items = []; let sub = 0;
        const cnt = pick([1, 2, 3, 4], [55, 30, 11, 4]);
        for (let j = 0; j < cnt; j++) {
          const p = byName[pick(names, nw)]; if (!p) continue;
          let unit = p.sizes.length ? p.sizes[Math.min(p.sizes.length - 1, pick([0, 1, 2], [25, 55, 20]))].price : p.price;
          const mods = [];
          const g = p.modifier_group_ids || [];
          if (oat && g.includes(oat.group_id) && rnd() < 0.2) { mods.push({ id: oat.id, name: oat.name, price: oat.price }); unit += oat.price; }
          if (syr && g.includes(syr.group_id) && rnd() < 0.15) { mods.push({ id: syr.id, name: syr.name, price: syr.price }); unit += syr.price; }
          if (shot && g.includes(shot.group_id) && rnd() < 0.1) { mods.push({ id: shot.id, name: shot.name, price: shot.price }); unit += shot.price; }
          const qty = rnd() < 0.12 ? 2 : 1;
          const ex = items.find(x => x.product_id === p.id && x.unit_price === unit);
          if (ex) { ex.qty += qty; ex.line_total += unit * qty; } else items.push({ id: U.uuid(), product_id: p.id, name: p.name, size: null, modifiers: mods, unit_price: unit, qty, line_total: unit * qty });
          sub += unit * qty;
        }
        if (!items.length) continue;
        const cancelled = rnd() < 0.05, kaspi = rnd() < 0.62;
        out.push({
          id: U.uuid(), number: i, business_date: bd, user_id: null, guest_token: U.uuid(), sample: true,
          customer_name: 'Пример', customer_phone: '', fulfillment: 'pickup', asap: rnd() < 0.6,
          ready_at: ready.toISOString(), delivery_address: null, delivery_details: null, comment: '',
          payment_method: kaspi ? 'kaspi' : 'place', payment_status: cancelled ? 'unpaid' : 'paid',
          status: cancelled ? 'cancelled' : 'completed', cancel_reason: cancelled ? pick(reasons, [4, 3, 2, 1]) : null,
          subtotal: sub, delivery_fee: 0, total: sub, created_at: created.toISOString(), updated_at: ready.toISOString(), items
        });
      }
      const day = out.splice(dayStart).sort((a, b) => a.created_at.localeCompare(b.created_at));
      day.forEach((o, i) => { o.number = i + 1; out.push(o); });
    }
    // часть заказов последних недель пришла по QR партнёров (доставка прямо к ним)
    const pts = db.partners || [];
    if (pts.length) {
      const since = U.addDays(today, -50);
      out.forEach(o => {
        if (o.business_date < since || rnd() > 0.16) return;
        const pt = pts[rnd() < 0.62 ? 0 : 1 % pts.length];
        const qty = o.items.reduce((a, i) => a + i.qty, 0), fee = U.partnerFee(pt, qty);
        Object.assign(o, {
          partner_id: pt.id, partner_name: pt.name, to_partner: true, fulfillment: 'delivery',
          delivery_address: pt.name + (pt.address ? ', ' + pt.address : ''), delivery_details: pt.place_hint,
          delivery_lat: pt.lat, delivery_lng: pt.lng, delivery_fee: fee, total: o.subtotal + fee
        });
      });
    }
    // примерно 4 из 10 заказов — гости, пришедшие в кофейню (бариста вносит у стойки)
    out.forEach(o => { o.source = !o.partner_id && o.status !== 'cancelled' && rnd() < 0.42 ? 'counter' : 'online'; if (o.source === 'counter') o.asap = true; });
    return out;
  }
  function seedPartners() {
    const base = { rate_pct: 10, rate_high_pct: 15, high_from_qty: 100, delivery_enabled: true, delivery_fee: 300, delivery_free_qty: 2, delivery_minutes: 15, note: '', active: true, created_at: new Date().toISOString() };
    return [
      Object.assign({}, base, { id: U.uuid(), code: 'sto-primer', name: 'СТО «Пример»', address: 'ул. Жайык, 2', place_hint: 'зона ожидания', lat: 51.14902, lng: 71.51703, payout_phone: '+77000000001', payout_name: 'Администратор', stats_token: U.uuid() }),
      Object.assign({}, base, { id: U.uuid(), code: 'shina-primer', name: 'Шиномонтаж «Пример»', address: 'пер. Кобда, 2/1', place_hint: '', lat: 51.137933, lng: 71.531446, payout_phone: '+77000000002', payout_name: 'Мастер-приёмщик', stats_token: U.uuid() })
    ];
  }

  /* ===================================================================
     DEMO
     =================================================================== */
  function makeDemo() {
    const KEY = 'cafe_demo_v10';  // v10: в примерах есть заказы у стойки
    const listeners = new Set();
    let db = U.store.get(KEY, null);
    if (!db || !db.settings) {
      const m = seedMenu();
      db = { settings: Object.assign({}, DEFAULT_SETTINGS), categories: m.categories, groups: m.groups, modifiers: m.modifiers, products: m.products, orders: [], users: [], session: null, partners: seedPartners(), payouts: [] };
      // демо: время работы — круглые сутки, чтобы можно было попробовать в любой момент
      db.settings.open_time = '00:00'; db.settings.close_time = '23:59';
      db.orders = sampleHistory(db, 75);
      // прошлый месяц партнёрам уже выплачен
      const prevM = U.addMonths(U.monthStart(U.todayStr(db.settings.timezone)), -1);
      db.partners.forEach(p => { const r = U.partnerMonth(p, db.orders, [], prevM); if (r.payout > 0) db.payouts.push({ id: U.uuid(), partner_id: p.id, period: prevM, amount: r.payout, note: 'Kaspi', paid_at: new Date().toISOString() }); });
      U.store.set(KEY, db);
    }
    if (!db.partners) db.partners = [];
    if (!db.payouts) db.payouts = [];
    const save = (evt) => { U.store.set(KEY, db); if (evt) listeners.forEach(fn => { try { fn(evt); } catch (e) { console.error(e); } }); };
    window.addEventListener('storage', e => {
      if (e.key !== KEY) return;
      const prev = db; db = U.store.get(KEY, db);
      const before = new Map(prev.orders.map(o => [o.id, o.updated_at]));
      db.orders.forEach(o => { if (!before.has(o.id)) listeners.forEach(fn => fn({ eventType: 'INSERT', new: o })); else if (before.get(o.id) !== o.updated_at) listeners.forEach(fn => fn({ eventType: 'UPDATE', new: o })); });
    });
    const wait = (v) => new Promise(r => setTimeout(() => r(v), 180));
    const clone = v => JSON.parse(JSON.stringify(v));
    const fail = msg => { throw new Error(msg); };
    const me = () => db.session ? db.users.find(u => u.id === db.session) : null;
    const isStaff = () => { const u = me(); return !!u && (u.role === 'staff' || u.role === 'admin'); };
    const isAdmin = () => { const u = me(); return !!u && u.role === 'admin'; };
    const authCbs = new Set();
    const emitAuth = (ev) => { const u = me(); authCbs.forEach(fn => fn(ev, u ? { id: u.id, email: u.email } : null)); };
    const withItems = o => clone(o);
    const upsert = (arr, obj) => { if (!obj.id) obj.id = U.uuid(); const i = arr.findIndex(x => x.id === obj.id); if (i >= 0) arr[i] = Object.assign(arr[i], obj); else arr.push(obj); return obj; };

    const api = {
      mode: 'demo',
      async getSettings() { return wait(clone(db.settings)); },
      async getMenu() {
        return wait(clone({
          categories: db.categories.slice().sort((a, b) => a.sort - b.sort),
          products: db.products.slice().sort((a, b) => a.sort - b.sort),
          groups: db.groups.slice().sort((a, b) => a.sort - b.sort).map(g => Object.assign({}, g, { modifiers: db.modifiers.filter(m => m.group_id === g.id).sort((a, b) => a.sort - b.sort) }))
        }));
      },
      async placeOrder(p) {
        await wait();
        const s = db.settings;
        const ctr = !!p.counter;   // заказ у стойки: вносит бариста
        if (ctr && !isStaff()) fail('Нет доступа');
        if (!ctr && !s.accepting_orders) fail('Сейчас мы не принимаем онлайн-заказы. Загляните к нам лично!');
        const name = String(p.customer_name || '').trim() || (ctr ? 'Гость' : ''); if (!name) fail('Укажите имя');
        const ful = ctr ? 'pickup' : (p.fulfillment || 'pickup'), pay = p.payment_method || (ctr ? 'place' : 'kaspi');
        if (ctr && pay !== 'kaspi' && pay !== 'place') fail('Неизвестный способ оплаты');
        const code = ctr ? '' : String(p.partner || '').trim().toLowerCase();
        const pt = code ? db.partners.find(x => x.code === code && x.active) : null;
        const toPt = !!pt && ful === 'delivery' && !!p.to_partner;
        if (toPt && !pt.delivery_enabled) fail('Доставка в «' + pt.name + '» сейчас недоступна. Можно оформить самовывоз');
        if (ful === 'delivery' && !s.delivery_enabled && !toPt) fail('Доставка пока недоступна');
        if (!ctr && (pay === 'kaspi' || ful === 'delivery') && U.digits(p.customer_phone).length < 10) fail('Укажите номер телефона: на него придёт счёт в Kaspi');
        if (!p.items || !p.items.length) fail('Корзина пуста');
        const lead = toPt ? pt.delivery_minutes : ful === 'delivery' ? s.delivery_minutes : s.prep_minutes;
        const ctrStatus = p.status === 'completed' ? 'completed' : 'accepted';
        let ready;
        if (ctr) ready = new Date(Date.now() + (ctrStatus === 'completed' ? 0 : s.prep_minutes) * 60000).toISOString();
        else if (p.asap !== false) { const st = U.shopState(s); if (!st.isOpen) fail('Сейчас мы закрыты. Выберите время, когда заберёте заказ'); ready = new Date(Date.now() + lead * 60000).toISOString(); }
        else { ready = p.ready_at; if (new Date(ready).getTime() < Date.now() + (lead - 1) * 60000) fail('К этому времени не успеем. Выберите время не раньше чем через ' + lead + ' мин'); }
        const items = [];
        let sub = 0;
        for (const it of p.items) {
          const pr = db.products.find(x => x.id === it.product_id && x.active);
          if (!pr) fail('Одна из позиций больше не продаётся. Обновите меню');
          if (!pr.available) fail('«' + pr.name + '» закончился, уберите его из заказа');
          let unit, size = null;
          if (pr.sizes.length) { const z = pr.sizes.find(x => x.label === it.size); if (!z) fail('Выберите размер для «' + pr.name + '»'); unit = Number(z.price); size = (z.label + ' ' + (z.volume || '')).trim(); }
          else unit = Number(pr.price || 0);
          const mods = (it.modifier_ids || []).map(mid => {
            const m = db.modifiers.find(x => x.id === mid);
            if (!m || !m.active || pr.modifier_group_ids.indexOf(m.group_id) < 0) fail('Добавка к «' + pr.name + '» недоступна, обновите меню');
            unit += Number(m.price);
            return { id: m.id, name: m.name, price: m.price, group_id: m.group_id, is_default: m.is_default };
          });
          const qty = Math.max(1, Math.min(20, Number(it.qty) || 1));
          sub += unit * qty;
          items.push({ id: U.uuid(), product_id: pr.id, name: pr.name, size, modifiers: mods, unit_price: unit, qty, line_total: unit * qty });
        }
        let fee = 0;
        let dkm = null, dlat = null, dlng = null;
        const cnt = items.reduce((a, i) => a + i.qty, 0);
        if (toPt) {
          dlat = pt.lat; dlng = pt.lng;
          if (dlat != null && U.hasZone(s)) dkm = Math.round(U.kmBetween([s.shop_lat, s.shop_lng], [dlat, dlng]) * 100) / 100;
          fee = U.partnerFee(pt, cnt);
        } else if (ful === 'delivery') {
          if (sub < s.delivery_min_order) fail('Минимальный заказ на доставку ' + s.delivery_min_order + ' ₸');
          if (!String(p.delivery_address || '').trim()) fail('Укажите адрес доставки');
          dlat = p.delivery_lat != null ? Number(p.delivery_lat) : null; dlng = p.delivery_lng != null ? Number(p.delivery_lng) : null;
          if (U.hasZone(s)) {
            if (dlat == null || dlng == null) fail('Отметьте адрес на карте, чтобы мы проверили зону доставки');
            dkm = Math.round(U.kmBetween([s.shop_lat, s.shop_lng], [dlat, dlng]) * 100) / 100;
            if (dkm > Number(s.delivery_radius_km)) fail('Этот адрес в ' + U.km(dkm) + ' от нас, а доставляем в радиусе ' + U.km(Number(s.delivery_radius_km)) + '. Можно оформить самовывоз');
          }
          fee = U.deliveryFee(s, sub);
        }
        const n = U.tzNow(s.timezone), bd = n.y + '-' + String(n.m).padStart(2, '0') + '-' + String(n.d).padStart(2, '0');
        const num = db.orders.filter(o => o.business_date === bd).reduce((a, o) => Math.max(a, o.number), 0) + 1;
        const u = me();
        const now = new Date().toISOString();
        const o = {
          id: U.uuid(), number: num, business_date: bd, user_id: u && !ctr ? u.id : null, guest_token: U.uuid(),
          customer_name: name, customer_phone: U.normPhone(p.customer_phone), fulfillment: ful, asap: ctr || p.asap !== false, ready_at: ready,
          delivery_address: toPt ? pt.name + (pt.address ? ', ' + pt.address : '') : ful === 'delivery' ? p.delivery_address : null,
          delivery_details: toPt ? (String(p.delivery_details || '').trim() || pt.place_hint) : ful === 'delivery' ? (p.delivery_details || '') : null,
          delivery_lat: ful === 'delivery' ? dlat : null, delivery_lng: ful === 'delivery' ? dlng : null, delivery_km: dkm,
          partner_id: pt ? pt.id : null, partner_name: pt ? pt.name : null, to_partner: toPt,
          comment: String(p.comment || '').trim(), payment_method: pay, payment_status: ctr && p.paid ? 'paid' : 'unpaid',
          status: ctr ? ctrStatus : 'new', cancel_reason: null, source: ctr ? 'counter' : 'online',
          subtotal: sub, delivery_fee: fee, total: sub + fee, created_at: now, updated_at: now, items
        };
        db.orders.push(o);
        if (u && !ctr) { if (!u.name) u.name = name; if (!u.phone) u.phone = o.customer_phone; }
        save({ eventType: 'INSERT', new: o });
        return { id: o.id, number: o.number, token: o.guest_token, total: o.total, ready_at: o.ready_at, status: o.status, counter: ctr };
      },
      async counterOrder(p) { if (!isStaff()) fail('Нет доступа'); return api.placeOrder(Object.assign({}, p, { counter: true })); },
      async getOrder(id, token) {
        await wait();
        const o = db.orders.find(x => x.id === id);
        const u = me();
        if (!o || !(o.guest_token === token || (u && o.user_id === u.id) || isStaff())) return null;
        const r = withItems(o); delete r.guest_token; return r;
      },
      async getGuestOrders(pairs) {
        await wait();
        return (pairs || []).map(pr => db.orders.find(o => o.id === pr.id && o.guest_token === pr.token)).filter(Boolean)
          .sort((a, b) => b.created_at.localeCompare(a.created_at)).map(o => { const r = withItems(o); delete r.guest_token; return r; });
      },
      async cancelOrder(id, token) {
        await wait();
        const o = db.orders.find(x => x.id === id); const u = me();
        if (!o || !(o.guest_token === token || (u && o.user_id === u.id))) fail('Заказ не найден');
        if (o.status !== 'new') fail('Заказ уже готовят. Напишите нам, если нужно его отменить');
        o.status = 'cancelled'; o.cancel_reason = 'Отменён гостем'; o.updated_at = new Date().toISOString();
        save({ eventType: 'UPDATE', new: o });
        return withItems(o);
      },

      /* вход */
      googleEnabled: false,
      async getUser() { const u = me(); return u ? { id: u.id, email: u.email } : null; },
      onAuth(cb) { authCbs.add(cb); return () => authCbs.delete(cb); },
      async signUp(email, password, name) {
        await wait();
        email = String(email || '').trim().toLowerCase();
        if (!/^\S+@\S+\.\S+$/.test(email)) fail('Проверьте email');
        if (String(password || '').length < 6) fail('Пароль должен быть не короче 6 символов');
        if (db.users.find(u => u.email === email)) fail('Такой email уже зарегистрирован. Войдите');
        const u = { id: U.uuid(), email, password, name: name || '', phone: '', role: db.users.length === 0 ? 'admin' : 'guest', created_at: new Date().toISOString() };
        db.users.push(u); db.session = u.id; save(); emitAuth('SIGNED_IN');
        return { needsConfirm: false };
      },
      async signIn(email, password) {
        await wait();
        const u = db.users.find(x => x.email === String(email || '').trim().toLowerCase());
        if (!u || u.password !== password) fail('Неверный email или пароль');
        db.session = u.id; save(); emitAuth('SIGNED_IN');
      },
      async signInGoogle() { fail('В демо-режиме вход через Google недоступен'); },
      async resetPassword() { await wait(); fail('В демо-режиме письма не отправляются'); },
      async updatePassword() { await wait(); },
      async signOut() { db.session = null; save(); emitAuth('SIGNED_OUT'); },
      async getProfile() { const u = me(); if (!u) return null; const r = clone(u); delete r.password; return r; },
      async updateProfile(patch) { const u = me(); if (!u) fail('Войдите в аккаунт'); if (patch.name != null) u.name = patch.name; if (patch.phone != null) u.phone = patch.phone; save(); },
      async claimOrders(pairs) {
        const u = me(); if (!u) return 0; let n = 0;
        (pairs || []).forEach(pr => { const o = db.orders.find(x => x.id === pr.id && x.guest_token === pr.token && !x.user_id); if (o) { o.user_id = u.id; n++; } });
        save(); return n;
      },
      async myOrders() {
        await wait(); const u = me(); if (!u) return [];
        return db.orders.filter(o => o.user_id === u.id).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 30).map(o => { const r = withItems(o); delete r.guest_token; return r; });
      },
      /* демо-вход для персонала */
      async demoStaffLogin(role) {
        const email = role === 'admin' ? 'owner@demo.kz' : 'barista@demo.kz';
        let u = db.users.find(x => x.email === email);
        if (!u) { u = { id: U.uuid(), email, password: 'demo', name: role === 'admin' ? 'Владелец' : 'Бариста', phone: '', role, created_at: new Date().toISOString() }; db.users.push(u); }
        u.role = role; db.session = u.id; save(); emitAuth('SIGNED_IN');
      },

      /* персонал */
      async listOrders() {
        await wait();
        if (!isStaff()) fail('Нет доступа');
        const n = U.tzNow(db.settings.timezone), bd = n.y + '-' + String(n.m).padStart(2, '0') + '-' + String(n.d).padStart(2, '0');
        return clone(db.orders.filter(o => o.business_date === bd || ['new', 'accepted', 'ready', 'on_the_way'].includes(o.status)))
          .sort((a, b) => b.created_at.localeCompare(a.created_at)).map(o => { delete o.guest_token; return o; });
      },
      async statsOrders(from, to) {
        await wait(); if (!isAdmin()) fail('Нет доступа');
        return clone(db.orders.filter(o => o.business_date >= from && o.business_date <= to)).map(o => { delete o.guest_token; return o; });
      },
      async updateOrder(id, patch) {
        await wait(); if (!isStaff()) fail('Нет доступа');
        const o = db.orders.find(x => x.id === id); if (!o) fail('Заказ не найден');
        Object.assign(o, patch, { updated_at: new Date().toISOString() });
        save({ eventType: 'UPDATE', new: o });
        return withItems(o);
      },
      subscribeOrders(cb, onState) {
        listeners.add(cb); if (onState) onState('live');
        return () => listeners.delete(cb);
      },
      async setAvailable(id, v) { if (!isStaff()) fail('Нет доступа'); const p = db.products.find(x => x.id === id); if (p) p.available = v; save(); },
      async setAccepting(v) { if (!isStaff()) fail('Нет доступа'); db.settings.accepting_orders = v; save(); },
      async setModifierActive(id, v) { if (!isStaff()) fail('Нет доступа'); const m = db.modifiers.find(x => x.id === id); if (m) m.active = v; save(); },

      /* админ */
      async saveSettings(patch) { if (!isAdmin()) fail('Нет доступа'); Object.assign(db.settings, patch); save(); return clone(db.settings); },
      async saveCategory(c) { if (!isAdmin()) fail('Нет доступа'); const r = upsert(db.categories, Object.assign({ active: true, sort: db.categories.length + 1 }, c)); save(); return clone(r); },
      async deleteCategory(id) { if (!isAdmin()) fail('Нет доступа'); db.categories = db.categories.filter(c => c.id !== id); db.products.forEach(p => { if (p.category_id === id) p.category_id = null; }); save(); },
      async saveProduct(p) { if (!isAdmin()) fail('Нет доступа'); const r = upsert(db.products, Object.assign({ available: true, active: true, sort: db.products.length + 1, sizes: [], modifier_group_ids: [] }, p)); save(); return clone(r); },
      async deleteProduct(id) { if (!isAdmin()) fail('Нет доступа'); db.products = db.products.filter(p => p.id !== id); save(); },
      async uploadProductPhoto(id, blobs) {
        if (!isAdmin()) fail('Нет доступа');
        // в демо фото хранятся прямо в браузере
        const [full, thumb] = await Promise.all([window.CafePhoto.toDataURL(blobs.full), window.CafePhoto.toDataURL(blobs.thumb)]);
        return { url: full, thumb };
      },
      async saveGroup(g) { if (!isAdmin()) fail('Нет доступа'); const r = upsert(db.groups, Object.assign({ multi: false, sort: db.groups.length + 1 }, g)); save(); return clone(r); },
      async deleteGroup(id) { if (!isAdmin()) fail('Нет доступа'); db.groups = db.groups.filter(g => g.id !== id); db.modifiers = db.modifiers.filter(m => m.group_id !== id); db.products.forEach(p => { p.modifier_group_ids = p.modifier_group_ids.filter(x => x !== id); }); save(); },
      async saveModifier(m) { if (!isAdmin()) fail('Нет доступа'); const r = upsert(db.modifiers, Object.assign({ active: true, is_default: false, price: 0, sort: 99 }, m)); save(); return clone(r); },
      async deleteModifier(id) { if (!isAdmin()) fail('Нет доступа'); db.modifiers = db.modifiers.filter(m => m.id !== id); save(); },
      async listTeam() { if (!isAdmin()) fail('Нет доступа'); return clone(db.users.filter(u => u.role !== 'guest')).map(u => { delete u.password; return u; }); },
      async setRole(email, role) {
        if (!isAdmin()) fail('Нет доступа');
        const u = db.users.find(x => x.email === String(email).trim().toLowerCase());
        if (!u) fail('Пользователь ' + email + ' ещё не зарегистрирован. Пусть сначала создаст аккаунт в приложении');
        if (u.id === db.session && role !== 'admin') fail('Нельзя снять права администратора с самого себя');
        u.role = role; save();
      },
      /* партнёры */
      async getPartner(code) {
        await wait(); const pt = db.partners.find(x => x.code === String(code || '').trim().toLowerCase() && x.active);
        return pt ? { code: pt.code, name: pt.name, address: pt.address, place_hint: pt.place_hint, delivery_enabled: pt.delivery_enabled, delivery_fee: pt.delivery_fee, delivery_free_qty: pt.delivery_free_qty, delivery_minutes: pt.delivery_minutes } : null;
      },
      async listPartners() { await wait(); if (!isAdmin()) fail('Нет доступа'); return clone(db.partners).sort((a, b) => (b.active - a.active) || a.name.localeCompare(b.name, 'ru')); },
      async savePartner(p) {
        await wait(); if (!isAdmin()) fail('Нет доступа');
        if (!/^[a-z0-9][a-z0-9-]{1,23}$/.test(p.code || '')) fail('Код: латиница, цифры и дефис, от 2 до 24 символов');
        if (db.partners.some(x => x.code === p.code && x.id !== p.id)) fail('Такой код уже занят другим партнёром');
        const r = upsert(db.partners, Object.assign(p.id ? {} : { stats_token: U.uuid(), created_at: new Date().toISOString(), active: true }, p)); save(); return clone(r);
      },
      async partnerReport(month) {
        await wait(); if (!isAdmin()) fail('Нет доступа');
        return db.partners.slice().sort((a, b) => (b.active - a.active) || a.name.localeCompare(b.name, 'ru')).map(p => Object.assign(
          { id: p.id, code: p.code, name: p.name, active: p.active, payout_phone: p.payout_phone, payout_name: p.payout_name, stats_token: p.stats_token },
          U.partnerMonth(p, db.orders, db.payouts, month)));
      },
      async setPartnerPaid(partnerId, month, amount, note) {
        await wait(); if (!isAdmin()) fail('Нет доступа');
        const period = U.monthStart(month);
        db.payouts = db.payouts.filter(x => !(x.partner_id === partnerId && x.period === period));
        db.payouts.push({ id: U.uuid(), partner_id: partnerId, period, amount: Math.max(0, Math.round(Number(amount) || 0)), note: note || '', paid_at: new Date().toISOString() }); save();
      },
      async unsetPartnerPaid(partnerId, month) { await wait(); if (!isAdmin()) fail('Нет доступа'); const period = U.monthStart(month); db.payouts = db.payouts.filter(x => !(x.partner_id === partnerId && x.period === period)); save(); },
      async partnerStats(token, month) {
        await wait();
        const p = db.partners.find(x => x.stats_token === token); if (!p) fail('Ссылка недействительна. Попросите новую у кофейни');
        const m = U.monthStart(month || U.todayStr(db.settings.timezone));
        const history = [1, 2, 3, 4, 5].map(k => { const r = U.partnerMonth(p, db.orders, db.payouts, U.addMonths(m, -k)); delete r.days; return r; });
        return Object.assign({ name: p.name, active: p.active, shop: db.settings.name, history }, U.partnerMonth(p, db.orders, db.payouts, m));
      },
      /* уведомления: в демо сервера нет, панель показывает их сама, пока открыта */
      async pushKey() { return null; },
      async pushStatus() { if (!isStaff()) fail('Нет доступа'); return { configured: false, demo: true, pg_net: false, mine: 0, team: null }; },
      async pushSubscribe() { fail('В демо-режиме нет сервера уведомлений'); },
      async pushUnsubscribe() { },
      async pushTest() { fail('В демо-режиме нет сервера уведомлений'); },
      async orderPushSubscribe() { return { configured: false, demo: true }; },
      async orderPushUnsubscribe() { },
      async resetDemo() { U.store.del(KEY); location.reload(); }
    };
    return api;
  }

  /* ===================================================================
     LIVE (Supabase)
     =================================================================== */
  function makeLive() {
    const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    const base = () => location.origin + location.pathname;
    const msg = (error) => {
      const m = (error && (error.message || error.error_description)) || 'Что-то пошло не так';
      if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз';
      if (/Invalid login credentials/i.test(m)) return 'Неверный email или пароль';
      if (/User already registered/i.test(m)) return 'Такой email уже зарегистрирован. Войдите';
      if (/Email not confirmed/i.test(m)) return 'Подтвердите email по ссылке из письма';
      if (/Password should be at least/i.test(m)) return 'Пароль должен быть не короче 6 символов';
      if (/email address.*invalid|Unable to validate email/i.test(m)) return 'Проверьте email';
      if (/rate limit/i.test(m)) return 'Слишком много попыток. Подождите немного';
      if (/not authorized/i.test(m)) return 'Письмо не отправлено: в Supabase не настроена почта (SMTP). См. инструкцию';
      if (/partners_code_key/i.test(m)) return 'Такой код уже занят другим партнёром';
      if (/partners_code_check/i.test(m)) return 'Код: латиница, цифры и дефис, от 2 до 24 символов';
      if (/function public\.push_|Could not find the function public\.push_/i.test(m)) return 'В базе нет функций уведомлений. Выполните новый schema.sql в Supabase';
      if (/counter_order|column orders\.source|source.*does not exist/i.test(m)) return 'В базе нет заказов у стойки. Выполните новый schema.sql в Supabase';
      if (/relation "public\.partner|function public\.(partner|get_partner)|Could not find the function public\.(partner|get_partner)|partners.*schema cache/i.test(m)) return 'В базе нет раздела партнёров. Выполните новый schema.sql в Supabase';
      return m;
    };
    const q = async (promise) => { const { data, error } = await promise; if (error) throw new Error(msg(error)); return data; };
    const rpc = (fn, args) => q(sb.rpc(fn, args));
    const ACTIVE = ['new', 'accepted', 'ready', 'on_the_way'];
    const norm = o => { if (!o) return o; if (o.order_items && !o.items) { o.items = o.order_items; delete o.order_items; } return o; };
    const startOfDay = async () => { const s = await q(sb.from('settings').select('timezone').eq('id', 1).single()); const n = U.tzNow(s.timezone); return U.zoned(n.y, n.m, n.d, 0, s.timezone).toISOString(); };
    const clean = (obj, keys) => { const r = {}; keys.forEach(k => { if (obj[k] !== undefined) r[k] = obj[k]; }); return r; };

    return {
      mode: 'live',
      sb,
      async getSettings() {
        const s = await q(sb.from('settings').select('*').eq('id', 1).single());
        s.open_time = String(s.open_time).slice(0, 5); s.close_time = String(s.close_time).slice(0, 5);
        return s;
      },
      async getMenu() {
        const [cats, prods, groups, mods] = await Promise.all([
          q(sb.from('categories').select('*').order('sort')),
          q(sb.from('products').select('*').order('sort')),
          q(sb.from('modifier_groups').select('*').order('sort')),
          q(sb.from('modifiers').select('*').order('sort'))
        ]);
        return { categories: cats, products: prods, groups: groups.map(g => Object.assign({}, g, { modifiers: mods.filter(m => m.group_id === g.id) })) };
      },
      placeOrder: (p) => rpc('place_order', { p }),
      counterOrder: (p) => rpc('counter_order', { p }),
      getOrder: (id, token) => rpc('get_order', { p_id: id, p_token: token || null }),
      getGuestOrders: (pairs) => rpc('get_guest_orders', { p_pairs: pairs || [] }),
      cancelOrder: (id, token) => rpc('cancel_order', { p_id: id, p_token: token || null }),

      googleEnabled: !!CFG.GOOGLE_LOGIN,
      async getUser() { const { data } = await sb.auth.getSession(); return data.session ? data.session.user : null; },
      onAuth(cb) { const { data } = sb.auth.onAuthStateChange((ev, session) => setTimeout(() => cb(ev, session ? session.user : null), 0)); return () => data.subscription.unsubscribe(); },
      async signUp(email, password, name) {
        const data = await q(sb.auth.signUp({ email: String(email).trim(), password, options: { data: { name }, emailRedirectTo: base() + '#profile' } }));
        return { needsConfirm: !data.session };
      },
      async signIn(email, password) { await q(sb.auth.signInWithPassword({ email: String(email).trim(), password })); },
      async signInGoogle(back) { await q(sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: base() + (back || '#profile') } })); },
      async resetPassword(email) { await q(sb.auth.resetPasswordForEmail(String(email).trim(), { redirectTo: base() + '#profile' })); },
      async updatePassword(password) { await q(sb.auth.updateUser({ password })); },
      async signOut() { await sb.auth.signOut(); },
      async getProfile() {
        const u = await this.getUser(); if (!u) return null;
        return q(sb.from('profiles').select('*').eq('id', u.id).maybeSingle());
      },
      async updateProfile(patch) { const u = await this.getUser(); await q(sb.from('profiles').update(clean(patch, ['name', 'phone'])).eq('id', u.id)); },
      claimOrders: (pairs) => rpc('claim_orders', { p_pairs: pairs || [] }),
      async myOrders() {
        const u = await this.getUser(); if (!u) return [];
        return (await q(sb.from('orders').select('*, order_items(*)').eq('user_id', u.id).order('created_at', { ascending: false }).limit(30))).map(norm);
      },

      async listOrders() {
        const since = await startOfDay();
        const [active, today] = await Promise.all([
          q(sb.from('orders').select('*, order_items(*)').in('status', ACTIVE).order('created_at', { ascending: false }).limit(200)),
          q(sb.from('orders').select('*, order_items(*)').gte('created_at', since).order('created_at', { ascending: false }).limit(500))
        ]);
        const map = new Map(); active.concat(today).forEach(o => map.set(o.id, norm(o)));
        return Array.from(map.values()).sort((a, b) => b.created_at.localeCompare(a.created_at));
      },
      async statsOrders(from, to) {
        const cols = 'id, number, business_date, created_at, ready_at, status, cancel_reason, payment_method, payment_status, fulfillment, subtotal, delivery_fee, total, partner_name, to_partner, source, order_items(product_id, name, size, modifiers, qty, line_total)';
        const out = [], page = 1000;
        for (let i = 0; i < 50; i++) {
          const rows = await q(sb.from('orders').select(cols).gte('business_date', from).lte('business_date', to)
            .order('created_at', { ascending: true }).range(i * page, i * page + page - 1));
          rows.forEach(r => out.push(norm(r)));
          if (rows.length < page) break;
        }
        return out;
      },
      async updateOrder(id, patch) {
        return norm(await q(sb.from('orders').update(clean(patch, ['status', 'payment_status', 'cancel_reason'])).eq('id', id).select('*, order_items(*)').single()));
      },
      subscribeOrders(cb, onState) {
        const ch = sb.channel('orders-feed-' + Math.random().toString(36).slice(2))
          .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, async (payload) => {
            let row = payload.new;
            if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
              try { row = await rpc('get_order', { p_id: payload.new.id, p_token: null }) || row; } catch (e) { /* оставим как есть */ }
            }
            cb({ eventType: payload.eventType, new: row, old: payload.old });
          })
          .subscribe(status => { if (onState) onState(status === 'SUBSCRIBED' ? 'live' : (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') ? 'off' : 'connecting'); });
        return () => sb.removeChannel(ch);
      },
      setAvailable: (id, v) => rpc('set_available', { p_id: id, p_value: v }),
      setAccepting: (v) => rpc('set_accepting', { p_value: v }),
      setModifierActive: (id, v) => rpc('set_modifier_active', { p_id: id, p_value: v }),

      async saveSettings(patch) {
        const keys = ['name', 'address', 'whatsapp', 'kaspi_phone', 'timezone', 'open_time', 'close_time', 'prep_minutes', 'accepting_orders', 'pickup_enabled', 'pay_kaspi', 'pay_place', 'pay_online', 'delivery_enabled', 'delivery_fee', 'delivery_min_order', 'delivery_minutes', 'delivery_zone', 'shop_lat', 'shop_lng', 'delivery_radius_km', 'delivery_free_from'];
        await q(sb.from('settings').update(Object.assign(clean(patch, keys), { updated_at: new Date().toISOString() })).eq('id', 1));
        return this.getSettings();
      },
      saveCategory: (c) => q(sb.from('categories').upsert(clean(c, ['id', 'name', 'sort', 'active'])).select().single()),
      deleteCategory: (id) => q(sb.from('categories').delete().eq('id', id)),
      saveProduct: (p) => q(sb.from('products').upsert(clean(p, ['id', 'category_id', 'name', 'description', 'image_url', 'badge', 'price', 'sizes', 'modifier_group_ids', 'available', 'active', 'sort'])).select().single()),
      deleteProduct: (id) => q(sb.from('products').delete().eq('id', id)),
      async uploadProductPhoto(id, blobs) {
        const base = 'p/' + (id || 'new') + '-' + Date.now().toString(36);
        const up = async (path, blob) => {
          const { error } = await sb.storage.from('menu').upload(path, blob, { contentType: 'image/jpeg', cacheControl: '31536000', upsert: true });
          if (error) throw new Error(/row-level security|not authorized|Unauthorized/i.test(error.message) ? 'Нет прав на загрузку фото. Выполните в Supabase новый schema.sql' : /Bucket not found/i.test(error.message) ? 'В Supabase нет хранилища для фото. Выполните новый schema.sql' : msg(error));
        };
        await up(base + '-thumb.jpg', blobs.thumb);
        await up(base + '-full.jpg', blobs.full);
        return { url: sb.storage.from('menu').getPublicUrl(base + '-full.jpg').data.publicUrl };
      },
      saveGroup: (g) => q(sb.from('modifier_groups').upsert(clean(g, ['id', 'name', 'multi', 'sort'])).select().single()),
      async deleteGroup(id) {
        const prods = await q(sb.from('products').select('id, modifier_group_ids').contains('modifier_group_ids', [id]));
        for (const p of prods) await q(sb.from('products').update({ modifier_group_ids: p.modifier_group_ids.filter(x => x !== id) }).eq('id', p.id));
        await q(sb.from('modifier_groups').delete().eq('id', id));
      },
      saveModifier: (m) => q(sb.from('modifiers').upsert(clean(m, ['id', 'group_id', 'name', 'price', 'is_default', 'active', 'sort'])).select().single()),
      deleteModifier: (id) => q(sb.from('modifiers').delete().eq('id', id)),
      listTeam: () => rpc('list_team', {}),
      setRole: (email, role) => rpc('set_role', { p_email: email, p_role: role }),

      /* партнёры */
      getPartner: (code) => rpc('get_partner', { p_code: code }),
      listPartners: () => q(sb.from('partners').select('*').order('active', { ascending: false }).order('name')),
      savePartner: (p) => q(sb.from('partners').upsert(clean(p, ['id', 'code', 'name', 'address', 'place_hint', 'lat', 'lng', 'rate_pct', 'rate_high_pct', 'high_from_qty',
        'delivery_enabled', 'delivery_fee', 'delivery_free_qty', 'delivery_minutes', 'payout_phone', 'payout_name', 'note', 'active'])).select().single()),
      partnerReport: (month) => rpc('partner_report', { p_month: U.monthStart(month) }),
      setPartnerPaid: (partnerId, month, amount, note) => q(sb.from('partner_payouts').upsert(
        { partner_id: partnerId, period: U.monthStart(month), amount: Math.max(0, Math.round(Number(amount) || 0)), note: note || '', paid_at: new Date().toISOString() },
        { onConflict: 'partner_id,period' })),
      unsetPartnerPaid: (partnerId, month) => q(sb.from('partner_payouts').delete().eq('partner_id', partnerId).eq('period', U.monthStart(month))),
      partnerStats: (token, month) => rpc('partner_stats', { p_token: token, p_month: month ? U.monthStart(month) : null }),

      /* push-уведомления персоналу */
      async pushKey() {
        try { const r = await fetch('push/key', { cache: 'no-store' }); if (!r.ok) return null; const j = await r.json(); return j && j.publicKey ? j.publicKey : null; }
        catch (e) { return null; }
      },
      pushStatus: () => rpc('push_status', {}),
      pushSubscribe: (s) => rpc('push_subscribe', { p_endpoint: s.endpoint, p_p256dh: s.p256dh, p_auth: s.auth, p_device: s.device || '' }),
      pushUnsubscribe: (endpoint) => rpc('push_unsubscribe', { p_endpoint: endpoint }),
      pushTest: () => rpc('push_test', {}),
      /* push-уведомления гостю о его заказе */
      orderPushSubscribe: (id, token, s) => rpc('order_push_subscribe', { p_id: id, p_token: token || null, p_endpoint: s.endpoint, p_p256dh: s.keys.p256dh, p_auth: s.keys.auth }),
      orderPushUnsubscribe: (id, token, endpoint) => rpc('order_push_unsubscribe', { p_id: id, p_token: token || null, p_endpoint: endpoint })
    };
  }

  const configured = !!(CFG.SUPABASE_URL && CFG.SUPABASE_KEY);
  let api;
  if (!configured) api = makeDemo();
  else if (!window.supabase) {
    // ключи указаны, но библиотека не загрузилась — не уходим молча в демо, а показываем ошибку
    const fail = () => Promise.reject(new Error('Не загрузился файл js/vendor/supabase-2.117.2.js. Проверьте, что он есть на сервере, и обновите страницу.'));
    api = new Proxy({ mode: 'broken', googleEnabled: false, onAuth() { return () => { }; } }, { get: (t, k) => (k in t ? t[k] : fail) });
  } else api = makeLive();
  window.Cafe = { util: U, api };
})();
