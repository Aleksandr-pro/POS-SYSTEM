/* ============================================================
   POS Контроль — аналитика: KPI, графики, топы, отчёты
   ============================================================ */
(function () {
  'use strict';
  var PAGES = window.PAGES = window.PAGES || {};
  var state = { period: 'week', pointId: 'all', date: null, month: null, from: null, to: null };

  function barRows(list, valueKey, nameKey, colorClass) {
    if (!list.length) return '<div class="muted small">Нет данных за период</div>';
    var max = Math.max.apply(null, list.map(function (x) { return x[valueKey] || 0; }));
    return '<div class="bar-list">' + list.map(function (x) {
      var pct = max ? Math.max(2, Math.round((x[valueKey] / max) * 100)) : 0;
      return '<div class="bar-row"><div class="line"><span class="nm" title="' + esc(x[nameKey]) + '">' + esc(x[nameKey]) + '</span>' +
        '<span class="val">' + fmtMoney(x[valueKey]) + '</span></div>' +
        '<div class="bar-track"><div class="bar-fill ' + (colorClass || '') + '" style="width:' + pct + '%"></div></div></div>';
    }).join('') + '</div>';
  }

  function groupExpenses(list) {
    var map = {};
    list.forEach(function (e) {
      var key = e.pruned ? 'Прочее (детали удалены)' : (e.reason || 'Без указания');
      if (!map[key]) map[key] = { name: key, amount: 0, count: 0 };
      map[key].amount += e.amount || 0;
      map[key].count++;
    });
    var arr = Object.keys(map).map(function (k) { return map[k]; });
    arr.sort(function (a, b) { return b.amount - a.amount; });
    return arr;
  }

  function qtyBarRows(list, nameKey, valueKey) {
    if (!list.length) return '<div class="muted small">Поставок за период нет</div>';
    var max = Math.max.apply(null, list.map(function (x) { return x[valueKey] || 0; }));
    return '<div class="bar-list">' + list.map(function (x) {
      var pct = max ? Math.max(2, Math.round((x[valueKey] / max) * 100)) : 0;
      return '<div class="bar-row"><div class="line"><span class="nm" title="' + esc(x[nameKey]) + '">' + esc(x[nameKey]) + '</span>' +
        '<span class="val">' + fmtNumber(x[valueKey]) + ' шт' + (x.cost ? ' · ' + fmtCompact(x.cost) : '') + '</span></div>' +
        '<div class="bar-track"><div class="bar-fill indigo" style="width:' + pct + '%"></div></div></div>';
    }).join('') + '</div>';
  }

  function sellerStats(sales) {
    var map = {};
    sales.forEach(function (s) {
      if (!map[s.userId]) map[s.userId] = { name: s.userName || userName(s.userId), count: 0, total: 0, items: 0 };
      map[s.userId].count++;
      map[s.userId].total += s.total || 0;
      map[s.userId].items += (s.items || []).reduce(function (n, it) { return n + it.qty; }, 0);
    });
    return Object.keys(map).map(function (k) { return map[k]; }).sort(function (a, b) { return b.total - a.total; });
  }

  PAGES.analytics = {
    render: function (root, ctx) {
      var user = ctx.user;
      var isSeller = user.role === 'seller';
      var allowedPoints = isSeller ? userPoints(user) : DB.points;
      if (isSeller) {
        var active = activePointId(user);
        var allowedIds = allowedPoints.map(function (p) { return p.id; });
        if (allowedIds.length && (state.pointId === 'all' || allowedIds.indexOf(state.pointId) === -1)) {
          state.pointId = active || allowedIds[0];
        }
      } else if (state.pointId !== 'all' && !getPoint(state.pointId)) {
        state.pointId = 'all';
      }
      var sel = normalizePeriodSel(state);
      state.date = sel.date; state.month = sel.month; state.from = sel.from; state.to = sel.to;
      var range = resolveRange(sel);
      var opts = { pointId: state.pointId !== 'all' ? state.pointId : null };
      var stats = summarize(range.from, range.to, opts);
      var supplies = suppliesBetween(range.from, range.to, opts);
      var supplySum = supplyTotals(supplies);
      var suppliedTop = topSuppliedProducts(supplies, 8);
      var prev = summarize(range.prevFrom, range.prevTo, opts);
      var margin = stats.revenue ? (stats.profit / stats.revenue) * 100 : 0;
      var points = allowedPoints;
      var top = topProducts(stats.sales);
      var byPoint = salesByPointList(stats.sales);
      var bySeller = sellerStats(stats.sales);
      var expGroups = groupExpenses(stats.expenseList);
      var daysWithSales = {};

      stats.sales.forEach(function (s) { daysWithSales[dayKey(s.createdAt)] = true; });

      function deltaBadge(cur, prevVal, invert) {
        var pct = deltaPct(cur, prevVal);
        if (!isFinite(pct) || Math.abs(pct) < 0.05) return '<span class="delta flat">0%</span>';
        var good = invert ? pct < 0 : pct > 0;
        return '<span class="delta ' + (good ? 'up' : 'down') + '">' + (pct > 0 ? icon('arrowUp', 12) : icon('arrowDown', 12)) +
          Math.abs(pct).toFixed(Math.abs(pct) >= 100 ? 0 : 1) + '%</span>';
      }

      root.innerHTML =
        '<div class="page">' +
          '<div class="page-head">' +
            '<div><h1>Аналитика и отчёты</h1><div class="sub">' + range.sub + ' · ' + (state.pointId === 'all' ? 'все точки' : esc(pointName(state.pointId))) + '</div></div>' +
            '<div class="page-actions">' +
              '<div class="segmented" id="anPeriod">' +
                '<button type="button" data-period="today" class="' + (state.period === 'today' ? 'active' : '') + '">Сегодня</button>' +
                '<button type="button" data-period="week" class="' + (state.period === 'week' ? 'active' : '') + '">Неделя</button>' +
                '<button type="button" data-period="month" class="' + (state.period === 'month' ? 'active' : '') + '">Месяц</button>' +
                '<button type="button" data-period="period" class="' + (state.period === 'period' ? 'active' : '') + '">Период</button>' +
              '</div>' +
              (points.length > 1
                ? '<select class="select" id="anPoint" style="width:auto;height:38px;min-width:150px">' +
                    (isSeller ? '' : '<option value="all">Все точки</option>') +
                    points.map(function (p) { return '<option value="' + p.id + '"' + (state.pointId === p.id ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }).join('') +
                  '</select>'
                : '') +
            '</div>' +
          '</div>' +

          periodToolbarHtml(state) +

          '<div class="grid-4">' +
            '<div class="card stat-card"><div class="stat-top"><div class="stat-icon indigo">' + icon('cash', 20) + '</div>' + deltaBadge(stats.revenue, prev.revenue) + '</div>' +
              '<div><div class="stat-label">Выручка</div><div class="stat-value">' + fmtMoney(stats.revenue) + '</div></div>' +
              '<div class="stat-foot">' + stats.salesCount + ' продаж · ' + fmtNumber(stats.itemsSold) + ' товаров</div></div>' +
            '<div class="card stat-card"><div class="stat-top"><div class="stat-icon red">' + icon('wallet', 20) + '</div>' + deltaBadge(stats.expenses, prev.expenses, true) + '</div>' +
              '<div><div class="stat-label">Расходы</div><div class="stat-value">' + fmtMoney(stats.expenses) + '</div></div>' +
              '<div class="stat-foot">' + expGroups.length + ' ' + plural(expGroups.length, 'статья', 'статьи', 'статей') + ' расходов</div></div>' +
            '<div class="card stat-card"><div class="stat-top"><div class="stat-icon green">' + icon('chart', 20) + '</div>' + deltaBadge(stats.profit, prev.profit) + '</div>' +
              '<div><div class="stat-label">Прибыль</div><div class="stat-value">' + fmtMoney(stats.profit) + '</div></div>' +
              '<div class="stat-foot">маржа ' + Math.round(margin) + '%</div></div>' +
            '<div class="card stat-card"><div class="stat-top"><div class="stat-icon amber">' + icon('receipt', 20) + '</div>' + deltaBadge(stats.avgCheck, prev.avgCheck) + '</div>' +
              '<div><div class="stat-label">Средний чек</div><div class="stat-value">' + fmtMoney(Math.round(stats.avgCheck)) + '</div></div>' +
              '<div class="stat-foot">' + Object.keys(daysWithSales).length + ' ' + plural(Object.keys(daysWithSales).length, 'день', 'дня', 'дней') + ' с продажами</div></div>' +
          '</div>' +

          '<div class="report-grid section-gap">' +
            '<div class="card" style="min-width:0">' +
              '<div class="card-head"><div><h3>Выручка и расходы</h3><div class="sub">' + range.sub + '</div></div>' +
                '<div class="legend"><span><i style="background:' + CHART_COLORS.revenue + '"></i>Выручка</span><span><i style="background:' + CHART_COLORS.expenses + '"></i>Расходы</span></div>' +
              '</div>' +
              '<div class="card-body"><div class="chart-wrap"><canvas id="anChart" class="chart-canvas tall"></canvas></div></div>' +
            '</div>' +
            '<div class="card">' +
              '<div class="card-head"><h3>Структура оплат</h3></div>' +
              '<div class="card-body">' +
                '<div class="donut-wrap" style="flex-direction:column;align-items:center;gap:16px">' +
                  '<canvas id="anDonut" width="176" height="176" style="width:176px;height:176px"></canvas>' +
                  '<div class="donut-legend" style="width:100%">' +
                    '<div class="row"><i style="background:#12b76a"></i><span class="nm">Наличные</span><span class="val">' + fmtMoney(stats.byMethod.cash) + '</span></div>' +
                    '<div class="row"><i style="background:#4f46e5"></i><span class="nm">Kaspi QR</span><span class="val">' + fmtMoney(stats.byMethod.qr) + '</span></div>' +
                    '<div class="row"><i style="background:#ee46bc"></i><span class="nm">Смешанный</span><span class="val">' + fmtMoney(stats.byMethod.mixed) + '</span></div>' +
                    (stats.mixedTotal
                      ? '<div class="row sub"><span class="nm" style="padding-left:16px">· наличными</span><span class="val">' + fmtMoney(stats.mixedCash) + '</span></div>' +
                        '<div class="row sub"><span class="nm" style="padding-left:16px">· Kaspi QR</span><span class="val">' + fmtMoney(stats.mixedQr) + '</span></div>' +
                        '<div class="row sub tiny muted"><span class="nm" style="padding-left:16px">смешанных продаж</span><span class="val">' + stats.mixedCount + '</span></div>'
                      : '') +
                  '</div>' +
                  '<div class="pay-total-box">' +
                    '<div class="row"><span class="nm">Итого наличными</span><span class="val">' + fmtMoney(stats.cashTotal) + '</span></div>' +
                    '<div class="row"><span class="nm">Итого Kaspi QR</span><span class="val">' + fmtMoney(stats.qrTotal) + '</span></div>' +
                    '<div class="row total"><span class="nm">Всего выручка</span><span class="val">' + fmtMoney(stats.revenue) + '</span></div>' +
                  '</div>' +
                '</div>' +
                '<div class="divider"></div>' +
                '<div class="kpi-inline">' +
                  '<div class="kpi-mini"><div class="l">Маржинальность</div><div class="v">' + Math.round(margin) + '%</div></div>' +
                  '<div class="kpi-mini"><div class="l">Прибыль в день</div><div class="v">' + fmtCompact(stats.profit / (range.days || 1)) + '</div></div>' +
                '</div>' +
              '</div>' +
            '</div>' +
          '</div>' +

          '<div class="report-grid section-gap">' +
            '<div class="card" style="min-width:0">' +
              '<div class="card-head"><div><h3>Топ товаров</h3><div class="sub">По выручке за период</div></div><span class="badge neutral">' + top.length + ' позиций</span></div>' +
              '<div class="card-body" style="padding-top:10px">' +
                (top.length
                  ? '<div class="table-wrap"><table class="tbl"><thead><tr><th style="width:34px">#</th><th>Товар</th><th>Кол-во</th><th>Выручка</th><th class="hide-sm" style="width:120px">Доля</th></tr></thead><tbody>' +
                      top.slice(0, 10).map(function (p, i) {
                        var share = stats.revenue ? (p.revenue / stats.revenue) * 100 : 0;
                        return '<tr><td><span class="idx badge neutral">' + (i + 1) + '</span></td>' +
                          '<td><div class="cell-main truncate" style="max-width:260px">' + esc(p.name) + '</div></td>' +
                          '<td><span class="badge neutral">' + p.qty + ' шт</span></td>' +
                          '<td><b class="money">' + fmtMoney(p.revenue) + '</b></td>' +
                          '<td class="hide-sm"><div class="flex gap-8"><div class="bar-track grow"><div class="bar-fill" style="width:' + Math.max(2, Math.round(share)) + '%"></div></div><span class="tiny muted">' + Math.round(share) + '%</span></div></td></tr>';
                      }).join('') + '</tbody></table></div>'
                  : '<div class="tbl-empty">Продаж за период пока нет</div>') +
              '</div>' +
            '</div>' +
            '<div class="card">' +
              '<div class="card-head"><h3>Продажи по точкам</h3></div>' +
              '<div class="card-body">' + barRows(byPoint, 'revenue', 'name', 'green') + '</div>' +
            '</div>' +
          '</div>' +

          '<div class="report-grid section-gap">' +
            '<div class="card">' +
              '<div class="card-head"><div><h3>Расходы по статьям</h3><div class="sub">Всего ' + fmtMoney(stats.expenses) + '</div></div></div>' +
              '<div class="card-body">' + barRows(expGroups, 'amount', 'name', 'red') + '</div>' +
            '</div>' +
            '<div class="card" style="min-width:0">' +
              '<div class="card-head"><h3>Сотрудники</h3></div>' +
              '<div class="card-body" style="padding-top:10px">' +
                (bySeller.length
                  ? '<div class="table-wrap"><table class="tbl"><thead><tr><th>Продавец</th><th>Продаж</th><th>Выручка</th><th class="text-right">Ср. чек</th></tr></thead><tbody>' +
                    bySeller.map(function (s) {
                      return '<tr><td><div class="user-cell">' + avatarHtml(s.name, 'avatar-sm') + '<span class="nm truncate">' + esc(s.name) + '</span></div></td>' +
                        '<td><span class="badge neutral">' + s.count + '</span></td>' +
                        '<td><b class="money">' + fmtMoney(s.total) + '</b></td>' +
                        '<td class="text-right money">' + fmtMoney(Math.round(s.total / s.count)) + '</td></tr>';
                    }).join('') + '</tbody></table></div>'
                  : '<div class="tbl-empty">Нет данных</div>') +
              '</div>' +
            '</div>' +
          '</div>' +

          '<div class="report-grid section-gap">' +
            '<div class="card">' +
              '<div class="card-head"><div><h3>Поступления на склад</h3><div class="sub">' + range.sub + '</div></div>' +
                '<span class="badge neutral">' + supplySum.count + ' ' + plural(supplySum.count, 'поставка', 'поставки', 'поставок') + '</span></div>' +
              '<div class="card-body">' +
                '<div class="kpi-inline" style="margin-bottom:16px">' +
                  '<div class="kpi-mini"><div class="l">Поступило единиц</div><div class="v">' + fmtNumber(supplySum.qty) + ' шт</div></div>' +
                  '<div class="kpi-mini"><div class="l">Позиций в поставках</div><div class="v">' + fmtNumber(supplySum.positions || 0) + '</div></div>' +
                '</div>' +
                qtyBarRows(suppliedTop, 'name', 'qty') +
              '</div>' +
            '</div>' +
            '<div class="card" style="min-width:0">' +
              '<div class="card-head"><h3>Последние поставки</h3></div>' +
              '<div class="card-body" style="padding-top:10px">' +
                (supplies.length
                  ? '<div class="table-wrap"><table class="tbl"><thead><tr><th>Дата</th><th class="hide-sm">Точка</th><th>Позиций</th><th class="text-right">Единиц</th></tr></thead><tbody>' +
                      supplies.slice().sort(function (a, b) { return b.createdAt - a.createdAt; }).slice(0, 6).map(function (sp) {
                        return '<tr><td><div class="cell-main nowrap">' + fmtDate(sp.createdAt) + '</div><div class="cell-sub nowrap">' + (sp.code || '') + '</div></td>' +
                          '<td class="hide-sm"><span class="cell-sub truncate" style="max-width:140px;display:block">' + esc(sp.pointName || pointName(sp.pointId)) + '</span></td>' +
                          '<td><span class="badge neutral">' + (sp.items || []).length + '</span></td>' +
                          '<td class="text-right"><span class="badge neutral">' + (sp.totalQty || 0) + ' шт</span></td></tr>';
                      }).join('') + '</tbody></table></div>'
                  : '<div class="tbl-empty">За выбранный период поставок не было</div>') +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<button type="button" class="fab" id="anExport">' + icon('download', 17) + ' Экспорт в Excel' +
          '<span class="kbd">XLSX</span></button>';

      root.querySelectorAll('[data-period]').forEach(function (btn) {
        btn.addEventListener('click', function () { state.period = btn.getAttribute('data-period'); ctx.rerender(); });
      });
      bindPeriodToolbar(root, state, function () { ctx.rerender(); });
      var pSelect = root.querySelector('#anPoint');
      if (pSelect) pSelect.addEventListener('change', function () {
        state.pointId = pSelect.value;
        if (isSeller) setActivePoint(user, pSelect.value);
        ctx.rerender();
      });

      var chart = root.querySelector('#anChart');
      if (chart) drawLineChart(chart, chartData(state.period, range.from, range.to, opts));
      var donut = root.querySelector('#anDonut');
      if (donut) {
        drawDonut(donut,
          [{ value: stats.byMethod.cash, color: '#12b76a' }, { value: stats.byMethod.qr, color: '#4f46e5' }, { value: stats.byMethod.mixed, color: '#ee46bc' }],
          'Оборот', fmtCompact(stats.revenue));
      }

      root.querySelector('#anExport').addEventListener('click', function () {
        var summary = [
          ['Показатель', 'Значение'],
          ['Период', range.label + ': ' + fmtDate(range.from) + ' — ' + fmtDate(range.to)],
          ['Точка', state.pointId === 'all' ? 'Все точки' : pointName(state.pointId)],
          ['Выручка, ₸', stats.revenue],
          ['Расходы, ₸', stats.expenses],
          ['Прибыль, ₸', stats.profit],
          ['Маржинальность, %', Math.round(margin)],
          ['Продаж', stats.salesCount],
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
          ['Поставлено единиц, шт', supplySum.qty],
          ['Сформировано', fmtDateTime(Date.now())]
        ];
        var tx = [['№', 'Дата', 'Время', 'Точка', 'Продавец', 'Товары', 'Кол-во', 'Сумма, ₸', 'Оплата', 'Наличными, ₸', 'Kaspi QR, ₸']];
        stats.sales.forEach(function (s) {
          var cash = s.payment === 'cash' ? s.total : (s.payment === 'mixed' ? (s.cashAmount || 0) : 0);
          var qr = s.payment === 'qr' ? s.total : (s.payment === 'mixed' ? (s.qrAmount || 0) : 0);
          tx.push([s.code || '', fmtDate(s.createdAt), fmtTime(s.createdAt), s.pointName || pointName(s.pointId), s.userName,
            (s.items && s.items.length) ? (s.items || []).map(function (i) { return i.name + ' ×' + i.qty; }).join(', ') : (s.imported ? 'Импорт' : '—'),
            (s.items || []).reduce(function (n, i) { return n + i.qty; }, 0), s.total, paymentLabel(s.payment), cash, qr]);
        });
        var products = [['Товар', 'Кол-во', 'Выручка, ₸', 'Доля, %']];
        top.forEach(function (p) {
          products.push([p.name, p.qty, p.revenue, stats.revenue ? Math.round((p.revenue / stats.revenue) * 1000) / 10 : 0]);
        });
        var exp = [['Дата', 'Статья', 'Точка', 'Сотрудник', 'Сумма, ₸']];
        stats.expenseList.forEach(function (e) {
          exp.push([fmtDate(e.createdAt), e.reason, e.pointName || pointName(e.pointId), e.userName, e.amount]);
        });
        var pts = [['Точка', 'Продаж', 'Выручка, ₸']];
        byPoint.forEach(function (p) { pts.push([p.name, p.count, p.revenue]); });
        var sup = [['Дата', '№', 'Точка', 'Товары', 'Единиц, шт', 'Сотрудник']];
        supplies.slice().sort(function (a, b) { return b.createdAt - a.createdAt; }).forEach(function (sp) {
          sup.push([fmtDate(sp.createdAt) + ' ' + fmtTime(sp.createdAt), sp.code || '', sp.pointName || pointName(sp.pointId),
            (sp.items || []).map(function (i) { return i.name + ' ×' + i.qty; }).join(', '),
            sp.totalQty || 0, sp.userName || '']);
        });

        var sellers = [['Сотрудник', 'Продаж', 'Выручка, ₸', 'Средний чек, ₸', 'Товаров, шт']];
        bySeller.forEach(function (s) { sellers.push([s.name, s.count, s.total, Math.round(s.total / s.count), s.items]); });

        PosXlsx.downloadXlsx('analitika_' + dayKey(range.from) + '_' + dayKey(range.to) + '.xlsx', [
          { name: 'Сводка', rows: summary },
          { name: 'Транзакции', rows: tx },
          { name: 'Товары', rows: products },
          { name: 'Точки', rows: pts },
          { name: 'Сотрудники', rows: sellers },
          { name: 'Расходы', rows: exp },
          { name: 'Поставки', rows: sup }
        ]);
        toast('Аналитический отчёт выгружен', 'success');
      });
    }
  };
})();
