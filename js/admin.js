/* =====================================================================
   Панель персонала: заказы в реальном времени, стоп-лист, меню и цены,
   настройки, команда. Бариста (staff) видит заказы и стоп-лист,
   администратор — всё.
   ===================================================================== */
(function () {
  'use strict';
  const { util: U, api: API } = window.Cafe;
  const esc = U.esc, money = U.money;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const ACTIVE = ['new', 'accepted', 'ready', 'on_the_way'];
  const clone = v => JSON.parse(JSON.stringify(v));

  const A = {
    root: null, ctx: null, user: null, profile: null, settings: null, menu: null,
    tab: U.store.get('adm_tab', 'orders'), menuSub: 'items',
    orders: [], fresh: new Set(), unsub: null, conn: 'connecting',
    audio: null, soundOn: false, chimeTimer: null, tick: null, poll: null, wake: null,
    edit: null, cancelFor: null, team: [], mounted: false
  };
  const isAdmin = () => A.profile && A.profile.role === 'admin';
  const isStaff = () => A.profile && (A.profile.role === 'staff' || A.profile.role === 'admin');
  const toast = (t, k) => A.ctx.toast(t, k);

  /* ------------------------------ вход ------------------------------ */
  async function mount(root, ctx) {
    A.root = root; A.ctx = ctx;
    if (!A.mounted) { bindEvents(); A.mounted = true; API.onAuth((ev) => { if ((ev === 'SIGNED_IN' || ev === 'SIGNED_OUT') && location.hash.indexOf('#admin') === 0) mount(A.root, A.ctx); }); }
    stopLive();
    const my = A.mountId = (A.mountId || 0) + 1;
    const stale = () => my !== A.mountId || location.hash.indexOf('#admin') !== 0;
    root.innerHTML = '<div class="boot"><span class="spinner"></span></div>';
    const user = await API.getUser().catch(() => null);
    if (stale()) return;
    A.user = user;
    if (!A.user) return renderLogin();
    const prof = await API.getProfile().catch(() => null);
    if (stale()) return;
    A.profile = prof;
    if (!isStaff()) return renderNoAccess();
    try {
      const r = await Promise.all([API.getSettings(), API.getMenu()]);
      if (stale()) return;
      A.settings = r[0]; A.menu = r[1];
    } catch (e) { root.innerHTML = '<div class="boot"><p class="err">' + esc(e.message) + '</p></div>'; return; }
    if (!isAdmin() && !['orders', 'counter', 'stop'].includes(A.tab)) A.tab = 'orders';
    renderFrame();
    startLive();
    showTab();
    notifInit();
  }

  function renderLogin() {
    const demo = API.mode === 'demo';
    A.root.innerHTML = '<div class="wrap"><div class="login-box">' +
      '<a class="back" href="#menu">← Меню гостя</a>' +
      '<h1 class="h-page">Панель персонала</h1>' +
      (demo ? '<div class="card form"><p class="muted small">Демо-режим: войдите одной кнопкой, чтобы посмотреть панель.</p><div class="row-btns"><button class="btn btn-primary" data-a="demo-login" data-v="admin">Войти как владелец</button><button class="btn" data-a="demo-login" data-v="staff">Как бариста</button></div></div>' :
        '<form class="card form" id="admLogin" novalidate>' +
        '<label class="field" for="adm-email"><span class="lab">Email</span><input id="adm-email" type="email" autocomplete="email"></label>' +
        '<label class="field" for="adm-pass"><span class="lab">Пароль</span><input id="adm-pass" type="password" autocomplete="current-password"></label>' +
        '<p class="err" id="admErr" hidden></p><button class="btn btn-primary" type="submit">Войти</button>' +
        (API.googleEnabled ? '<button class="btn btn-ghost" type="button" data-a="google">Войти через Google</button>' : '') +
        '<p class="hint">Нет аккаунта? Зарегистрируйтесь в приложении (Профиль → Войти), затем администратор выдаст вам доступ.</p></form>') +
      '</div></div>';
  }
  function renderNoAccess() {
    A.root.innerHTML = '<div class="wrap"><div class="login-box"><h1 class="h-page">Нет доступа</h1>' +
      '<div class="card form"><p>Вы вошли как <b>' + esc(A.user.email || '') + '</b>, но у этого аккаунта нет доступа к панели.</p>' +
      '<p class="muted small">Попросите владельца добавить ваш email во вкладке «Команда». Если вы владелец и только что всё настроили, выполните в Supabase команду из инструкции, чтобы стать администратором.</p>' +
      '<div class="row-btns"><button class="btn" data-a="logout">Выйти</button><a class="btn btn-ghost" href="#menu">Меню гостя</a></div></div></div></div>';
  }

  /* ------------------------------ каркас ------------------------------ */
  function tabs() {
    const t = [['orders', 'Заказы'], ['counter', '+ Новый заказ'], ['stop', 'Стоп-лист']];
    if (isAdmin()) t.push(['stats', 'Статистика'], ['partners', 'Партнёры'], ['menu', 'Меню и цены'], ['settings', 'Настройки'], ['team', 'Команда']);
    return t;
  }
  function renderFrame() {
    const newCount = A.orders.filter(o => o.status === 'new').length;
    A.root.innerHTML = '<header class="adm-top"><div class="wrap adm-top-in">' +
      '<div class="adm-brand">' + esc(A.settings.name) + ' <small>' + (isAdmin() ? 'владелец' : 'бариста') + '</small></div>' +
      '<div class="adm-tools">' +
      '<label class="switch" for="adm-acc"><input type="checkbox" id="adm-acc"' + (A.settings.accepting_orders ? ' checked' : '') + '>Приём заказов</label>' +
      '<button class="btn btn-sm ' + (A.soundOn ? 'btn-ghost' : 'btn-primary') + '" data-a="sound" id="soundBtn">' + (A.soundOn ? 'Звук включён' : 'Включить звук') + '</button>' +
      '<button class="btn btn-sm btn-ghost" data-a="notif" id="notifBtn" aria-expanded="' + N.open + '" aria-controls="notifBox">' + notifBtnInner() + '</button>' +
      '<span class="conn ' + A.conn + '" id="connDot">' + ({ live: 'онлайн', off: 'нет связи', connecting: 'связь…' }[A.conn]) + '</span>' +
      '<a class="btn btn-sm btn-ghost" href="#menu">Меню гостя</a>' +
      '<button class="btn btn-sm btn-ghost" data-a="logout">Выйти</button>' +
      '</div>' +
      '<div id="notifBox" class="notif-box"' + (N.open ? '' : ' hidden') + '>' + (N.open ? notifHTML() : '') + '</div>' +
      '<nav class="adm-tabs" role="tablist">' + tabs().map(t => '<button role="tab" data-a="tab" data-v="' + t[0] + '" aria-selected="' + (A.tab === t[0]) + '">' + t[1] + (t[0] === 'orders' && newCount ? '<span class="cnt" id="newCnt">' + newCount + '</span>' : '') + '</button>').join('') + '</nav>' +
      '</div></header><main class="wrap adm-page" id="admMain"></main>';
  }
  function setTab(t) { if (t === 'stats') ST.cur = null; if (t === 'partners') { PT.report = null; PT.err = null; PT.edit = null; PT.pay = null; } hideTip(); A.tab = t; U.store.set('adm_tab', t); A.edit = null; $$('.adm-tabs button', A.root).forEach(b => b.setAttribute('aria-selected', String(b.dataset.v === t))); showTab(); }
  function showTab() {
    const m = $('#admMain'); if (!m) return;
    if (A.tab === 'orders') m.innerHTML = ordersHTML();
    else if (A.tab === 'stop') m.innerHTML = stopHTML();
    else if (A.tab === 'counter') { m.innerHTML = counterHTML(); cObserve(); }
    else if (A.tab === 'menu') m.innerHTML = menuHTML();
    else if (A.tab === 'settings') { m.innerHTML = settingsHTML(); mountShopMap(); }
    else if (A.tab === 'team') { m.innerHTML = teamHTML(); loadTeam(); }
    else if (A.tab === 'stats') { m.innerHTML = statsHTML(); if (!ST.cur && !ST.loading && !ST.err) loadStats(); }
    else if (A.tab === 'partners') { m.innerHTML = partnersHTML(); if (PT.edit) mountPtMap(); if (!PT.report && !PT.loading && !PT.err) loadPartners(); }
    updateBadges();
    if (A.tab === 'orders') keepAwake(); else releaseAwake();
  }
  function updateBadges() {
    const n = A.orders.filter(o => o.status === 'new').length;
    document.title = (n ? '(' + n + ') ' : '') + 'Панель · ' + A.settings.name;
    const tab = $('.adm-tabs button[data-v="orders"]', A.root);
    if (tab) tab.innerHTML = 'Заказы' + (n ? '<span class="cnt">' + n + '</span>' : '');
  }

  /* ------------------------------ живые заказы ------------------------------ */
  async function loadOrders() {
    try { A.orders = await API.listOrders(); } catch (e) { toast(e.message, 'bad'); }
    if (A.tab === 'orders') showTab(); else updateBadges();
    scheduleChime();
  }
  function startLive() {
    loadOrders();
    A.unsub = API.subscribeOrders(onOrderEvent, (st) => {
      const was = A.conn; A.conn = st;
      const d = $('#connDot'); if (d) { d.className = 'conn ' + st; d.textContent = { live: 'онлайн', off: 'нет связи', connecting: 'связь…' }[st]; }
      if (st === 'live' && was === 'off') loadOrders();
    });
    A.tick = setInterval(() => { if (A.tab === 'orders' && !A.cancelFor && !isTypingIn()) showTab(); }, 30000);
    A.poll = setInterval(() => { if (A.conn !== 'live') loadOrders(); }, 20000);
    document.addEventListener('visibilitychange', onVisible);
  }
  function onVisible() { if (!document.hidden && A.user && location.hash.indexOf('#admin') === 0) { loadOrders(); if (A.tab === 'orders') keepAwake(); } }
  function stopLive() {
    if (A.unsub) { A.unsub(); A.unsub = null; }
    clearInterval(A.tick); clearInterval(A.poll); clearInterval(A.chimeTimer);
    document.removeEventListener('visibilitychange', onVisible);
    releaseAwake();
  }
  window.addEventListener('hashchange', () => { if (location.hash.indexOf('#admin') !== 0) { stopLive(); document.title = A.settings ? A.settings.name : document.title; } });
  const isTypingIn = () => { const a = document.activeElement; return a && /INPUT|TEXTAREA|SELECT/.test(a.tagName); };

  function onOrderEvent(ev) {
    const o = ev.new;
    if (ev.eventType === 'DELETE') { A.orders = A.orders.filter(x => x.id !== (ev.old && ev.old.id)); }
    else if (o && o.id) {
      const i = A.orders.findIndex(x => x.id === o.id);
      if (!o.items && i >= 0) o.items = A.orders[i].items;
      if (i >= 0) A.orders[i] = o; else { A.orders.unshift(o); }
      if (ev.eventType === 'INSERT' || (i < 0 && o.status === 'new')) {
        if (!o.items) loadOrders();
        // заказ у стойки бариста внёс сам — без звонка и уведомления
        if (o.source !== 'counter') { A.fresh.add(o.id); chime(); setTimeout(() => A.fresh.delete(o.id), 6000); localNotify(o); }
      }
    }
    if (A.tab === 'orders' && !A.cancelFor) showTab(); else updateBadges();
    scheduleChime();
  }

  /* ------------------------------ уведомления на телефон ------------------------------ */
  const N = {
    ready: false, open: false, busy: false, msg: '', err: '',
    supported: 'Notification' in window, perm: 'Notification' in window ? Notification.permission : 'denied',
    pushable: 'serviceWorker' in navigator && 'PushManager' in window,
    sub: null, key: null, status: null, local: false
  };
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = () => (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  const notifOn = () => N.perm === 'granted' && (!!N.sub || N.local);
  const BELL = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15Z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>';
  function notifBtnInner() { return BELL + '<span>' + (notifOn() ? 'Уведомления вкл.' : 'Уведомления') + '</span>' + (notifOn() ? '<i class="dot-on" aria-hidden="true"></i>' : ''); }
  function deviceName() {
    const ua = navigator.userAgent;
    const os = isIOS ? (/iPad/.test(ua) || navigator.maxTouchPoints > 1 && /Mac/.test(ua) ? 'iPad' : 'iPhone') : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'Устройство';
    const br = /EdgA?\//.test(ua) ? 'Edge' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /YaBrowser/.test(ua) ? 'Яндекс Браузер' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /Firefox|FxiOS/.test(ua) ? 'Firefox' : /Safari/.test(ua) ? 'Safari' : 'браузер';
    return os + ' · ' + br + (standalone() ? ' · приложение' : '');
  }
  const b64u = s => { const p = '='.repeat((4 - s.length % 4) % 4), b = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); const a = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a; };
  const sameKey = (buf, arr) => { if (!buf) return false; const a = new Uint8Array(buf); return a.length === arr.length && a.every((v, i) => v === arr[i]); };
  async function swReg() {
    if (!('serviceWorker' in navigator)) return null;
    try {
      let r = await navigator.serviceWorker.getRegistration();
      if (!r) r = await navigator.serviceWorker.register('sw.js');
      await Promise.race([navigator.serviceWorker.ready, new Promise(res => setTimeout(res, 4000))]);
      return r;
    } catch (e) { return null; }
  }
  async function notifInit() {
    N.perm = N.supported ? Notification.permission : 'denied';
    N.local = U.store.get('adm_local_notif', false) && N.perm === 'granted';
    try {
      const reg = N.pushable ? await navigator.serviceWorker.getRegistration() : null;
      N.sub = reg && reg.pushManager ? await reg.pushManager.getSubscription() : null;
    } catch (e) { N.sub = null; }
    if (API.mode === 'live') {
      N.key = await API.pushKey();
      N.status = await API.pushStatus().catch(() => null);
      // подписка есть в браузере: напоминаем о ней базе (после смены аккаунта или переустановки базы)
      if (N.sub && N.key && N.perm === 'granted') {
        const j = N.sub.toJSON();
        API.pushSubscribe({ endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, device: deviceName() }).catch(() => { });
      }
    }
    N.ready = true;
    renderNotif();
    if (A.tab === 'orders') showTab();
  }
  function renderNotif() {
    const b = $('#notifBtn'); if (b) { b.innerHTML = notifBtnInner(); b.setAttribute('aria-expanded', String(N.open)); }
    const box = $('#notifBox'); if (!box) return;
    box.hidden = !N.open; box.innerHTML = N.open ? notifHTML() : '';
  }
  function notifHTML() {
    const live = API.mode === 'live', server = live && !!N.key && !!(N.status && N.status.configured);
    let state, btns = '';
    if (!N.supported) state = isIOS ? 'На iPhone уведомления работают только из приложения на экране «Домой». Откройте сайт в Safari → «Поделиться» → «На экран Домой», запустите оттуда и зайдите в панель.' : 'Этот браузер не умеет показывать уведомления. Откройте панель в Chrome.';
    else if (isIOS && !standalone()) state = 'На iPhone уведомления работают только из приложения на экране «Домой». Откройте сайт в Safari → «Поделиться» → «На экран Домой», запустите оттуда и зайдите в панель.';
    else if (N.perm === 'denied') state = 'Уведомления запрещены в настройках браузера. Нажмите на значок слева от адреса сайта → «Уведомления» → «Разрешить» и обновите страницу.';
    else if (N.sub) { state = '<b>Включены на этом устройстве.</b> О новом заказе придёт уведомление, даже если панель закрыта и экран заблокирован.'; btns = '<button class="btn btn-sm btn-primary" data-a="notif-test">Отправить тест</button><button class="btn btn-sm btn-ghost" data-a="notif-off">Выключить на этом устройстве</button>'; }
    else if (N.local) { state = '<b>Включены, пока панель открыта.</b> Можно свернуть браузер или переключиться на другое приложение, но не закрывать вкладку.' + (live && !server ? ' Чтобы уведомления приходили и при закрытой панели, подключите сервер уведомлений (см. ниже).' : ''); btns = (server ? '<button class="btn btn-sm btn-primary" data-a="notif-on">Включить полностью</button>' : '') + '<button class="btn btn-sm" data-a="notif-test">Проверить</button><button class="btn btn-sm btn-ghost" data-a="notif-off">Выключить</button>'; }
    else { state = server ? 'Телефон или планшет сообщит о новом заказе звуком и баннером, даже если панель закрыта.' : (live ? 'Сервер уведомлений ещё не подключён: пока уведомления будут приходить, только когда панель открыта.' : 'В демо уведомления приходят, пока панель открыта.'); btns = '<button class="btn btn-sm btn-primary" data-a="notif-on">Включить на этом устройстве</button>'; }
    let h = '<div class="card notif-card"><div class="st-h"><h3>' + BELL + ' Уведомления о новых заказах</h3><button class="iconbtn" data-a="notif-close" aria-label="Закрыть">×</button></div>' +
      '<p class="notif-state">' + state + '</p>' +
      (btns ? '<div class="row-btns">' + btns + '</div>' : '') +
      (N.busy ? '<p class="hint">Подождите…</p>' : '') +
      (N.msg ? '<p class="hint ok-t" role="status">' + esc(N.msg) + '</p>' : '') +
      (N.err ? '<p class="err" role="alert">' + esc(N.err) + '</p>' : '');
    if (live && !server && isAdmin()) h += '<details class="notif-setup"><summary>Как подключить сервер уведомлений</summary><ol>' +
      '<li>Залейте новый архив на сервер и запустите deploy.sh, как обычно.</li>' +
      '<li>В конце deploy.sh напечатает команду <code>select public.set_push_config(…)</code>. Выполните её в Supabase → SQL Editor.</li>' +
      '<li>Обновите эту страницу и нажмите «Включить на этом устройстве» на телефоне каждого бариста.</li></ol>' +
      (N.status && N.status.pg_net === false ? '<p class="hint">В базе не включено расширение pg_net: выполните новый schema.sql.</p>' : '') + '</details>';
    if (N.status && Array.isArray(N.status.team) && N.status.team.length) h += '<p class="hint notif-team">Подключены: ' + N.status.team.map(t => esc(t.who) + ' (' + esc(t.device || 'устройство') + ')').join(', ') + '</p>';
    return h + '</div>';
  }
  async function notifEnable() {
    N.busy = true; N.err = ''; N.msg = ''; renderNotif();
    try {
      if (!N.supported) throw new Error('Этот браузер не умеет показывать уведомления');
      const perm = await Notification.requestPermission();
      N.perm = perm;
      if (perm !== 'granted') throw new Error(perm === 'denied' ? 'Браузер запретил уведомления. Разрешите их в настройках сайта и обновите страницу' : 'Нужно нажать «Разрешить» в окне браузера');
      const reg = await swReg();
      if (API.mode === 'live' && N.key && reg && reg.pushManager) {
        if (N.status && N.status.configured === false) throw new Error('Сервер уведомлений не подключён к базе. Выполните в Supabase команду set_push_config из вывода deploy.sh');
        const key = b64u(N.key);
        let sub = await reg.pushManager.getSubscription();
        if (sub && !sameKey(sub.options && sub.options.applicationServerKey, key)) { await sub.unsubscribe().catch(() => { }); sub = null; }
        if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
        const j = sub.toJSON();
        await API.pushSubscribe({ endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, device: deviceName() });
        N.sub = sub; N.local = false; U.store.set('adm_local_notif', false);
        N.msg = 'Готово. Нажмите «Отправить тест», чтобы проверить.';
      } else {
        N.local = true; U.store.set('adm_local_notif', true);
        N.msg = 'Включено. Пока панель открыта, новые заказы будут приходить уведомлением.';
      }
      N.status = API.mode === 'live' ? await API.pushStatus().catch(() => N.status) : N.status;
    } catch (e) { N.err = e && e.name === 'NotAllowedError' ? 'Браузер не разрешил подписку. Проверьте, что уведомления для сайта разрешены' : (e.message || 'Не получилось включить'); }
    N.busy = false; renderNotif(); if (A.tab === 'orders') showTab();
  }
  async function notifOffQuiet() {
    if (N.sub) { const ep = N.sub.endpoint; try { await API.pushUnsubscribe(ep); } catch (e) { /* не страшно */ } try { await N.sub.unsubscribe(); } catch (e) { /* не страшно */ } N.sub = null; }
    N.local = false; U.store.set('adm_local_notif', false);
  }
  async function notifDisable() {
    N.busy = true; N.err = ''; N.msg = ''; renderNotif();
    await notifOffQuiet();
    N.status = API.mode === 'live' ? await API.pushStatus().catch(() => N.status) : N.status;
    N.busy = false; N.msg = 'Уведомления на этом устройстве выключены.'; renderNotif();
  }
  async function notifTest() {
    N.err = ''; N.msg = '';
    try {
      if (N.sub) { N.busy = true; renderNotif(); await API.pushTest(); N.msg = 'Отправили. Уведомление придёт через пару секунд. Если нет — проверьте, что уведомления браузера не выключены в настройках телефона.'; }
      else { await showLocal('Kese Coffee: уведомления работают', 'Так будут приходить новые заказы', 'test'); N.msg = 'Показали тестовое уведомление.'; }
    } catch (e) { N.err = e.message; }
    N.busy = false; renderNotif();
  }
  async function showLocal(title, body, tag) {
    const opts = { body, tag: tag || 'kese', renotify: true, icon: 'icons/icon-192.png', badge: 'icons/badge-96.png', data: { url: './#admin' } };
    const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration().catch(() => null) : null;
    if (reg && reg.showNotification) return reg.showNotification(title, opts);
    try { new Notification(title, opts); } catch (e) { throw new Error('Браузер не показал уведомление'); }
  }
  function localNotify(o) {
    // при настоящей push-подписке уведомление пришлёт сервер; здесь — только запасной вариант
    if (!N.local || N.sub || N.perm !== 'granted' || !document.hidden || !o || !o.number) return;
    const items = (o.items || []).map(i => i.name + (i.size ? ' ' + String(i.size).split(' ')[0] : '') + (i.qty > 1 ? ' ×' + i.qty : '')).join(', ');
    const when = o.asap ? 'как можно скорее' : 'к ' + U.timeIn(o.ready_at, A.settings.timezone);
    showLocal('Новый заказ №' + o.number + ' · ' + money(o.total), [items, when, o.customer_name].filter(Boolean).join(' · '), 'order-' + o.id).catch(() => { });
  }

  /* звук: короткий сигнал, повтор каждые 20 с, пока есть непринятые заказы */
  function unlockSound() {
    try {
      A.audio = A.audio || new (window.AudioContext || window.webkitAudioContext)();
      if (A.audio.state === 'suspended') A.audio.resume();
      A.soundOn = true; U.store.set('adm_sound', true); chime();
    } catch (e) { toast('Браузер не разрешил звук', 'bad'); }
    const b = $('#soundBtn'); if (b) { b.textContent = 'Звук включён'; b.className = 'btn btn-sm btn-ghost'; }
    scheduleChime();
  }
  function chime() {
    if (!A.soundOn || !A.audio) return;
    const ctx = A.audio, t0 = ctx.currentTime;
    [[880, 0], [1320, .18], [1760, .36]].forEach(([f, d]) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = f; o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0.0001, t0 + d); g.gain.exponentialRampToValueAtTime(0.35, t0 + d + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.35);
      o.start(t0 + d); o.stop(t0 + d + 0.4);
    });
    if (navigator.vibrate) navigator.vibrate(150);
  }
  function scheduleChime() {
    clearInterval(A.chimeTimer);
    if (A.orders.some(o => o.status === 'new')) A.chimeTimer = setInterval(() => { if (A.orders.some(o => o.status === 'new')) chime(); else clearInterval(A.chimeTimer); }, 20000);
  }
  async function keepAwake() { try { if ('wakeLock' in navigator && !A.wake) { A.wake = await navigator.wakeLock.request('screen'); A.wake.addEventListener('release', () => { A.wake = null; }); } } catch (e) { A.wake = null; } }
  function releaseAwake() { if (A.wake) { A.wake.release().catch(() => { }); A.wake = null; } }

  /* ------------------------------ доска заказов ------------------------------ */
  function ordersHTML() {
    const s = A.settings, tz = s.timezone;
    const col = st => A.orders.filter(o => st.includes(o.status));
    const nw = col(['new']).sort((a, b) => a.created_at.localeCompare(b.created_at));
    const prep = col(['accepted']).sort((a, b) => a.ready_at.localeCompare(b.ready_at));
    const ready = col(['ready', 'on_the_way']).sort((a, b) => a.ready_at.localeCompare(b.ready_at));
    const n = U.tzNow(tz), today = n.y + '-' + String(n.m).padStart(2, '0') + '-' + String(n.d).padStart(2, '0');
    const todays = A.orders.filter(o => o.business_date === today);
    const valid = todays.filter(o => o.status !== 'cancelled');
    const revenue = valid.reduce((a, o) => a + o.total, 0);
    const done = A.orders.filter(o => o.status === 'completed' || o.status === 'cancelled').sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    let h = '';
    if (!s.accepting_orders) h += '<div class="adm-banner bad"><span>Приём онлайн-заказов на паузе. Гости видят меню, но не могут заказать.</span><button class="btn btn-sm" data-a="accepting-on">Возобновить</button></div>';
    if (!A.soundOn) h += '<div class="adm-banner"><span>Включите звук, чтобы слышать новые заказы. Браузер разрешает звук только после нажатия.</span><button class="btn btn-sm btn-primary" data-a="sound">Включить звук</button></div>';
    if (N.ready && !notifOn() && N.supported && U.store.get('adm_notif_hint', '') !== 'closed') h += '<div class="adm-banner"><span>Включите уведомления: о новом заказе телефон сообщит, даже если панель закрыта.</span><button class="btn btn-sm btn-primary" data-a="notif">Настроить</button><button class="btn btn-sm btn-ghost" data-a="notif-hint-x">Не сейчас</button></div>';
    const atCounter = valid.filter(o => o.source === 'counter').length;
    h += '<div class="stats"><span>Сегодня заказов <b>' + valid.length + '</b>' + (atCounter ? ' <small>(у стойки ' + atCounter + ')</small>' : '') + '</span><span>Сумма <b>' + money(revenue) + '</b></span>' +
      (valid.length ? '<span>Средний чек <b>' + money(Math.round(revenue / valid.length)) + '</b></span>' : '') +
      '<button class="btn btn-sm btn-primary stats-new" data-a="tab" data-v="counter">+ Заказ у стойки</button></div>';
    h += '<div class="board">' +
      colHTML('Новые', nw, 'Новых заказов нет. Они появятся здесь со звуком.') +
      colHTML('Готовятся', prep, 'Примите заказ, и он переедет сюда.') +
      colHTML('Готовы к выдаче', ready, 'Здесь будут готовые заказы.') +
      '</div>';
    if (done.length) {
      h += '<details class="done-list"><summary>Завершённые (' + done.length + ')</summary>' + done.map(o =>
        '<div class="done-row"><span class="num">№' + o.number + '</span><span class="txt">' + esc(o.customer_name) + ' · ' + esc((o.items || []).map(i => i.name + (i.qty > 1 ? ' ×' + i.qty : '')).join(', ')) + '</span>' +
        '<span class="chip-s st-' + o.status + '">' + esc(U.STATUS[o.status]) + '</span><span class="pr">' + money(o.total) + '</span></div>').join('') + '</details>';
    }
    return h;
  }
  function colHTML(title, list, empty) {
    return '<section class="col"><div class="col-h"><span>' + title + '</span><span class="n">' + list.length + '</span></div>' +
      (list.length ? list.map(cardHTML).join('') : '<div class="col-empty">' + empty + '</div>') + '</section>';
  }
  function leftLabel(o) {
    const m = Math.round((new Date(o.ready_at).getTime() - Date.now()) / 60000);
    if (m <= -1) return '<span class="left late">опоздание ' + Math.abs(m) + ' мин</span>';
    if (m <= 3) return '<span class="left soon">сейчас</span>';
    if (m <= 10) return '<span class="left soon">через ' + m + ' мин</span>';
    if (m < 120) return '<span class="left">через ' + m + ' мин</span>';
    return '<span class="left">' + U.dayLabel(o.ready_at, A.settings.timezone) + '</span>';
  }
  function cardHTML(o) {
    const tz = A.settings.timezone, del = o.fulfillment === 'delivery';
    const items = (o.items || []).map(it => {
      const d = [it.size, U.modsText(it.modifiers)].filter(Boolean).join(' · ');
      const special = (it.modifiers || []).some(m => !(m.is_default && !m.price));
      return '<li><span class="oc-q' + (it.qty > 1 ? ' many' : '') + '">' + it.qty + '×</span><span class="oc-n">' + esc(it.name) + '</span>' + (d ? '<span class="oc-d' + (special ? ' mark' : '') + '">' + esc(d) + '</span>' : '') + '</li>';
    }).join('');
    let main = '';
    if (o.status === 'new') main = '<button class="btn btn-primary oc-main" data-a="st" data-id="' + o.id + '" data-v="accepted">Принять</button>';
    else if (o.status === 'accepted') main = del ? '<button class="btn btn-ok oc-main" data-a="st" data-id="' + o.id + '" data-v="on_the_way">Передан курьеру</button>' : '<button class="btn btn-ok oc-main" data-a="st" data-id="' + o.id + '" data-v="ready">Готов</button>';
    else if (o.status === 'ready') main = del ? '<button class="btn btn-ok oc-main" data-a="st" data-id="' + o.id + '" data-v="on_the_way">Передан курьеру</button>' : '<button class="btn oc-main" data-a="st" data-id="' + o.id + '" data-v="completed">Выдан гостю</button>';
    else if (o.status === 'on_the_way') main = '<button class="btn oc-main" data-a="st" data-id="' + o.id + '" data-v="completed">Доставлен</button>';
    let pay = '<span class="badge ' + o.payment_status + '">' + esc(U.PAY[o.payment_method]) + ': ' + esc(U.PAY_STATUS[o.payment_status]).toLowerCase() + '</span>';
    let payBtns = '';
    if (o.payment_method === 'kaspi') {
      if (o.payment_status === 'unpaid') payBtns = '<button class="btn btn-sm" data-a="pay" data-id="' + o.id + '" data-v="invoice_sent">Счёт выставлен</button>';
      if (o.payment_status !== 'paid') payBtns += '<button class="btn btn-sm" data-a="pay" data-id="' + o.id + '" data-v="paid">Оплачен</button>';
    } else if (o.payment_status !== 'paid') payBtns = '<button class="btn btn-sm" data-a="pay" data-id="' + o.id + '" data-v="paid">Оплачен</button>';
    const cancel = A.cancelFor === o.id ? cancelBox(o) : '<button class="btn btn-sm btn-ghost" data-a="cancel" data-id="' + o.id + '">Отменить</button>';
    return '<article class="ocard s-' + o.status + (A.fresh.has(o.id) ? ' fresh' : '') + '">' +
      '<div class="oc-top"><span class="oc-num">№' + o.number + '</span><span class="oc-time"><b>' + (o.asap ? 'Скорее' : 'к ' + U.timeIn(o.ready_at, tz)) + '</b>' + leftLabel(o) + '</span></div>' +
      '<div class="oc-who"><b>' + esc(o.customer_name) + '</b>' + (o.customer_phone ? '<button class="oc-phone" data-a="copy" data-v="' + esc(o.customer_phone) + '" title="Скопировать номер для Kaspi">' + esc(U.phoneFmt(o.customer_phone)) + '</button>' : '') +
      (del ? '<span class="badge del">Доставка</span>' : '') +
      (o.source === 'counter' ? '<span class="badge walkin">У стойки</span>' : '') +
      (o.partner_name ? '<span class="badge pt" title="' + (o.to_partner ? 'Принести к партнёру' : 'Заказ по QR партнёра') + '">' + (o.to_partner ? 'К партнёру: ' : 'QR: ') + esc(o.partner_name) + '</span>' : '') + '</div>' +
      (del ? '<div class="oc-addr">' + esc(o.delivery_address || '') + (o.delivery_details ? ', ' + esc(o.delivery_details) : '') +
        (o.delivery_lat != null ? '<span class="oc-geo">' + (o.delivery_km != null ? '≈ ' + U.km(Number(o.delivery_km)) + ' · ' : '') +
          '<a href="https://2gis.kz/geo/' + o.delivery_lng + ',' + o.delivery_lat + '" target="_blank" rel="noopener">2ГИС</a> · ' +
          '<a href="https://yandex.kz/maps/?pt=' + o.delivery_lng + ',' + o.delivery_lat + '&z=17&l=map" target="_blank" rel="noopener">Яндекс Карты</a></span>' : '') +
        '</div>' : '') +
      '<ul class="oc-items">' + items + '</ul>' +
      (o.comment ? '<div class="oc-note">' + esc(o.comment) + '</div>' : '') +
      '<div class="oc-pay"><span class="sumv">' + money(o.total) + '</span>' + pay + payBtns + '</div>' +
      '<div class="oc-act">' + main + '</div>' +
      '<div class="oc-act">' + cancel + '<span class="muted small" style="margin-left:auto;align-self:center">' + U.timeIn(o.created_at, tz) + '</span></div>' +
      '</article>';
  }
  function cancelBox(o) {
    const reasons = ['Закончились ингредиенты', 'Не успеваем', 'Гость попросил отменить', 'Не дозвонились'];
    return '<div class="confirm" style="flex:1"><p>Причина отмены заказа №' + o.number + '</p>' +
      reasons.map(r => '<button class="btn btn-sm" data-a="cancel-do" data-id="' + o.id + '" data-v="' + esc(r) + '">' + esc(r) + '</button>').join('') +
      '<button class="btn btn-sm btn-ghost" data-a="cancel-no">Не отменять</button></div>';
  }
  async function setOrder(id, patch) {
    const i = A.orders.findIndex(o => o.id === id); if (i < 0) return;
    const before = A.orders[i];
    A.orders[i] = Object.assign({}, before, patch);
    showTab(); scheduleChime();
    try { const r = await API.updateOrder(id, patch); if (r) { if (!r.items) r.items = before.items; const j = A.orders.findIndex(o => o.id === id); if (j >= 0) A.orders[j] = r; } }
    catch (e) { A.orders[i] = before; toast(e.message, 'bad'); }
    showTab(); scheduleChime();
  }

  /* ------------------------------ стоп-лист ------------------------------ */
  function stopHTML() {
    const prods = A.menu.products.filter(p => p.active);
    const off = prods.filter(p => !p.available).length;
    let h = '<p class="muted">Отключите то, что закончилось. Гости увидят «Закончилось», заказать не смогут. ' + (off ? '<b>Сейчас на стопе: ' + off + '</b>' : '') + '</p>';
    h += '<h2 class="h-sec">Позиции</h2><div class="stop-grid">' + prods.map(p =>
      '<label class="stop-item switch' + (p.available ? '' : ' off') + '" for="sp-' + p.id + '"><span class="nm">' + esc(p.name) + '</span><input type="checkbox" id="sp-' + p.id + '" data-a="avail" data-id="' + p.id + '"' + (p.available ? ' checked' : '') + '></label>').join('') + '</div>';
    const mods = [];
    A.menu.groups.forEach(g => g.modifiers.forEach(m => { if (!m.is_default) mods.push({ g, m }); }));
    if (mods.length) h += '<h2 class="h-sec">Добавки</h2><div class="stop-grid">' + mods.map(({ g, m }) =>
      '<label class="stop-item switch' + (m.active ? '' : ' off') + '" for="sm-' + m.id + '"><span class="nm">' + esc(m.name) + ' <span class="muted small">' + esc(g.name.toLowerCase()) + '</span></span><input type="checkbox" id="sm-' + m.id + '" data-a="mod-avail" data-id="' + m.id + '"' + (m.active ? ' checked' : '') + '></label>').join('') + '</div>';
    return h;
  }

  /* ------------------------------ заказ у стойки ------------------------------ */
  // Гость пришёл в кофейню: бариста набирает заказ, он попадает на доску и в статистику
  const C = { lines: [], cat: 'all', name: '', phone: '', comment: '', pay: U.store.get('ctr_pay', 'place'), paid: true, edit: null, busy: false, err: '', last: null };
  const cIdx = () => U.indexMenu(A.menu);
  const cGroups = (p, ix) => (p.modifier_group_ids || []).map(id => ix.groups[id]).filter(g => g && g.modifiers.some(m => m.active)).sort((a, b) => a.sort - b.sort);
  function cDefaults(p, ix) {
    const ids = [];
    cGroups(p, ix).forEach(g => { if (g.multi) return; const ms = g.modifiers.filter(m => m.active); const d = ms.find(m => m.is_default) || ms[0]; if (d) ids.push(d.id); });
    return ids.sort();
  }
  const cKey = l => l.product_id + '|' + (l.size || '') + '|' + l.modifier_ids.slice().sort().join(',');
  function cMerge() { const out = []; C.lines.forEach(l => { const ex = out.find(x => cKey(x) === cKey(l)); if (ex) ex.qty = Math.min(20, ex.qty + l.qty); else out.push(l); }); C.lines = out; }
  function cLines(ix) {
    return C.lines.map(l => {
      const p = ix.products[l.product_id];
      if (!p || !p.active) return Object.assign({}, l, { name: 'Позиция удалена из меню', unit: 0, bad: true, detail: '' });
      return Object.assign({}, l, { name: p.name, unit: U.unitPrice(p, l.size, l.modifier_ids, ix), bad: !p.available,
        detail: U.modsText(l.modifier_ids.map(id => ix.mods[id]).filter(Boolean)) });
    });
  }
  function cAdd(pid, size) {
    const ix = cIdx(), p = ix.products[pid]; if (!p || !p.available) return;
    const l = { product_id: pid, size: size || null, modifier_ids: cDefaults(p, ix), qty: 1 };
    const ex = C.lines.find(x => cKey(x) === cKey(l));
    if (ex) ex.qty = Math.min(20, ex.qty + 1); else C.lines.push(l);
    C.err = '';
    if (C.last) { C.last = null; const lb = $('#ctrLast'); if (lb) lb.remove(); }
    renderTicket();
    const t = $('[data-tile="' + pid + '"]'); if (t) { t.classList.remove('ct-hit'); void t.offsetWidth; t.classList.add('ct-hit'); }
  }
  function counterHTML() {
    const prods = A.menu.products.filter(p => p.active);
    const cats = A.menu.categories.filter(c => c.active && prods.some(p => p.category_id === c.id));
    if (C.cat !== 'all' && !cats.some(c => c.id === C.cat)) C.cat = 'all';
    const shown = prods.filter(p => C.cat === 'all' || p.category_id === C.cat);
    return lastHTML() + '<div class="ctr">' +
      '<section class="ctr-menu" aria-label="Меню">' +
      '<div class="chips ctr-cats" role="group" aria-label="Категории"><button class="chip" data-a="c-cat" data-v="all" aria-pressed="' + (C.cat === 'all') + '">Все</button>' +
      cats.map(c => '<button class="chip" data-a="c-cat" data-v="' + c.id + '" aria-pressed="' + (C.cat === c.id) + '">' + esc(c.name) + '</button>').join('') + '</div>' +
      '<div class="ctr-grid">' + (shown.length ? shown.map(tileHTML).join('') : '<p class="muted">В меню пока нет позиций.</p>') + '</div></section>' +
      '<aside class="ctr-ticket card" id="ctrTicket" aria-label="Заказ гостя">' + ticketHTML() + '</aside></div>' +
      '<div class="ctr-bar" id="ctrBar">' + barHTML() + '</div>';
  }
  function tileHTML(p) {
    const off = !p.available;
    const btn = (label, price, v) => '<button class="ct-add" data-a="c-add" data-id="' + p.id + '" data-v="' + esc(v) + '"' + (off ? ' disabled' : '') + ' aria-label="' + esc(p.name + (v ? ' ' + v : '')) + ', ' + money(price) + '"><b>' + esc(label) + '</b><small>' + money(price) + '</small></button>';
    const btns = p.sizes && p.sizes.length ? p.sizes.map(z => btn(z.label, z.price, z.label)).join('') : btn('+', p.price || 0, '');
    return '<div class="ct-tile' + (off ? ' off' : '') + '" data-tile="' + p.id + '"><span class="ct-nm">' + esc(p.name) + (off ? ' <span class="ct-stop">стоп</span>' : '') + '</span><div class="ct-btns">' + btns + '</div></div>';
  }
  function lastHTML() {
    const l = C.last; if (!l) return '';
    const done = l.status === 'completed';
    return '<div class="ct-last" id="ctrLast" role="status"><span class="ct-big">№' + l.number + '</span><div class="ct-last-tx"><b>' + (done ? 'Выдан' : 'Готовится') + ' · ' + money(l.total) + '</b>' +
      '<span>' + (done ? 'Сохранён в статистике.' : 'Назовите гостю номер. Заказ уже на доске в «Готовятся».') + '</span></div>' +
      '<button class="btn btn-sm btn-ghost" data-a="tab" data-v="orders">К заказам</button></div>';
  }
  function cEditor(l, i, ix) {
    const p = ix.products[l.product_id]; if (!p) return '';
    let h = '<div class="ct-ed">';
    if (p.sizes && p.sizes.length > 1) h += '<div class="chips">' + p.sizes.map(z => '<button class="chip" data-a="c-size" data-i="' + i + '" data-v="' + esc(z.label) + '" aria-pressed="' + (l.size === z.label) + '">' + esc(z.label) + ' <small>' + money(z.price) + '</small></button>').join('') + '</div>';
    cGroups(p, ix).forEach(g => {
      h += '<div class="ct-eg"><span class="lab">' + esc(g.name) + '</span><div class="chips">' + g.modifiers.filter(m => m.active).map(m =>
        '<button class="chip" data-a="c-mod" data-i="' + i + '" data-g="' + g.id + '" data-v="' + m.id + '" aria-pressed="' + (l.modifier_ids.indexOf(m.id) >= 0) + '">' + esc(m.name) + (m.price ? ' <small>+' + money(m.price) + '</small>' : '') + '</button>').join('') + '</div></div>';
    });
    return h + '<div class="row-btns"><button class="btn btn-sm btn-primary" data-a="c-edit-done">Готово</button><button class="btn btn-sm btn-ghost" data-a="c-del" data-i="' + i + '">Убрать</button></div></div>';
  }
  function ticketHTML() {
    const ix = cIdx(), lines = cLines(ix);
    const total = lines.reduce((a, l) => a + l.unit * l.qty, 0), n = lines.reduce((a, l) => a + l.qty, 0);
    const bad = lines.some(l => l.bad), dis = !lines.length || bad || C.busy ? ' disabled' : '';
    let h = '<div class="ct-h"><h2>Заказ у стойки</h2>' + (n ? '<span class="muted small">' + n + ' ' + U.plural(n, 'позиция', 'позиции', 'позиций') + '</span>' : '') + '</div>';
    if (!lines.length) h += '<p class="ct-empty">Нажмите на размер напитка в меню, и он появится здесь.</p>';
    else h += '<ul class="ct-lines">' + lines.map((l, i) => '<li class="ct-line' + (l.bad ? ' bad' : '') + (C.edit === i ? ' open' : '') + '">' +
      '<button class="ct-ln" data-a="c-edit" data-i="' + i + '" aria-expanded="' + (C.edit === i) + '"><b>' + esc(l.name) + (l.size ? ' ' + esc(l.size) : '') + '</b><small>' + (l.bad ? 'на стопе, уберите' : esc(l.detail || 'добавки и размер')) + '</small></button>' +
      '<span class="ct-q"><button data-a="c-q" data-i="' + i + '" data-v="-1" aria-label="Меньше">−</button><b>' + l.qty + '</b><button data-a="c-q" data-i="' + i + '" data-v="1" aria-label="Больше">+</button></span>' +
      '<span class="ct-sum">' + money(l.unit * l.qty) + '</span>' + (C.edit === i ? cEditor(l, i, ix) : '') + '</li>').join('') + '</ul>';
    h += '<div class="ct-total"><span>Итого</span><b>' + money(total) + '</b></div>' +
      '<form id="ctrForm" class="ct-form" novalidate>' +
      '<div class="ct-two"><label class="field" for="c-name"><span class="lab">Имя на стакане</span><input id="c-name" type="text" maxlength="60" autocomplete="off" placeholder="Гость" value="' + esc(C.name) + '"></label>' +
      '<label class="field" for="c-phone"><span class="lab">Телефон</span><input id="c-phone" type="tel" inputmode="tel" autocomplete="off" placeholder="по желанию" value="' + esc(C.phone) + '"></label></div>' +
      '<div class="field"><span class="lab">Оплата</span><div class="seg ct-pay" role="radiogroup" aria-label="Оплата">' +
      [['place', 'Наличные / карта'], ['kaspi', 'Kaspi QR']].map(x => '<button type="button" role="radio" data-a="c-pay" data-v="' + x[0] + '" aria-checked="' + (C.pay === x[0]) + '">' + x[1] + '</button>').join('') + '</div></div>' +
      '<label class="switch ct-paid" for="c-paid"><input type="checkbox" id="c-paid"' + (C.paid ? ' checked' : '') + '>Уже оплачен</label>' +
      '<label class="field" for="c-comment"><span class="lab">Комментарий</span><input id="c-comment" type="text" maxlength="200" autocomplete="off" placeholder="Без сахара, погорячее" value="' + esc(C.comment) + '"></label>' +
      (C.err ? '<p class="err" role="alert">' + esc(C.err) + '</p>' : '') +
      '<div class="ct-go"><button type="submit" class="btn btn-primary"' + dis + '>' + (C.busy ? 'Оформляем…' : 'Готовить · ' + money(total)) + '</button>' +
      '<button type="button" class="btn" data-a="c-done"' + dis + '>Выдан сразу</button></div>' +
      (lines.length ? '<button type="button" class="linkbtn" data-a="c-clear">Очистить заказ</button>' : '') +
      '</form>';
    return h;
  }
  function barHTML() {
    const n = C.lines.reduce((a, l) => a + l.qty, 0); if (!n) return '';
    const total = cLines(cIdx()).reduce((a, l) => a + l.unit * l.qty, 0);
    return '<button class="ctr-bar-in" data-a="c-jump"><span class="cb-count">' + n + '</span><span>К оформлению</span><b>' + money(total) + '</b></button>';
  }
  // на телефоне: когда чек уже виден, нижняя кнопка «К оформлению» не нужна и не должна закрывать «Готовить»
  function cObserve() {
    if (C.io) C.io.disconnect();
    const t = $('#ctrTicket'); if (!t || !('IntersectionObserver' in window)) return;
    C.io = new IntersectionObserver(es => { const b = $('#ctrBar'); if (b) b.classList.toggle('away', es[es.length - 1].isIntersecting); });
    C.io.observe(t);
  }
  function renderTicket() {
    const act = document.activeElement, ds = act && act.dataset;
    const sel = ds && ds.a ? '[data-a="' + ds.a + '"]' + (ds.i ? '[data-i="' + ds.i + '"]' : '') + (ds.v ? '[data-v="' + ds.v.replace(/"/g, '\\"') + '"]' : '') : null;
    const t = $('#ctrTicket'); if (t) t.innerHTML = ticketHTML();
    const b = $('#ctrBar'); if (b) b.innerHTML = barHTML();
    if (t && sel && !document.contains(act)) { const el = t.querySelector(sel); if (el) el.focus({ preventScroll: true }); }
  }
  async function counterSubmit(status) {
    if (C.busy) return;
    cMerge();
    if (!C.lines.length) { C.err = 'Добавьте хотя бы одну позицию'; return renderTicket(); }
    C.busy = true; C.err = ''; renderTicket();
    try {
      const r = await API.counterOrder({
        customer_name: C.name.trim(), customer_phone: C.phone.trim() ? U.normPhone(C.phone) : '',
        payment_method: C.pay, paid: !!C.paid, status, comment: C.comment.trim(),
        items: C.lines.map(l => ({ product_id: l.product_id, size: l.size, modifier_ids: l.modifier_ids, qty: l.qty }))
      });
      C.last = { number: r.number, total: r.total, status: r.status || status };
      C.lines = []; C.edit = null; C.name = ''; C.phone = ''; C.comment = ''; C.paid = true;
      toast('Заказ №' + r.number + (status === 'completed' ? ' выдан' : ' готовится'));
      loadOrders();
      window.scrollTo({ top: 0 });
    } catch (e) {
      C.err = e.message;
      if (/закончился|не продаётся|обновите меню|недоступна/i.test(e.message)) { try { A.menu = await API.getMenu(); } catch (x) { /* офлайн */ } }
    }
    C.busy = false;
    if (A.tab === 'counter') showTab();
  }

  /* ------------------------------ меню и цены ------------------------------ */
  function priceSummary(p) {
    if (p.sizes && p.sizes.length) return p.sizes.map(z => z.label + ' ' + money(z.price)).join(' · ');
    return money(p.price || 0);
  }
  function menuHTML() {
    const sub = A.menuSub;
    let h = '<div class="sub-tabs">' + [['items', 'Позиции'], ['groups', 'Добавки'], ['cats', 'Категории']].map(t =>
      '<button class="chip" data-a="msub" data-v="' + t[0] + '" aria-pressed="' + (sub === t[0]) + '">' + t[1] + '</button>').join('') + '</div>';
    if (sub === 'items') h += itemsEditor();
    else if (sub === 'groups') h += groupsEditor();
    else h += catsEditor();
    return h;
  }
  function itemsEditor() {
    const cats = A.menu.categories.slice();
    const orphan = A.menu.products.filter(p => !cats.some(c => c.id === p.category_id));
    if (orphan.length) cats.push({ id: '', name: 'Без категории' });
    const list = cats.map(c => {
      const ps = c.id ? A.menu.products.filter(p => p.category_id === c.id) : orphan;
      return '<section class="ed-cat"><div class="ed-cat-h"><h3>' + esc(c.name) + (c.active === false ? ' <span class="muted small">(скрыта)</span>' : '') + '</h3><button class="btn btn-sm btn-ghost" data-a="p-new" data-v="' + (c.id || '') + '">+ Позиция</button></div>' +
        (ps.length ? ps.map(p => '<div class="ed-item' + (p.active ? '' : ' hidden-p') + '"><span class="tx"><span class="nm">' + esc(p.name) + '</span><span class="ds">' + esc(priceSummary(p)) + (p.available ? '' : ' · на стопе') + '</span></span>' +
          '<label class="switch" title="В наличии"><input type="checkbox" data-a="avail" data-id="' + p.id + '"' + (p.available ? ' checked' : '') + ' aria-label="В наличии: ' + esc(p.name) + '"></label>' +
          '<button class="iconbtn" data-a="p-edit" data-id="' + p.id + '" aria-label="Изменить ' + esc(p.name) + '">✎</button></div>').join('') : '<p class="muted small">Пока пусто</p>') +
        '</section>';
    }).join('');
    return '<div class="ed"><div class="ed-list">' + (list || '<p class="muted">Сначала создайте категорию.</p>') + '</div>' +
      '<aside class="ed-panel" id="edPanel">' + (A.edit && A.edit.kind === 'product' ? productForm() : '<p class="muted">Нажмите ✎ рядом с позицией, чтобы изменить цену, размеры или добавки. Кнопка «+ Позиция» добавит новую.</p>') + '</aside></div>';
  }
  function productForm() {
    const p = A.edit.data, sized = A.edit.sized;
    return '<form id="pForm" class="form" novalidate><h3>' + (p.id ? 'Изменить позицию' : 'Новая позиция') + '</h3>' +
      '<label class="field" for="pf-name"><span class="lab">Название</span><input id="pf-name" type="text" maxlength="80" value="' + esc(p.name || '') + '" required></label>' +
      '<label class="field" for="pf-desc"><span class="lab">Описание</span><input id="pf-desc" type="text" maxlength="160" value="' + esc(p.description || '') + '"></label>' +
      '<div class="field"><span class="lab">Фото</span><div class="ph-box">' +
      '<span class="ph-prev">' + (p.image_url ? '<img src="' + esc(thumbOf(p)) + '" alt="Фото: ' + esc(p.name || '') + '">' : '<span class="muted small">Нет фото</span>') + '</span>' +
      '<div class="ph-act"><label class="btn btn-sm" for="pf-file">' + (p.image_url ? 'Заменить фото' : 'Загрузить фото') + '</label>' +
      '<input id="pf-file" type="file" accept="image/*" class="sr">' +
      (p.image_url ? '<button type="button" class="btn btn-sm btn-ghost" data-a="ph-del">Убрать</button>' : '') +
      '<p class="hint" id="phHint">С телефона можно сразу сфотографировать. Лучше всего: один напиток или десерт на тёмном фоне.</p></div></div>' +
      '<details class="ph-link"><summary class="hint">Или вставить ссылку на фото</summary><input id="pf-img" type="text" value="' + esc(p.image_url && !/^data:/.test(p.image_url) ? p.image_url : '') + '" placeholder="https://…/photo.jpg"></details></div>' +
      '<label class="field" for="pf-badge"><span class="lab">Метка</span><input id="pf-badge" type="text" maxlength="16" value="' + esc(p.badge || '') + '" placeholder="Хит, Новинка"></label>' +
      '<label class="field" for="pf-cat"><span class="lab">Категория</span><select id="pf-cat"><option value="">Без категории</option>' + A.menu.categories.map(c => '<option value="' + c.id + '"' + (c.id === p.category_id ? ' selected' : '') + '>' + esc(c.name) + '</option>').join('') + '</select></label>' +
      '<fieldset><legend class="lab">Цена</legend><div class="seg" role="radiogroup"><button type="button" role="radio" aria-checked="' + !sized + '" data-a="p-mode" data-v="single">Одна цена</button><button type="button" role="radio" aria-checked="' + sized + '" data-a="p-mode" data-v="sizes">Размеры</button></div>' +
      (sized ? '<div class="checks" id="szRows">' + (p.sizes || []).map((z, i) =>
        '<div class="sz-row"><input type="text" data-sz="label" data-i="' + i + '" value="' + esc(z.label) + '" placeholder="M" aria-label="Размер"><input type="text" data-sz="volume" data-i="' + i + '" value="' + esc(z.volume || '') + '" placeholder="350 мл" aria-label="Объём"><input type="number" inputmode="numeric" min="0" step="10" data-sz="price" data-i="' + i + '" value="' + (z.price != null ? z.price : '') + '" placeholder="₸" aria-label="Цена"><button type="button" class="iconbtn" data-a="sz-del" data-i="' + i + '" aria-label="Удалить размер">×</button></div>').join('') +
        '</div><button type="button" class="btn btn-sm btn-ghost" data-a="sz-add" style="justify-self:start">+ Размер</button>'
        : '<input id="pf-price" type="number" inputmode="numeric" min="0" step="10" value="' + (p.price != null ? p.price : '') + '" placeholder="Цена, ₸" aria-label="Цена">') +
      '</fieldset>' +
      (A.menu.groups.length ? '<fieldset><legend class="lab">Добавки</legend><div class="checks">' + A.menu.groups.map(g =>
        '<label class="check" for="pg-' + g.id + '"><input type="checkbox" id="pg-' + g.id + '" data-pg="' + g.id + '"' + ((p.modifier_group_ids || []).includes(g.id) ? ' checked' : '') + '>' + esc(g.name) + ' <span class="muted small">' + esc(g.modifiers.map(m => m.name).join(', ')) + '</span></label>').join('') + '</div></fieldset>' : '') +
      '<div class="checks"><label class="check" for="pf-active"><input type="checkbox" id="pf-active"' + (p.active !== false ? ' checked' : '') + '>Показывать в меню</label>' +
      '<label class="check" for="pf-avail"><input type="checkbox" id="pf-avail"' + (p.available !== false ? ' checked' : '') + '>В наличии</label></div>' +
      '<label class="field" for="pf-sort"><span class="lab">Порядок в списке</span><input id="pf-sort" type="number" value="' + (p.sort || 0) + '"></label>' +
      '<p class="err" id="pErr" hidden></p>' +
      '<div class="row-btns"><button class="btn btn-primary" type="submit">Сохранить</button><button class="btn btn-ghost" type="button" data-a="ed-close">Отмена</button></div>' +
      (p.id ? '<div class="danger-zone" id="pDel"><button class="btn btn-sm btn-ghost" type="button" data-a="p-del-ask">Удалить позицию</button></div>' : '') +
      '</form>';
  }
  function readProductForm() {
    const p = A.edit.data;
    const v = id => { const el = document.getElementById(id); return el ? el.value : undefined; };
    if (v('pf-name') !== undefined) p.name = v('pf-name');
    if (v('pf-desc') !== undefined) p.description = v('pf-desc');
    if (v('pf-cat') !== undefined) p.category_id = v('pf-cat') || null;
    if (v('pf-img') !== undefined) { const link = v('pf-img').trim(); if (link && link !== p.image_url) { p.image_url = link; delete p.thumb_url; } }
    if (v('pf-badge') !== undefined) p.badge = v('pf-badge').trim();
    if (v('pf-price') !== undefined) p.price = v('pf-price') === '' ? null : Number(v('pf-price'));
    if (v('pf-sort') !== undefined) p.sort = Number(v('pf-sort')) || 0;
    const a = document.getElementById('pf-active'); if (a) p.active = a.checked;
    const b = document.getElementById('pf-avail'); if (b) p.available = b.checked;
    $$('[data-sz]').forEach(el => { const i = Number(el.dataset.i), k = el.dataset.sz; if (!p.sizes[i]) return; p.sizes[i][k] = k === 'price' ? (el.value === '' ? null : Number(el.value)) : el.value; });
    const pg = $$('[data-pg]'); if (pg.length) p.modifier_group_ids = pg.filter(el => el.checked).map(el => el.dataset.pg);
  }
  function thumbOf(p) {
    const u = p.image_url || '';
    if (p.thumb_url) return p.thumb_url;
    if (/(^|\/)assets\/products\/[^/]+\.jpg$/.test(u)) return u.replace(/assets\/products\/([^/]+)$/, 'assets/products/thumbs/$1');
    if (/-full\.jpg$/.test(u)) return u.replace(/-full\.jpg$/, '-thumb.jpg');
    return u;
  }
  async function onPhotoChosen(input) {
    const file = input.files && input.files[0]; if (!file) return;
    readProductForm();
    const hint = $('#phHint'); if (hint) { hint.textContent = 'Обрабатываем и загружаем фото…'; hint.classList.remove('err'); }
    input.disabled = true;
    try {
      const blobs = await window.CafePhoto.prepare(file);
      const r = await API.uploadProductPhoto(A.edit.data.id, blobs);
      A.edit.data.image_url = r.url;
      if (r.thumb) A.edit.data.thumb_url = r.thumb; else delete A.edit.data.thumb_url;
      rerenderPanel();
      const h = $('#phHint'); if (h) h.textContent = 'Фото загружено. Нажмите «Сохранить», чтобы оно появилось в меню.';
    } catch (e) {
      input.disabled = false; input.value = '';
      const h = $('#phHint'); if (h) { h.textContent = e.message; h.classList.add('err'); } else toast(e.message, 'bad');
    }
  }
  function rerenderPanel() { const pn = $('#edPanel'); if (pn) pn.innerHTML = productForm(); }
  async function saveProduct() {
    readProductForm();
    const p = clone(A.edit.data), err = $('#pErr');
    const fail = t => { err.textContent = t; err.hidden = false; };
    p.name = (p.name || '').trim(); if (!p.name) return fail('Укажите название.');
    if (A.edit.sized) {
      p.sizes = (p.sizes || []).filter(z => String(z.label || '').trim() || z.price != null).map(z => ({ label: String(z.label || '').trim(), volume: String(z.volume || '').trim(), price: Number(z.price) }));
      if (!p.sizes.length) return fail('Добавьте хотя бы один размер.');
      if (p.sizes.some(z => !z.label || !(z.price >= 0) || isNaN(z.price))) return fail('У каждого размера нужны название и цена.');
      if (new Set(p.sizes.map(z => z.label)).size !== p.sizes.length) return fail('Названия размеров не должны повторяться.');
      p.price = null;
    } else {
      if (p.price == null || isNaN(p.price) || p.price < 0) return fail('Укажите цену.');
      p.sizes = [];
    }
    try {
      await API.saveProduct(p);
      toast('Сохранено: ' + p.name);
      A.edit = null; await reloadMenu();
    } catch (e) { fail(e.message); }
  }
  async function reloadMenu() { try { A.menu = await API.getMenu(); } catch (e) { toast(e.message, 'bad'); } showTab(); }

  function groupsEditor() {
    return '<p class="muted">Группа «одна на выбор» — например, молоко: гость выбирает один вариант, первый отмеченный «по умолчанию» уже выбран. Группа «несколько» — например, доп. шот и сливки.</p>' +
      '<div class="set-grid">' + A.menu.groups.map(groupCard).join('') + groupCard({ id: '', name: '', multi: false, modifiers: [] }) + '</div>';
  }
  function groupCard(g) {
    const isNew = !g.id;
    return '<form class="card form" data-group="' + (g.id || 'new') + '" novalidate><h3>' + (isNew ? 'Новая группа' : esc(g.name)) + '</h3>' +
      '<div class="grid2"><label class="field"><span class="lab">Название группы</span><input type="text" name="gname" value="' + esc(g.name) + '" placeholder="Например, Сироп"></label>' +
      '<label class="check" style="align-self:end"><input type="checkbox" name="gmulti"' + (g.multi ? ' checked' : '') + '>Можно выбрать несколько</label></div>' +
      (isNew ? '' : '<div class="checks">' + g.modifiers.map(m =>
        '<div class="md-row" data-mod="' + m.id + '"><input type="text" name="mname" value="' + esc(m.name) + '" aria-label="Название"><input type="number" name="mprice" min="0" step="10" value="' + m.price + '" aria-label="Доплата, ₸">' +
        '<label class="check small" title="Выбран по умолчанию"><input type="checkbox" name="mdef"' + (m.is_default ? ' checked' : '') + '>по умолч.</label>' +
        '<button type="button" class="iconbtn" data-a="m-del" data-id="' + m.id + '" aria-label="Удалить вариант">×</button></div>').join('') +
        '<div class="md-row" data-mod="new"><input type="text" name="mname" placeholder="Новый вариант" aria-label="Название нового варианта"><input type="number" name="mprice" min="0" step="10" placeholder="+₸" aria-label="Доплата"><label class="check small"><input type="checkbox" name="mdef">по умолч.</label><span></span></div></div>') +
      '<div class="row-btns"><button class="btn btn-primary btn-sm" type="submit">' + (isNew ? 'Создать группу' : 'Сохранить') + '</button>' +
      (isNew ? '' : '<button class="btn btn-ghost btn-sm" type="button" data-a="g-del" data-id="' + g.id + '">Удалить группу</button>') + '</div></form>';
  }
  async function saveGroup(form) {
    const id = form.dataset.group;
    const name = form.gname.value.trim(); if (!name) return toast('Укажите название группы', 'bad');
    const multi = form.gmulti.checked;
    try {
      const g = await API.saveGroup(Object.assign(id === 'new' ? {} : { id }, { name, multi }));
      const rows = $$('.md-row', form);
      let sort = 0;
      for (const r of rows) {
        sort++;
        const mname = r.querySelector('[name=mname]').value.trim(), mprice = Number(r.querySelector('[name=mprice]').value || 0), mdef = r.querySelector('[name=mdef]').checked;
        const mid = r.dataset.mod;
        if (mid === 'new') { if (mname) await API.saveModifier({ group_id: g.id, name: mname, price: mprice, is_default: mdef && !multi, sort }); }
        else await API.saveModifier({ id: mid, group_id: g.id, name: mname || 'Без названия', price: mprice, is_default: mdef && !multi, sort });
      }
      toast('Сохранено'); await reloadMenu();
    } catch (e) { toast(e.message, 'bad'); }
  }
  function catsEditor() {
    return '<div class="card" style="max-width:640px">' + A.menu.categories.map((c, i) =>
      '<div class="team-row" data-cat="' + c.id + '"><input type="text" value="' + esc(c.name) + '" data-cname aria-label="Название категории" style="flex:1 1 180px;width:auto">' +
      '<label class="check small"><input type="checkbox" data-cactive' + (c.active ? ' checked' : '') + '>видна</label>' +
      '<button class="iconbtn" data-a="c-up" data-i="' + i + '" aria-label="Выше"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
      '<button class="iconbtn" data-a="c-save" data-id="' + c.id + '" aria-label="Сохранить">✓</button>' +
      '<button class="iconbtn" data-a="c-del" data-id="' + c.id + '" aria-label="Удалить">×</button></div>').join('') +
      '<form class="team-row" id="catNew" novalidate><input type="text" name="cname" placeholder="Новая категория" aria-label="Новая категория" style="flex:1 1 180px;width:auto"><button class="btn btn-sm btn-primary" type="submit">Добавить</button></form>' +
      '<p class="hint">Удалённая категория не удаляет позиции: они попадут в «Без категории».</p></div>';
  }

  /* ------------------------------ настройки ------------------------------ */
  function settingsHTML() {
    const s = A.settings;
    const chk = (k, label, extra) => '<label class="check" for="s-' + k + '"><input type="checkbox" id="s-' + k + '" data-s="' + k + '"' + (s[k] ? ' checked' : '') + (extra || '') + '>' + label + '</label>';
    const inp = (k, label, type, ph, attrs) => '<label class="field" for="s-' + k + '"><span class="lab">' + label + '</span><input id="s-' + k + '" data-s="' + k + '" type="' + (type || 'text') + '" value="' + esc(s[k] == null ? '' : s[k]) + '" placeholder="' + esc(ph || '') + '"' + (attrs || '') + '></label>';
    return '<div class="set-grid">' +
      '<form class="card form" data-set novalidate><h3>Заведение</h3>' + inp('name', 'Название') + inp('address', 'Адрес', 'text', 'ул. Абая, 10') +
      inp('whatsapp', 'WhatsApp для вопросов гостей', 'tel', '77001234567') + inp('kaspi_phone', 'Номер Kaspi, с которого придут счета', 'tel', '+7 700 123 45 67') +
      '<button class="btn btn-primary btn-sm" type="submit">Сохранить</button></form>' +
      '<form class="card form" data-set novalidate><h3>Время</h3><div class="grid2">' + inp('open_time', 'Открываемся', 'time') + inp('close_time', 'Закрываемся', 'time') + '</div>' +
      inp('prep_minutes', 'Минут на приготовление', 'number', '10', ' min="1" max="120"') +
      inp('timezone', 'Часовой пояс', 'text', 'Asia/Almaty', ' list="tzlist"') + '<datalist id="tzlist"><option value="Asia/Almaty"><option value="Asia/Aqtobe"><option value="Asia/Tashkent"><option value="Asia/Bishkek"><option value="Europe/Moscow"></datalist>' +
      '<button class="btn btn-primary btn-sm" type="submit">Сохранить</button></form>' +
      '<form class="card form" data-set novalidate><h3>Заказы и оплата</h3><div class="checks">' + chk('accepting_orders', 'Принимать онлайн-заказы') + chk('pickup_enabled', 'Самовывоз') +
      chk('pay_kaspi', 'Оплата через Kaspi (счёт по номеру)') + chk('pay_place', 'Оплата на месте') +
      '<label class="check muted" for="s-pay_online"><input type="checkbox" id="s-pay_online" disabled>Онлайн-оплата картой (подключим вместе с эквайрингом)</label></div>' +
      '<button class="btn btn-primary btn-sm" type="submit">Сохранить</button></form>' +
      '<form class="card form" data-set novalidate><h3>Доставка</h3><div class="checks">' + chk('delivery_enabled', 'Включить доставку') + '</div>' +
      '<div class="grid2">' + inp('delivery_fee', 'Стоимость, ₸', 'number', '500', ' min="0" step="50"') + inp('delivery_min_order', 'Минимальный заказ, ₸', 'number', '3000', ' min="0" step="100"') + '</div>' +
      '<div class="grid2">' + inp('delivery_minutes', 'Время доставки, мин', 'number', '30', ' min="5" max="240"') + inp('delivery_free_from', 'Бесплатно от, ₸ (0 — всегда платно)', 'number', '0', ' min="0" step="500"') + '</div>' +
      '<fieldset class="field"><legend class="lab">Зона доставки</legend>' +
      '<label class="range" for="s-delivery_radius_km"><span>Радиус</span><input type="range" id="s-delivery_radius_km" data-s="delivery_radius_km" min="0.5" max="10" step="0.5" value="' + esc(s.delivery_radius_km || 2) + '"><b id="radiusVal">' + U.km(Number(s.delivery_radius_km || 2)) + '</b></label>' +
      '<input type="hidden" data-s="shop_lat" data-num="1" id="s-shop_lat" value="' + esc(s.shop_lat == null ? '' : s.shop_lat) + '"><input type="hidden" data-s="shop_lng" data-num="1" id="s-shop_lng" value="' + esc(s.shop_lng == null ? '' : s.shop_lng) + '">' +
      '<div class="row-btns"><button type="button" class="btn btn-sm" data-a="shop-find">Найти кофейню по адресу</button></div>' +
      '<div id="shopMap" class="del-map adm-map"></div>' +
      '<p class="hint" id="shopHint">' + (U.hasZone(s) ? 'Перетащите значок кофейни, если он стоит неточно. Круг — зона доставки.' : '<b>Отметьте кофейню на карте</b>: нажмите на точку, где она находится. Пока точка не отмечена, адреса гостей не проверяются.') + '</p></fieldset>' +
      inp('delivery_zone', 'Описание зоны для гостей (необязательно)', 'text', 'Мкр. Самал, ул. Абая до пр. Достык') +
      '<p class="hint">Пока доставка выключена, гости видят только самовывоз.</p><button class="btn btn-primary btn-sm" type="submit">Сохранить</button></form>' +
      (API.mode === 'demo' ? '<div class="card form"><h3>Демо</h3><p class="muted small">Удалить все демо-заказы и аккаунты и вернуть стартовое меню.</p><button class="btn btn-sm" data-a="demo-reset" type="button">Сбросить демо</button></div>' : '') +
      '</div>';
  }
  async function mountShopMap() {
    const el = $('#shopMap'); if (!el || !window.CafeMap) return;
    const s = A.settings, has = U.hasZone(s);
    try {
      A.shopMap = await window.CafeMap.picker(el, {
        shop: has ? [Number(s.shop_lat), Number(s.shop_lng)] : null, radiusKm: Number(s.delivery_radius_km || 2), draggableShop: true,
        pin: has ? null : null,
        onPick: (lat, lng) => { $('#s-shop_lat').value = lat.toFixed(6); $('#s-shop_lng').value = lng.toFixed(6); $('#shopHint').textContent = 'Точка отмечена. Нажмите «Сохранить», чтобы применить.'; }
      });
      if (!has) A.shopMap.map.setView([51.1282, 71.4304], 12);
    } catch (e) { el.innerHTML = '<p class="map-fail">' + esc(e.message) + '</p>'; }
  }
  async function saveSettings(form) {
    const patch = {};
    $$('[data-s]', form).forEach(el => {
      const k = el.dataset.s;
      if (el.type === 'checkbox') patch[k] = el.checked;
      else if (el.dataset.num) patch[k] = el.value === '' ? null : Number(el.value);
      else if (el.type === 'number' || el.type === 'range') patch[k] = Number(el.value || 0);
      else patch[k] = el.value.trim();
    });
    if (patch.whatsapp != null) patch.whatsapp = U.digits(patch.whatsapp);
    if (patch.open_time && patch.close_time && U.hm(patch.open_time) >= U.hm(patch.close_time)) return toast('Время закрытия должно быть позже открытия', 'bad');
    if (patch.timezone) { try { new Intl.DateTimeFormat('ru', { timeZone: patch.timezone }); } catch (e) { return toast('Неизвестный часовой пояс', 'bad'); } }
    try { A.settings = await API.saveSettings(patch); toast('Настройки сохранены'); renderFrame(); showTab(); }
    catch (e) { toast(e.message, 'bad'); }
  }

  /* ------------------------------ команда ------------------------------ */
  function teamHTML() {
    return '<div class="set-grid"><div class="card"><h3 class="h-sec" style="margin-top:0">Команда</h3><div id="teamList"><div class="boot"><span class="spinner"></span></div></div></div>' +
      '<form class="card form" id="teamAdd" novalidate><h3 class="h-sec" style="margin-top:0">Добавить сотрудника</h3>' +
      '<p class="muted small">Сотрудник сначала создаёт аккаунт в приложении (Профиль → Войти или создать аккаунт). Потом введите его email здесь.</p>' +
      '<label class="field" for="t-email"><span class="lab">Email</span><input id="t-email" type="email" required></label>' +
      '<label class="field" for="t-role"><span class="lab">Роль</span><select id="t-role"><option value="staff">Бариста: заказы и стоп-лист</option><option value="admin">Администратор: всё, включая цены</option></select></label>' +
      '<button class="btn btn-primary" type="submit">Выдать доступ</button></form></div>';
  }
  async function loadTeam() {
    const box = $('#teamList'); if (!box) return;
    try { A.team = await API.listTeam(); } catch (e) { box.innerHTML = '<p class="err">' + esc(e.message) + '</p>'; return; }
    box.innerHTML = A.team.map(u => '<div class="team-row"><span class="em"><b>' + esc(u.name || u.email) + '</b><br><span class="muted small">' + esc(u.email) + '</span></span>' +
      '<select data-a="role" data-email="' + esc(u.email) + '" aria-label="Роль"' + (A.user && u.id === A.user.id ? ' disabled' : '') + '><option value="staff"' + (u.role === 'staff' ? ' selected' : '') + '>Бариста</option><option value="admin"' + (u.role === 'admin' ? ' selected' : '') + '>Администратор</option><option value="guest">Убрать доступ</option></select></div>').join('') || '<p class="muted">Пока только вы.</p>';
  }

  /* ------------------------------ партнёры ------------------------------ */
  const PT = { month: null, report: null, list: null, loading: false, err: null, edit: null, qr: null, pay: null, req: 0, map: null };
  const ptBase = () => location.origin + location.pathname.replace(/[^/]*$/, '');
  const ptLink = code => ptBase() + '?p=' + encodeURIComponent(code);
  const ptStatsLink = token => ptBase() + 'partner.html?t=' + token;
  const fmtPct = v => String(Number(v)).replace('.', ',') + '%';
  const curMonth = () => U.monthStart(U.todayStr(A.settings.timezone));
  const ptKpi = (l, v, main) => '<div class="kpi' + (main ? ' kpi-main' : '') + '"><span class="kpi-l">' + l + '</span><b class="kpi-v">' + v + '</b></div>';
  const ddmm = iso => { const d = new Date(iso); return String(d.getDate()).padStart(2, '0') + '.' + String(d.getMonth() + 1).padStart(2, '0'); };

  async function loadPartners() {
    if (!PT.month) PT.month = curMonth();
    const my = ++PT.req; PT.loading = true; PT.err = null;
    renderPtBody();
    try {
      const r = await Promise.all([API.partnerReport(PT.month), API.listPartners()]);
      if (my !== PT.req) return;
      PT.report = r[0]; PT.list = r[1];
    } catch (e) { if (my !== PT.req) return; PT.err = e.message; }
    PT.loading = false;
    renderPtBody();
  }
  function renderPtBody() {
    if (A.tab !== 'partners') return;
    const b = $('#ptBody'); if (b) b.innerHTML = ptBodyHTML(); else showTab();
    const bar = $('#ptCsv'); if (bar) bar.disabled = !PT.report || !PT.report.length;
  }
  function partnersHTML() {
    const cur = curMonth(), m = PT.month || cur;
    return '<div class="st-bar"><div class="pt-month" role="group" aria-label="Месяц"><button class="iconbtn" data-a="pt-month" data-v="-1" aria-label="Предыдущий месяц">‹</button><b>' + U.monthLabel(m) + '</b>' +
      '<button class="iconbtn" data-a="pt-month" data-v="1" aria-label="Следующий месяц"' + (m >= cur ? ' disabled' : '') + '>›</button></div>' +
      '<button class="btn btn-sm btn-primary" data-a="pt-new">Добавить партнёра</button>' +
      '<button class="btn btn-sm btn-ghost" id="ptCsv" data-a="pt-csv"' + (!PT.report || !PT.report.length ? ' disabled' : '') + '>Скачать для Excel</button></div>' +
      '<div id="ptFormBox">' + (PT.edit ? partnerForm() : '') + '</div><div id="ptBody">' + ptBodyHTML() + '</div>';
  }
  function ptBodyHTML() {
    if (PT.err) return '<p class="err">' + esc(PT.err) + '</p>';
    if (!PT.report) return '<div class="boot"><span class="spinner"></span></div>';
    if (!PT.report.length) return PT.edit ? '' : '<div class="card pt-empty"><h3>Партнёров пока нет</h3><p class="muted">Добавьте автосервис или другое место рядом. У него будет свой QR: гости заказывают кофе, вы приносите его прямо туда, а партнёр получает процент с выданных заказов.</p><button class="btn btn-primary" data-a="pt-new">Добавить партнёра</button></div>';
    const R = PT.report, cur = curMonth();
    const tot = R.reduce((a, r) => ({ orders: a.orders + r.orders, sub: a.sub + r.subtotal, pay: a.pay + r.payout, paid: a.paid + (r.paid ? r.paid.amount : 0) }), { orders: 0, sub: 0, pay: 0, paid: 0 });
    const due = R.filter(r => r.payout > 0 && !r.paid);
    let h = '<p class="st-cap">' + U.monthLabel(PT.month) + (PT.loading ? ' · обновляем…' : '') + '. Считаются только выданные заказы, без платы за доставку. Отменённые и незавершённые не входят.' +
      (API.mode === 'demo' ? ' <b>В демо партнёры и заказы примерные.</b>' : '') + '</p>';
    h += '<div class="kpis">' + ptKpi('Заказов через партнёров', tot.orders) + ptKpi('На сумму', money(tot.sub)) + ptKpi('К выплате', money(tot.pay), true) + ptKpi('Уже выплачено', money(tot.paid)) + '</div>';
    if (due.length && PT.month < cur) h += '<div class="adm-banner"><span>Не выплачено за ' + U.monthLabel(PT.month) + ': <b>' + due.length + '</b> ' + U.plural(due.length, 'партнёр', 'партнёра', 'партнёров') + ' на ' + money(due.reduce((a, r) => a + r.payout, 0)) + '. Переведите на Kaspi и отметьте выплату.</span></div>';
    return h + '<div class="pt-list">' + R.map(ptCard).join('') + '</div>';
  }
  function ptCard(r) {
    const p = (PT.list || []).find(x => x.id === r.id) || r;
    const closed = PT.month < curMonth();
    const left = Number(r.high_from_qty) - r.qty;
    const tier = Number(r.high_from_qty) > 0 && Number(r.rate_high_pct) > Number(r.rate_pct)
      ? (r.rate >= Number(r.rate_high_pct) ? '<span class="pt-tier">Повышенная ставка ' + fmtPct(r.rate_high_pct) + ': больше ' + r.high_from_qty + ' позиций за месяц</span>'
        : 'До ставки ' + fmtPct(r.rate_high_pct) + ' осталось ' + left + ' ' + U.plural(left, 'позиция', 'позиции', 'позиций'))
      : '';
    let pay = '';
    if (r.paid) pay = '<span class="badge paid">Выплачено ' + money(r.paid.amount) + ' · ' + ddmm(r.paid.paid_at) + (r.paid.note ? ' · ' + esc(r.paid.note) : '') + '</span><button class="linkbtn" data-a="pt-unpay" data-id="' + r.id + '">Снять отметку</button>';
    else if (PT.pay === r.id) pay = '<form class="pt-payform" data-ptpay="' + r.id + '" novalidate><label class="sr" for="pp-amt">Сумма выплаты</label><input id="pp-amt" type="number" min="0" step="1" inputmode="numeric" value="' + r.payout + '">' +
      '<label class="sr" for="pp-note">Комментарий</label><input id="pp-note" type="text" maxlength="80" placeholder="Комментарий, например Kaspi"><button class="btn btn-sm btn-ok" type="submit">Выплачено</button><button type="button" class="btn btn-sm btn-ghost" data-a="pt-pay-no">Отмена</button></form>';
    else if (r.payout > 0) pay = '<button class="btn btn-sm' + (closed ? ' btn-primary' : '') + '" data-a="pt-pay" data-id="' + r.id + '">Отметить выплату</button>' + (closed ? '' : '<span class="muted small">месяц ещё идёт</span>');
    return '<article class="card pt-card' + (r.active ? '' : ' off') + '">' +
      '<div class="pt-head"><div class="pt-title"><h3>' + esc(r.name) + (r.active ? '' : ' <span class="tag">отключён</span>') + '</h3>' +
      '<span class="muted small">' + (p.address ? esc(p.address) + ' · ' : '') + 'код ' + esc(r.code) + ' · ' + fmtPct(p.rate_pct) + (Number(p.high_from_qty) > 0 ? ', от ' + p.high_from_qty + ' поз. ' + fmtPct(p.rate_high_pct) : '') + '</span></div>' +
      '<div class="pt-btns"><button class="btn btn-sm" data-a="pt-qr" data-id="' + r.id + '" aria-expanded="' + (PT.qr === r.id) + '">QR и табличка</button><button class="btn btn-sm btn-ghost" data-a="pt-edit" data-id="' + r.id + '">Изменить</button></div></div>' +
      '<dl class="pt-nums"><div><dt>Заказов</dt><dd>' + r.orders + '</dd></div><div><dt>Позиций</dt><dd>' + r.qty + '</dd></div><div><dt>Сумма</dt><dd>' + money(r.subtotal) + '</dd></div>' +
      '<div><dt>Ставка</dt><dd>' + fmtPct(r.rate) + '</dd></div><div class="pt-due"><dt>К выплате</dt><dd>' + money(r.payout) + '</dd></div></dl>' +
      (tier || r.in_progress ? '<p class="pt-note">' + tier + (tier && r.in_progress ? '. ' : '') + (r.in_progress ? 'Ещё в работе: ' + r.in_progress + ' ' + U.plural(r.in_progress, 'заказ', 'заказа', 'заказов') + ', попадут в расчёт после выдачи.' : '') + '</p>' : '') +
      '<div class="pt-foot"><span class="pt-recv">' + (r.payout_phone ? 'Kaspi: <button class="oc-phone" data-a="copy" data-v="' + esc(r.payout_phone) + '" title="Скопировать номер">' + esc(U.phoneFmt(U.normPhone(r.payout_phone))) + '</button>' + (r.payout_name ? ' · ' + esc(r.payout_name) : '') : '<span class="warn-t">Нет номера Kaspi для выплат</span>') + '</span>' +
      '<span class="pt-pay">' + pay + '</span></div>' +
      (PT.qr === r.id ? qrPanel(p) : '') +
      '</article>';
  }

  /* QR: своя отрисовка в SVG и PNG (библиотека qrcode-generator лежит в js/vendor) */
  function qrMatrix(text) {
    const q = window.qrcode(0, 'M'); q.addData(text); q.make();
    const n = q.getModuleCount(), m = [];
    for (let r = 0; r < n; r++) { const row = []; for (let c = 0; c < n; c++) row.push(q.isDark(r, c)); m.push(row); }
    return m;
  }
  function qrSVG(text, quiet) {
    if (!window.qrcode) return '<p class="err small">Не загрузился файл js/vendor/qrcode-1.4.4.js</p>';
    const m = qrMatrix(text), n = m.length, z = quiet == null ? 2 : quiet; let d = '';
    m.forEach((row, r) => row.forEach((on, c) => { if (on) d += 'M' + (c + z) + ' ' + (r + z) + 'h1v1h-1z'; }));
    return '<svg viewBox="0 0 ' + (n + 2 * z) + ' ' + (n + 2 * z) + '" role="img" aria-label="QR-код: ' + esc(text) + '" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#ffffff"/><path d="' + d + '" fill="#1A120B"/></svg>';
  }
  function qrPNG(text, name) {
    if (!window.qrcode) return toast('Не загрузился файл js/vendor/qrcode-1.4.4.js', 'bad');
    const m = qrMatrix(text), n = m.length, z = 4, s = 16, c = document.createElement('canvas');
    c.width = c.height = (n + 2 * z) * s;
    const x = c.getContext('2d'); x.fillStyle = '#ffffff'; x.fillRect(0, 0, c.width, c.height); x.fillStyle = '#1A120B';
    m.forEach((row, r) => row.forEach((on, cc) => { if (on) x.fillRect((cc + z) * s, (r + z) * s, s, s); }));
    c.toBlob(b => {
      const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'qr-' + name + '.png';
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      toast('QR сохранён: qr-' + name + '.png');
    });
  }
  function qrPanel(p) {
    const link = ptLink(p.code), stats = ptStatsLink(p.stats_token);
    const msg = 'Здравствуйте! Это ' + A.settings.name + '. По этой ссылке видно, сколько заказов пришло через ваш QR и сколько вам к выплате: ' + stats;
    return '<div class="pt-qr"><div class="pt-qr-img">' + qrSVG(link) + '</div><div class="pt-qr-txt">' +
      '<span class="lab">Ссылка для гостей</span><code class="pt-link">' + esc(link) + '</code>' +
      '<div class="row-btns"><button class="btn btn-sm btn-primary" data-a="pt-print" data-id="' + p.id + '">Табличка A6 для печати</button><button class="btn btn-sm" data-a="pt-png" data-id="' + p.id + '">Скачать QR</button><button class="btn btn-sm btn-ghost" data-a="pt-copy" data-v="' + esc(link) + '">Скопировать ссылку</button></div>' +
      '<p class="hint">Эту же ссылку можно записать в NFC-метку.</p>' +
      '<span class="lab">Статистика для партнёра</span><p class="hint">По этой ссылке партнёр видит свои заказы и сумму к выплате. Имён и телефонов гостей там нет.</p><code class="pt-link">' + esc(stats) + '</code>' +
      '<div class="row-btns"><button class="btn btn-sm btn-ghost" data-a="pt-copy" data-v="' + esc(stats) + '">Скопировать</button>' +
      '<a class="btn btn-sm btn-ghost" href="https://wa.me/' + U.digits(U.normPhone(p.payout_phone || '')) + '?text=' + encodeURIComponent(msg) + '" target="_blank" rel="noopener">Отправить в WhatsApp</a>' +
      '<a class="btn btn-sm btn-ghost" href="' + esc(stats) + '" target="_blank" rel="noopener">Открыть</a></div>' +
      '</div></div>';
  }
  function printCard(p) {
    const w = window.open('', '_blank');
    if (!w) return toast('Браузер не открыл новое окно. Разрешите всплывающие окна для этого сайта', 'bad');
    const link = ptLink(p.code), base = ptBase(), free = Number(p.delivery_free_qty);
    const nm = /[«"„]/.test(p.name) ? p.name : '«' + p.name + '»';
    const fee = Number(p.delivery_enabled) === 0 || p.delivery_enabled === false ? 'Закажите заранее — заберёте без очереди'
      : (Number(p.delivery_fee) ? 'Доставка ' + money(p.delivery_fee) + (free > 0 ? ' · от ' + free + ' ' + U.plural(free, 'позиции', 'позиций', 'позиций') + ' бесплатно' : '') : 'Доставка бесплатно');
    const site = base.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const corner = base + 'assets/orn/corner.png';
    const logo = '<svg viewBox="0 0 44 24" width="11mm" height="6mm" fill="none" stroke="#D9B67E" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 21 L17 4 L24 12 L30 6 L42 21"/><path d="M11 21 L19 12.5"/><path d="M26 21 L32 14"/></svg>';
    const html = '<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Табличка — ' + esc(p.name) + '</title>' +
      '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,600;0,700;1,600&family=Onest:wght@400;500;600&display=swap">' +
      '<style>@page{size:105mm 148mm;margin:0}*{box-sizing:border-box}html,body{margin:0;background:#3a3330}' +
      'body{font-family:Onest,system-ui,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact;display:grid;justify-items:center;gap:6mm;padding:8mm 0}' +
      '.card{position:relative;width:105mm;height:148mm;overflow:hidden;background:radial-gradient(ellipse 80% 60% at 50% 45%,#3B2718 0%,#26190F 55%,#170F09 100%);color:#F4EADB;display:flex;flex-direction:column;align-items:center;text-align:center;padding:9mm 8mm 8mm}' +
      '.fr{position:absolute;inset:4mm;border:.45mm solid #B8925A;border-radius:2.5mm}.fr2{position:absolute;inset:5.3mm;border:.25mm solid rgba(184,146,90,.45);border-radius:1.8mm}' +
      '.c{position:absolute;width:15mm;height:12.5mm}.c1{top:2.5mm;left:2.5mm;transform:rotate(180deg)}.c2{top:2.5mm;right:2.5mm;transform:scaleY(-1)}.c3{bottom:2.5mm;left:2.5mm;transform:scaleX(-1)}.c4{bottom:2.5mm;right:2.5mm}' +
      '.brand{display:flex;align-items:center;gap:2.5mm;font-family:Lora,Georgia,serif;font-weight:700;font-size:6.2mm;letter-spacing:.06em;color:#D9B67E;margin-top:1mm}' +
      '.sub{font-size:2.3mm;letter-spacing:.3em;text-transform:uppercase;color:#E2D3BA;margin-top:1mm}' +
      '.ribbon{margin-top:4mm;padding:1.6mm 7mm;background:linear-gradient(180deg,#EBCF9F,#C9A46C 55%,#A97F45);clip-path:polygon(3mm 0,calc(100% - 3mm) 0,100% 50%,calc(100% - 3mm) 100%,3mm 100%,0 50%);font-family:Lora,Georgia,serif;font-weight:700;font-size:3.6mm;letter-spacing:.06em;text-transform:uppercase;color:#1E140C}' +
      'h1{margin:2.5mm 0 0;font-family:Lora,Georgia,serif;font-style:italic;font-weight:600;font-size:13mm;line-height:.95;color:#DDB97F}' +
      'h2{margin:0;font-family:Lora,Georgia,serif;font-weight:600;font-size:7mm;line-height:1.1;color:#F6ECDC}' +
      '.for{margin-top:2.5mm;font-size:3.3mm;line-height:1.35;color:#E8DCC8;max-width:80mm}.for b{color:#F6ECDC}' +
      '.qr{margin-top:4mm;width:44mm;height:44mm;padding:2mm;background:#F6EEDF;border:.8mm solid #C9A46C;border-radius:3mm}.qr svg{display:block;width:100%;height:100%}' +
      '.cam{margin-top:2.5mm;font-size:3.4mm;font-weight:600;color:#F4EADB}.fee{margin-top:1mm;font-size:2.9mm;color:#E2D3BA}' +
      '.site{margin-top:auto;font-size:3.2mm;font-weight:600;color:#DDB97F}' +
      '.tools{font-size:13px;color:#eee;text-align:center;max-width:105mm}.tools button{font:inherit;font-weight:600;padding:10px 22px;border-radius:999px;border:0;background:#C9A46C;color:#1E140C;cursor:pointer}' +
      '@media print{html,body{background:none;padding:0;display:block}.tools{display:none}}</style></head><body>' +
      '<div class="card"><div class="fr"></div><div class="fr2"></div>' +
      '<img class="c c1" src="' + corner + '" alt=""><img class="c c2" src="' + corner + '" alt=""><img class="c c3" src="' + corner + '" alt=""><img class="c c4" src="' + corner + '" alt="">' +
      '<div class="brand">' + logo + 'KESE COFFEE</div><div class="sub">Қазақстан · кофе · адамдар</div>' +
      '<div class="ribbon">' + (p.delivery_enabled === false ? 'Предзаказ онлайн' : 'Кофе с доставкой') + '</div>' +
      '<h1>Кофе</h1><h2>' + (p.delivery_enabled === false ? 'без очереди' : 'прямо сюда') + '</h2>' +
      '<p class="for">' + (p.delivery_enabled === false ? 'Для гостей <b>' + esc(nm) + '</b>' : 'Для гостей <b>' + esc(nm) + '</b>: закажите, и мы принесём примерно за ' + Number(p.delivery_minutes || 15) + ' минут') + '</p>' +
      '<div class="qr">' + qrSVG(link, 1) + '</div><div class="cam">Наведите камеру телефона</div><div class="fee">' + esc(fee) + '</div>' +
      '<div class="site">' + esc(site) + '</div></div>' +
      '<div class="tools"><p>Размер A6, 105×148 мм. В окне печати выберите масштаб 100% и «Без полей», включите «Фоновые изображения».</p><button onclick="print()">Печать</button></div>' +
      '<script>window.addEventListener("load",function(){(document.fonts?document.fonts.ready:Promise.resolve()).then(function(){setTimeout(function(){print()},300)})})<\/script></body></html>';
    w.document.open(); w.document.write(html); w.document.close();
  }

  function partnerForm() {
    const p = PT.edit, isNew = !p.id, v = k => esc(p[k] == null ? '' : p[k]);
    const inp = (k, label, attrs, ph) => '<label class="field" for="pt-' + k + '"><span class="lab">' + label + '</span><input id="pt-' + k + '" value="' + v(k) + '"' + (ph ? ' placeholder="' + esc(ph) + '"' : '') + (attrs || '') + '></label>';
    return '<form class="card form pt-form" id="ptForm" novalidate><div class="st-h"><h3>' + (isNew ? 'Новый партнёр' : esc(p.name)) + '</h3><button type="button" class="iconbtn" data-a="pt-close" aria-label="Закрыть">×</button></div>' +
      '<div class="grid2">' + inp('name', 'Название', ' maxlength="80" autocomplete="off"', 'Tez Auto') +
      '<label class="field" for="pt-code"><span class="lab">Код в ссылке</span><input id="pt-code" value="' + v('code') + '" maxlength="24" autocapitalize="off" autocomplete="off" spellcheck="false" placeholder="tez-auto"' + (isNew ? '' : ' data-touched="1"') + '>' +
      '<span class="hint">' + (isNew ? 'Латиница, цифры и дефис. Заполнится сам из названия.' : 'Если поменять код, напечатанный QR перестанет работать.') + '</span></label></div>' +
      '<div class="grid2">' + inp('address', 'Адрес', '', 'пр. Абылай хана, 60/1') + inp('place_hint', 'Где искать гостя', ' maxlength="80"', 'Зона ожидания, 1 этаж') + '</div>' +
      '<fieldset class="field"><legend class="lab">Точка на карте</legend><div class="row-btns"><button type="button" class="btn btn-sm" data-a="pt-find">Найти по адресу</button></div>' +
      '<div id="ptMap" class="del-map adm-map"></div><input type="hidden" id="pt-lat" value="' + v('lat') + '"><input type="hidden" id="pt-lng" value="' + v('lng') + '">' +
      '<p class="hint" id="ptMapHint">' + (p.lat != null ? 'Точка отмечена, курьер увидит её в заказе. Нажмите на карте, чтобы поправить.' : 'Нажмите на карте, где находится партнёр. Курьер увидит эту точку в заказе.') + '</p></fieldset>' +
      '<h4 class="st-sub">Выплата партнёру</h4>' +
      '<div class="grid3">' + inp('rate_pct', 'Ставка, %', ' type="number" min="0" max="50" step="0.5" inputmode="decimal"') + inp('rate_high_pct', 'Повышенная, %', ' type="number" min="0" max="50" step="0.5" inputmode="decimal"') +
      inp('high_from_qty', 'Повышенная от, позиций в месяц', ' type="number" min="0" step="10" inputmode="numeric"') + '</div>' +
      '<p class="hint">Процент считается от суммы выданных заказов без доставки. 0 в последнем поле — без повышенной ставки.</p>' +
      '<div class="grid2">' + inp('payout_name', 'Кому платим', ' maxlength="80"', 'Владелец или администратор') + inp('payout_phone', 'Номер Kaspi для выплат', ' type="tel" inputmode="tel"', '+7 700 000 00 00') + '</div>' +
      '<h4 class="st-sub">Доставка к партнёру</h4><div class="checks"><label class="check" for="pt-delivery_enabled"><input type="checkbox" id="pt-delivery_enabled"' + (p.delivery_enabled ? ' checked' : '') + '>Приносить заказы гостей прямо к партнёру</label></div>' +
      '<div class="grid3">' + inp('delivery_fee', 'Стоимость, ₸', ' type="number" min="0" step="50" inputmode="numeric"') + inp('delivery_free_qty', 'Бесплатно от, позиций', ' type="number" min="0" step="1" inputmode="numeric"') +
      inp('delivery_minutes', 'Минут на доставку', ' type="number" min="5" max="120" step="5" inputmode="numeric"') + '</div>' +
      '<p class="hint">Минимальной суммы нет: можно заказать даже один кофе. 0 в поле «Бесплатно от» — доставка всегда платная.</p>' +
      inp('note', 'Заметка, видите только вы', ' maxlength="200"', 'Договорились 26.10 с Ерланом') +
      (isNew ? '' : '<div class="checks"><label class="check" for="pt-active"><input type="checkbox" id="pt-active"' + (p.active ? ' checked' : '') + '>Партнёр активен. Если выключить, его QR перестанет учитываться</label></div>') +
      '<p class="err" id="ptErr" role="alert" hidden></p><div class="row-btns"><button class="btn btn-primary" type="submit">Сохранить</button><button class="btn btn-ghost" type="button" data-a="pt-close">Отмена</button></div></form>';
  }
  async function mountPtMap() {
    const el = $('#ptMap'); if (!el || !window.CafeMap || !PT.edit) return;
    const s = A.settings, has = U.hasZone(s), p = PT.edit;
    try {
      PT.map = await window.CafeMap.picker(el, {
        shop: has ? [Number(s.shop_lat), Number(s.shop_lng)] : null, radiusKm: has ? Number(s.delivery_radius_km || 2) : 0,
        pin: p.lat != null ? [Number(p.lat), Number(p.lng)] : null,
        onPick: (lat, lng) => setPtPoint(lat, lng)
      });
      if (!has && p.lat == null && PT.map) PT.map.map.setView([51.1282, 71.4304], 12);
    } catch (e) { el.innerHTML = '<p class="map-fail">' + esc(e.message) + '</p>'; }
  }
  function setPtPoint(lat, lng, label) {
    const s = A.settings, a = $('#pt-lat'), b = $('#pt-lng'), h = $('#ptMapHint'); if (!a) return;
    a.value = lat.toFixed(6); b.value = lng.toFixed(6);
    if (h) h.textContent = (label ? 'Нашли: ' + label + '. ' : 'Точка отмечена') + (U.hasZone(s) ? (label ? '' : ': ') + U.km(U.kmBetween([Number(s.shop_lat), Number(s.shop_lng)], [lat, lng])) + ' от кофейни' : '') + '. Нажмите «Сохранить».';
  }
  function readPtForm() {
    const g = id => $('#pt-' + id); if (!g('name')) return PT.edit;
    const num = (id, d) => { const x = g(id).value; return x === '' ? d : Number(String(x).replace(',', '.')); };
    const lat = g('lat').value, lng = g('lng').value;
    return Object.assign({}, PT.edit, {
      name: g('name').value.trim(), code: g('code').value.trim().toLowerCase(), address: g('address').value.trim(), place_hint: g('place_hint').value.trim(),
      lat: lat === '' ? null : Number(lat), lng: lng === '' ? null : Number(lng),
      rate_pct: num('rate_pct', 10), rate_high_pct: num('rate_high_pct', 15), high_from_qty: Math.round(num('high_from_qty', 0)),
      payout_name: g('payout_name').value.trim(), payout_phone: g('payout_phone').value.trim(),
      delivery_enabled: g('delivery_enabled').checked, delivery_fee: Math.round(num('delivery_fee', 0)), delivery_free_qty: Math.round(num('delivery_free_qty', 0)),
      delivery_minutes: Math.round(num('delivery_minutes', 15)), note: g('note').value.trim(),
      active: g('active') ? g('active').checked : true
    });
  }
  async function savePartner() {
    const p = readPtForm();
    const err = t => { const e = $('#ptErr'); if (e) { e.textContent = t; e.hidden = false; } else toast(t, 'bad'); };
    if (!p.code) p.code = U.slug(p.name);
    if (!p.name) return err('Укажите название партнёра.');
    if (!/^[a-z0-9][a-z0-9-]{1,23}$/.test(p.code)) return err('Код в ссылке: только латиница, цифры и дефис, от 2 до 24 символов.');
    for (const k of ['rate_pct', 'rate_high_pct']) if (!(p[k] >= 0 && p[k] <= 50)) return err('Ставка должна быть от 0 до 50%.');
    if (!(p.delivery_minutes >= 5 && p.delivery_minutes <= 120)) return err('Время доставки: от 5 до 120 минут.');
    if ([p.high_from_qty, p.delivery_fee, p.delivery_free_qty].some(x => !(x >= 0))) return err('Проверьте числа: они не могут быть отрицательными.');
    if (p.payout_phone) { const n = U.normPhone(p.payout_phone); if (U.digits(n).length !== 11) return err('Проверьте номер Kaspi: нужно 11 цифр, например +7 700 123 45 67.'); p.payout_phone = n; }
    const body = Object.assign({}, p); if (!body.id) delete body.id; delete body.stats_token; delete body.created_at; delete body.updated_at;
    try {
      const saved = await API.savePartner(body);
      toast('Партнёр сохранён'); PT.edit = null; PT.qr = saved && saved.id ? saved.id : PT.qr;
      const fb = $('#ptFormBox'); if (fb) fb.innerHTML = '';
      await loadPartners();
      const card = PT.qr && $('.pt-qr'); if (card) card.scrollIntoView({ block: 'center' });
    } catch (e) { err(e.message); }
  }
  function openPtForm(p) {
    PT.edit = p; PT.pay = null;
    const fb = $('#ptFormBox'); if (!fb) return showTab();
    fb.innerHTML = partnerForm(); mountPtMap();
    fb.scrollIntoView({ block: 'start' }); const n = $('#pt-name'); if (n) n.focus({ preventScroll: true });
  }
  function exportPartnersCSV() {
    const sep = ';', cell = v => { const s = String(v == null ? '' : v); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const head = ['Партнёр', 'Код', 'Кому платим', 'Kaspi', 'Заказов', 'Позиций', 'Сумма, ₸', 'Ставка, %', 'К выплате, ₸', 'Выплачено, ₸', 'Дата выплаты', 'Комментарий'];
    const rows = PT.report.map(r => [r.name, r.code, r.payout_name, r.payout_phone, r.orders, r.qty, r.subtotal, String(r.rate).replace('.', ','), r.payout,
      r.paid ? r.paid.amount : '', r.paid ? ddmm(r.paid.paid_at) : '', r.paid ? r.paid.note : ''].map(cell).join(sep));
    const blob = new Blob(['﻿' + [head.join(sep)].concat(rows).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'kese-partnery_' + PT.month.slice(0, 7) + '.csv';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast('Файл сохранён: откройте его в Excel');
  }
  async function ptCopy(text) {
    try { await navigator.clipboard.writeText(text); toast('Скопировано'); } catch (e) { toast(text); }
  }

  /* ------------------------------ статистика ------------------------------ */
  const WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
  const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  const RANGES = [['today', 'Сегодня'], ['yesterday', 'Вчера'], ['7', '7 дней'], ['30', '30 дней'], ['month', 'Этот месяц'], ['custom', 'Свои даты']];
  const ST = { range: U.store.get('st_range', '7'), from: null, to: null, hourBy: 'ready', metric: 'revenue', cur: null, prev: null, loading: false, err: null, req: 0 };

  const dLabel = s => { const [, m, d] = s.split('-').map(Number); return d + ' ' + MONTHS[m - 1]; };
  const compact = n => n >= 1e6 ? (Math.round(n / 1e5) / 10).toString().replace('.', ',') + ' млн' : n >= 1000 ? (Math.round(n / 100) / 10).toString().replace('.', ',') + 'K' : String(Math.round(n));
  function niceMax(v) { if (v <= 0) return 4; const p = Math.pow(10, Math.floor(Math.log10(v))); const f = v / p; const n = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10; return n * p; }

  function rangeDates() {
    const t = U.todayStr(A.settings.timezone);
    switch (ST.range) {
      case 'today': return [t, t];
      case 'yesterday': { const y = U.addDays(t, -1); return [y, y]; }
      case '30': return [U.addDays(t, -29), t];
      case 'month': return [t.slice(0, 8) + '01', t];
      case 'custom': return [ST.from || U.addDays(t, -6), ST.to || t];
      default: return [U.addDays(t, -6), t];
    }
  }
  async function loadStats() {
    const [from, to] = rangeDates();
    const len = U.daysBetween(from, to) + 1;
    const pf = U.addDays(from, -len), pt = U.addDays(from, -1);
    const my = ++ST.req;
    ST.loading = true; ST.err = null; ST.from = from; ST.to = to;
    if (A.tab === 'stats') showTab();
    try {
      const r = await Promise.all([API.statsOrders(from, to), API.statsOrders(pf, pt)]);
      if (my !== ST.req) return;
      ST.cur = r[0]; ST.prev = r[1]; ST.pFrom = pf; ST.pTo = pt;
    } catch (e) { if (my !== ST.req) return; ST.err = e.message; }
    ST.loading = false;
    if (A.tab === 'stats') showTab();
  }
  function summarize(list) {
    const ok = list.filter(o => o.status !== 'cancelled'), canc = list.filter(o => o.status === 'cancelled');
    const revenue = ok.reduce((a, o) => a + o.total, 0);
    return {
      orders: ok.length, revenue, avg: ok.length ? Math.round(revenue / ok.length) : 0, cancelled: canc.length,
      items: ok.reduce((a, o) => a + (o.items || []).reduce((b, i) => b + i.qty, 0), 0),
      unpaid: ok.filter(o => o.payment_status !== 'paid' && o.status === 'completed'), ok, canc
    };
  }
  function delta(cur, prev, upGood) {
    if (!prev && !cur) return '<span class="delta flat">без изменений</span>';
    if (!prev) return '<span class="delta flat">в прошлом периоде не было</span>';
    const pct = Math.round((cur - prev) / prev * 100);
    if (pct === 0) return '<span class="delta flat">как в прошлом периоде</span>';
    const good = (pct > 0) === upGood;
    return '<span class="delta ' + (good ? 'up' : 'down') + '">' + (pct > 0 ? '▲ +' : '▼ ') + pct + '%</span>';
  }

  /* столбчатая диаграмма на HTML: одна серия, без легенды */
  function colChart(cols, opts) {
    const max = niceMax(Math.max(0, ...cols.map(c => c.v)));
    const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => max * f);
    const peak = cols.reduce((b, c, i) => c.v > (b < 0 ? -1 : cols[b].v) ? i : b, -1);
    const every = Math.max(1, Math.ceil(cols.length / (opts.maxLabels || 12)));
    return '<div class="cc" style="--n:' + cols.length + '">' +
      '<div class="cc-y" aria-hidden="true">' + ticks.slice().reverse().map(t => '<span>' + (opts.money ? compact(t) : (t % 1 ? '' : compact(t))) + '</span>').join('') + '</div>' +
      '<div class="cc-main"><div class="cc-plot">' +
      ticks.map(t => '<i class="cc-grid" style="bottom:' + (t / max * 100) + '%"></i>').join('') +
      '<div class="cc-cols">' + cols.map((c, i) =>
        '<div class="cc-col" tabindex="0" data-tip="' + U.esc(c.tip) + '">' +
        (i === peak && c.v > 0 ? '<span class="cc-val" style="bottom:' + (c.v / max * 100) + '%">' + U.esc(opts.money ? compact(c.v) : String(c.v)) + '</span>' : '') +
        '<span class="cc-bar' + (c.dim ? ' dim' : '') + '" style="height:' + (c.v / max * 100) + '%"></span></div>').join('') + '</div></div>' +
      '<div class="cc-x" aria-hidden="true">' + cols.map((c, i) => '<span>' + ((i % every === 0) ? U.esc(c.l) : '') + '</span>').join('') + '</div></div></div>';
  }

  function statsHTML() {
    const s = A.settings, tz = s.timezone;
    let h = '<div class="st-bar"><div class="chips" role="group" aria-label="Период">' + RANGES.map(r =>
      '<button class="chip" data-a="st-range" data-v="' + r[0] + '" aria-pressed="' + (ST.range === r[0]) + '">' + r[1] + '</button>').join('') + '</div>';
    if (ST.range === 'custom') {
      const [f, t] = rangeDates();
      h += '<div class="st-dates"><label for="st-from">с</label><input type="date" id="st-from" value="' + f + '" max="' + U.todayStr(tz) + '"><label for="st-to">по</label><input type="date" id="st-to" value="' + t + '" max="' + U.todayStr(tz) + '"></div>';
    }
    h += '<button class="btn btn-sm btn-ghost" data-a="st-csv"' + (!ST.cur || !ST.cur.length ? ' disabled' : '') + '>Скачать для Excel</button></div>';
    if (ST.err) return h + '<p class="err">' + U.esc(ST.err) + '</p>';
    if (!ST.cur) return h + '<div class="boot"><span class="spinner"></span></div>';
    const [from, to] = [ST.from, ST.to], len = U.daysBetween(from, to) + 1;
    const C = summarize(ST.cur), P = summarize(ST.prev || []);
    const prevName = len === 1 ? (ST.range === 'today' ? 'вчерашним днём' : 'предыдущим днём') : 'прошлыми ' + len + ' ' + U.plural(len, 'днём', 'днями', 'днями');
    const period = from === to ? dLabel(from) : dLabel(from) + ' — ' + dLabel(to);
    h += '<p class="st-cap">' + period + (ST.loading ? ' · обновляем…' : '') + ' · сравнение с ' + prevName + '. Учитываются заказы с сайта и у стойки, отменённые не входят в выручку.' +
      (API.mode === 'demo' ? ' <b>В демо прошлые дни заполнены примерными заказами.</b>' : '') + '</p>';

    // KPI
    h += '<div class="kpis">' +
      '<div class="kpi kpi-main"><span class="kpi-l">Выручка</span><b class="kpi-v">' + U.money(C.revenue) + '</b>' + delta(C.revenue, P.revenue, true) + '</div>' +
      '<div class="kpi"><span class="kpi-l">Заказов</span><b class="kpi-v">' + C.orders + '</b>' + delta(C.orders, P.orders, true) + '</div>' +
      '<div class="kpi"><span class="kpi-l">Средний чек</span><b class="kpi-v">' + U.money(C.avg) + '</b>' + delta(C.avg, P.avg, true) + '</div>' +
      '<div class="kpi"><span class="kpi-l">Продано позиций</span><b class="kpi-v">' + C.items + '</b>' + delta(C.items, P.items, true) + '</div>' +
      '<div class="kpi"><span class="kpi-l">Отменено</span><b class="kpi-v">' + C.cancelled + '</b>' + delta(C.cancelled, P.cancelled, false) + '</div>' +
      '</div>';
    if (C.unpaid.length) h += '<div class="adm-banner"><span>Выданы, но не отмечены как оплаченные: <b>' + C.unpaid.length + '</b> ' + U.plural(C.unpaid.length, 'заказ', 'заказа', 'заказов') + ' на ' + U.money(C.unpaid.reduce((a, o) => a + o.total, 0)) + '. Проверьте Kaspi Pay.</span></div>';
    if (!ST.cur.length) return h + '<div class="col-empty">За этот период заказов нет.</div>';

    h += '<div class="st-grid">';
    // по дням
    if (len > 1) {
      const days = []; for (let d = from; d <= to; d = U.addDays(d, 1)) days.push(d);
      const byDay = {}; days.forEach(d => { byDay[d] = { r: 0, n: 0 }; });
      C.ok.forEach(o => { const x = byDay[o.business_date]; if (x) { x.r += o.total; x.n++; } });
      const rev = ST.metric === 'revenue';
      const cols = days.map(d => {
        const x = byDay[d], wd = U.weekday(d);
        return { l: len > 10 ? String(Number(d.slice(8))) : WD[wd] + ' ' + Number(d.slice(8)), v: rev ? x.r : x.n, dim: wd >= 5,
          tip: WD[wd] + ', ' + dLabel(d) + ': ' + U.money(x.r) + ' · ' + x.n + ' ' + U.plural(x.n, 'заказ', 'заказа', 'заказов') };
      });
      const best = days.reduce((b, d) => byDay[d].r > byDay[b].r ? d : b, days[0]);
      h += '<section class="card st-card st-wide"><div class="st-h"><h3>' + (rev ? 'Выручка' : 'Заказы') + ' по дням</h3>' +
        '<div class="seg seg-sm" role="radiogroup"><button role="radio" data-a="st-metric" data-v="revenue" aria-checked="' + rev + '">Выручка</button><button role="radio" data-a="st-metric" data-v="orders" aria-checked="' + !rev + '">Заказы</button></div></div>' +
        colChart(cols, { money: rev, maxLabels: 16 }) +
        '<p class="st-note">Лучший день: <b>' + WD[U.weekday(best)] + ', ' + dLabel(best) + '</b> — ' + U.money(byDay[best].r) + '. Выходные выделены приглушённым цветом.</p></section>';
    }

    // по часам
    const hourOf = o => U.hourIn(ST.hourBy === 'ready' ? o.ready_at : o.created_at, tz);
    const hc = {}; C.ok.forEach(o => { const hh = hourOf(o); hc[hh] = (hc[hh] || 0) + 1; });
    const hs = Object.keys(hc).map(Number);
    let h0 = Math.min(U.hm(s.open_time) / 60 | 0, ...hs), h1 = Math.max(Math.ceil(U.hm(s.close_time) / 60) - 1, ...hs);
    if (s.open_time === '00:00' || h1 - h0 > 16) { h0 = Math.min(...hs); h1 = Math.max(...hs); }
    const hours = []; for (let x = h0; x <= h1; x++) hours.push(x);
    const total = C.ok.length;
    const top = hours.slice().sort((a, b) => (hc[b] || 0) - (hc[a] || 0)).slice(0, 2).filter(x => hc[x]);
    h += '<section class="card st-card st-wide"><div class="st-h"><h3>Заказы по часам</h3>' +
      '<div class="seg seg-sm" role="radiogroup"><button role="radio" data-a="st-hour" data-v="ready" aria-checked="' + (ST.hourBy === 'ready') + '">Когда забирают</button><button role="radio" data-a="st-hour" data-v="created" aria-checked="' + (ST.hourBy === 'created') + '">Когда заказали</button></div></div>' +
      colChart(hours.map(x => ({ l: String(x).padStart(2, '0'), v: hc[x] || 0, tip: String(x).padStart(2, '0') + ':00–' + String(x + 1).padStart(2, '0') + ':00: ' + (hc[x] || 0) + ' ' + U.plural(hc[x] || 0, 'заказ', 'заказа', 'заказов') + ' (' + Math.round((hc[x] || 0) / total * 100) + '%)' })), { maxLabels: 14 }) +
      (top.length ? '<p class="st-note">Больше всего заказов ' + top.map(x => '<b>' + String(x).padStart(2, '0') + ':00–' + String(x + 1).padStart(2, '0') + ':00</b> (' + Math.round(hc[x] / total * 100) + '%)').join(' и ') + '. В эти часы нужен второй человек за стойкой.</p>' : '') +
      '</section>';

    // тепловая карта день недели × час
    if (len >= 7) {
      const m = {}; let mx = 0;
      C.ok.forEach(o => { const k = U.weekday(o.business_date) + ':' + hourOf(o); m[k] = (m[k] || 0) + 1; mx = Math.max(mx, m[k]); });
      const lvl = v => !v ? 0 : Math.min(5, Math.ceil(v / mx * 5));
      h += '<section class="card st-card st-wide"><div class="st-h"><h3>Загрузка по дням недели и часам</h3>' +
        '<span class="hm-key" aria-hidden="true">меньше' + [1, 2, 3, 4, 5].map(l => '<i class="hm-c l' + l + '"></i>').join('') + 'больше</span></div>' +
        '<div class="hm-wrap"><div class="hm" style="--cols:' + hours.length + '">' +
        '<span></span>' + hours.map(x => '<span class="hm-hx">' + String(x).padStart(2, '0') + '</span>').join('') +
        WD.map((w, wi) => '<span class="hm-wd">' + w + '</span>' + hours.map(x => { const v = m[wi + ':' + x] || 0; return '<i class="hm-c l' + lvl(v) + '" tabindex="0" data-tip="' + w + ', ' + String(x).padStart(2, '0') + ':00–' + String(x + 1).padStart(2, '0') + ':00: ' + v + ' ' + U.plural(v, 'заказ', 'заказа', 'заказов') + ' за период"></i>'; }).join('')).join('') +
        '</div></div><p class="st-note">Чем темнее клетка, тем больше заказов в этот день недели и час за выбранный период.</p></section>';
    }

    // топ позиций
    const prod = {};
    C.ok.forEach(o => (o.items || []).forEach(i => { const k = i.name; const x = prod[k] || (prod[k] = { n: 0, r: 0 }); x.n += i.qty; x.r += i.line_total; }));
    const list = Object.keys(prod).map(k => Object.assign({ name: k }, prod[k])).sort((a, b) => b.r - a.r);
    const maxR = list.length ? list[0].r : 1, itemsRev = list.reduce((a, x) => a + x.r, 0) || 1;
    h += '<section class="card st-card"><div class="st-h"><h3>Что продаётся</h3><span class="muted small">по выручке</span></div>' +
      '<div class="tbl-wrap"><table class="st-tbl"><thead><tr><th>Позиция</th><th class="num">Шт.</th><th class="num">Сумма</th><th class="bar-th"><span class="sr">Доля</span></th></tr></thead><tbody>' +
      list.map(x => '<tr><td>' + U.esc(x.name) + '</td><td class="num">' + x.n + '</td><td class="num">' + U.money(x.r) + '</td><td class="bar-td"><span class="hbar" style="width:' + (x.r / maxR * 100) + '%"></span><span class="pct">' + Math.round(x.r / itemsRev * 100) + '%</span></td></tr>').join('') +
      '</tbody></table></div></section>';

    // оплата, получение, отмены
    const grp = (arr, key) => { const g = {}; arr.forEach(o => { const k = o[key]; const x = g[k] || (g[k] = { n: 0, r: 0 }); x.n++; x.r += o.total; }); return g; };
    const pay = grp(C.ok, 'payment_method'), ful = grp(C.ok, 'fulfillment');
    const src = grp(C.ok.map(o => ({ total: o.total, source: o.source === 'counter' ? 'counter' : 'online' })), 'source');
    const rows = (g, names) => Object.keys(g).sort((a, b) => g[b].r - g[a].r).map(k => '<tr><td>' + U.esc(names[k] || k) + '</td><td class="num">' + g[k].n + '</td><td class="num">' + U.money(g[k].r) + '</td><td class="num muted">' + Math.round(g[k].n / C.orders * 100) + '%</td></tr>').join('');
    const cr = {}; C.canc.forEach(o => { const k = o.cancel_reason || 'Без причины'; cr[k] = (cr[k] || 0) + 1; });
    h += '<section class="card st-card"><div class="st-h"><h3>Оплата и получение</h3></div>' +
      '<div class="tbl-wrap"><table class="st-tbl"><thead><tr><th>Откуда заказ</th><th class="num">Заказов</th><th class="num">Сумма</th><th class="num">Доля</th></tr></thead><tbody>' + rows(src, { online: 'С сайта', counter: 'У стойки' }) + '</tbody></table></div>' +
      '<div class="tbl-wrap"><table class="st-tbl"><thead><tr><th>Оплата</th><th class="num">Заказов</th><th class="num">Сумма</th><th class="num">Доля</th></tr></thead><tbody>' + rows(pay, U.PAY) + '</tbody></table></div>' +
      (Object.keys(ful).length > 1 || ful.delivery ? '<div class="tbl-wrap"><table class="st-tbl"><thead><tr><th>Получение</th><th class="num">Заказов</th><th class="num">Сумма</th><th class="num">Доля</th></tr></thead><tbody>' + rows(ful, { pickup: 'Самовывоз', delivery: 'Доставка' }) + '</tbody></table></div>' : '') +
      '<h4 class="st-sub">Отмены</h4>' + (C.canc.length ? '<ul class="st-list">' + Object.keys(cr).sort((a, b) => cr[b] - cr[a]).map(k => '<li><span>' + U.esc(k) + '</span><b>' + cr[k] + '</b></li>').join('') + '</ul>' : '<p class="muted small">Отмен не было.</p>') +
      '</section>';

    // таблица по дням
    if (len > 1) {
      const days = []; for (let d = to; d >= from; d = U.addDays(d, -1)) days.push(d);
      const byDay = {}; ST.cur.forEach(o => { const x = byDay[o.business_date] || (byDay[o.business_date] = { n: 0, r: 0, c: 0 }); if (o.status === 'cancelled') x.c++; else { x.n++; x.r += o.total; } });
      h += '<details class="card st-card st-wide"><summary><h3>Таблица по дням</h3></summary><div class="tbl-wrap"><table class="st-tbl"><thead><tr><th>День</th><th class="num">Заказов</th><th class="num">Выручка</th><th class="num">Средний чек</th><th class="num">Отмен</th></tr></thead><tbody>' +
        days.map(d => { const x = byDay[d] || { n: 0, r: 0, c: 0 }; return '<tr><td>' + WD[U.weekday(d)] + ', ' + dLabel(d) + '</td><td class="num">' + x.n + '</td><td class="num">' + U.money(x.r) + '</td><td class="num">' + (x.n ? U.money(Math.round(x.r / x.n)) : '—') + '</td><td class="num">' + (x.c || '') + '</td></tr>'; }).join('') +
        '</tbody></table></div></details>';
    }
    h += '</div>';
    return h;
  }

  function exportCSV() {
    const tz = A.settings.timezone, sep = ';';
    const cell = v => { const s = String(v == null ? '' : v); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const head = ['Дата', 'Номер', 'Откуда', 'Заказан', 'К выдаче', 'Статус', 'Причина отмены', 'Оплата', 'Статус оплаты', 'Получение', 'Позиции', 'Кол-во', 'Сумма, ₸'];
    const lines = [head.join(sep)].concat(ST.cur.slice().sort((a, b) => a.created_at.localeCompare(b.created_at)).map(o => [
      o.business_date, o.number, o.source === 'counter' ? 'У стойки' : 'С сайта', U.timeIn(o.created_at, tz), U.timeIn(o.ready_at, tz), U.STATUS[o.status], o.cancel_reason || '',
      U.PAY[o.payment_method], U.PAY_STATUS[o.payment_status], o.fulfillment === 'delivery' ? 'Доставка' : 'Самовывоз',
      (o.items || []).map(i => i.name + (i.size ? ' ' + i.size : '') + (i.qty > 1 ? ' ×' + i.qty : '')).join(', '),
      (o.items || []).reduce((a, i) => a + i.qty, 0), o.total
    ].map(cell).join(sep)));
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'kese-coffee-zakazy_' + ST.from + '_' + ST.to + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast('Файл сохранён: откройте его в Excel');
  }

  /* подсказка при наведении/касании */
  function tipEl() { let t = document.getElementById('chartTip'); if (!t) { t = document.createElement('div'); t.id = 'chartTip'; t.className = 'chart-tip'; t.hidden = true; document.body.appendChild(t); } return t; }
  function showTip(el) {
    const t = tipEl(); t.textContent = el.dataset.tip; t.hidden = false;
    const r = el.getBoundingClientRect(), w = t.offsetWidth, hgt = t.offsetHeight;
    let x = r.left + r.width / 2 - w / 2; x = Math.max(8, Math.min(window.innerWidth - w - 8, x));
    let y = r.top - hgt - 8; if (y < 8) y = r.bottom + 8;
    t.style.left = x + 'px'; t.style.top = y + 'px';
  }
  function hideTip() { const t = document.getElementById('chartTip'); if (t) t.hidden = true; }
  document.addEventListener('mouseover', e => { const el = e.target.closest && e.target.closest('[data-tip]'); if (el && location.hash.indexOf('#admin') === 0) showTip(el); });
  document.addEventListener('mouseout', e => { if (e.target.closest && e.target.closest('[data-tip]')) hideTip(); });
  document.addEventListener('focusin', e => { const el = e.target.closest && e.target.closest('[data-tip]'); if (el) showTip(el); });
  document.addEventListener('focusout', hideTip);
  window.addEventListener('scroll', hideTip, { passive: true });

  /* ------------------------------ события ------------------------------ */
  function bindEvents() {
    document.addEventListener('click', async (e) => {
      if (location.hash.indexOf('#admin') !== 0) return;
      const b = e.target.closest('[data-a]'); if (!b || !A.root.contains(b)) return;
      const a = b.dataset.a, id = b.dataset.id, v = b.dataset.v;
      if (a === 'tab') return setTab(v);
      if (a === 'sound') return unlockSound();
      if (a === 'logout') { stopLive(); await notifOffQuiet(); await API.signOut(); location.hash = '#admin'; return mount(A.root, A.ctx); }
      if (a === 'notif') { N.open = !N.open; return renderNotif(); }
      if (a === 'notif-close') { N.open = false; return renderNotif(); }
      if (a === 'notif-on') return notifEnable();
      if (a === 'notif-off') return notifDisable();
      if (a === 'notif-test') return notifTest();
      if (a === 'notif-hint-x') { U.store.set('adm_notif_hint', 'closed'); return showTab(); }
      if (a === 'demo-login') { await API.demoStaffLogin(v); return; }
      if (a === 'google') { try { await API.signInGoogle('#admin'); } catch (err) { toast(err.message, 'bad'); } return; }
      if (a === 'demo-reset') return API.resetDemo();
      if (a === 'accepting-on') { try { await API.setAccepting(true); A.settings.accepting_orders = true; renderFrame(); showTab(); } catch (err) { toast(err.message, 'bad'); } return; }
      if (a === 'c-cat') { C.cat = v; return showTab(); }
      if (a === 'c-add') return cAdd(id, v);
      if (a === 'c-q') {
        const i = Number(b.dataset.i), l = C.lines[i]; if (!l) return;
        l.qty += Number(v);
        if (l.qty <= 0) { C.lines.splice(i, 1); C.edit = null; } else l.qty = Math.min(20, l.qty);
        return renderTicket();
      }
      if (a === 'c-edit') { const i = Number(b.dataset.i); C.edit = C.edit === i ? null : i; return renderTicket(); }
      if (a === 'c-edit-done') { C.edit = null; cMerge(); return renderTicket(); }
      if (a === 'c-del') { C.lines.splice(Number(b.dataset.i), 1); C.edit = null; return renderTicket(); }
      if (a === 'c-size') { const l = C.lines[Number(b.dataset.i)]; if (l) l.size = v; return renderTicket(); }
      if (a === 'c-mod') {
        const l = C.lines[Number(b.dataset.i)], g = cIdx().groups[b.dataset.g]; if (!l || !g) return;
        if (g.multi) { const k = l.modifier_ids.indexOf(v); if (k >= 0) l.modifier_ids.splice(k, 1); else l.modifier_ids.push(v); }
        else { const ids = g.modifiers.map(m => m.id); l.modifier_ids = l.modifier_ids.filter(x => ids.indexOf(x) < 0).concat([v]); }
        return renderTicket();
      }
      if (a === 'c-pay') { C.pay = v; U.store.set('ctr_pay', v); return renderTicket(); }
      if (a === 'c-done') return counterSubmit('completed');
      if (a === 'c-clear') { C.lines = []; C.edit = null; C.err = ''; return renderTicket(); }
      if (a === 'c-jump') { const t = $('#ctrTicket'); if (t) t.scrollIntoView({ block: 'start', behavior: 'smooth' }); return; }
      if (a === 'st') return setOrder(id, { status: v });
      if (a === 'pay') return setOrder(id, { payment_status: v });
      if (a === 'cancel') { A.cancelFor = id; return showTab(); }
      if (a === 'cancel-no') { A.cancelFor = null; return showTab(); }
      if (a === 'cancel-do') { A.cancelFor = null; return setOrder(id, { status: 'cancelled', cancel_reason: v }); }
      if (a === 'copy') {
        const digits = U.digits(v);
        try { await navigator.clipboard.writeText(digits); toast('Номер скопирован: ' + U.phoneFmt(digits)); } catch (err) { toast(U.phoneFmt(digits)); }
        return;
      }
      if (a === 'msub') { A.menuSub = v; A.edit = null; return showTab(); }
      if (a === 'st-range') { ST.range = v; U.store.set('st_range', v); if (v === 'custom' && !ST.from) { ST.from = null; } return loadStats(); }
      if (a === 'st-metric') { ST.metric = v; return showTab(); }
      if (a === 'st-hour') { ST.hourBy = v; return showTab(); }
      if (a === 'st-csv') return exportCSV();
      if (a === 'pt-month') {
        PT.month = U.addMonths(PT.month || curMonth(), Number(v)); if (PT.month > curMonth()) PT.month = curMonth();
        PT.pay = null; if (PT.edit) PT.edit = readPtForm();
        const m = $('#admMain'); if (m) { m.innerHTML = partnersHTML(); if (PT.edit) mountPtMap(); }
        return loadPartners();
      }
      if (a === 'pt-new') return openPtForm({ name: '', code: '', address: '', place_hint: '', lat: null, lng: null, rate_pct: 10, rate_high_pct: 15, high_from_qty: 100, delivery_enabled: true, delivery_fee: 300, delivery_free_qty: 2, delivery_minutes: 15, payout_name: '', payout_phone: '', note: '', active: true });
      if (a === 'pt-edit') { const p = (PT.list || []).find(x => x.id === id); if (p) openPtForm(clone(p)); return; }
      if (a === 'pt-close') { PT.edit = null; const fb = $('#ptFormBox'); if (fb) fb.innerHTML = ''; return; }
      if (a === 'pt-find') {
        const addr = ($('#pt-address').value || '').trim(); if (!addr) return toast('Сначала введите адрес партнёра', 'bad');
        b.disabled = true;
        try {
          const s = A.settings, near = U.hasZone(s) ? [Number(s.shop_lat), Number(s.shop_lng)] : null;
          const list = await window.CafeMap.search(/астана|нур-султан/i.test(addr) ? addr : addr + ', Астана', near);
          if (!list.length) toast('Адрес не найден. Нажмите на карте, где находится партнёр', 'bad');
          else { const x = list[0]; if (PT.map) PT.map.setPin(x.lat, x.lng, true); setPtPoint(x.lat, x.lng, x.label); }
        } catch (err) { toast(err.message, 'bad'); }
        b.disabled = false; return;
      }
      if (a === 'pt-qr') { PT.qr = PT.qr === id ? null : id; return renderPtBody(); }
      if (a === 'pt-print' || a === 'pt-png') { const p = (PT.list || []).find(x => x.id === id); if (!p) return; return a === 'pt-print' ? printCard(p) : qrPNG(ptLink(p.code), p.code); }
      if (a === 'pt-copy') return ptCopy(v);
      if (a === 'pt-pay') { PT.pay = id; renderPtBody(); const i = $('#pp-amt'); if (i) i.focus(); return; }
      if (a === 'pt-pay-no') { PT.pay = null; return renderPtBody(); }
      if (a === 'pt-unpay') {
        if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = 'Точно снять отметку?'; return; }
        try { await API.unsetPartnerPaid(id, PT.month); toast('Отметка о выплате снята'); await loadPartners(); } catch (err) { toast(err.message, 'bad'); }
        return;
      }
      if (a === 'pt-csv') return PT.report && PT.report.length ? exportPartnersCSV() : null;
      if (a === 'p-edit') { const p = A.menu.products.find(x => x.id === id); A.edit = { kind: 'product', data: clone(p), sized: !!(p.sizes && p.sizes.length) }; showTab(); if (window.innerWidth < 900) $('#edPanel').scrollIntoView({ block: 'start' }); return; }
      if (a === 'p-new') { A.edit = { kind: 'product', data: { name: '', description: '', category_id: v || null, price: null, sizes: [{ label: 'S', volume: '250 мл', price: null }, { label: 'M', volume: '350 мл', price: null }, { label: 'L', volume: '450 мл', price: null }], modifier_group_ids: [], active: true, available: true, sort: A.menu.products.length + 1 }, sized: false }; showTab(); const f = $('#pf-name'); if (f) { f.focus(); if (window.innerWidth < 900) $('#edPanel').scrollIntoView({ block: 'start' }); } return; }
      if (a === 'ed-close') { A.edit = null; return showTab(); }
      if (a === 'p-mode') { readProductForm(); A.edit.sized = v === 'sizes'; if (A.edit.sized && !(A.edit.data.sizes || []).length) A.edit.data.sizes = [{ label: 'M', volume: '350 мл', price: A.edit.data.price }]; return rerenderPanel(); }
      if (a === 'sz-add') { readProductForm(); A.edit.data.sizes.push({ label: '', volume: '', price: null }); rerenderPanel(); const rows = $$('[data-sz="label"]'); if (rows.length) rows[rows.length - 1].focus(); return; }
      if (a === 'sz-del') { readProductForm(); A.edit.data.sizes.splice(Number(b.dataset.i), 1); return rerenderPanel(); }
      if (a === 'ph-del') { readProductForm(); A.edit.data.image_url = null; delete A.edit.data.thumb_url; return rerenderPanel(); }
      if (a === 'p-del-ask') { $('#pDel').innerHTML = '<span>Удалить «' + esc(A.edit.data.name) + '» насовсем? Можно просто скрыть из меню.</span><button class="btn btn-sm btn-danger" type="button" data-a="p-del">Удалить</button><button class="btn btn-sm btn-ghost" type="button" data-a="p-del-no">Нет</button>'; return; }
      if (a === 'p-del-no') return rerenderPanel();
      if (a === 'p-del') { try { await API.deleteProduct(A.edit.data.id); toast('Позиция удалена'); A.edit = null; await reloadMenu(); } catch (err) { toast(err.message, 'bad'); } return; }
      if (a === 'm-del') { try { await API.deleteModifier(id); await reloadMenu(); } catch (err) { toast(err.message, 'bad'); } return; }
      if (a === 'g-del') {
        if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = 'Точно удалить?'; b.classList.add('btn-danger'); return; }
        try { await API.deleteGroup(id); toast('Группа удалена'); await reloadMenu(); } catch (err) { toast(err.message, 'bad'); } return;
      }
      if (a === 'c-save' || a === 'c-del' || a === 'c-up') {
        try {
          if (a === 'c-save') { const row = b.closest('[data-cat]'); await API.saveCategory({ id, name: row.querySelector('[data-cname]').value.trim() || 'Без названия', active: row.querySelector('[data-cactive]').checked }); toast('Сохранено'); }
          if (a === 'c-del') {
            if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = '?'; b.classList.add('btn-danger'); toast('Нажмите ещё раз, чтобы удалить категорию'); return; }
            await API.deleteCategory(id); toast('Категория удалена');
          }
          if (a === 'c-up') {
            const i = Number(b.dataset.i), cs = A.menu.categories.slice();
            [cs[i - 1], cs[i]] = [cs[i], cs[i - 1]];
            for (let k = 0; k < cs.length; k++) if (cs[k].sort !== k + 1) await API.saveCategory({ id: cs[k].id, name: cs[k].name, active: cs[k].active, sort: k + 1 });
          }
          await reloadMenu();
        } catch (err) { toast(err.message, 'bad'); }
        return;
      }
    });

    document.addEventListener('change', async (e) => {
      if (location.hash.indexOf('#admin') !== 0 || !A.root.contains(e.target)) return;
      const t = e.target;
      if (t.id === 'st-from' || t.id === 'st-to') {
        const f = $('#st-from').value, to = $('#st-to').value;
        if (f && to) { ST.from = f <= to ? f : to; ST.to = f <= to ? to : f; ST.range = 'custom'; loadStats(); }
        return;
      }
      if (t.id === 'pf-file') return onPhotoChosen(t);
      if (t.id === 'c-paid') { C.paid = t.checked; return; }
      if (t.id === 's-delivery_radius_km') return;
      if (t.id === 'adm-acc') {
        try { await API.setAccepting(t.checked); A.settings.accepting_orders = t.checked; toast(t.checked ? 'Приём заказов включён' : 'Приём заказов на паузе'); if (A.tab === 'orders') showTab(); }
        catch (err) { t.checked = !t.checked; toast(err.message, 'bad'); }
        return;
      }
      if (t.dataset.a === 'avail') {
        const p = A.menu.products.find(x => x.id === t.dataset.id);
        try { await API.setAvailable(p.id, t.checked); p.available = t.checked; toast(p.name + (t.checked ? ' снова в наличии' : ' на стопе')); if (A.tab === 'stop') showTab(); else { const lab = t.closest('.ed-item'); if (lab) showTab(); } }
        catch (err) { t.checked = !t.checked; toast(err.message, 'bad'); }
        return;
      }
      if (t.dataset.a === 'mod-avail') {
        let m = null; A.menu.groups.forEach(g => g.modifiers.forEach(x => { if (x.id === t.dataset.id) m = x; }));
        try { await API.setModifierActive(m.id, t.checked); m.active = t.checked; toast(m.name + (t.checked ? ' снова есть' : ' на стопе')); showTab(); }
        catch (err) { t.checked = !t.checked; toast(err.message, 'bad'); }
        return;
      }
      if (t.dataset.a === 'role') {
        try { await API.setRole(t.dataset.email, t.value); toast('Роль обновлена'); loadTeam(); } catch (err) { toast(err.message, 'bad'); loadTeam(); }
      }
    });

    document.addEventListener('submit', async (e) => {
      if (location.hash.indexOf('#admin') !== 0 || !A.root.contains(e.target)) return;
      e.preventDefault();
      const f = e.target;
      if (f.id === 'admLogin') {
        const err = $('#admErr');
        try { await API.signIn($('#adm-email').value, $('#adm-pass').value); await mount(A.root, A.ctx); }
        catch (x) { err.textContent = x.message; err.hidden = false; }
        return;
      }
      if (f.id === 'ctrForm') return counterSubmit('accepted');
      if (f.id === 'pForm') return saveProduct();
      if (f.id === 'ptForm') return savePartner();
      if (f.dataset.ptpay) {
        const amt = Math.round(Number($('#pp-amt').value)); if (!(amt >= 0)) return toast('Проверьте сумму', 'bad');
        const btn = f.querySelector('[type=submit]'); if (btn) btn.disabled = true;
        try { await API.setPartnerPaid(f.dataset.ptpay, PT.month, amt, $('#pp-note').value.trim()); PT.pay = null; toast('Выплата отмечена'); await loadPartners(); }
        catch (x) { toast(x.message, 'bad'); if (btn) btn.disabled = false; }
        return;
      }
      if (f.dataset.group) return saveGroup(f);
      if (f.id === 'catNew') { const name = f.cname.value.trim(); if (!name) return; try { await API.saveCategory({ name, sort: A.menu.categories.length + 1, active: true }); await reloadMenu(); } catch (x) { toast(x.message, 'bad'); } return; }
      if (f.hasAttribute('data-set')) return saveSettings(f);
      if (f.id === 'teamAdd') {
        const email = $('#t-email').value.trim(); if (!email) return;
        try { await API.setRole(email, $('#t-role').value); toast('Доступ выдан: ' + email); f.reset(); loadTeam(); } catch (x) { toast(x.message, 'bad'); }
      }
    });
  }

  A.soundOn = false; // звук включается кнопкой при каждом открытии — так требует браузер
  document.addEventListener('input', (e) => {
    if (e.target.id === 'c-name') { C.name = e.target.value; return; }
    if (e.target.id === 'c-phone') { C.phone = e.target.value; return; }
    if (e.target.id === 'c-comment') { C.comment = e.target.value; return; }
    if (e.target.id === 'pt-code') { e.target.dataset.touched = '1'; return; }
    if (e.target.id === 'pt-name') { const c = $('#pt-code'); if (c && !c.dataset.touched) c.value = U.slug(e.target.value); return; }
    if (e.target.id !== 's-delivery_radius_km') return;
    const r = Number(e.target.value); const v = $('#radiusVal'); if (v) v.textContent = U.km(r);
    if (A.shopMap) A.shopMap.setRadius(r);
  });
  document.addEventListener('click', async (e) => {
    const b = e.target.closest && e.target.closest('[data-a="shop-find"]'); if (!b) return;
    const addr = A.settings.address || ''; if (!addr) return toast('Сначала укажите адрес в блоке «Заведение»', 'bad');
    b.disabled = true;
    try {
      const list = await window.CafeMap.search(/астана/i.test(addr) ? addr : addr + ', Астана', null);
      if (!list.length) toast('Адрес не найден на карте. Нажмите на точку кофейни вручную', 'bad');
      else { const x = list[0]; A.shopMap.setPin(x.lat, x.lng, true); $('#s-shop_lat').value = x.lat.toFixed(6); $('#s-shop_lng').value = x.lng.toFixed(6); $('#shopHint').textContent = 'Нашли: ' + x.label + '. Проверьте точку и нажмите «Сохранить».'; }
    } catch (err) { toast(err.message, 'bad'); }
    b.disabled = false;
  });
  window.CafeAdmin = { mount };
})();
