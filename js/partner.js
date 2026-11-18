/* =====================================================================
   Страница статистики для партнёра: partner.html?t=<секретный токен>
   Показывает заказы через QR партнёра и сумму к выплате. Без данных гостей.
   ===================================================================== */
(function () {
  'use strict';
  const { util: U, api: API } = window.Cafe;
  const esc = U.esc, money = U.money;
  const app = document.getElementById('app');
  const MON = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  const LOGO = '<svg class="logo" viewBox="0 0 44 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 21 L17 4 L24 12 L30 6 L42 21"/><path d="M11 21 L19 12.5"/><path d="M26 21 L32 14"/></svg>';
  const P = { token: null, month: null, cur: null, data: null, err: null, loading: false, req: 0 };
  const pct = v => String(Number(v)).replace('.', ',') + '%';
  const dayLabel = s => { const [, m, d] = s.split('-').map(Number); return d + ' ' + MON[m - 1]; };
  const ddmm = iso => { const d = new Date(iso); return String(d.getDate()).padStart(2, '0') + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.' + d.getFullYear(); };

  function start() {
    const q = new URLSearchParams(location.search);
    P.token = (q.get('t') || '').trim();
    const today = new Date(); P.cur = U.ds(today.getFullYear(), today.getMonth() + 1, 1);
    const m = (q.get('m') || '').trim();
    P.month = /^\d{4}-\d{2}$/.test(m) && m + '-01' <= P.cur ? m + '-01' : P.cur;
    if (!/^[0-9a-f-]{36}$/i.test(P.token)) { P.err = 'В ссылке нет кода партнёра. Попросите кофейню прислать ссылку ещё раз.'; return render(); }
    load();
  }
  async function load() {
    const my = ++P.req; P.loading = true; render();
    try { const d = await API.partnerStats(P.token, P.month); if (my !== P.req) return; P.data = d; P.err = null; }
    catch (e) { if (my !== P.req) return; P.err = e.message; }
    P.loading = false; render();
  }
  function payStatus(d, closed) {
    if (d.paid) return '<span class="ps-st ok">Выплачено ' + money(d.paid.amount) + ' · ' + ddmm(d.paid.paid_at) + '</span>';
    if (!d.payout) return '<span class="ps-st">Нечего выплачивать</span>';
    return closed ? '<span class="ps-st wait">Ожидает выплаты на Kaspi</span>' : '<span class="ps-st">Месяц ещё идёт. Выплата до 5 числа следующего месяца</span>';
  }
  function render() {
    let h = '<header class="ps-top"><span class="brand">' + LOGO + '<span class="brand-txt"><b>' + esc((P.data && P.data.shop) || 'Kese Coffee') + '</b><small>Партнёрская программа</small></span></span></header>';
    if (P.err && !P.data) { app.innerHTML = h + '<div class="card ps-card"><h1 class="h-page">Не получилось открыть</h1><p class="muted">' + esc(P.err) + '</p></div>'; return; }
    if (!P.data) { app.innerHTML = h + '<div class="boot"><span class="spinner" aria-hidden="true"></span><span>Загружаем статистику…</span></div>'; return; }
    const d = P.data, closed = P.month < P.cur;
    const left = Number(d.high_from_qty) - d.qty;
    h += '<section class="ps-head"><p class="eyebrow">Партнёр</p><h1>' + esc(d.name) + '</h1>' +
      (d.active ? '' : '<p class="ps-off">Партнёрство приостановлено: новые заказы через ваш QR сейчас не учитываются.</p>') +
      '<div class="pt-month" role="group" aria-label="Месяц"><button class="iconbtn" data-m="-1" aria-label="Предыдущий месяц">‹</button><b>' + U.monthLabel(P.month) + '</b>' +
      '<button class="iconbtn" data-m="1" aria-label="Следующий месяц"' + (P.month >= P.cur ? ' disabled' : '') + '>›</button></div></section>';
    h += '<section class="card ps-card ps-main"><span class="lab">' + (closed ? 'К выплате за ' : 'Начислено за ') + U.monthLabel(P.month) + '</span>' +
      '<b class="ps-big">' + money(d.payout) + '</b>' + payStatus(d, closed) +
      '<dl class="pt-nums"><div><dt>Заказов</dt><dd>' + d.orders + '</dd></div><div><dt>Позиций</dt><dd>' + d.qty + '</dd></div><div><dt>Сумма заказов</dt><dd>' + money(d.subtotal) + '</dd></div><div><dt>Ваш процент</dt><dd>' + pct(d.rate) + '</dd></div></dl>' +
      (Number(d.high_from_qty) > 0 && Number(d.rate_high_pct) > Number(d.rate_pct)
        ? '<p class="ps-tier">' + (d.rate >= Number(d.rate_high_pct) ? 'Повышенная ставка ' + pct(d.rate_high_pct) + ' за этот месяц: больше ' + d.high_from_qty + ' позиций.'
          : 'До ставки ' + pct(d.rate_high_pct) + ' осталось <b>' + left + '</b> ' + U.plural(left, 'позиция', 'позиции', 'позиций') + ' в этом месяце.') + '</p>' : '') +
      (d.in_progress ? '<p class="hint">Ещё готовятся или в пути: ' + d.in_progress + '. Они попадут в расчёт после выдачи.</p>' : '') +
      (P.loading ? '<p class="hint">Обновляем…</p>' : '') + '</section>';
    if (d.days && d.days.length) {
      h += '<section class="card ps-card"><h2 class="h-sec">По дням</h2><div class="tbl-wrap"><table class="st-tbl"><thead><tr><th>День</th><th class="num">Заказов</th><th class="num">Позиций</th><th class="num">Сумма</th></tr></thead><tbody>' +
        d.days.slice().reverse().map(x => '<tr><td>' + dayLabel(x.date) + '</td><td class="num">' + x.orders + '</td><td class="num">' + x.qty + '</td><td class="num">' + money(x.subtotal) + '</td></tr>').join('') +
        '</tbody></table></div></section>';
    } else {
      h += '<section class="card ps-card"><p class="muted">В этом месяце заказов через ваш QR пока не было.</p></section>';
    }
    if (d.history && d.history.some(x => x.orders || x.paid)) {
      h += '<section class="card ps-card"><h2 class="h-sec">Прошлые месяцы</h2><div class="tbl-wrap"><table class="st-tbl"><thead><tr><th>Месяц</th><th class="num">Заказов</th><th class="num">Сумма</th><th class="num">Выплата</th><th>Статус</th></tr></thead><tbody>' +
        d.history.map(x => '<tr><td>' + U.monthLabel(x.month) + '</td><td class="num">' + x.orders + '</td><td class="num">' + money(x.subtotal) + '</td><td class="num">' + money(x.payout) + '</td><td>' +
          (x.paid ? '<span class="ps-st ok">выплачено ' + ddmm(x.paid.paid_at) + '</span>' : x.payout ? '<span class="ps-st wait">ожидает</span>' : '—') + '</td></tr>').join('') +
        '</tbody></table></div></section>';
    }
    h += '<p class="hint ps-foot">Учитываются выданные заказы, оформленные через ваш QR, без платы за доставку. Имена и телефоны гостей здесь не показываются. Вопросы по выплатам — в WhatsApp кофейни.</p>';
    app.innerHTML = h;
  }
  app.addEventListener('click', e => {
    const b = e.target.closest('[data-m]'); if (!b || b.disabled) return;
    P.month = U.addMonths(P.month, Number(b.dataset.m)); if (P.month > P.cur) P.month = P.cur;
    try { const u = new URL(location.href); u.searchParams.set('m', P.month.slice(0, 7)); history.replaceState(null, '', u.pathname + u.search); } catch (err) { /* не важно */ }
    load();
  });
  start();
})();
