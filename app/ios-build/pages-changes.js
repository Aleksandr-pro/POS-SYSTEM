/* ============================================================
   POS Контроль — журнал изменений продаж (правки и отмены)
   ============================================================ */
(function () {
  'use strict';
  var PAGES = window.PAGES = window.PAGES || {};
  var state = { period: 'week', type: 'all', pointId: 'all' };

  function typeLabel(type) {
    if (type === 'cancel') return 'Отмена';
    return 'Правка';
  }

  function typeBadge(type) {
    return type === 'cancel'
      ? '<span class="badge" style="background:var(--danger-soft);color:var(--danger-600)">' + icon('x', 12) + ' Отмена</span>'
      : '<span class="badge" style="background:var(--primary-soft);color:var(--primary-600)">' + icon('edit', 12) + ' Правка</span>';
  }

  function payText(snap) {
    if (!snap) return '—';
    if (snap.payment === 'mixed') {
      return 'Смешанный · нал ' + fmtMoney(snap.cashAmount) + ' / QR ' + fmtMoney(snap.qrAmount);
    }
    return paymentLabel(snap.payment) + (snap.payment === 'qr' ? ' · ' + fmtMoney(snap.total) : ' · ' + fmtMoney(snap.total));
  }

  function receiptText(snap) {
    if (!snap) return '—';
    return snap.hasReceipt ? '<span class="badge success">есть</span>' : '<span class="badge neutral">нет</span>';
  }

  function rangeFor(period) {
    var now = Date.now();
    var today = startOfDay(new Date());
    if (period === 'today') return { from: today, to: now };
    if (period === 'week') return { from: startOfDay(addDays(new Date(), -6)), to: now };
    if (period === 'month') return { from: startOfDay(addDays(new Date(), -29)), to: now };
    return { from: 0, to: now };
  }

  PAGES.changes = {
    render: function (root, ctx) {
      var user = ctx.user;
      var range = rangeFor(state.period);

      var all = (DB.saleChanges || []).slice().sort(function (a, b) { return b.at - a.at; });
      var list = all.filter(function (c) {
        if (c.at < range.from || c.at > range.to) return false;
        if (state.type !== 'all' && c.type !== state.type) return false;
        if (state.pointId !== 'all' && c.pointId !== state.pointId) return false;
        return true;
      });

      var edits = list.filter(function (c) { return c.type === 'edit'; }).length;
      var cancels = list.filter(function (c) { return c.type === 'cancel'; }).length;

      var rowsHtml = list.map(function (c) {
        var before = c.before || null;
        var after = c.after || null;
        var items = (c.items || []).map(function (i) { return esc(i.name) + ' ×' + i.qty; }).join(', ') || '—';
        return '<tr data-change-row data-name="' + esc((c.saleCode + ' ' + c.userName + ' ' + items).toLowerCase()) + '">' +
          '<td><div class="cell-main nowrap">' + fmtDate(c.at) + '</div><div class="cell-sub nowrap">' + fmtTime(c.at) + '</div></td>' +
          '<td>' + typeBadge(c.type) + '</td>' +
          '<td><div class="cell-main nowrap">#' + esc(c.saleCode || '') + '</div>' +
            '<div class="cell-sub nowrap">продажа ' + fmtDate(c.saleAt || c.at) + ' ' + fmtTime(c.saleAt || c.at) + '</div></td>' +
          '<td><span class="cell-main">' + esc(c.userName || '—') + '</span>' +
            '<div class="cell-sub">' + esc(c.pointName || pointName(c.pointId)) + '</div></td>' +
          '<td style="max-width:230px"><span class="muted small">' + items + '</span></td>' +
          '<td><div class="cell-sub nowrap">было: ' + payText(before) + '</div>' +
            '<div class="cell-sub nowrap">чек: ' + receiptText(before) + '</div></td>' +
          '<td>' + (after
            ? '<div class="cell-main nowrap">стало: ' + payText(after) + '</div><div class="cell-sub nowrap">чек: ' + receiptText(after) + '</div>'
            : '<div class="cell-main" style="color:var(--danger-600)">отменена</div>' +
              '<div class="cell-sub">' + ((c.restored || []).length ? 'возврат: ' + (c.restored || []).map(function (r) { return esc(r.name) + ' ×' + r.qty; }).join(', ') : '') + '</div>') + '</td>' +
          '</tr>';
      }).join('');

      var pointOptions = DB.points.map(function (p) {
        return '<option value="' + p.id + '"' + (state.pointId === p.id ? ' selected' : '') + '>' + esc(p.name) + '</option>';
      }).join('');

      root.innerHTML =
        '<div class="page">' +
          '<div class="page-head">' +
            '<div><h1>Изменения</h1><div class="sub">Правки и отмены продаж — кто, когда и что изменил</div></div>' +
            '<div class="page-actions">' +
              '<div class="segmented">' +
                '<button type="button" data-period="today" class="' + (state.period === 'today' ? 'active' : '') + '">Сегодня</button>' +
                '<button type="button" data-period="week" class="' + (state.period === 'week' ? 'active' : '') + '">7 дней</button>' +
                '<button type="button" data-period="month" class="' + (state.period === 'month' ? 'active' : '') + '">30 дней</button>' +
                '<button type="button" data-period="all" class="' + (state.period === 'all' ? 'active' : '') + '">Всё время</button>' +
              '</div>' +
            '</div>' +
          '</div>' +

          '<div class="kpi-inline" style="margin-bottom:16px">' +
            '<div class="kpi-mini"><div class="l">Всего изменений</div><div class="v">' + list.length + '</div></div>' +
            '<div class="kpi-mini"><div class="l">Правок</div><div class="v">' + edits + '</div></div>' +
            '<div class="kpi-mini"><div class="l">Отмен продаж</div><div class="v" style="color:var(--danger-600)">' + cancels + '</div></div>' +
            '<div class="kpi-mini"><div class="l">Сумма отменённых</div><div class="v">' + fmtMoney(list.filter(function (c) { return c.type === 'cancel' && c.before; }).reduce(function (s, c) { return s + (c.before.total || 0); }, 0)) + '</div></div>' +
          '</div>' +

          '<div class="card">' +
            '<div class="card-head" style="padding-bottom:14px">' +
              '<div><h3>Журнал изменений</h3><div class="sub">' + (list.length ? list.length + ' ' + plural(list.length, 'запись', 'записи', 'записей') : 'пока пусто') + '</div></div>' +
              '<div class="flex gap-8 wrap">' +
                '<select class="select" id="chType" style="width:auto;height:36px">' +
                  '<option value="all"' + (state.type === 'all' ? ' selected' : '') + '>Все типы</option>' +
                  '<option value="edit"' + (state.type === 'edit' ? ' selected' : '') + '>Только правки</option>' +
                  '<option value="cancel"' + (state.type === 'cancel' ? ' selected' : '') + '>Только отмены</option>' +
                '</select>' +
                '<select class="select" id="chPoint" style="width:auto;height:36px">' +
                  '<option value="all"' + (state.pointId === 'all' ? ' selected' : '') + '>Все точки</option>' + pointOptions +
                '</select>' +
                '<div class="input-icon" style="width:180px">' + icon('search', 15) +
                  '<input class="input" id="chSearch" style="height:36px" placeholder="Найти…"></div>' +
              '</div>' +
            '</div>' +
            '<div class="card-body" style="padding-top:0">' +
              (list.length
                ? '<div class="table-wrap"><table class="tbl"><thead><tr>' +
                    '<th>Когда</th><th>Тип</th><th>Продажа</th><th>Кто · точка</th><th>Товары</th><th>Было</th><th>Стало</th>' +
                  '</tr></thead><tbody>' + rowsHtml + '</tbody></table></div>'
                : '<div class="tbl-empty">' + (all.length ? 'За выбранный период изменений нет' : 'Продажи ещё не правили и не отменяли') + '</div>') +
            '</div>' +
          '</div>' +

          '<div class="form-note info" style="margin-top:14px">' + icon('info', 15) +
            '<span>Продавец может изменить оплату, чек и отменить продажу <b>только в течение 2 суток</b> и только на своей точке. Каждое действие фиксируется здесь: кто, когда, что было и что стало.</span>' +
          '</div>' +
        '</div>';

      root.querySelectorAll('[data-period]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          state.period = btn.getAttribute('data-period');
          ctx.rerender();
        });
      });
      root.querySelector('#chType').addEventListener('change', function (e) { state.type = e.target.value; ctx.rerender(); });
      root.querySelector('#chPoint').addEventListener('change', function (e) { state.pointId = e.target.value; ctx.rerender(); });
      var search = root.querySelector('#chSearch');
      search.addEventListener('input', function () {
        var q = search.value.trim().toLowerCase();
        root.querySelectorAll('[data-change-row]').forEach(function (tr) {
          tr.style.display = tr.getAttribute('data-name').indexOf(q) === -1 ? 'none' : '';
        });
      });
    }
  };
})();
