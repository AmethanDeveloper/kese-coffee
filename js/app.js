/* =====================================================================
   Гостевое приложение: меню, корзина, оформление, статус, профиль, вход
   ===================================================================== */
(function () {
  'use strict';
  const { util: U, api: API } = window.Cafe;
  const esc = U.esc, money = U.money;
  const $ = (s, r) => (r || document).querySelector(s);
  const app = $('#app');

  const S = {
    settings: null, menu: null, idx: null,
    cart: U.store.get('cafe_cart', []),
    ful: U.store.get('cafe_ful', 'pickup'),
    guest: U.store.get('cafe_guest', { name: '', phone: '' }),
    myOrders: U.store.get('cafe_orders', []),      // [{ id, token, number, at }]
    lastCart: U.store.get('cafe_last_cart', null),
    user: null, profile: null,
    time: null, pay: null, form: {},
    sending: false, recovery: false, afterLogin: '#profile', loginTab: 'in',
    sheet: null, installEvt: null, poll: null, lastStatus: {}, adminLoaded: false,
    cat: 'all', q: '', searchOpen: false, pendingScroll: null,
    partner: null, ptFresh: false,
    curOrder: null, lastPay: {}, gn: {}, pushKey: null
  };
  const saveCart = () => U.store.set('cafe_cart', S.cart);
  const saveOrders = () => U.store.set('cafe_orders', S.myOrders.slice(0, 40));
  const pairs = () => S.myOrders.map(o => ({ id: o.id, token: o.token }));
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ------------------------------ мелочи ------------------------------ */
  let toastTimer;
  function toast(text, kind) {
    const t = $('#toast'); if (!t) return;
    t.textContent = text; t.className = 'toast' + (kind ? ' ' + kind : ''); t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
  }
  const go = h => { if (location.hash === h) route(); else location.hash = h; };
  const SV = (d, w) => '<svg viewBox="0 0 24 24" width="' + (w || 20) + '" height="' + (w || 20) + '" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' + d + '</svg>';
  const LOGO = '<svg class="logo" viewBox="0 0 44 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 21 L17 4 L24 12 L30 6 L42 21"/><path d="M11 21 L19 12.5"/><path d="M26 21 L32 14"/></svg>';
  const icon = {
    search: SV('<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>'),
    bag: SV('<path d="M5 8h14l-1 12H6L5 8Z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/>'),
    cup: SV('<path d="M6 8h12l-1.4 12.2a1 1 0 0 1-1 .8H8.4a1 1 0 0 1-1-.8L6 8Z"/><path d="M5 5.5h14V8H5z"/><path d="M9 3h6"/><path d="M8.5 13h7"/>', 18),
    cupBig: SV('<path d="M5 9h11v5a5.5 5.5 0 0 1-11 0V9Z"/><path d="M16 10.5h1.5a2.5 2.5 0 0 1 0 5H16"/><path d="M8 3.5c0 1.5 1.5 1.5 1.5 3M12 3.5c0 1.5 1.5 1.5 1.5 3"/>', 26),
    leaf: SV('<path d="M5 19C5 10 10 5 19 5c0 9-5 14-14 14Z"/><path d="M5 19l8-8"/>', 26),
    heart: SV('<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z"/>', 16),
    heartBig: SV('<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z"/>', 26),
    arrow: SV('<path d="M5 12h14M14 7l5 5-5 5"/>', 18),
    pin: SV('<path d="M12 21s-6.5-6.2-6.5-11.2a6.5 6.5 0 0 1 13 0C18.5 14.8 12 21 12 21Z"/><circle cx="12" cy="9.8" r="2.3"/>', 18),
    bell: SV('<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15Z"/><path d="M10 20a2 2 0 0 0 4 0"/>', 18),
    share: SV('<path d="M12 3v12"/><path d="M8 7l4-4 4 4"/><path d="M6 11H5v10h14V11h-1"/>', 18),
    phone: SV('<rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M12 7v7"/><path d="M9 11l3 3 3-3"/><path d="M10.5 18.5h3"/>', 20),
    user: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0"/></svg>',
    back: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M15 5l-7 7 7 7"/></svg>',
    wa: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3Z"/></svg>'
  };

  /* ------------------------------ запуск ------------------------------ */
  async function boot() {
    app.innerHTML = '<div class="boot"><span class="spinner" aria-hidden="true"></span><span>Загружаем меню…</span></div>';
    capturePartnerParam();
    try {
      const r = await Promise.all([API.getSettings(), API.getMenu()]);
      S.settings = r[0]; setMenu(r[1]);
    } catch (e) {
      app.innerHTML = '<div class="boot"><p class="err">' + esc(e.message) + '</p><button class="btn" onclick="location.reload()">Обновить</button></div>';
      return;
    }
    await loadPartner();
    fixFulfillment();
    try { S.user = await API.getUser(); } catch (e) { S.user = null; }
    if (S.user) S.profile = await API.getProfile().catch(() => null);

    API.onAuth(async (ev, user) => {
      if (ev === 'PASSWORD_RECOVERY') { S.recovery = true; S.user = user; go('#profile'); return; }
      if (ev === 'TOKEN_REFRESHED' || ev === 'INITIAL_SESSION' || ev === 'USER_UPDATED') { S.user = user; return; }
      if (ev === 'SIGNED_OUT') { S.user = null; S.profile = null; if (!isAdminRoute()) route(); return; }
      if (ev === 'SIGNED_IN') {
        const wasIn = S.user && user && S.user.id === user.id && S.profile;
        S.user = user;
        if (wasIn) return;
        S.profile = await API.getProfile().catch(() => null);
        if (!isAdminRoute()) { try { const n = await API.claimOrders(pairs()); if (n > 0) toast('Заказы без регистрации добавлены в аккаунт'); } catch (e) { /* не критично */ } }
        if (location.hash === '#login') go(S.afterLogin || '#profile');
        else if (!isAdminRoute()) route();
      }
    });

    window.addEventListener('hashchange', route);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshMenu(); });
    setInterval(refreshMenu, 90000);
    setInterval(() => { if (currentView() === 'menu' || currentView() === 'cart') updateStatusOnly(); }, 60000);
    route();
  }
  function setMenu(m) { S.menu = m; S.idx = U.indexMenu(m); }
  function fixFulfillment() {
    const s = S.settings;
    if (S.ful === 'partner' && !ptDelivery()) S.ful = 'pickup';
    if (S.ful === 'delivery' && !s.delivery_enabled) S.ful = 'pickup';
    if (S.ful === 'pickup' && !s.pickup_enabled) S.ful = ptDelivery() ? 'partner' : s.delivery_enabled ? 'delivery' : 'pickup';
  }

  /* ---------- партнёр: гость отсканировал QR в автосервисе и т. п. (ссылка ?p=код) ---------- */
  function capturePartnerParam() {
    try {
      const u = new URL(location.href), c = (u.searchParams.get('p') || '').trim().toLowerCase();
      if (!c) return;
      U.store.set('kese_partner', { code: c.slice(0, 24), at: Date.now() }); S.ptFresh = true;
      u.searchParams.delete('p');
      history.replaceState(null, '', u.pathname + u.search + u.hash);
    } catch (e) { /* старый браузер — без партнёра */ }
  }
  function storedPartner() {
    const st = U.store.get('kese_partner', null);
    if (!st || !st.code) return null;
    if (Date.now() - Number(st.at || 0) > U.PARTNER_HOURS * 3600000) { U.store.del('kese_partner'); return null; }
    return st;
  }
  async function loadPartner() {
    const st = storedPartner(); if (!st) { S.partner = null; return; }
    try { S.partner = await API.getPartner(st.code); } catch (e) { S.partner = null; return; }
    if (!S.partner) { U.store.del('kese_partner'); return; }
    if (S.ptFresh && S.partner.delivery_enabled) { S.ful = 'partner'; U.store.set('cafe_ful', S.ful); }
  }
  const ptDelivery = () => !!(S.partner && S.partner.delivery_enabled);
  const ptCode = () => S.partner ? S.partner.code : ((storedPartner() || {}).code || null);
  const isDel = () => S.ful === 'delivery';
  const isPt = () => S.ful === 'partner' && ptDelivery();
  function curSlots() {
    if (isPt()) return U.slots(Object.assign({}, S.settings, { delivery_minutes: Number(S.partner.delivery_minutes) }), 'delivery');
    return U.slots(S.settings, S.ful === 'partner' ? 'pickup' : S.ful);
  }
  function curFee(sub) {
    if (isPt()) return U.partnerFee(S.partner, cartCount());
    return isDel() ? U.deliveryFee(S.settings, sub) : 0;
  }
  const ptName = () => !S.partner ? '' : /[«"„]/.test(S.partner.name) ? S.partner.name : '«' + S.partner.name + '»';
  function ptFeeText() {
    const p = S.partner, free = Number(p.delivery_free_qty);
    if (!Number(p.delivery_fee)) return 'Доставка бесплатно';
    return 'Доставка ' + money(p.delivery_fee) + (free > 0 ? ', от ' + free + ' ' + U.plural(free, 'позиции', 'позиций', 'позиций') + ' бесплатно' : '');
  }
  async function refreshMenu() {
    if (!S.settings || isAdminRoute()) return;
    try {
      const r = await Promise.all([API.getSettings(), API.getMenu()]);
      S.settings = r[0]; setMenu(r[1]); fixFulfillment();
      const v = currentView(); if ((v === 'menu' || v === 'cart') && !S.sheet && !S.sending && !isTyping()) route();
    } catch (e) { /* офлайн — покажем, что есть */ }
  }
  const isTyping = () => { const a = document.activeElement; return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA'); };
  const isAdminRoute = () => location.hash.indexOf('#admin') === 0;
  function currentView() { const h = location.hash; if (!h || h === '#' || h === '#menu') return 'menu'; return h.slice(1).split('/')[0]; }

  /* ------------------------------ маршруты ------------------------------ */
  function route() {
    clearInterval(S.poll); S.poll = null;
    closeSheet(true);
    if (isAdminRoute()) { S.cameFromAdmin = true; return loadAdmin(); }
    document.body.classList.remove('admin-mode');
    document.body.classList.add('guest');
    if (S.cameFromAdmin) { S.cameFromAdmin = false; S.lastHash = null; refreshMenu(); }
    const v = currentView();
    let html;
    if (v === 'cart') html = viewCart();
    else if (v === 'order') html = viewOrderShell();
    else if (v === 'profile') html = viewProfile();
    else if (v === 'login') html = viewLogin();
    else html = viewMenu();
    const y = window.scrollY, same = S.lastHash === location.hash;
    app.innerHTML = shell(html, v);
    window.scrollTo(0, same ? y : 0);
    S.lastHash = location.hash;
    if (same && S.refocus) { const el = app.querySelector(S.refocus); if (el) el.focus({ preventScroll: true }); }
    S.refocus = null;
    if (S.pendingScroll && v === 'menu') { const t = S.pendingScroll; S.pendingScroll = null; setTimeout(() => scrollToId(t), 30); }
    if (v === 'cart' && S.ful === 'delivery') mountDelMap();
    if (v === 'order') loadOrder(location.hash.split('/')[1]);
    if (v === 'profile') loadHistory();
    renderCartBar(v);
  }

  function shell(inner, v) {
    const s = S.settings, initial = S.profile && S.profile.name ? S.profile.name[0] : (S.guest.name ? S.guest.name[0] : '');
    const n = cartCount();
    return (API.mode === 'demo' ? '<div class="demo-bar"><div class="wrap">Демо-режим: заказы и аккаунты хранятся только в этом браузере. <a href="#admin">Открыть панель персонала</a></div></div>' : '') +
      '<header class="top"><div class="wrap top-in">' +
      '<a href="#menu" class="brand" aria-label="' + esc(s.name) + ', на главную">' + LOGO + '<span class="brand-txt"><b>' + esc(brandName(s.name)) + '</b><small>Қазақстан · кофе · адамдар</small></span></a>' +
      '<nav class="topnav" aria-label="Разделы сайта">' +
      '<a href="#menu" data-act="goto" data-v="top"' + (v === 'menu' ? ' aria-current="page"' : '') + '>Меню</a>' +
      '<a href="#menu" data-act="goto" data-v="about">О нас</a>' +
      '<a href="#menu" data-act="goto" data-v="contacts">Адрес и контакты</a></nav>' +
      '<div class="top-icons">' +
      (v === 'menu' ? '<button type="button" class="ibtn" data-act="search" aria-label="Поиск по меню" aria-expanded="' + !!S.searchOpen + '">' + icon.search + '</button>' : '') +
      '<a href="#cart" class="ibtn" aria-label="Корзина' + (n ? ', ' + n + ' ' + U.plural(n, 'позиция', 'позиции', 'позиций') : '') + '">' + icon.bag + (n ? '<span class="badge-n">' + n + '</span>' : '') + '</a>' +
      '<a href="#profile" class="ibtn' + (v === 'profile' || v === 'login' ? ' on' : '') + '" aria-label="Профиль">' + (initial ? '<span class="ava">' + esc(initial.toUpperCase()) + '</span>' : icon.user) + '</a>' +
      '<a href="#menu" class="btn-out" data-act="goto" data-v="menu">' + icon.cup + '<span>' + (isPt() ? 'Принести сюда' : isDel() ? 'Доставка' : 'На вынос') + '</span></a>' +
      '</div></div></header>' +
      '<main class="wrap page" id="main">' + inner + '</main>' + footerHTML();
  }
  const brandName = n => String(n || '').replace(/\s+/g, '') === 'KeseCoffee' ? 'KeseCoffee' : n;
  function footerHTML() {
    const s = S.settings;
    const gis = 'https://2gis.kz/search/' + encodeURIComponent(s.address || s.name);
    const wa = s.whatsapp ? 'https://wa.me/' + U.digits(s.whatsapp) : '';
    return '<footer class="site-foot" id="contacts"><div class="wrap">' +
      '<div class="sf-top">' +
      '<div class="sf-brand">' + LOGO + '<span class="brand-txt"><b>' + esc(brandName(s.name)) + '</b><small>Қазақстан · кофе · адамдар</small></span></div>' +
      '<div class="sf-col"><span class="sf-lab">Адрес</span><p>' + esc(s.address || '—') + '</p>' + (s.address ? '<a href="' + gis + '" target="_blank" rel="noopener">Открыть в 2ГИС</a>' : '') + '</div>' +
      '<div class="sf-col"><span class="sf-lab">Часы работы</span><p>Ежедневно ' + esc(s.open_time) + '–' + esc(s.close_time) + '</p>' + (wa ? '<a href="' + wa + '" target="_blank" rel="noopener">' + icon.wa + 'WhatsApp ' + esc(U.phoneFmt(s.whatsapp)) + '</a>' : '') + '</div>' +
      '<p class="sf-tag" lang="kk">Жақсы күн<br>кофеден басталады ' + icon.heart + '</p>' +
      '</div>' +
      '<img class="sf-corner l" src="assets/orn/corner.png" alt="" aria-hidden="true" loading="lazy"><img class="sf-corner r" src="assets/orn/corner.png" alt="" aria-hidden="true" loading="lazy">' +
      '<div class="sf-bot"><span>© ' + new Date().getFullYear() + ' ' + esc(brandName(s.name)) + '</span><a href="#admin">Вход для персонала</a><span class="sf-made">' + LOGO + 'Made in Kazakhstan</span></div>' +
      '</div></footer>';
  }
  function scrollToId(id) {
    const el = document.getElementById(id); if (!el) return;
    if (id === 'top') return window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
    const y = el.getBoundingClientRect().top + window.scrollY - 76;
    window.scrollTo({ top: Math.max(0, y), behavior: reduce ? 'auto' : 'smooth' });
  }
  function statusText() {
    const s = S.settings, st = U.shopState(s);
    if (!s.accepting_orders) return { cls: 'closed', text: 'Онлайн-заказы на паузе' };
    if (st.isOpen) return { cls: 'open', text: 'Открыто до ' + s.close_time };
    if (st.beforeOpen) return { cls: 'closed', text: 'Закрыто · откроемся в ' + s.open_time };
    return { cls: 'closed', text: 'Закрыто · откроемся завтра в ' + s.open_time };
  }
  function updateStatusOnly() { const el = $('#shopStatus'); if (!el) return; const t = statusText(); el.className = 'status ' + t.cls; el.textContent = t.text; }

  /* ------------------------------ меню ------------------------------ */
  function menuData() {
    const prods = S.menu.products.filter(p => p.active);
    const cats = S.menu.categories.filter(c => c.active && prods.some(p => p.category_id === c.id)).slice();
    const orphan = prods.filter(p => !cats.some(c => c.id === p.category_id));
    if (orphan.length) cats.push({ id: '_other', name: 'Другое' });
    if (S.cat !== 'all' && !cats.some(c => c.id === S.cat)) S.cat = 'all';
    return { prods, cats, orphan };
  }
  function viewMenu() {
    const s = S.settings, st = statusText();
    const { cats } = menuData();
    const active = activeOrder();
    const many = fulOptions().length > 1;
    let h = '';
    if (S.partner) {
      h += '<div class="pt-bar" role="note"><span class="pt-ic" aria-hidden="true">' + icon.pin + '</span><p><b>Вы в ' + esc(ptName()) + '</b>' +
        (ptDelivery() ? ' · принесём кофе прямо сюда примерно за ' + Number(S.partner.delivery_minutes) + ' мин' : ' · закажите кофе заранее и заберите без очереди') + '</p>' +
        '<button type="button" class="linkbtn" data-act="pt-clear">Я не здесь</button></div>';
    }
    h += '<section class="hero" id="top">' +
      '<div class="hero-txt">' +
      '<p class="eyebrow">' + (isPt() ? 'Доставка в ' + esc(ptName()) : isDel() ? 'Доставка по району' : 'Предзаказ · кофе с собой') + '</p>' +
      '<h1>' + esc(s.name) + '</h1>' +
      '<p class="hero-sub">Когда вкус вдохновляет</p>' +
      '<p class="lead">' + (isPt()
        ? 'Закажите здесь, и мы принесём кофе прямо в ' + esc(ptName()) + ' примерно за ' + Number(S.partner.delivery_minutes) + ' минут. ' + esc(ptFeeText()) + ', без минимальной суммы.'
        : isDel()
        ? 'Привезём горячим' + (U.hasZone(s) ? ' в радиусе ' + U.km(Number(s.delivery_radius_km)) + ' от кофейни' : '') + '. Доставка ' + money(s.delivery_fee) + (Number(s.delivery_free_from) > 0 ? ', бесплатно от ' + money(s.delivery_free_from) : '') + ', заказ от ' + money(s.delivery_min_order) + '.'
        : 'Свежий кофе, натуральные ингредиенты и казахское гостеприимство в каждом стакане. Закажите заранее и заберите без очереди.') + '</p>' +
      '<p class="meta"><span class="status ' + st.cls + '" id="shopStatus">' + esc(st.text) + '</span>' + (s.address ? '<span>' + esc(s.address) + '</span>' : '') + '</p>' +
      '<div class="hero-cta"><button type="button" class="btn btn-primary btn-cta" data-act="goto" data-v="menu">' + icon.cup + (isPt() ? 'Заказать сюда' : isDel() ? 'Заказать доставку' : 'На вынос') + icon.arrow + '</button>' + heroAppHTML() + (many ? fulToggle() : '') + '</div>' +
      '</div>' +
      '<div class="hero-img" role="img" aria-label="Стаканы ' + esc(s.name) + ' на каменной стойке"></div>' +
      '</section>';
    if (active) h += '<a class="active-order" href="#order/' + active.id + '"><span>Заказ <b>№' + active.number + '</b> оформлен</span><span>Статус →</span></a>';
    h += '<div class="menu-head" id="menuTop">' +
      '<div class="search' + (S.searchOpen || S.q ? '' : ' closed') + '"><label for="f-q" class="sr">Поиск по меню</label>' + icon.search + '<input id="f-q" type="search" placeholder="Найти напиток или десерт" autocomplete="off" value="' + esc(S.q || '') + '"></div>' +
      '<div class="cats-row"><nav class="cats" aria-label="Разделы меню">' +
      '<button type="button" class="chip" data-act="cat" data-id="all" aria-pressed="' + (S.cat === 'all') + '">Все</button>' +
      cats.map(c => '<button type="button" class="chip" data-act="cat" data-id="' + c.id + '" aria-pressed="' + (S.cat === c.id) + '">' + esc(c.name) + '</button>').join('') +
      '</nav><span class="orn-line" aria-hidden="true"><img src="assets/orn/divider.png" alt="" width="233" height="35"></span></div></div>';
    if (!S.cart.length && S.lastCart && S.lastCart.length) {
      const names = S.lastCart.map(l => { const p = S.idx.products[l.product_id]; return p ? p.name + (l.qty > 1 ? ' ×' + l.qty : '') : null; }).filter(Boolean);
      if (names.length) h += '<div class="repeat"><p>Как в прошлый раз: <b>' + esc(names.join(', ')) + '</b></p><button type="button" class="btn btn-ghost btn-sm" data-act="repeat-last">Повторить</button></div>';
    }
    h += '<div id="menuList">' + menuListHTML() + '</div>';
    h += '<div class="orn-strip" aria-hidden="true"><img src="assets/orn/border.png" alt="" width="308" height="53" loading="lazy"></div>' +
      '<section class="perks" id="about" aria-label="О нас">' +
      perk(icon.leaf, 'Только качественные зёрна', 'Проверенные поставщики и свежая обжарка') +
      perk(icon.cupBig, 'Быстро и удобно', 'Закажите заранее, приготовим к вашему приходу') +
      perk(icon.heartBig, 'Казахское гостеприимство', 'Тепло в каждом стакане') +
      '</section>';
    return h;
  }
  const perk = (ic, t, d) => '<div class="perk"><span class="perk-ic" aria-hidden="true">' + ic + '</span><div><h3>' + t + '</h3><p>' + d + '</p></div></div>';
  function menuListHTML() {
    const { prods, cats, orphan } = menuData();
    const q = (S.q || '').trim().toLowerCase();
    const match = p => !q || (p.name + ' ' + (p.description || '')).toLowerCase().indexOf(q) >= 0;
    const shown = cats.filter(c => S.cat === 'all' || S.cat === c.id);
    let h = shown.map(c => {
      const list = (c.id === '_other' ? orphan : prods.filter(p => p.category_id === c.id)).filter(match);
      if (!list.length) return '';
      return '<section class="cat" id="cat-' + c.id + '"><h2>' + esc(c.name) + '</h2>' + list.map(rowHTML).join('') + '</section>';
    }).join('');
    if (!prods.length) h = '<p class="empty-note">Меню пока пустое. Загляните чуть позже.</p>';
    else if (!h) h = '<p class="empty-note">' + (q ? 'По запросу «' + esc(S.q) + '» ничего не нашлось.' : 'В этом разделе пока пусто.') + '</p>';
    return h;
  }
  function refreshList() {
    const el = $('#menuList'); if (el) el.innerHTML = menuListHTML();
    document.querySelectorAll('.cats .chip').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.id === S.cat)));
  }
  function fulOptions() {
    const s = S.settings, o = [];
    if (ptDelivery()) o.push(['partner', 'Принести сюда']);
    if (s.pickup_enabled) o.push(['pickup', 'Самовывоз']);
    if (s.delivery_enabled) o.push(['delivery', 'Доставка']);
    return o;
  }
  function fulToggle() {
    const o = fulOptions();
    return '<div class="seg' + (o.length > 2 ? ' seg-3' : '') + '" role="radiogroup" aria-label="Способ получения">' +
      o.map(x => '<button type="button" role="radio" aria-checked="' + (S.ful === x[0]) + '" data-act="ful" data-v="' + x[0] + '">' + x[1] + '</button>').join('') + '</div>';
  }
  function rowHTML(p) {
    const off = !p.available;
    const inCart = S.cart.filter(l => l.product_id === p.id).reduce((a, l) => a + l.qty, 0);
    // для фирменных фото есть отдельные миниатюры со стаканом целиком; любое другое фото показываем целиком без обрезки
    const url = p.image_url || '';
    const builtIn = /(^|\/)assets\/products\/[^/]+\.jpg$/.test(url), uploaded = /-full\.jpg$/.test(url);
    const own = builtIn || uploaded || !!p.thumb_url;
    const tsrc = p.thumb_url || (builtIn ? url.replace(/assets\/products\/([^/]+)$/, 'assets/products/thumbs/$1') : uploaded ? url.replace(/-full\.jpg$/, '-thumb.jpg') : url);
    const thumb = p.image_url
      ? '<span class="thumb' + (own ? '' : ' fit') + '"><img src="' + esc(tsrc) + '" alt="" loading="lazy" decoding="async" onerror="this.parentNode.classList.add(\'ph\');this.remove()"></span>'
      : '<span class="thumb ph" aria-hidden="true"></span>';
    return '<button type="button" class="row' + (off ? ' off' : '') + '" data-act="open" data-id="' + p.id + '"' + (off ? ' disabled' : '') + '>' + thumb +
      '<span class="tx"><span class="nm">' + esc(p.name) + (p.badge ? ' <span class="hit">' + esc(p.badge) + '</span>' : '') + (inCart ? ' <span class="incart" aria-label="в корзине ' + inCart + '">' + inCart + '</span>' : '') + '</span>' +
      (p.description ? '<span class="ds">' + esc(p.description) + '</span>' : '') + '</span>' +
      (off ? '<span class="tag">Закончилось</span>' : '<span class="pr">' + (p.sizes && p.sizes.length > 1 ? '<small>от</small> ' : '') + money(U.minPrice(p)) + '</span>') +
      '<span class="plus" aria-hidden="true">+</span></button>';
  }
  function activeOrder() {
    const o = S.myOrders[0];
    if (!o) return null;
    if (Date.now() - new Date(o.at).getTime() > 3 * 3600 * 1000) return null;
    if (o.done) return null;
    return o;
  }

  /* ---------- «Скачать приложение»: установка сайта на экран телефона ---------- */
  const isAndroid = () => /Android/i.test(navigator.userAgent);
  function installMode() {
    if (U.standalone()) return null;                 // уже открыто как приложение
    if (S.installEvt) return 'prompt';               // Chrome/Android: системное окно установки
    if (U.store.get('kese_app_ok', 0)) return null;  // уже установили из этого браузера
    if (U.isIOS()) return 'ios';                     // iPhone: «Поделиться → На экран Домой»
    if (isAndroid() || API.mode === 'demo') return 'manual';
    return null;
  }
  // кнопка в первом экране, рядом с «На вынос»; в установленном приложении не показывается
  function heroAppHTML() {
    if (!installMode()) return '';
    return '<button type="button" class="btn btn-ghost btn-app" id="heroApp" data-act="app-install">' + icon.phone + 'Скачать приложение</button>';
  }
  function refreshAppBtn() {
    const el = $('#heroApp'), html = currentView() === 'menu' ? heroAppHTML() : '';
    if (el) { if (!html) el.remove(); return; }
    const cta = $('.hero-cta .btn-cta');
    if (html && cta) cta.insertAdjacentHTML('afterend', html);
  }
  // Сразу установить из сайта умеют Chrome и Edge (Android и компьютер). В остальных случаях — короткая инструкция.
  function openInstallSheet() {
    const ua = navigator.userAgent, ios = U.isIOS(), android = isAndroid();
    const inApp = /Instagram|FBAN|FBAV|FB_IAB|TikTok|musical_ly|Telegram|Line\/|; wv\)/.test(ua);   // браузер внутри Instagram, WhatsApp и т. п.
    const samsung = /SamsungBrowser/.test(ua), yandex = /YaBrowser/.test(ua);
    const chromeAndroid = android && /Chrome\//.test(ua) && !inApp && !samsung && !yandex && !/OPR|EdgA|Firefox/.test(ua);
    const toChrome = 'intent://' + location.host + location.pathname + '#Intent;scheme=https;package=com.android.chrome;end';
    let lead = '', steps, cta = '';
    if (ios) {
      if (inApp) lead = 'Сначала откройте сайт в Safari: нажмите «•••» в углу и «Открыть в браузере».';
      steps = [
        'Нажмите «Поделиться» ' + icon.share + (/CriOS|FxiOS|EdgiOS|YaBrowser/.test(ua) ? ' справа от адреса сайта' : ' внизу экрана Safari (иногда он спрятан под «•••»)'),
        'Выберите «На экран „Домой“»',
        'Нажмите «Добавить». Иконка Kese Coffee появится на экране'];
    } else if (android && !chromeAndroid) {
      lead = inApp ? 'Этот встроенный браузер не умеет ставить приложения. Откройте сайт в Chrome: там это одна кнопка.'
        : 'Быстрее всего установить из Chrome: откройте сайт в нём и нажмите «Скачать приложение» ещё раз.';
      cta = '<a class="btn btn-primary" href="' + esc(toChrome) + '">Открыть в Chrome</a>';
      steps = inApp ? ['Нажмите «Открыть в Chrome» (или меню ⋮ → «Открыть в браузере»)', 'В Chrome нажмите «Скачать приложение» ещё раз', 'Подтвердите «Установить». Иконка Kese Coffee появится на экране']
        : samsung ? ['Или здесь: меню ☰ внизу экрана', '«Добавить страницу на» → «Главный экран»', 'Подтвердите. Иконка Kese Coffee появится на экране']
        : ['Или здесь: меню ⋮ справа от адреса', '«Добавить на главный экран» или «Установить приложение»', 'Подтвердите. Иконка Kese Coffee появится на экране'];
    } else if (android) {
      lead = 'Если пункта нет — приложение уже установлено: ищите иконку Kese Coffee на экране.';
      steps = ['Нажмите меню ⋮ справа от адреса сайта', 'Выберите «Установить приложение» или «Добавить на главный экран»', 'Подтвердите. Иконка Kese Coffee появится на экране'];
    } else {
      if (API.mode === 'demo') lead = 'Это демо: здесь установка недоступна. На настоящем сайте в Chrome кнопка сразу открывает окно «Установить».';
      steps = ['Откройте сайт в Chrome или Edge', 'Нажмите значок установки ⊕ справа в адресной строке (или меню ⋮ → «Установить Kese Coffee»)', 'Подтвердите. Kese Coffee откроется отдельным окном'];
    }
    S.sheet = { kind: 'install', opener: document.activeElement };
    sheetRoot().innerHTML = '<div class="sheet-back enter" data-act="close"></div>' +
      '<div class="sheet install-sheet enter" role="dialog" aria-modal="true" aria-labelledby="ins-t" tabindex="-1">' +
      '<button type="button" class="x" data-act="close" aria-label="Закрыть">×</button>' +
      '<div class="ins-head"><img src="icons/icon-192.png" alt="" width="56" height="56"><div><h2 id="ins-t">Скачать приложение Kese Coffee</h2><p class="ins-sub">Бесплатно, без App Store и Play Маркета</p></div></div>' +
      (lead ? '<p class="ins-lead">' + esc(lead) + '</p>' : '') + cta +
      '<ol class="ins-steps">' + steps.map(s => '<li><span>' + s + '</span></li>').join('') + '</ol>' +
      (ios ? '<p class="hint">Открывайте Kese Coffee с этой иконки: только так iPhone пришлёт уведомление, что заказ готов.</p>' : '') +
      '<button type="button" class="btn ' + (cta ? 'btn-ghost' : 'btn-primary') + '" data-act="close">Понятно</button></div>';
    document.body.classList.add('noscroll');
    setTimeout(() => { const b = $('#sheet-root .sheet'); if (b) b.focus(); }, 30);
  }
  async function installApp() {
    if (!S.installEvt) return openInstallSheet();
    const ev = S.installEvt; S.installEvt = null;
    try { ev.prompt(); const r = await ev.userChoice; if (r && r.outcome === 'accepted') toast('Устанавливаем Kese Coffee на экран'); } catch (e) { /* окно не открылось */ }
    refreshAppBtn(); if (currentView() === 'profile') route();
  }

  /* ------------------------------ карточка товара ------------------------------ */
  function sheetRoot() { let r = $('#sheet-root'); if (!r) { r = document.createElement('div'); r.id = 'sheet-root'; document.body.appendChild(r); r.addEventListener('click', onSheetClick); r.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); }); } return r; }
  function openSheet(pid, preset) {
    const p = S.idx.products[pid]; if (!p || !p.available) return;
    const sh = { pid, qty: 1, size: null, sel: {}, opener: document.activeElement };
    if (p.sizes && p.sizes.length) sh.size = (p.sizes[p.sizes.length > 2 ? 1 : 0]).label;
    groupsOf(p).forEach(g => {
      const mods = g.modifiers.filter(m => m.active);
      if (g.multi) sh.sel[g.id] = [];
      else { const d = mods.find(m => m.is_default) || mods[0]; sh.sel[g.id] = d ? [d.id] : []; }
    });
    if (preset) Object.assign(sh, preset);
    S.sheet = sh; sh.enter = true; renderSheet(); sh.enter = false;
    document.body.classList.add('noscroll');
    setTimeout(() => { const b = $('#sheet-root .sheet'); if (b) b.focus(); }, 30);
  }
  function groupsOf(p) { return (p.modifier_group_ids || []).map(id => S.idx.groups[id]).filter(g => g && g.modifiers.some(m => m.active)).sort((a, b) => a.sort - b.sort); }
  function sheetMods() { return Object.values(S.sheet.sel).reduce((a, x) => a.concat(x), []); }
  function renderSheet() {
    const sh = S.sheet, p = S.idx.products[sh.pid];
    const unit = U.unitPrice(p, sh.size, sheetMods(), S.idx);
    let h = '<div class="sheet-back' + (sh.enter ? ' enter' : '') + '" data-act="close"></div><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sh-t" tabindex="-1">' +
      '<button type="button" class="x" data-act="close" aria-label="Закрыть">×</button>' +
      (p.image_url ? '<div class="sheet-img"><img src="' + esc(p.image_url) + '" alt="' + esc(p.name) + '" onerror="this.parentNode.remove()"></div>' : '') +
      '<h2 id="sh-t">' + esc(p.name) + '</h2>' + (p.description ? '<p class="muted">' + esc(p.description) + '</p>' : '');
    if (p.sizes && p.sizes.length) {
      h += '<div class="og"><span class="lab">Размер</span><div class="chips">' + p.sizes.map(z =>
        '<button type="button" class="chip" data-act="size" data-v="' + esc(z.label) + '" aria-pressed="' + (sh.size === z.label) + '">' + esc(z.label) + (z.volume ? ' · ' + esc(z.volume) : '') + ' <small>' + money(z.price) + '</small></button>').join('') + '</div></div>';
    }
    groupsOf(p).forEach(g => {
      h += '<div class="og"><span class="lab">' + esc(g.name) + (g.multi ? '' : '') + '</span><div class="chips">' + g.modifiers.filter(m => m.active).map(m =>
        '<button type="button" class="chip" data-act="mod" data-g="' + g.id + '" data-v="' + m.id + '" aria-pressed="' + (sh.sel[g.id].indexOf(m.id) >= 0) + '">' + esc(m.name) + (m.price ? ' <small>+' + money(m.price) + '</small>' : '') + '</button>').join('') + '</div></div>';
    });
    h += '<div class="sheet-foot"><div class="stepper" role="group" aria-label="Количество"><button type="button" data-act="qty" data-v="-1" aria-label="Меньше">−</button><span>' + sh.qty + '</span><button type="button" data-act="qty" data-v="1" aria-label="Больше">+</button></div>' +
      '<button type="button" class="btn btn-primary grow" data-act="add">' + (sh.editKey ? 'Сохранить' : 'Добавить') + ' · ' + money(unit * sh.qty) + '</button></div></div>';
    sheetRoot().innerHTML = h;
  }
  function onSheetClick(e) {
    const b = e.target.closest('[data-act]'); if (!b || !S.sheet) return;
    const sh = S.sheet, act = b.dataset.act;
    if (act === 'close') return closeSheet();
    if (sh.kind) return;                     // окно-инструкция: кроме «закрыть» действий нет
    if (act === 'size') { sh.size = b.dataset.v; }
    else if (act === 'mod') {
      const g = S.idx.groups[b.dataset.g], id = b.dataset.v, arr = sh.sel[g.id];
      if (g.multi) { const i = arr.indexOf(id); if (i >= 0) arr.splice(i, 1); else arr.push(id); }
      else sh.sel[g.id] = [id];
    }
    else if (act === 'qty') { sh.qty = Math.max(1, Math.min(20, sh.qty + Number(b.dataset.v))); }
    else if (act === 'add') {
      const mods = sheetMods().slice().sort();
      const key = sh.pid + '|' + (sh.size || '') + '|' + mods.join(',');
      if (sh.editKey) S.cart = S.cart.filter(l => l.key !== sh.editKey);
      const ex = S.cart.find(l => l.key === key);
      if (ex) ex.qty = Math.min(20, ex.qty + sh.qty); else S.cart.push({ key, product_id: sh.pid, size: sh.size, modifier_ids: mods, qty: sh.qty });
      saveCart();
      const name = S.idx.products[sh.pid].name;
      closeSheet();
      toast(name + ' в корзине');
      route();
      return;
    }
    const keep = b.dataset.act + (b.dataset.v || '');
    renderSheet();
    const again = $('#sheet-root [data-act="' + b.dataset.act + '"][data-v="' + (b.dataset.v || '') + '"]');
    if (again && keep) again.focus();
  }
  function closeSheet(silent) {
    const r = $('#sheet-root'); if (r) r.innerHTML = '';
    document.body.classList.remove('noscroll');
    if (S.sheet && !silent && S.sheet.opener && document.contains(S.sheet.opener)) S.sheet.opener.focus();
    S.sheet = null;
  }

  /* ------------------------------ корзина ------------------------------ */
  function cartLines() {
    return S.cart.map(l => {
      const p = S.idx.products[l.product_id];
      if (!p || !p.active) return Object.assign({}, l, { missing: true, name: 'Позиция больше не продаётся', unit: 0 });
      const mods = (l.modifier_ids || []).map(id => S.idx.mods[id]).filter(Boolean)
        .sort((a, b) => ((S.idx.groups[a.group_id] || {}).sort || 0) - ((S.idx.groups[b.group_id] || {}).sort || 0) || a.sort - b.sort);
      const z = p.sizes && p.sizes.length ? p.sizes.find(x => x.label === l.size) : null;
      return Object.assign({}, l, {
        name: p.name, soldOut: !p.available, unit: U.unitPrice(p, l.size, l.modifier_ids, S.idx),
        detail: [z ? (z.label + (z.volume ? ' ' + z.volume : '')) : '', U.modsText(mods)].filter(Boolean).join(' · ')
      });
    });
  }
  const cartTotal = () => cartLines().reduce((a, l) => a + (l.missing ? 0 : l.unit * l.qty), 0);
  const cartCount = () => S.cart.reduce((a, l) => a + l.qty, 0);
  function renderCartBar(v) {
    let bar = $('#cartbar');
    const show = v === 'menu' && S.cart.length > 0;
    if (!bar) { bar = document.createElement('div'); bar.id = 'cartbar'; bar.className = 'cartbar'; document.body.appendChild(bar); }
    bar.hidden = !show;
    document.body.classList.toggle('has-bar', show);
    if (show) bar.innerHTML = '<a href="#cart" class="cartbar-in"><span class="cb-count">' + cartCount() + '</span><span class="cb-text">Корзина</span><span class="cb-sum">' + money(cartTotal()) + '</span></a>';
  }

  function viewCart() {
    const s = S.settings, lines = cartLines();
    if (!lines.length) return '<a class="back" href="#menu">' + icon.back + 'Меню</a><div class="empty-block"><h1 class="h-page">Корзина пуста</h1><p class="muted">Выберите напиток в меню, и он появится здесь.</p><a href="#menu" class="btn btn-primary">Открыть меню</a></div>';
    const sl = curSlots();
    if (!S.time || (S.time.key !== 'custom' && !sl.list.find(x => x.key === S.time.key))) S.time = sl.list[0] || null;
    const name = S.form.name != null ? S.form.name : (S.profile && S.profile.name) || S.guest.name || '';
    const phone = S.form.phone != null ? S.form.phone : (S.profile && S.profile.phone) || S.guest.phone || '';
    const carried = isDel() || isPt();
    const pays = [];
    if (s.pay_kaspi) pays.push(['kaspi', 'Kaspi', 'Пришлём счёт на ваш номер после подтверждения']);
    if (s.pay_place) pays.push(['place', carried ? 'При получении' : 'На месте', carried ? 'Курьеру картой, QR или наличными' : 'Картой, QR или наличными на кассе']);
    if (s.pay_online) pays.push(['online', 'Картой онлайн', 'Оплата сразу при заказе']);
    if (!S.pay || !pays.find(x => x[0] === S.pay)) S.pay = U.store.get('cafe_pay', null);
    if (!S.pay || !pays.find(x => x[0] === S.pay)) S.pay = pays.length ? pays[0][0] : null;
    const sub = cartTotal(), fee = curFee(sub);
    const short = isDel() && sub < s.delivery_min_order;
    const zone = isDel() && U.hasZone(s);
    const out = zone && delState().out;
    const bad = lines.some(l => l.missing || l.soldOut);
    const timeNote = !sl.canNow ? (!S.settings.accepting_orders ? 'Сейчас онлайн-заказы на паузе.' : (sl.day === 1 ? 'Сейчас закрыто. Можно заказать на завтра.' : 'Мы ещё закрыты. Можно заказать заранее, с ' + s.open_time + '.')) : '';

    let h = '<a class="back" href="#menu">' + icon.back + 'Меню</a>' +
      '<div class="checkout"><div class="ticket">' +
      '<div class="t-head"><h1 class="t-title">Ваш заказ</h1><span class="code">' + cartCount() + ' ' + U.plural(cartCount(), 'позиция', 'позиции', 'позиций') + '</span></div>' +
      '<ul class="lines">' + lines.map((l, i) =>
        '<li class="line' + (l.missing || l.soldOut ? ' warn' : '') + '">' +
        '<button type="button" class="l-nm" data-act="edit" data-i="' + i + '"' + (l.missing ? ' disabled' : '') + '>' + esc(l.name) + '</button>' +
        '<span class="l-pr">' + (l.missing ? '' : money(l.unit * l.qty)) + '</span>' +
        '<span class="l-op">' + (l.soldOut ? '<b class="warn-t">Закончился, уберите из заказа</b>' : esc(l.detail || '')) + '</span>' +
        '<span class="qty"><button type="button" class="qb" data-act="lq" data-i="' + i + '" data-v="-1" aria-label="Убрать одну">−</button><span class="qn">' + l.qty + '</span><button type="button" class="qb" data-act="lq" data-i="' + i + '" data-v="1" aria-label="Добавить ещё"' + (l.missing ? ' disabled' : '') + '>+</button></span>' +
        '</li>').join('') + '</ul>' +
      '<div class="sum">' +
      (carried ? '<div><span>Позиции</span><span>' + money(sub) + '</span></div><div><span>Доставка</span><span>' + (fee ? money(fee) : 'бесплатно') + '</span></div>' : '') +
      '<div class="sum-total"><span>Итого</span><b>' + money(sub + fee) + '</b></div></div>' +
      '<div class="perf" aria-hidden="true"></div>' +
      '<form class="form" id="orderForm" novalidate>';
    if (fulOptions().length > 1) h += '<div class="field"><span class="lab">Как получить</span>' + fulToggle() + '</div>';
    if (isPt()) {
      const p = S.partner, free = Number(p.delivery_free_qty), left = free > 0 && fee > 0 ? free - cartCount() : 0;
      h += '<fieldset class="del"><legend class="lab">Куда принести</legend>' +
        '<div class="pt-to"><span class="pt-ic" aria-hidden="true">' + icon.pin + '</span><span><b>' + esc(p.name) + '</b>' + (p.address ? '<small>' + esc(p.address) + '</small>' : '') + '</span></div>' +
        '<label class="field" for="f-ptwhere"><span class="lab">Как вас найти</span><input id="f-ptwhere" type="text" maxlength="120" placeholder="' + esc(p.place_hint ? p.place_hint + ', ваша машина' : 'Зона ожидания, ваша машина') + '" value="' + esc(S.form.ptwhere || '') + '"></label>' +
        '<p class="hint">' + esc(ptFeeText()) + '. Без минимальной суммы.' + (left > 0 ? ' Добавьте ещё ' + left + ' ' + U.plural(left, 'позицию', 'позиции', 'позиций') + ', и доставка будет бесплатной.' : '') + '</p>' +
        '</fieldset>';
    }
    if (isDel()) {
      if (S.form.addr == null) S.form.addr = U.store.get('cafe_addr', '');
      if (S.form.lat == null) { const ll = U.store.get('cafe_addr_ll', null); if (ll) { S.form.lat = ll[0]; S.form.lng = ll[1]; } }
      h += '<fieldset class="del"><legend class="lab">Куда привезти</legend>' +
        '<div class="addr-row"><label for="f-addr" class="sr">Улица и дом</label><input id="f-addr" type="text" autocomplete="street-address" placeholder="Улица и дом, например Лепсы 40" value="' + esc(S.form.addr || '') + '">' +
        (zone ? '<button type="button" class="btn btn-sm" data-act="addr-find">Найти</button>' : '') + '</div>' +
        (zone ? '<div id="addrResults" class="addr-res" hidden></div>' +
          '<button type="button" class="linkbtn loc" data-act="addr-locate">' + icon.pin + 'Моё местоположение</button>' +
          '<div id="delMap" class="del-map" aria-label="Карта зоны доставки: нажмите, чтобы отметить место"></div>' +
          '<p class="del-info" id="delInfo" role="status">' + delInfoHTML() + '</p>' : '') +
        '<label class="field" for="f-addr2"><span class="lab">Квартира, подъезд, этаж</span><input id="f-addr2" type="text" placeholder="Кв. 12, подъезд 2, этаж 5" value="' + esc(S.form.addr2 || U.store.get('cafe_addr2', '')) + '"></label>' +
        (s.delivery_zone ? '<p class="hint">Зона доставки: ' + esc(s.delivery_zone) + '</p>' : '') +
        (short ? '<p class="hint warn-t">До минимальной суммы доставки не хватает ' + money(s.delivery_min_order - sub) + '</p>' : '') +
        (Number(s.delivery_free_from) > 0 && fee > 0 ? '<p class="hint">Доставка бесплатно от ' + money(s.delivery_free_from) + ', добавьте ещё на ' + money(s.delivery_free_from - sub) + '</p>' : '') +
        '</fieldset>';
    }
    h += '<fieldset><legend class="lab">' + (isPt() ? 'Когда принести' : isDel() ? 'Когда привезти' : 'Когда заберёте') + '</legend>' +
      (timeNote ? '<p class="hint">' + esc(timeNote) + '</p>' : '') +
      '<div class="chips">' + sl.list.map(x => '<button type="button" class="chip" data-act="time" data-v="' + x.key + '" aria-pressed="' + (!!S.time && S.time.key === x.key) + '">' + esc(x.label) + (x.sub ? ' <small>' + esc(x.sub) + '</small>' : '') + '</button>').join('') + '</div>' +
      '<label class="custom" for="f-time">Другое время' + (sl.day === 1 ? ' (завтра)' : '') + ' <input type="time" id="f-time" step="300" min="' + esc(s.open_time) + '" max="' + esc(s.close_time) + '" value="' + (S.time && S.time.key === 'custom' ? esc(S.time.label) : '') + '"></label>' +
      '</fieldset>' +
      '<label class="field" for="f-name"><span class="lab">Имя</span><input id="f-name" type="text" autocomplete="given-name" maxlength="60" placeholder="Как подписать стакан" value="' + esc(name) + '"></label>' +
      '<label class="field" for="f-phone"><span class="lab">Телефон' + (S.pay === 'kaspi' ? ' для счёта Kaspi' : '') + '</span><input id="f-phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="+7 700 000 00 00" value="' + esc(phone) + '"></label>' +
      '<label class="field" for="f-comment"><span class="lab">Комментарий</span><textarea id="f-comment" maxlength="500" placeholder="Без сахара, погорячее, крышку не нужно">' + esc(S.form.comment || '') + '</textarea></label>' +
      (pays.length ? '<fieldset><legend class="lab">Оплата</legend><div class="radios">' + pays.map(x =>
        '<label class="radio" for="pay-' + x[0] + '"><input type="radio" name="pay" id="pay-' + x[0] + '" value="' + x[0] + '"' + (S.pay === x[0] ? ' checked' : '') + '><span>' + esc(x[1]) + '<small>' + esc(x[2]) + '</small></span></label>').join('') + '</div></fieldset>' : '') +
      '<p class="err" id="formErr" role="alert" hidden></p>' +
      '<button type="submit" class="btn btn-primary btn-big" id="sendBtn" data-base="' + (bad || short || !S.time || S.sending ? 1 : 0) + '"' + (bad || short || out || !S.time || S.sending ? ' disabled' : '') + '>' + (S.sending ? 'Отправляем…' : 'Отправить заказ · ' + money(sub + fee)) + '</button>' +
      (S.user ? '' : '<p class="hint center">Без регистрации. <a href="#login" data-act="login-from-cart">Войдите</a>, чтобы заказы сохранялись в аккаунте.</p>') +
      '</form></div></div>';
    return h;
  }
  /* ---------- зона доставки ---------- */
  function delState() {
    const s = S.settings;
    if (!U.hasZone(s) || S.form.lat == null) return { has: false, out: false, km: null };
    const k = U.kmBetween([Number(s.shop_lat), Number(s.shop_lng)], [S.form.lat, S.form.lng]);
    return { has: true, km: k, out: k > Number(s.delivery_radius_km) };
  }
  function delInfoHTML() {
    const s = S.settings, st = delState(), r = U.km(Number(s.delivery_radius_km));
    if (!st.has) return '<span class="di">Отметьте место на карте или найдите адрес. Доставляем в радиусе ' + r + ' от кофейни.</span>';
    if (st.out) return '<span class="di bad">' + U.km(st.km) + ' от нас: это за зоной доставки (до ' + r + '). Выберите другой адрес или самовывоз.</span>';
    return '<span class="di ok">' + U.km(st.km) + ' от нас, адрес в зоне доставки</span>';
  }
  function updateDelInfo() {
    const el = $('#delInfo'); if (el) el.innerHTML = delInfoHTML();
    const b = $('#sendBtn'); if (b) b.disabled = b.dataset.base === '1' || delState().out;
  }
  function setDelPoint(lat, lng, fillAddress) {
    S.form.lat = lat; S.form.lng = lng; U.store.set('cafe_addr_ll', [lat, lng]);
    updateDelInfo();
    if (fillAddress && window.CafeMap) {
      const my = S.revReq = (S.revReq || 0) + 1;
      window.CafeMap.reverse(lat, lng).then(a => { if (a && my === S.revReq) { S.form.addr = a; const i = $('#f-addr'); if (i) i.value = a; } }).catch(() => { });
    }
  }
  async function mountDelMap() {
    const el = $('#delMap'); if (!el || !window.CafeMap) return;
    const s = S.settings;
    try {
      S.delMap = await window.CafeMap.picker(el, {
        shop: [Number(s.shop_lat), Number(s.shop_lng)], radiusKm: Number(s.delivery_radius_km),
        pin: S.form.lat != null ? [S.form.lat, S.form.lng] : null,
        onPick: (lat, lng) => setDelPoint(lat, lng, true)
      });
    } catch (e) { el.innerHTML = '<p class="map-fail">' + esc(e.message) + '. Можно оформить самовывоз или написать нам в WhatsApp.</p>'; }
  }
  async function findAddress() {
    captureForm();
    const q = (S.form.addr || '').trim(), box = $('#addrResults');
    if (!q) { formErr('Введите улицу и дом.'); return; }
    box.hidden = false; box.innerHTML = '<span class="muted small">Ищем…</span>';
    try {
      const s = S.settings, city = /астана|нур-султан/i.test(q) ? q : q + ', Астана';
      const list = await window.CafeMap.search(city, [Number(s.shop_lat), Number(s.shop_lng)]);
      if (!list.length) { box.innerHTML = '<span class="muted small">Не нашли такой адрес. Отметьте место на карте вручную.</span>'; return; }
      box.innerHTML = list.map(x => '<button type="button" class="addr-opt" data-act="addr-pick" data-lat="' + x.lat + '" data-lng="' + x.lng + '" data-label="' + esc(x.label) + '">' + icon.pin + '<span>' + esc(x.label) + '</span><small>' + U.km(U.kmBetween([Number(s.shop_lat), Number(s.shop_lng)], [x.lat, x.lng])) + '</small></button>').join('');
    } catch (e) { box.innerHTML = '<span class="muted small">' + esc(e.message) + '</span>'; }
  }
  function captureForm() {
    const v = id => { const el = document.getElementById(id); return el ? el.value : undefined; };
    ['name', 'phone', 'comment', 'addr', 'addr2', 'ptwhere'].forEach(k => { const val = v('f-' + k); if (val !== undefined) S.form[k] = val; });
  }
  function formErr(text) { const e = $('#formErr'); if (!e) return toast(text, 'bad'); e.textContent = text; e.hidden = false; e.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' }); }

  async function submitOrder() {
    captureForm();
    const s = S.settings, f = S.form;
    const name = (f.name || '').trim(), phone = (f.phone || '').trim();
    if (!name) { formErr('Укажите имя, чтобы бариста подписал стакан.'); $('#f-name').focus(); return; }
    const del = isDel(), pt = isPt();
    if ((S.pay === 'kaspi' || del || pt) && U.digits(phone).length < 10) { formErr(S.pay === 'kaspi' ? 'Укажите телефон: на него придёт счёт в Kaspi.' : 'Укажите телефон для курьера.'); $('#f-phone').focus(); return; }
    if (del && !(f.addr || '').trim()) { formErr('Укажите адрес доставки.'); $('#f-addr').focus(); return; }
    if (del && U.hasZone(s) && f.lat == null) { formErr('Отметьте место доставки на карте, чтобы мы проверили зону.'); const m = $('#delMap'); if (m) m.scrollIntoView({ block: 'center' }); return; }
    if (del && delState().out) { formErr('Этот адрес за зоной доставки. Выберите другой адрес или самовывоз.'); return; }
    if (!S.time) { formErr('Выберите, когда заберёте заказ.'); return; }
    if (!S.pay) { formErr('Способ оплаты недоступен. Обновите страницу.'); return; }
    const payload = {
      customer_name: name, customer_phone: U.normPhone(phone), fulfillment: del || pt ? 'delivery' : 'pickup', payment_method: S.pay,
      asap: !!S.time.asap, ready_at: S.time.asap ? null : S.time.iso, comment: f.comment || '',
      delivery_address: del ? f.addr : null, delivery_details: del ? f.addr2 : pt ? (f.ptwhere || '') : null,
      delivery_lat: del ? f.lat : null, delivery_lng: del ? f.lng : null,
      partner: ptCode(), to_partner: pt,
      items: S.cart.map(l => ({ product_id: l.product_id, size: l.size, modifier_ids: l.modifier_ids, qty: l.qty }))
    };
    S.sending = true; const btn = $('#sendBtn'); if (btn) { btn.disabled = true; btn.textContent = 'Отправляем…'; }
    try {
      const r = await API.placeOrder(payload);
      S.myOrders.unshift({ id: r.id, token: r.token, number: r.number, at: new Date().toISOString() }); saveOrders();
      autoNotify(S.myOrders[0]);
      S.lastCart = S.cart.slice(); U.store.set('cafe_last_cart', S.lastCart);
      S.guest = { name, phone: payload.customer_phone }; U.store.set('cafe_guest', S.guest);
      U.store.set('cafe_pay', S.pay);
      if (del) { U.store.set('cafe_addr', f.addr || ''); U.store.set('cafe_addr2', f.addr2 || ''); }
      S.cart = []; saveCart(); S.form = {}; S.time = null;
      S.sending = false;
      go('#order/' + r.id);
    } catch (e) {
      S.sending = false;
      if (btn) { btn.disabled = false; btn.textContent = 'Отправить заказ · ' + money(cartTotal() + curFee(cartTotal())); }
      formErr(e.message);
      if (/закончился|не продаётся|обновите меню/i.test(e.message)) refreshMenu();
    }
  }

  /* ------------------------------ статус заказа ------------------------------ */
  function viewOrderShell() { return '<a class="back" href="#menu">' + icon.back + 'Меню</a><div id="orderBox"><div class="boot"><span class="spinner"></span></div></div>'; }
  async function loadOrder(id, quiet) {
    const box = $('#orderBox'); if (!box) return;
    const local = S.myOrders.find(o => o.id === id);
    let o = null;
    try { o = await API.getOrder(id, local ? local.token : null); }
    catch (e) { if (!quiet) box.innerHTML = '<p class="err">' + esc(e.message) + '</p>'; schedulePoll(id); return; }
    if (!o) { box.innerHTML = '<div class="empty-block"><h1 class="h-page">Заказ не найден</h1><p class="muted">Возможно, он оформлен на другом устройстве. Войдите в аккаунт, чтобы увидеть все заказы.</p><a class="btn" href="#profile">Профиль</a></div>'; return; }
    const prev = S.lastStatus[id], prevPay = S.lastPay[id];
    S.lastStatus[id] = o.status; S.lastPay[id] = o.payment_status;
    const localOnly = !!(local && local.push === 'local' && document.hidden);   // уведомления без сервера, вкладка свёрнута
    if (prev && prev !== o.status) { notifyStatus(o); if (localOnly) localGuestNotify(o, o.status); }
    if (prevPay && prevPay !== o.payment_status && o.payment_status === 'invoice_sent' && localOnly) localGuestNotify(o, 'invoice');
    if (local && (o.status === 'completed' || o.status === 'cancelled')) { local.done = true; local.push = null; saveOrders(); }
    if (currentView() !== 'order' || location.hash.split('/')[1] !== id) return;
    S.curOrder = o;
    box.innerHTML = orderHTML(o);
    if (['new', 'accepted', 'ready', 'on_the_way'].includes(o.status)) schedulePoll(id);
  }
  function schedulePoll(id) {
    clearInterval(S.poll);
    S.poll = setInterval(() => {
      const l = S.myOrders.find(x => x.id === id);
      if (!document.hidden || (l && l.push === 'local')) loadOrder(id, true);   // без сервера уведомлений проверяем и в свёрнутой вкладке
    }, 8000);
  }

  /* ---------- уведомления гостю: «заказ готов», «курьер выехал» ---------- */
  const canNotify = () => 'Notification' in window;
  const canPush = () => API.mode === 'live' && 'serviceWorker' in navigator && 'PushManager' in window;
  const notifWaiting = o => o.fulfillment === 'delivery' ? ['new', 'accepted', 'ready'].includes(o.status) : ['new', 'accepted'].includes(o.status);
  async function swReady() {
    if (!('serviceWorker' in navigator)) return null;
    try {
      let r = await navigator.serviceWorker.getRegistration();
      if (!r) r = await navigator.serviceWorker.register('sw.js');
      await Promise.race([navigator.serviceWorker.ready, new Promise(res => setTimeout(res, 4000))]);
      return r;
    } catch (e) { return null; }
  }
  // Подписывает этот телефон на заказ. 'push' — придёт, даже если сайт закрыт; 'local' — пока страница открыта.
  async function attachNotify(local, ask) {
    if (!canNotify()) throw new Error('Этот браузер не умеет показывать уведомления');
    let perm = Notification.permission;
    if (perm === 'default' && ask) perm = await Notification.requestPermission();
    if (perm !== 'granted') throw new Error(perm === 'denied' ? 'Уведомления для сайта запрещены в настройках браузера' : 'Нужно нажать «Разрешить» в окне браузера');
    let mode = 'local';
    if (canPush()) {
      try {
        if (!S.pushKey) S.pushKey = await API.pushKey();
        const reg = S.pushKey ? await swReady() : null;
        if (reg && reg.pushManager) {
          const key = U.b64u(S.pushKey);
          let sub = await reg.pushManager.getSubscription();
          if (sub && !U.sameKey(sub.options && sub.options.applicationServerKey, key)) { await sub.unsubscribe().catch(() => { }); sub = null; }
          if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
          const r = await API.orderPushSubscribe(local.id, local.token, sub.toJSON());
          if (r && r.configured) { mode = 'push'; local.ep = sub.endpoint; }
        }
      } catch (e) { mode = 'local'; }   // сервер не ответил — покажем сами, пока страница открыта
    }
    local.push = mode; saveOrders();
    U.store.set('kese_notify', 'on');
    return mode;
  }
  function rerenderNotify() { const nb = $('#notifyBox'); if (nb && S.curOrder) nb.innerHTML = notifyHTML(S.curOrder); }
  async function notifyOn(id) {
    const local = S.myOrders.find(o => o.id === id); if (!local) return;
    S.gn = { id, busy: true }; rerenderNotify();
    try { await attachNotify(local, true); S.gn = {}; }
    catch (e) { S.gn = { id, err: e.message }; }
    rerenderNotify();
  }
  function notifyOff(id) {
    const local = S.myOrders.find(o => o.id === id); if (!local) return;
    if (local.push === 'push' && local.ep) API.orderPushUnsubscribe(id, local.token, local.ep).catch(() => { });
    local.push = null; local.ep = null; saveOrders();
    U.store.set('kese_notify', 'off');
    S.gn = { id, msg: 'Хорошо, без уведомлений.' }; rerenderNotify();
  }
  // кто однажды включил уведомления — следующие заказы подключаем сами, без вопросов
  function autoNotify(local) {
    if (U.store.get('kese_notify', '') !== 'on' || !canNotify() || Notification.permission !== 'granted') return;
    S.gn = { id: local.id, busy: true };
    attachNotify(local, false).catch(() => { }).then(() => { if (S.gn.id === local.id) S.gn = {}; rerenderNotify(); });
  }
  function notifyHTML(o) {
    const local = S.myOrders.find(x => x.id === o.id);
    if (!local || !notifWaiting(o)) return '';
    const what = o.to_partner ? 'когда понесём заказ' : o.fulfillment === 'delivery' ? 'когда курьер выедет' : 'когда заказ будет готов';
    const g = S.gn && S.gn.id === o.id ? S.gn : {};
    let title, text, btn = '', on = false;
    if (g.busy) { title = 'Подключаем уведомления…'; text = 'Если браузер спросит, нажмите «Разрешить»'; }
    else if (local.push === 'push' || local.push === 'local') {
      on = true; title = 'Сообщим, ' + what;
      text = local.push === 'push' ? 'Уведомление придёт, даже если закрыть сайт' : 'Пока эта страница открыта. Свернуть браузер можно';
      btn = '<button type="button" class="linkbtn" data-act="notify-off" data-id="' + o.id + '">Выключить</button>';
    } else if (U.isIOS() && !U.standalone()) {
      title = 'Сообщить, ' + what + '?';
      text = 'На iPhone уведомление приходит в приложение Kese Coffee. Установка занимает 10 секунд';
      btn = '<button type="button" class="btn btn-sm" data-act="install-help">' + icon.phone + 'Скачать приложение</button>';
    } else if (!canNotify()) return '';
    else if (Notification.permission === 'denied') {
      title = 'Уведомления выключены';
      text = 'Разрешите их для сайта в настройках браузера, и мы сообщим, ' + what;
    } else {
      title = 'Сообщить, ' + what + '?';
      text = 'Пришлём уведомление на этот телефон';
      btn = '<button type="button" class="btn btn-sm btn-primary" data-act="notify-on" data-id="' + o.id + '">' + icon.bell + 'Включить</button>';
    }
    return '<div class="g-notif' + (on ? ' on' : '') + '"><span class="g-ic" aria-hidden="true">' + icon.bell + '</span>' +
      '<div class="g-tx"><b>' + esc(title) + '</b><span>' + esc(text) + '</span></div>' + btn +
      (g.err ? '<p class="err" role="alert">' + esc(g.err) + '</p>' : '') +
      (g.msg ? '<p class="hint ok-t" role="status">' + esc(g.msg) + '</p>' : '') + '</div>';
  }
  function guestNote(o, kind) {
    if (kind === 'invoice') return ['Счёт в Kaspi: ' + money(o.total), 'Откройте Kaspi.kz и оплатите заказ №' + o.number];
    const del = o.fulfillment === 'delivery', addr = S.settings.address;
    return {
      accepted: ['Заказ №' + o.number + ' принят', 'Готовим'],
      ready: del ? null : ['Заказ №' + o.number + ' готов!', 'Заберите на стойке' + (addr ? ' · ' + addr : '')],
      on_the_way: [(o.to_partner ? 'Несём ваш кофе · заказ №' : 'Курьер выехал · заказ №') + o.number, 'Скоро будем: ' + (o.delivery_address || 'по вашему адресу')],
      cancelled: ['Заказ №' + o.number + ' отменён', o.cancel_reason || 'Если есть вопросы, напишите нам в WhatsApp']
    }[kind] || null;
  }
  async function localGuestNotify(o, kind) {
    const t = guestNote(o, kind); if (!t || !canNotify() || Notification.permission !== 'granted') return;
    const loud = kind === 'ready' || kind === 'on_the_way';
    const opts = { body: t[1], tag: 'order-' + o.id, renotify: true, requireInteraction: loud, icon: 'icons/icon-192.png', badge: 'icons/badge-96.png', data: { url: './#order/' + o.id } };
    try {
      const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null;
      if (reg && reg.showNotification) { await reg.showNotification(t[0], opts); return; }
      const n = new Notification(t[0], opts); n.onclick = () => { window.focus(); n.close(); };
    } catch (e) { /* не показали — останется сообщение на странице */ }
  }
  function notifyStatus(o) {
    const t = { accepted: 'Заказ принят, готовим', ready: o.fulfillment === 'delivery' ? 'Заказ собран, скоро передадим курьеру' : 'Заказ готов! Заберите на стойке', on_the_way: 'Курьер выехал', cancelled: 'Заказ отменён', completed: 'Приятного кофе!' }[o.status];
    if (t) toast(t, o.status === 'ready' ? 'good' : '');
    if (o.status === 'ready' && navigator.vibrate) navigator.vibrate([200, 100, 200]);
  }
  function orderHTML(o) {
    const s = S.settings, del = o.fulfillment === 'delivery';
    const steps = del ? [['new', 'Принят'], ['accepted', 'Готовим'], ['on_the_way', 'В пути'], ['completed', 'Доставлен']]
      : [['new', 'Отправлен'], ['accepted', 'Готовим'], ['ready', 'Готов'], ['completed', 'Выдан']];
    const map = del ? { new: 0, accepted: 1, ready: 1, on_the_way: 2, completed: 3 } : { new: 0, accepted: 1, ready: 2, on_the_way: 2, completed: 3 };
    const cur = map[o.status];
    const head = {
      new: 'Заказ отправлен. Ждём, когда бариста его примет',
      accepted: 'Готовим ваш заказ',
      ready: del ? 'Заказ собран, передаём курьеру' : 'Заказ готов! Заберите на стойке',
      on_the_way: 'Курьер уже едет к вам',
      completed: del ? 'Доставлено. Приятного кофе!' : 'Заказ выдан. Приятного кофе!',
      cancelled: 'Заказ отменён'
    }[o.status];
    const when = o.asap ? (del ? 'Привезём примерно к ' : 'Будет готов примерно к ') + U.timeIn(o.ready_at, s.timezone)
      : (del ? 'Привезём ' : 'Заберите ') + U.dayLabel(o.ready_at, s.timezone) + ' к ' + U.timeIn(o.ready_at, s.timezone);
    let pay = '';
    if (o.status !== 'cancelled') {
      if (o.payment_method === 'kaspi') {
        pay = o.payment_status === 'paid' ? '<div class="pay ok">Оплачено через Kaspi</div>'
          : o.payment_status === 'invoice_sent' ? '<div class="pay act"><b>Счёт отправлен в Kaspi</b>Откройте приложение Kaspi.kz и оплатите счёт на ' + money(o.total) + '.</div>'
            : '<div class="pay"><b>Оплата через Kaspi</b>Пришлём счёт на номер ' + esc(U.phoneFmt(o.customer_phone)) + ' после подтверждения заказа.</div>';
      } else if (o.payment_method === 'place') {
        pay = o.payment_status === 'paid' ? '<div class="pay ok">Оплачено</div>' : '<div class="pay"><b>Оплата ' + (del ? 'курьеру' : 'на месте') + '</b>' + money(o.total) + ' картой, QR или наличными.</div>';
      }
    }
    const wa = s.whatsapp ? 'https://wa.me/' + U.digits(s.whatsapp) + '?text=' + encodeURIComponent('Здравствуйте! Вопрос по заказу №' + o.number) : '';
    return '<div class="order-view ticket">' +
      '<div class="t-head"><span class="code">' + U.dayLabel(o.created_at, s.timezone) + ', ' + U.timeIn(o.created_at, s.timezone) + '</span><span class="code">' + esc(U.STATUS[o.status]) + '</span></div>' +
      '<p class="big-num">№' + o.number + '</p>' +
      '<h1 class="o-head' + (o.status === 'ready' ? ' ready' : '') + '">' + esc(head) + '</h1>' +
      (o.status === 'cancelled' ? (o.cancel_reason ? '<p class="muted">' + esc(o.cancel_reason) + '</p>' : '')
        : '<ol class="track">' + steps.map((st, i) => '<li class="' + (i < cur ? 'done' : i === cur ? 'now' : '') + '"><span>' + st[1] + '</span></li>').join('') + '</ol>' +
        '<p class="when">' + esc(when) + '</p>') +
      (del ? '<p class="muted">' + esc(o.delivery_address || '') + (o.delivery_details ? ', ' + esc(o.delivery_details) : '') + '</p>' : (s.address && o.status !== 'cancelled' ? '<p class="muted">Забрать: ' + esc(s.address) + '</p>' : '')) +
      '<div id="notifyBox">' + notifyHTML(o) + '</div>' +
      pay +
      '<div class="perf" aria-hidden="true"></div>' +
      '<ul class="lines static">' + (o.items || []).map(it => '<li class="line"><span class="l-nm">' + esc(it.name) + (it.qty > 1 ? ' ×' + it.qty : '') + '</span><span class="l-pr">' + money(it.line_total) + '</span>' + (U.itemLine(it) ? '<span class="l-op">' + esc(U.itemLine(it)) + '</span>' : '') + '</li>').join('') + '</ul>' +
      '<div class="sum">' + (o.delivery_fee ? '<div><span>Доставка</span><span>' + money(o.delivery_fee) + '</span></div>' : '') + '<div class="sum-total"><span>Итого</span><b>' + money(o.total) + '</b></div></div>' +
      (o.comment ? '<p class="muted">Комментарий: ' + esc(o.comment) + '</p>' : '') +
      '<div class="o-actions">' +
      (o.status === 'new' ? '<button type="button" class="btn btn-ghost" data-act="cancel-ask" data-id="' + o.id + '">Отменить заказ</button>' : '') +
      (wa ? '<a class="btn btn-ghost" href="' + wa + '" target="_blank" rel="noopener">' + icon.wa + 'Написать нам</a>' : '') +
      (o.status === 'completed' || o.status === 'cancelled' ? '<button type="button" class="btn btn-primary" data-act="repeat-order" data-id="' + o.id + '">Повторить заказ</button>' : '') +
      '</div><div id="cancelBox"></div>' +
      (!S.user && o.status !== 'cancelled' ? '<p class="hint center">Страница обновляется сама. Можно закрыть её и вернуться через профиль.</p>' : '') +
      '</div>';
  }

  /* ------------------------------ профиль ------------------------------ */
  function viewProfile() {
    const s = S.settings;
    if (S.recovery) {
      return '<h1 class="h-page">Новый пароль</h1><form class="card form" id="pwForm" novalidate><label class="field" for="p-new"><span class="lab">Новый пароль</span><input id="p-new" type="password" autocomplete="new-password" minlength="6"></label><p class="err" id="formErr" hidden></p><button class="btn btn-primary" type="submit">Сохранить пароль</button></form>';
    }
    let h = '<h1 class="h-page">Профиль</h1>';
    if (S.user) {
      const p = S.profile || {};
      h += '<form class="card form" id="profForm" novalidate>' +
        '<p class="muted small">' + esc(S.user.email || '') + (p.role && p.role !== 'guest' ? ' · ' + (p.role === 'admin' ? 'администратор' : 'бариста') : '') + '</p>' +
        '<label class="field" for="p-name"><span class="lab">Имя</span><input id="p-name" type="text" maxlength="60" value="' + esc(p.name || '') + '"></label>' +
        '<label class="field" for="p-phone"><span class="lab">Телефон для счёта Kaspi</span><input id="p-phone" type="tel" inputmode="tel" value="' + esc(p.phone || '') + '" placeholder="+7 700 000 00 00"></label>' +
        '<div class="row-btns"><button class="btn btn-primary" type="submit">Сохранить</button><button class="btn btn-ghost" type="button" data-act="logout">Выйти</button>' +
        (p.role === 'staff' || p.role === 'admin' ? '<a class="btn btn-ghost" href="#admin">Панель персонала</a>' : '') + '</div></form>';
    } else {
      h += '<form class="card form" id="guestForm" novalidate>' +
        '<p class="muted small">Гостевой профиль. Хранится только на этом телефоне.</p>' +
        '<label class="field" for="g-name"><span class="lab">Имя</span><input id="g-name" type="text" maxlength="60" value="' + esc(S.guest.name || '') + '"></label>' +
        '<label class="field" for="g-phone"><span class="lab">Телефон для счёта Kaspi</span><input id="g-phone" type="tel" inputmode="tel" value="' + esc(S.guest.phone || '') + '" placeholder="+7 700 000 00 00"></label>' +
        '<div class="row-btns"><button class="btn btn-primary" type="submit">Сохранить</button></div></form>' +
        '<div class="card cta"><div><b>Сохраните историю заказов</b><p class="muted small">Создайте аккаунт: заказы будут видны на любом устройстве, а повторить любимый кофе можно в одно касание.</p></div><a class="btn" href="#login">Войти или создать аккаунт</a></div>';
    }
    h += '<h2 class="h-sec">Мои заказы</h2><div id="history"><div class="boot"><span class="spinner"></span></div></div>';
    h += installBlock();
    return h;
  }
  function installBlock() {
    const m = installMode(); if (!m) return '';
    return '<div class="card cta"><div><b>Приложение на экране</b><p class="muted small">Иконка на главном экране, заказ в два касания и уведомление, когда кофе готов.</p></div>' +
      '<button class="btn" type="button" data-act="install">' + icon.phone + 'Скачать приложение</button></div>';
  }
  async function loadHistory() {
    const box = $('#history'); if (!box) return;
    let list = [];
    try {
      list = S.user ? await API.myOrders() : (S.myOrders.length ? await API.getGuestOrders(pairs()) : []);
    } catch (e) { box.innerHTML = '<p class="err">' + esc(e.message) + '</p>'; return; }
    if (!$('#history')) return;
    if (!list.length) { box.innerHTML = '<p class="muted">Заказов пока нет.</p>'; return; }
    const tz = S.settings.timezone;
    box.innerHTML = '<ul class="hist">' + list.map(o =>
      '<li class="hist-item"><a href="#order/' + o.id + '" class="hist-main">' +
      '<span class="hist-top"><b>№' + o.number + '</b><span class="chip-s st-' + o.status + '">' + esc(U.STATUS[o.status]) + '</span><span class="muted small">' + U.dayLabel(o.created_at, tz) + ', ' + U.timeIn(o.created_at, tz) + '</span></span>' +
      '<span class="muted small hist-items">' + esc((o.items || []).map(i => i.name + (i.qty > 1 ? ' ×' + i.qty : '')).join(', ')) + '</span></a>' +
      '<span class="hist-side"><span class="pr">' + money(o.total) + '</span><button type="button" class="btn btn-ghost btn-sm" data-act="repeat-order" data-id="' + o.id + '">Повторить</button></span></li>').join('') + '</ul>';
    S.histCache = list;
  }

  /* ------------------------------ вход ------------------------------ */
  function viewLogin() {
    if (S.user) return '<p class="muted">Вы уже вошли.</p><a class="btn" href="#profile">Профиль</a>';
    const up = S.loginTab === 'up';
    return '<a class="back" href="#profile">' + icon.back + 'Профиль</a>' +
      '<h1 class="h-page">' + (up ? 'Создать аккаунт' : 'Вход') + '</h1>' +
      '<div class="seg" role="tablist"><button type="button" role="tab" aria-selected="' + !up + '" data-act="tab" data-v="in">Вход</button><button type="button" role="tab" aria-selected="' + up + '" data-act="tab" data-v="up">Регистрация</button></div>' +
      '<form class="card form" id="authForm" novalidate>' +
      (up ? '<label class="field" for="a-name"><span class="lab">Имя</span><input id="a-name" type="text" autocomplete="given-name" maxlength="60" value="' + esc(S.guest.name || '') + '"></label>' : '') +
      '<label class="field" for="a-email"><span class="lab">Email</span><input id="a-email" type="email" autocomplete="email" inputmode="email"></label>' +
      '<label class="field" for="a-pass"><span class="lab">Пароль</span><input id="a-pass" type="password" autocomplete="' + (up ? 'new-password' : 'current-password') + '" minlength="6"></label>' +
      '<p class="err" id="formErr" role="alert" hidden></p>' +
      '<button class="btn btn-primary" type="submit" id="authBtn">' + (up ? 'Создать аккаунт' : 'Войти') + '</button>' +
      (!up ? '<button class="linkbtn" type="button" data-act="forgot">Забыли пароль?</button>' : '') +
      (API.googleEnabled ? '<div class="or"><span>или</span></div><button class="btn btn-ghost" type="button" data-act="google">Войти через Google</button>' : '') +
      '</form>' +
      (S.myOrders.length ? '<p class="hint center">Заказы, сделанные без регистрации, перенесутся в аккаунт.</p>' : '');
  }
  async function submitAuth() {
    const email = $('#a-email').value.trim(), pass = $('#a-pass').value, up = S.loginTab === 'up';
    const nameEl = $('#a-name');
    if (!email) return formErr('Укажите email.');
    if (pass.length < 6) return formErr('Пароль должен быть не короче 6 символов.');
    const btn = $('#authBtn'); btn.disabled = true;
    try {
      if (up) {
        const r = await API.signUp(email, pass, nameEl ? nameEl.value.trim() : '');
        if (r.needsConfirm) { formErr('Мы отправили письмо на ' + email + '. Откройте ссылку из него, чтобы подтвердить вход.'); $('#formErr').classList.add('info'); }
      } else await API.signIn(email, pass);
    } catch (e) { formErr(e.message); }
    btn.disabled = false;
  }

  /* ------------------------------ повтор заказа ------------------------------ */
  function repeatItems(items) {
    let added = 0, skipped = 0;
    items.forEach(it => {
      const p = S.idx.products[it.product_id];
      if (!p || !p.active || !p.available) { skipped++; return; }
      let size = null;
      if (p.sizes && p.sizes.length) {
        const lbl = it.size ? String(it.size).split(' ')[0] : null;
        size = (p.sizes.find(z => z.label === lbl) || p.sizes[p.sizes.length > 2 ? 1 : 0]).label;
      }
      const ids = (it.modifier_ids || (it.modifiers || []).map(m => m.id)).filter(id => { const m = S.idx.mods[id]; return m && m.active && p.modifier_group_ids.indexOf(m.group_id) >= 0; }).sort();
      const key = p.id + '|' + (size || '') + '|' + ids.join(',');
      const ex = S.cart.find(l => l.key === key);
      if (ex) ex.qty = Math.min(20, ex.qty + it.qty); else S.cart.push({ key, product_id: p.id, size, modifier_ids: ids, qty: it.qty });
      added++;
    });
    saveCart();
    if (skipped) toast(added ? 'Часть позиций закончилась, остальное в корзине' : 'Этих позиций сейчас нет', added ? '' : 'bad');
    if (added) go('#cart');
  }

  /* ------------------------------ события ------------------------------ */
  app.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const act = b.dataset.act;
    S.refocus = '[data-act="' + act + '"]' + (b.dataset.v ? '[data-v="' + b.dataset.v + '"]' : '') + (b.dataset.i ? '[data-i="' + b.dataset.i + '"]' : '');
    if (act === 'open') {
      const p = S.idx.products[b.dataset.id];
      if (p && !(p.sizes && p.sizes.length) && !groupsOf(p).length) {
        const key = p.id + '||', ex = S.cart.find(l => l.key === key);
        if (ex) ex.qty = Math.min(20, ex.qty + 1); else S.cart.push({ key, product_id: p.id, size: null, modifier_ids: [], qty: 1 });
        saveCart(); toast(p.name + ' в корзине'); route(); return;
      }
      return openSheet(b.dataset.id);
    }
    if (act === 'cat') { S.cat = b.dataset.id; refreshList(); return; }
    if (act === 'search') {
      e.preventDefault(); S.searchOpen = !S.searchOpen;
      const box = $('.search'); b.setAttribute('aria-expanded', String(S.searchOpen));
      if (box) { box.classList.toggle('closed', !S.searchOpen && !S.q); if (S.searchOpen) { $('#f-q').focus(); scrollToId('menuTop'); } }
      return;
    }
    if (act === 'goto') {
      e.preventDefault();
      const target = { top: 'top', menu: 'menuTop', about: 'about', contacts: 'contacts' }[b.dataset.v] || 'top';
      if (currentView() !== 'menu' && target !== 'contacts') { S.pendingScroll = target; go('#menu'); return; }
      scrollToId(target); return;
    }
    if (act === 'ful') { captureForm(); S.ful = b.dataset.v; U.store.set('cafe_ful', S.ful); S.time = null; route(); return; }
    if (act === 'pt-clear') {
      U.store.del('kese_partner'); S.partner = null;
      if (S.ful === 'partner') { S.ful = S.settings.pickup_enabled ? 'pickup' : 'delivery'; U.store.set('cafe_ful', S.ful); }
      fixFulfillment(); S.time = null; route(); toast('Хорошо, заказ будет обычным'); return;
    }
    if (act === 'repeat-last') return repeatItems(S.lastCart.map(l => ({ product_id: l.product_id, size: l.size, modifier_ids: l.modifier_ids, qty: l.qty })));
    if (act === 'lq') {
      captureForm();
      const i = Number(b.dataset.i); S.cart[i].qty += Number(b.dataset.v);
      if (S.cart[i].qty <= 0) S.cart.splice(i, 1); else S.cart[i].qty = Math.min(20, S.cart[i].qty);
      saveCart(); route(); return;
    }
    if (act === 'edit') {
      captureForm();
      const l = S.cart[Number(b.dataset.i)]; const p = S.idx.products[l.product_id]; if (!p) return;
      const sel = {}; groupsOf(p).forEach(g => { sel[g.id] = l.modifier_ids.filter(id => S.idx.mods[id] && S.idx.mods[id].group_id === g.id); if (!g.multi && !sel[g.id].length) { const d = g.modifiers.find(m => m.is_default && m.active); sel[g.id] = d ? [d.id] : []; } });
      return openSheet(p.id, { size: l.size, sel, qty: l.qty, editKey: l.key });
    }
    if (act === 'time') {
      captureForm();
      const sl = curSlots(); S.time = sl.list.find(x => x.key === b.dataset.v) || null;
      route(); return;
    }
    if (act === 'login-from-cart') { captureForm(); S.afterLogin = '#cart'; return; }
    if (act === 'addr-find') return findAddress();
    if (act === 'addr-pick') {
      const lat = Number(b.dataset.lat), lng = Number(b.dataset.lng);
      S.form.addr = b.dataset.label; const i = $('#f-addr'); if (i) i.value = b.dataset.label;
      $('#addrResults').hidden = true;
      if (S.delMap) S.delMap.setPin(lat, lng, true);
      setDelPoint(lat, lng, false); return;
    }
    if (act === 'addr-locate') {
      b.disabled = true;
      try { const [lat, lng] = await window.CafeMap.locate(); if (S.delMap) S.delMap.setPin(lat, lng, true); setDelPoint(lat, lng, true); }
      catch (err) { formErr(err.message); }
      b.disabled = false; return;
    }
    if (act === 'cancel-ask') {
      $('#cancelBox').innerHTML = '<div class="confirm"><p>Отменить заказ?</p><button type="button" class="btn btn-danger btn-sm" data-act="cancel-yes" data-id="' + b.dataset.id + '">Да, отменить</button><button type="button" class="btn btn-ghost btn-sm" data-act="cancel-no">Нет</button></div>';
      return;
    }
    if (act === 'cancel-no') { $('#cancelBox').innerHTML = ''; return; }
    if (act === 'cancel-yes') {
      const id = b.dataset.id, local = S.myOrders.find(o => o.id === id);
      b.disabled = true;
      try { await API.cancelOrder(id, local ? local.token : null); toast('Заказ отменён'); loadOrder(id); }
      catch (err) { toast(err.message, 'bad'); b.disabled = false; }
      return;
    }
    if (act === 'repeat-order') {
      const id = b.dataset.id, local = S.myOrders.find(o => o.id === id);
      let o = (S.histCache || []).find(x => x.id === id);
      if (!o) { try { o = await API.getOrder(id, local ? local.token : null); } catch (err) { return toast(err.message, 'bad'); } }
      if (o) repeatItems(o.items || []);
      return;
    }
    if (act === 'logout') { await API.signOut(); toast('Вы вышли из аккаунта'); go('#profile'); return; }
    if (act === 'tab') { S.loginTab = b.dataset.v; route(); return; }
    if (act === 'forgot') {
      const email = $('#a-email').value.trim(); if (!email) return formErr('Введите email, и мы пришлём ссылку для нового пароля.');
      try { await API.resetPassword(email); formErr('Ссылка для смены пароля отправлена на ' + email + '.'); $('#formErr').classList.add('info'); } catch (err) { formErr(err.message); }
      return;
    }
    if (act === 'google') { try { await API.signInGoogle(S.afterLogin === '#cart' ? '#cart' : '#profile'); } catch (err) { formErr(err.message); } return; }
    if (act === 'install' || act === 'app-install') return installApp();
    if (act === 'install-help') return openInstallSheet();
    if (act === 'notify-on') return notifyOn(b.dataset.id);
    if (act === 'notify-off') return notifyOff(b.dataset.id);
  });

  app.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    if (f.id === 'orderForm') return submitOrder();
    if (f.id === 'authForm') return submitAuth();
    if (f.id === 'guestForm') {
      S.guest = { name: $('#g-name').value.trim(), phone: U.normPhone($('#g-phone').value) }; U.store.set('cafe_guest', S.guest);
      toast('Сохранено'); route(); return;
    }
    if (f.id === 'profForm') {
      try { await API.updateProfile({ name: $('#p-name').value.trim(), phone: U.normPhone($('#p-phone').value) }); S.profile = await API.getProfile(); toast('Сохранено'); route(); }
      catch (err) { toast(err.message, 'bad'); }
      return;
    }
    if (f.id === 'pwForm') {
      const v = $('#p-new').value; if (v.length < 6) return formErr('Пароль должен быть не короче 6 символов.');
      try { await API.updatePassword(v); S.recovery = false; toast('Пароль обновлён'); route(); } catch (err) { formErr(err.message); }
    }
  });

  app.addEventListener('keydown', (e) => {
    if (e.target.id === 'f-addr' && e.key === 'Enter' && $('[data-act="addr-find"]')) { e.preventDefault(); findAddress(); }
  });
  app.addEventListener('change', (e) => {
    const t = e.target;
    if (t.name === 'pay') { captureForm(); S.pay = t.value; route(); return; }
    if (t.id === 'f-time') {
      captureForm();
      if (!t.value) { S.time = null; route(); return; }
      const sl = curSlots();
      S.time = { key: 'custom', asap: false, label: t.value, iso: U.isoFor(S.settings, sl.day, t.value) };
      route();
    }
  });
  app.addEventListener('input', (e) => {
    if (e.target.id === 'f-q') { S.q = e.target.value; refreshList(); return; }
    if (e.target.id && e.target.id.indexOf('f-') === 0) captureForm();
  });

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); S.installEvt = e;
    if (!S.settings || isAdminRoute()) return;
    if (currentView() === 'profile') route(); else refreshAppBtn();
  });
  window.addEventListener('appinstalled', () => {
    S.installEvt = null; U.store.set('kese_app_ok', 1);
    if (!S.settings || isAdminRoute()) return;
    refreshAppBtn(); toast('Готово! Kese Coffee теперь на экране телефона', 'good');
  });

  /* ------------------------------ панель персонала ------------------------------ */
  function loadAdmin() {
    const cb = $('#cartbar'); if (cb) cb.hidden = true;
    document.body.classList.remove('has-bar');
    document.body.classList.add('admin-mode');
    document.body.classList.remove('guest');
    const mount = () => window.CafeAdmin.mount(app, { S, route, toast, go });
    if (window.CafeAdmin) return mount();
    app.innerHTML = '<div class="boot"><span class="spinner"></span><span>Открываем панель…</span></div>';
    const sc = document.createElement('script'); sc.src = 'js/admin.js?v=' + (window.APP_VERSION || '1');
    sc.onload = mount; sc.onerror = () => { app.innerHTML = '<div class="boot"><p class="err">Не удалось загрузить панель. Проверьте интернет.</p></div>'; };
    document.body.appendChild(sc);
  }

  /* ------------------------------ офлайн-кэш ------------------------------ */
  if ('serviceWorker' in navigator && location.protocol === 'https:' && API.mode === 'live') {
    window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => { }); });
  }

  boot();
})();
