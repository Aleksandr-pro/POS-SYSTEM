/* ============================================================
   POS Контроль — панель управления (дашборд)
   ============================================================ */
(function () {
  'use strict';
  var PAGES = window.PAGES = window.PAGES || {};
  var state = { period: 'today', pointId: 'all', date: null, month: null, from: null, to: null };

  function greeting() {
    var h = new Date().getHours();
    if (h < 5) return 'Доброй ночи';
    if (h < 12) return 'Доброе утро';
    if (h < 18) return 'Добрый день';
    return 'Добрый вечер';
  }

  function deltaBadge(current, previous, invert) {
    var pct = deltaPct(current, previous);
    if (!isFinite(pct) || Math.abs(pct) < 0.05) return '<span class="delta flat">0%</span>';
    var good = invert ? pct < 0 : pct > 0;
    var cls = good ? 'up' : 'down';
    var arrow = pct > 0 ? icon('arrowUp', 12) : icon('arrowDown', 12);
    return '<span class="delta ' + cls + '">' + arrow + Math.abs(pct).toFixed(Math.abs(pct) >= 100 ? 0 : 1) + '%</span>';
  }

  function pointOptionsHTML(user) {
    var points = user.role === 'seller' ? userPoints(user) : DB.points;
    var html = '';
    if (user.role !== 'seller') html += '<option value="all">Все точки</option>';
    points.forEach(function (p) {
      html += '<option value="' + p.id + '"' + (state.pointId === p.id ? ' selected' : '') + '>' + esc(p.name) + '</option>';
    });
    return html;
  }

  function ensurePointState(user) {
    var allowed = userPoints(user).map(function (p) { return p.id; });
    if (user.role === 'seller') {
      var active = activePointId(user);
      if (!allowed.length) { state.pointId = 'all'; return; }
      if (state.pointId === 'all' || allowed.indexOf(state.pointId) === -1) state.pointId = active || allowed[0];
      return;
    }
    if (state.pointId !== 'all' && !getPoint(state.pointId)) state.pointId = 'all';
  }

  PAGES.dashboard = {
    render: function (root, ctx) {
      var user = ctx.user;
      ensurePointState(user);

      var sel = normalizePeriodSel(state);
      state.date = sel.date; state.month = sel.month; state.from = sel.from; state.to = sel.to;
      var range = resolveRange(sel);
      var opts = { pointId: state.pointId !== 'all' ? state.pointId : null };
      var stats = summarize(range.from, range.to, opts);
      var supplyList = suppliesBetween(range.from, range.to, opts);
      var supplySum = supplyTotals(supplyList);
      var prev = summarize(range.prevFrom, range.prevTo, opts);
      var points = user.role === 'seller' ? userPoints(user) : DB.points;
      var multiPoint = user.role === 'seller' && points.length > 1;
      var showOnboarding = (user.role === 'admin') && (DB.points.length === 0 || DB.products.length === 0);

      root.innerHTML =
        '<div class="page">' +
          '<div class="greet">' +
            '<div>' +
              '<h1>' + greeting() + ', ' + esc((user.fullName || '').split(' ')[0]) + '!</h1>' +
              '<div class="sub">' + (state.period === 'today' ? fmtDateHuman(range.from) : range.sub) + ' · ' + (state.pointId === 'all' ? 'все точки продаж' : esc(pointName(state.pointId))) + '</div>' +
            '</div>' +
            '<div class="period-row">' +
              '<div class="segmented" id="periodSwitch">' +
                '<button type="button" data-period="today" class="' + (state.period === 'today' ? 'active' : '') + '">Сегодня</button>' +
                '<button type="button" data-period="week" class="' + (state.period === 'week' ? 'active' : '') + '">Неделя</button>' +
                '<button type="button" data-period="month" class="' + (state.period === 'month' ? 'active' : '') + '">Месяц</button>' +
                '<button type="button" data-period="period" class="' + (state.period === 'period' ? 'active' : '') + '">Период</button>' +
              '</div>' +
              (points.length > 1 || user.role !== 'seller'
                ? '<select class="select" id="pointFilter" style="height:38px;width:auto;min-width:150px">' + pointOptionsHTML(user) + '</select>'
                : '') +
            '</div>' +
          '</div>' +

          periodToolbarHtml(state) +

          (showOnboarding
            ? '<div class="card" style="padding:20px;margin-bottom:18px;background:linear-gradient(120deg,#eef2ff,#faf5ff);border-color:#dfe3ff">' +
                '<div class="flex between wrap gap-12">' +
                  '<div style="display:flex;gap:14px;align-items:flex-start">' +
                    '<div class="stat-icon indigo" style="width:44px;height:44px">' + icon('sparkles', 21) + '</div>' +
                    '<div><div style="font-size:15.5px;font-weight:750">Начните настройку системы</div>' +
                    '<div class="muted small" style="margin-top:3px;max-width:560px">Создайте точку продаж и товары, заполните остатки — и система готова к работе.</div></div>' +
                  '</div>' +
                  '<div class="flex gap-8 wrap">' +
                    '<button type="button" class="btn btn-primary" id="onboardPoints">' + icon('pin', 16) + ' Создать точку</button>' +
                  '</div>' +
                '</div>' +
              '</div>'
            : '') +

          '<div class="grid-4">' +
            '<div class="card stat-card">' +
              '<div class="stat-top"><div class="stat-icon indigo">' + icon('cash', 20) + '</div>' + deltaBadge(stats.revenue, prev.revenue) + '</div>' +
              '<div><div class="stat-label">Выручка</div><div class="stat-value">' + fmtMoney(stats.revenue) + '</div></div>' +
              '<div class="stat-foot">' + stats.salesCount + ' ' + plural(stats.salesCount, 'продажа', 'продажи', 'продаж') + ' за период</div>' +
            '</div>' +
            '<div class="card stat-card">' +
              '<div class="stat-top"><div class="stat-icon red">' + icon('wallet', 20) + '</div>' + deltaBadge(stats.expenses, prev.expenses, true) + '</div>' +
              '<div><div class="stat-label">Расходы</div><div class="stat-value">' + fmtMoney(stats.expenses) + '</div></div>' +
              '<div class="stat-foot">' + stats.expenseList.length + ' ' + plural(stats.expenseList.length, 'запись', 'записи', 'записей') + ' о расходах</div>' +
            '</div>' +
            '<div class="card stat-card">' +
              '<div class="stat-top"><div class="stat-icon green">' + icon('chart', 20) + '</div>' + deltaBadge(stats.profit, prev.profit) + '</div>' +
              '<div><div class="stat-label">Прибыль</div><div class="stat-value">' + fmtMoney(stats.profit) + '</div></div>' +
              '<div class="stat-foot">' + (stats.revenue ? Math.round((stats.profit / stats.revenue) * 100) : 0) + '% маржинальность</div>' +
            '</div>' +
            '<div class="card stat-card">' +
              '<div class="stat-top"><div class="stat-icon amber">' + icon('receipt', 20) + '</div>' + deltaBadge(stats.avgCheck, prev.avgCheck) + '</div>' +
              '<div><div class="stat-label">Средний чек</div><div class="stat-value">' + fmtMoney(Math.round(stats.avgCheck)) + '</div></div>' +
              '<div class="stat-foot">продано ' + fmtNumber(stats.itemsSold) + ' ' + plural(stats.itemsSold, 'товар', 'товара', 'товаров') + '</div>' +
            '</div>' +
          '</div>' +

          (supplySum.count
            ? '<div class="card supply-strip" style="margin-top:16px">' +
                '<div class="stat-icon indigo" style="width:38px;height:38px;flex:0 0 auto">' + icon('package', 18) + '</div>' +
                '<div style="min-width:0"><div class="semibold small">Поступления на склад за период</div>' +
                  '<div class="muted tiny">' + supplySum.count + ' ' + plural(supplySum.count, 'поставка', 'поставки', 'поставок') + ' · ' + fmtNumber(supplySum.qty) + ' шт</div></div>' +
                '<button type="button" class="btn btn-sm btn-secondary" data-go-stock style="margin-left:auto">Склад</button>' +
              '</div>'
            : '') +
          '<div class="dash-grid section-gap">' +
            '<div class="card">' +
              '<div class="card-head">' +
                '<div><h3>Динамика продаж</h3><div class="sub">' + range.sub + '</div></div>' +
                '<div class="legend">' +
                  '<span><i style="background:' + CHART_COLORS.revenue + '"></i>Выручка</span>' +
                  '<span><i style="background:' + CHART_COLORS.expenses + '"></i>Расходы</span>' +
                '</div>' +
              '</div>' +
              '<div class="card-body">' +
                '<div class="chart-wrap"><canvas id="dashChart" class="chart-canvas"></canvas></div>' +
              '</div>' +
            '</div>' +
            '<div class="side-col">' +
              '<div class="card">' +
                '<div class="card-head"><h3>Способы оплаты</h3></div>' +
                '<div class="card-body">' +
                  '<div class="donut-wrap">' +
                    '<canvas id="payDonut" width="132" height="132" style="width:132px;height:132px"></canvas>' +
                    '<div class="donut-legend">' +
                      '<div class="row"><i style="background:#12b76a"></i><span class="nm">Наличные</span><span class="val">' + fmtCompact(stats.byMethod.cash) + '</span></div>' +
                      '<div class="row"><i style="background:#4f46e5"></i><span class="nm">Kaspi QR</span><span class="val">' + fmtCompact(stats.byMethod.qr) + '</span></div>' +
                      '<div class="row"><i style="background:#ee46bc"></i><span class="nm">Смешанный</span><span class="val">' + fmtCompact(stats.byMethod.mixed) + '</span></div>' +
                      (stats.mixedTotal
                        ? '<div class="pay-split">' +
                            '<div class="row sub"><span class="nm">· наличными в смешанных</span><span class="val">' + fmtCompact(stats.mixedCash) + '</span></div>' +
                            '<div class="row sub"><span class="nm">· Kaspi в смешанных</span><span class="val">' + fmtCompact(stats.mixedQr) + '</span></div>' +
                          '</div>'
                        : '') +
                      '<div class="pay-totals">' +
                        '<div class="row"><span class="nm">Всего наличными</span><span class="val">' + fmtCompact(stats.cashTotal) + '</span></div>' +
                        '<div class="row"><span class="nm">Всего Kaspi QR</span><span class="val">' + fmtCompact(stats.qrTotal) + '</span></div>' +
                      '</div>' +
                    '</div>' +
                  '</div>' +
                '</div>' +
              '</div>' +
              '<div class="card grow">' +
                '<div class="card-head"><h3>Топ товаров</h3><span class="muted tiny">' + range.label + '</span></div>' +
                '<div class="card-body">' +
                  (function () {
                    var top = topProducts(stats.sales, 5);
                    if (!top.length) return '<div class="muted small" style="padding:8px 0">Пока нет продаж за период</div>';
                    return '<div class="top-prod">' + top.map(function (p, i) {
                      return '<div class="top-prod-row"><span class="idx">' + (i + 1) + '</span>' +
                        '<span class="nm" title="' + esc(p.name) + '">' + esc(p.name) + '</span>' +
                        '<span class="badge neutral">' + p.qty + ' шт</span>' +
                        '<span class="sum">' + fmtCompact(p.revenue) + '</span></div>';
                    }).join('') + '</div>';
                  })() +
                '</div>' +
              '</div>' +
            '</div>' +
          '</div>' +

          '<div class="grid-2 section-gap" style="grid-template-columns:1.6fr 1fr" id="dashBottom">' +
            '<div class="card" style="min-width:0">' +
              '<div class="card-head" style="flex-wrap:wrap"><div><h3>Последние транзакции</h3><div class="sub">' + stats.salesCount + ' · ' + range.sub + '</div></div>' +
                (function () {
                  var stubs = historyStubSummary();
                  if (!stubs.count || (user.role !== 'admin' && user.role !== 'dev')) return '';
                  return '<button type="button" class="btn btn-danger-soft btn-sm" id="dashClearStubs" style="white-space:nowrap">' +
                    icon('trash', 14) + ' Убрать заглушки (' + fmtNumber(stubs.count) + ')</button>';
                })() +
              '</div>' +
              '<div class="card-body" style="padding-top:10px">' +
                (function () {
                  var recent = stats.sales.slice().sort(function (a, b) { return b.createdAt - a.createdAt; }).slice(0, 7);
                  if (!recent.length) return emptyState('receipt', 'Продаж пока нет', 'Оформите первую продажу в разделе «Касса»', '<button class="btn btn-primary btn-sm" data-go-cash>' + icon('cash', 15) + ' Перейти в кассу</button>');
                  return '<div class="table-wrap"><table class="tbl"><thead><tr>' +
                    '<th>Продавец</th><th>Товары</th><th class="hide-sm">Время</th><th>Оплата</th><th class="text-right">Сумма</th><th></th>' +
                    '</tr></thead><tbody>' + recent.map(function (s) {
                      var itemsText = (s.items || []).map(function (it) { return it.name + ' ×' + it.qty; }).join(', ');
                      return '<tr>' +
                        '<td><div class="user-cell">' + avatarHtml(s.userName, 'avatar-sm') +
                          '<div style="min-width:0"><div class="nm truncate">' + esc(s.userName) + '</div><div class="un truncate">' + esc(s.pointName || pointName(s.pointId)) + '</div></div></div></td>' +
                        '<td style="max-width:230px"><div class="cell-main truncate" title="' + esc(itemsText) + '">' + esc(itemsText) + '</div><div class="cell-sub">' + (s.items || []).reduce(function (n, it) { return n + it.qty; }, 0) + ' шт · #' + esc(s.code || '') + (s.manual ? ' · вручную' : '') + '</div></td>' +
                        '<td class="hide-sm"><div class="cell-main" style="font-weight:500">' + fmtTime(s.createdAt) + '</div><div class="cell-sub">' + fmtDate(s.createdAt) + '</div></td>' +
                        '<td>' + badge(paymentLabel(s.payment), paymentBadgeClass(s.payment)) +
                          (s.payment === 'mixed'
                            ? '<div class="cell-sub nowrap">нал ' + fmtCompact(s.cashAmount || 0) + ' · QR ' + fmtCompact(s.qrAmount || 0) + '</div>'
                            : '') + '</td>' +
                        '<td class="text-right"><span class="cell-main money">' + fmtMoney(s.total) + '</span></td>' +
                        '<td><div class="actions">' +
                          (s.receipt
                            ? '<button class="icon-btn" data-receipt="' + s.id + '" title="Посмотреть чек">' + icon('image', 16) + '</button>'
                            : '') +
                          (user.role === 'admin' || user.role === 'dev'
                            ? '<button class="icon-btn danger" data-delete-sale="' + s.id + '" title="Удалить транзакцию">' + icon('trash', 16) + '</button>'
                            : '') +
                        '</div></td>' +
                      '</tr>';
                    }).join('') + '</tbody></table></div>';
                })() +
              '</div>' +
            '</div>' +
            '<div class="card" style="min-width:0">' +
              '<div class="card-head"><h3>Расходы</h3>' +
                (user.role === 'admin' ? '<button class="icon-btn" id="dashAddExpense" title="Добавить расход">' + icon('plus', 17) + '</button>' : '') +
              '</div>' +
              '<div class="card-body" style="padding-top:10px">' +
                (function () {
                  var list = stats.expenseList.slice().sort(function (a, b) { return b.createdAt - a.createdAt; }).slice(0, 5);
                  if (!list.length) return '<div class="muted small" style="padding:10px 0">Расходов за период нет</div>';
                  return list.map(function (e) {
                    return '<div class="today-line" style="padding-left:0;padding-right:0">' +
                      '<div style="min-width:0"><div class="nm truncate">' + esc(e.reason || 'Расход') + '</div>' +
                      '<div class="tm">' + fmtDate(e.createdAt) + ', ' + fmtTime(e.createdAt) + ' · ' + esc(e.userName || '') + '</div></div>' +
                      '<div class="flex gap-6"><span class="sum" style="color:var(--danger-600)">−' + fmtMoney(e.amount) + '</span>' +
                        (user.role === 'admin' ? '<button class="icon-btn danger" style="width:26px;height:26px" data-delete-expense="' + e.id + '" title="Удалить">' + icon('trash', 13) + '</button>' : '') +
                      '</div></div>';
                  }).join('');
                })() +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<button type="button" class="fab" id="dashExport" title="Экспорт данных в Excel">' + icon('download', 17) + ' Экспорт' +
          '<span class="kbd">XLSX</span></button>';

      // события
      root.querySelectorAll('[data-period]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          state.period = btn.getAttribute('data-period');
          ctx.rerender();
        });
      });
      bindPeriodToolbar(root, state, function () { ctx.rerender(); });

      var filter = root.querySelector('#pointFilter');
      if (filter) filter.addEventListener('change', function () {
        state.pointId = filter.value;
        if (user.role === 'seller') setActivePoint(user, filter.value);
        ctx.rerender();
      });

      root.querySelectorAll('[data-go-stock]').forEach(function (btn) {
        btn.addEventListener('click', function () { ctx.navigate('stock'); });
      });
      var goCash = root.querySelector('[data-go-cash]');
      if (goCash) goCash.addEventListener('click', function () { ctx.navigate('cash'); });
      var onboardPoints = root.querySelector('#onboardPoints');
      if (onboardPoints) onboardPoints.addEventListener('click', function () { ctx.navigate('points'); });
      root.querySelectorAll('[data-receipt]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var sale = DB.sales.find(function (s) { return s.id === btn.getAttribute('data-receipt'); });
          if (!sale || !sale.receipt) return;
          openImageViewer(sale.receipt, 'Чек об оплате', 'Продажа #' + (sale.code || '') + ' · ' + fmtMoney(sale.total));
        });
      });
      var dashClearStubs = root.querySelector('#dashClearStubs');
      if (dashClearStubs) dashClearStubs.addEventListener('click', function () {
        var stubs = historyStubSummary();
        confirmDialog({
          title: 'Убрать заглушки?',
          message: 'Будет удалено <b>' + fmtNumber(stubs.count) + '</b> сводных записей без состава на <b>' + fmtMoney(stubs.revenue) + '</b>' +
            (stubs.days ? ' за ' + fmtNumber(stubs.days) + ' дн' : '') + '. Обычные продажи и склад не изменятся.',
          confirmText: 'Убрать',
          danger: true
        }).then(function (okay) {
          if (!okay) return;
          var res = clearHistoryStubs(user);
          if (res.error) { toast(res.error, 'error'); return; }
          toast(res.removed ? 'Заглушки убраны: ' + fmtNumber(res.removed) + ' на ' + fmtMoney(res.revenue) : 'Заглушек нет', 'success', 4200);
          ctx.rerender();
        });
      });

      root.querySelectorAll('[data-delete-sale]').forEach(function (btn) {
        btn.addEventListener('click', async function () {
          var id = btn.getAttribute('data-delete-sale');
          var sale = DB.sales.find(function (s) { return s.id === id; });
          if (!sale) return;
          var noItems = !sale.items || !sale.items.length;
          var ok = await confirmDialog({
            title: 'Удалить транзакцию?',
            message: 'Продажа на <b>' + fmtMoney(sale.total) + '</b> от ' + fmtDate(sale.createdAt) + ' будет удалена. ' +
              (noItems ? 'Это сводная запись без состава — склад не меняется.' : 'Остатки товаров восстановлены.'),
            confirmText: 'Удалить',
            danger: true
          });
          if (!ok) return;
          deleteSale(id, !noItems, user);
          toast(noItems ? 'Запись удалена' : 'Транзакция удалена, остатки восстановлены');
          ctx.rerender();
        });
      });
      root.querySelectorAll('[data-delete-expense]').forEach(function (btn) {
        btn.addEventListener('click', async function () {
          var ok = await confirmDialog({ title: 'Удалить расход?', message: 'Запись о расходе будет удалена из статистики.', confirmText: 'Удалить', danger: true });
          if (!ok) return;
          deleteExpense(btn.getAttribute('data-delete-expense'));
          toast('Расход удалён');
          ctx.rerender();
        });
      });
      var addExpense = root.querySelector('#dashAddExpense');
      if (addExpense && typeof window.openExpenseModal === 'function') {
        addExpense.addEventListener('click', function () {
          window.openExpenseModal({ user: user, pointId: state.pointId !== 'all' ? state.pointId : (DB.points[0] && DB.points[0].id), onDone: function () { ctx.rerender(); } });
        });
      }

      // графики
      var chart = root.querySelector('#dashChart');
      if (chart) drawLineChart(chart, chartData(state.period, range.from, range.to, opts));

      var donut = root.querySelector('#payDonut');
      if (donut) {
        drawDonut(donut,
          [{ value: stats.byMethod.cash, color: '#12b76a' }, { value: stats.byMethod.qr, color: '#4f46e5' }, { value: stats.byMethod.mixed, color: '#ee46bc' }],
          'Оборот', fmtCompact(stats.revenue));
      }

      root.querySelector('#dashExport').addEventListener('click', function () { exportDashboard(user, range, opts); });
    }
  };

  function exportDashboard(user, range, opts) {
    var stats = summarize(range.from, range.to, opts);
    var pointTitle = opts.pointId ? pointName(opts.pointId) : 'Все точки';
    var summaryRows = [
      ['Показатель', 'Значение'],
      ['Период', range.label + ': ' + fmtDate(range.from) + ' — ' + fmtDate(range.to)],
      ['Точка продаж', pointTitle],
      ['Выручка, ₸', stats.revenue],
      ['Расходы, ₸', stats.expenses],
      ['Прибыль, ₸', stats.profit],
      ['Количество продаж', stats.salesCount],
      ['Средний чек, ₸', Math.round(stats.avgCheck)],
      ['Продано товаров, шт', stats.itemsSold],
      ['Наличные (только нал.), ₸', stats.byMethod.cash],
      ['Kaspi QR (только QR), ₸', stats.byMethod.qr],
      ['Смешанная оплата, всего, ₸', stats.byMethod.mixed],
      ['— из них наличными, ₸', stats.mixedCash],
      ['— из них Kaspi QR, ₸', stats.mixedQr],
      ['— количество смешанных продаж', stats.mixedCount],
      ['Итого поступило наличными (с учётом смешанных), ₸', stats.cashTotal],
      ['Итого поступило Kaspi QR (с учётом смешанных), ₸', stats.qrTotal],
      ['Поставок на склад', supplySum.count],
      ['Поставлено товаров, шт', supplySum.qty],
      ['Сформировано', fmtDateTime(Date.now())]
    ];

    var txRows = [['№', 'Дата', 'Время', 'Точка', 'Продавец', 'Товары', 'Кол-во, шт', 'Сумма, ₸', 'Оплата', 'Наличные, ₸', 'QR, ₸', 'Чек']];
    stats.sales.slice().sort(function (a, b) { return b.createdAt - a.createdAt; }).forEach(function (s) {
      txRows.push([
        s.code || '',
        fmtDate(s.createdAt),
        fmtTime(s.createdAt),
        s.pointName || pointName(s.pointId),
        s.userName || userName(s.userId),
        (s.items && s.items.length) ? (s.items || []).map(function (it) { return it.name + ' ×' + it.qty; }).join(', ') : (s.imported ? 'Импорт из старой системы' : '—'),
        (s.items || []).reduce(function (n, it) { return n + it.qty; }, 0),
        s.total,
        paymentLabel(s.payment),
        s.cashAmount || 0,
        s.qrAmount || 0,
        s.receipt ? 'Да' : '—'
      ]);
    });

    var productRows = [['Товар', 'Количество, шт', 'Выручка, ₸']];
    topProducts(stats.sales).forEach(function (p) { productRows.push([p.name, p.qty, p.revenue]); });

    var expenseRows = [['Дата', 'Точка', 'Сотрудник', 'Сумма, ₸', 'Причина']];
    stats.expenseList.slice().sort(function (a, b) { return b.createdAt - a.createdAt; }).forEach(function (e) {
      expenseRows.push([fmtDate(e.createdAt) + ' ' + fmtTime(e.createdAt), e.pointName || pointName(e.pointId), e.userName || '', e.amount, e.reason]);
    });

    var supplyRows = [['Дата', '№', 'Точка', 'Позиций', 'Единиц, шт', 'Сотрудник']];
    suppliesBetween(range.from, range.to, opts).slice().sort(function (a, b) { return b.createdAt - a.createdAt; }).forEach(function (sp) {
      supplyRows.push([fmtDate(sp.createdAt) + ' ' + fmtTime(sp.createdAt), sp.code || '', sp.pointName || pointName(sp.pointId),
        (sp.items || []).length, sp.totalQty || 0, sp.userName || '']);
    });

    var sellerMap = {};
    stats.sales.forEach(function (s) {
      if (!sellerMap[s.userId]) sellerMap[s.userId] = { name: s.userName || userName(s.userId), count: 0, total: 0 };
      sellerMap[s.userId].count++;
      sellerMap[s.userId].total += s.total;
    });
    var sellerRows = [['Продавец', 'Продаж', 'Выручка, ₸', 'Средний чек, ₸']];
    Object.keys(sellerMap).forEach(function (id) {
      var s = sellerMap[id];
      sellerRows.push([s.name, s.count, s.total, Math.round(s.total / s.count)]);
    });

    PosXlsx.downloadXlsx('panel_' + dayKey(range.from) + '_' + dayKey(range.to) + '.xlsx', [
      { name: 'Сводка', rows: summaryRows },
      { name: 'Транзакции', rows: txRows },
      { name: 'Товары', rows: productRows },
      { name: 'Расходы', rows: expenseRows },
      { name: 'Поставки', rows: supplyRows },
      { name: 'Сотрудники', rows: sellerRows }
    ]);
    toast('Отчёт выгружен в Excel', 'success');
  }
})();
