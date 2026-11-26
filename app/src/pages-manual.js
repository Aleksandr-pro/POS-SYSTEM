/* ============================================================
   POS Контроль — ручные продажи: любая дата и время (владелец, разработчик)
   ============================================================ */
(function () {
  'use strict';
  var PAGES = window.PAGES = window.PAGES || {};

  var state = { period: 'month', pointId: 'all' };

  function rangeFor(period) {
    var now = Date.now();
    if (period === 'today') return { from: startOfDay(new Date()), to: now };
    if (period === 'week') return { from: startOfDay(addDays(new Date(), -6)), to: now };
    if (period === 'month') return { from: startOfDay(addDays(new Date(), -29)), to: now };
    if (period === 'quarter') return { from: startOfDay(addDays(new Date(), -89)), to: now };
    return { from: 0, to: now };
  }

  function periodCovering(at) {
    var now = Date.now();
    if (at >= startOfDay(new Date())) return 'today';
    if (at >= startOfDay(addDays(new Date(), -6))) return 'week';
    if (at >= startOfDay(addDays(new Date(), -29))) return 'month';
    if (at >= startOfDay(addDays(new Date(), -89))) return 'quarter';
    return 'all';
  }

  function sellersFor(pointId) {
    return DB.users.filter(function (u) {
      if (u.role !== 'seller') return false;
      var ids = Array.isArray(u.pointIds) ? u.pointIds : (u.pointId ? [u.pointId] : []);
      return ids.indexOf(pointId) !== -1;
    });
  }

  function sellerOptions(pointId, currentUserId) {
    var me = getUser(currentUserId);
    var list = sellersFor(pointId);
    var html = '<option value="">' + esc(me ? 'Я — ' + me.fullName : 'Не указывать') + '</option>';
    list.forEach(function (u) {
      html += '<option value="' + u.id + '">' + esc(u.fullName) + '</option>';
    });
    return html;
  }

  /* ---------- форма добавления ---------- */
  function openManualSaleModal(ctx, opts) {
    opts = opts || {};
    var user = ctx.user;
    if (!DB.points.length) {
      toast('Сначала создайте точку продаж', 'error');
      return;
    }

    var pointId = opts.pointId || (state.pointId !== 'all' ? state.pointId : (DB.points[0] && DB.points[0].id));
    var cart = [];
    var payment = 'cash';
    var defaultDate = opts.date || dayKey(new Date());
    var defaultTime = opts.time || fmtTime(Date.now());

    function productsOf(pid) {
      return productsForPoint(pid);
    }

    function productOptions(pid) {
      var list = productsOf(pid);
      if (!list.length) return '<option value="">Нет товаров на точке</option>';
      return list.map(function (p) {
        return '<option value="' + p.id + '">' + esc(p.name) + ' · ' + fmtMoney(p.price) + '</option>';
      }).join('');
    }

    var pointsOptions = DB.points.map(function (p) {
      return '<option value="' + p.id + '"' + (p.id === pointId ? ' selected' : '') + '>' + esc(p.name) + '</option>';
    }).join('');

    var modal = openModal({
      title: 'Добавить продажу',
      subtitle: 'Любая дата — продажа попадёт в статистику, аналитику и отчёт по складу',
      size: 'lg',
      body:
        '<form id="msForm" style="display:flex;flex-direction:column;gap:14px">' +
          '<div class="form-grid">' +
            '<div class="field"><label for="msPoint">Точка продаж</label>' +
              '<select class="select" id="msPoint">' + pointsOptions + '</select></div>' +
            '<div class="field"><label for="msSeller">Кто оформил</label>' +
              '<select class="select" id="msSeller">' + sellerOptions(pointId, user.id) + '</select></div>' +
            '<div class="field"><label for="msDate">Дата продажи</label>' +
              '<input class="input" type="date" id="msDate" max="' + dayKey(new Date()) + '" value="' + defaultDate + '"></div>' +
            '<div class="field"><label for="msTime">Время</label>' +
              '<input class="input" type="time" id="msTime" value="' + defaultTime + '"></div>' +
          '</div>' +

          '<div class="field" style="margin:0"><label>Товары</label>' +
            '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">' +
              '<select class="select" id="msProduct" style="flex:1 1 220px;min-width:170px">' + productOptions(pointId) + '</select>' +
              '<input class="input" type="number" id="msQty" min="1" step="1" value="1" style="width:76px" title="Количество">' +
              '<input class="input" type="number" id="msPrice" min="0" step="1" style="width:110px" title="Цена за штуку" placeholder="Цена">' +
              '<button type="button" class="btn btn-secondary" id="msAdd">' + icon('plus', 15) + ' Добавить</button>' +
            '</div>' +
            '<div id="msCart" style="margin-top:10px"></div>' +
          '</div>' +

          '<div class="field" style="margin:0"><label>Оплата</label>' +
            '<div class="segmented pay-seg" id="msPay">' +
              '<button type="button" data-pay="cash" class="active">Наличные</button>' +
              '<button type="button" data-pay="qr">Kaspi QR</button>' +
              '<button type="button" data-pay="mixed">Смешанный</button>' +
            '</div>' +
          '</div>' +

          '<div class="form-grid" id="msMixed" style="display:none">' +
            '<div class="field"><label for="msCash">Наличными, ' + APP_CONFIG.currency + '</label>' +
              '<input class="input" id="msCash" inputmode="numeric" placeholder="0"></div>' +
            '<div class="field"><label for="msQr">Kaspi QR, ' + APP_CONFIG.currency + '</label>' +
              '<input class="input" id="msQr" inputmode="numeric" placeholder="0"></div>' +
          '</div>' +

          '<div class="field" style="margin:0"><label for="msNote">Комментарий (необязательно)</label>' +
            '<input class="input" id="msNote" placeholder="Например: продажа за 15 октября, чек потерян"></div>' +

          '<div id="msStockBox">' +
            '<label class="check"><input type="checkbox" id="msDeduct" checked>' +
              '<span id="msDeductText">Списать товары со склада (только для сегодняшней даты).</span></label>' +
          '</div>' +

          '<div class="form-note info" style="margin:0" id="msHint">' + icon('info', 15) +
            '<span id="msHintText">Продажа за прошлую дату попадёт в отчёт склада за эту дату (колонка «Продано»), но не изменит остатки и отчёты за следующие дни.</span></div>' +
        '</form>',
      footer:
        '<button type="button" class="btn btn-secondary" data-cancel>Отмена</button>' +
        '<button type="button" class="btn btn-primary" id="msSave">' + icon('check', 16) + ' Добавить продажу</button>',
      onMount: function (el, close) {
        var pointEl = el.querySelector('#msPoint');
        var sellerEl = el.querySelector('#msSeller');
        var productEl = el.querySelector('#msProduct');
        var qtyEl = el.querySelector('#msQty');
        var priceEl = el.querySelector('#msPrice');
        var cartEl = el.querySelector('#msCart');
        var mixedBox = el.querySelector('#msMixed');
        var cashEl = el.querySelector('#msCash');
        var qrEl = el.querySelector('#msQr');

        function cartTotal() {
          return cart.reduce(function (s, it) { return s + it.price * it.qty; }, 0);
        }

        function syncPrice() {
          var p = getProduct(productEl.value);
          priceEl.value = p ? p.price : '';
        }

        function renderCart() {
          if (!cart.length) {
            cartEl.innerHTML = '<div class="muted small" style="padding:6px 0">Пока пусто — выберите товар и нажмите «Добавить»</div>';
          } else {
            cartEl.innerHTML = '<div class="table-wrap"><table class="tbl"><thead><tr>' +
              '<th>Товар</th><th style="width:84px">Кол-во</th><th style="width:110px">Цена</th>' +
              '<th class="text-right">Сумма</th><th style="width:44px"></th></tr></thead><tbody>' +
              cart.map(function (it, i) {
                return '<tr>' +
                  '<td><span class="cell-main">' + esc(it.name) + '</span></td>' +
                  '<td><input class="input" style="width:70px;height:34px" type="number" min="1" step="1" value="' + it.qty + '" data-qty="' + i + '"></td>' +
                  '<td><input class="input" style="width:96px;height:34px" type="number" min="0" step="1" value="' + it.price + '" data-price="' + i + '"></td>' +
                  '<td class="text-right"><span class="cell-main money">' + fmtMoney(it.price * it.qty) + '</span></td>' +
                  '<td><button type="button" class="icon-btn danger" data-remove="' + i + '" title="Убрать">' + icon('trash', 15) + '</button></td>' +
                '</tr>';
              }).join('') + '</tbody></table></div>' +
              '<div class="flex between" style="padding:8px 2px 0;font-weight:700">' +
                '<span>Итого</span><span>' + fmtMoney(cartTotal()) + '</span></div>';
          }
          cartEl.querySelectorAll('[data-qty]').forEach(function (inp) {
            inp.addEventListener('change', function () {
              var i = Number(inp.getAttribute('data-qty'));
              cart[i].qty = Math.max(1, Math.round(Number(inp.value) || 1));
              renderCart();
            });
          });
          cartEl.querySelectorAll('[data-price]').forEach(function (inp) {
            inp.addEventListener('change', function () {
              var i = Number(inp.getAttribute('data-price'));
              cart[i].price = Math.max(0, Math.round(Number(inp.value) || 0));
              renderCart();
            });
          });
          cartEl.querySelectorAll('[data-remove]').forEach(function (btn) {
            btn.addEventListener('click', function () {
              cart.splice(Number(btn.getAttribute('data-remove')), 1);
              renderCart();
            });
          });
          syncMixedHint();
        }

        function syncMixedHint() {
          var total = cartTotal();
          if (payment !== 'mixed') return;
          if (!cashEl.value) {
            qrEl.value = total ? String(total) : '';
          }
        }

        function rebuildProducts() {
          productEl.innerHTML = productOptions(pointEl.value);
          syncPrice();
          sellerEl.innerHTML = sellerOptions(pointEl.value, user.id);
        }

        productEl.addEventListener('change', syncPrice);
        pointEl.addEventListener('change', function () {
          rebuildProducts();
          cart = [];
          renderCart();
        });

        el.querySelector('#msAdd').addEventListener('click', function () {
          var product = getProduct(productEl.value);
          if (!product) { toast('Выберите товар', 'error'); return; }
          var qty = Math.max(1, Math.round(Number(qtyEl.value) || 1));
          var price = priceEl.value === '' ? product.price : Math.max(0, Math.round(Number(priceEl.value) || 0));
          if (price <= 0) { toast('Укажите цену больше нуля', 'error'); priceEl.focus(); return; }
          var existing = cart.filter(function (it) { return it.productId === product.id; })[0];
          if (existing) {
            existing.qty += qty;
            existing.price = price;
          } else {
            cart.push({ productId: product.id, name: product.name, price: price, qty: qty });
          }
          qtyEl.value = '1';
          renderCart();
        });

        el.querySelectorAll('#msPay [data-pay]').forEach(function (btn) {
          btn.addEventListener('click', function () {
            payment = btn.getAttribute('data-pay');
            el.querySelectorAll('#msPay [data-pay]').forEach(function (b) { b.classList.toggle('active', b === btn); });
            mixedBox.style.display = payment === 'mixed' ? '' : 'none';
            if (payment === 'mixed') syncMixedHint();
          });
        });

        cashEl.addEventListener('input', function () {
          var cash = Math.max(0, Math.round(Number(cashEl.value) || 0));
          var total = cartTotal();
          if (cash > total) cash = total;
          qrEl.value = String(Math.max(0, total - cash));
        });

        var deductEl = el.querySelector('#msDeduct');
        var dateEl = el.querySelector('#msDate');
        var hintText = el.querySelector('#msHintText');

        var lastToday = null;
        function syncDeductState() {
          var at = parseSaleMoment(dateEl.value, el.querySelector('#msTime').value || '00:00');
          var isToday = !!at && at >= startOfDay(new Date());
          deductEl.disabled = !isToday;
          if (!isToday) deductEl.checked = false;
          else if (lastToday === false) deductEl.checked = true;   // вернулись к сегодняшней дате
          lastToday = isToday;
          hintText.innerHTML = isToday
            ? 'Продажа за сегодня: если оставить галочку, товары спишутся со склада, как при обычной продаже.'
            : 'Продажа за прошлую дату попадёт в отчёт склада за эту дату (колонка «Продано»), но <b>не изменит остатки</b> и отчёты за следующие дни.';
        }
        dateEl.addEventListener('change', syncDeductState);
        el.querySelector('#msTime').addEventListener('change', syncDeductState);
        syncDeductState();

        el.querySelector('[data-cancel]').addEventListener('click', close);
        el.querySelector('#msSave').addEventListener('click', function () {
          if (!cart.length) { toast('Добавьте хотя бы один товар', 'error'); return; }
          var at = parseSaleMoment(el.querySelector('#msDate').value, el.querySelector('#msTime').value);
          if (!at) { toast('Проверьте дату и время', 'error'); return; }
          if (at > Date.now() + 60000) { toast('Дата продажи не может быть в будущем', 'error'); return; }

          var cashAmount = 0, qrAmount = 0;
          if (payment === 'mixed') {
            cashAmount = Math.max(0, Math.round(Number(cashEl.value) || 0));
            qrAmount = Math.max(0, Math.round(Number(qrEl.value) || 0));
          }

          var res = createManualSale({
            pointId: pointEl.value,
            at: at,
            items: cart,
            payment: payment,
            cashAmount: cashAmount,
            qrAmount: qrAmount,
            sellerId: sellerEl.value || null,
            note: el.querySelector('#msNote').value,
            deductStock: el.querySelector('#msDeduct').checked
          }, user);

          if (res.error) { toast(res.error, 'error', 4600); return; }

          state.pointId = res.sale.pointId;
          state.period = periodCovering(at);
          close();
          toast('Продажа на ' + fmtMoney(res.total) + ' добавлена за ' + fmtDate(at) + ' ' + fmtTime(at), 'success', 4200);
          ctx.rerender();
        });
      }
    });
    return modal;
  }

  PAGES.manual = {
    render: function (root, ctx) {
      var user = ctx.user;
      if (!canManageManualSales(user)) {
        root.innerHTML = '<div class="page">' + emptyState('lock', 'Раздел недоступен', 'Добавлять продажи вручную может владелец или разработчик.', '') + '</div>';
        return;
      }

      var range = rangeFor(state.period);
      var all = manualSales();
      var list = all.filter(function (s) {
        if (s.createdAt < range.from || s.createdAt > range.to) return false;
        if (state.pointId !== 'all' && s.pointId !== state.pointId) return false;
        return true;
      }).sort(function (a, b) { return b.createdAt - a.createdAt; });

      var sum = list.reduce(function (n, s) { return n + (s.total || 0); }, 0);
      var deducted = list.filter(function (s) { return s.stockDeducted; }).length;

      var pointOptions = DB.points.map(function (p) {
        return '<option value="' + p.id + '"' + (state.pointId === p.id ? ' selected' : '') + '>' + esc(p.name) + '</option>';
      }).join('');

      var rows = list.map(function (s) {
        var itemsText = (s.items || []).map(function (it) { return it.name + ' ×' + it.qty; }).join(', ') || '—';
        var pay = s.payment === 'mixed'
          ? badge(paymentLabel('mixed'), paymentBadgeClass('mixed')) + '<div class="cell-sub nowrap">нал ' + fmtCompact(s.cashAmount || 0) + ' · QR ' + fmtCompact(s.qrAmount || 0) + '</div>'
          : badge(paymentLabel(s.payment), paymentBadgeClass(s.payment));
        return '<tr data-manual-row>' +
          '<td><div class="cell-main nowrap">' + fmtDate(s.createdAt) + '</div><div class="cell-sub nowrap">' + fmtTime(s.createdAt) + '</div></td>' +
          '<td><span class="cell-main">' + esc(s.pointName || pointName(s.pointId)) + '</span></td>' +
          '<td style="max-width:250px"><div class="cell-main truncate" title="' + esc(itemsText) + '">' + esc(itemsText) + '</div>' +
            '<div class="cell-sub">' + (s.items || []).reduce(function (n, it) { return n + it.qty; }, 0) + ' шт · #' + esc(s.code || '') + '</div></td>' +
          '<td>' + pay + '</td>' +
          '<td class="text-right"><span class="cell-main money">' + fmtMoney(s.total) + '</span></td>' +
          '<td><span class="cell-main">' + esc(s.userName || '—') + '</span>' +
            '<div class="cell-sub">добавил: ' + esc(s.manualBy || '—') + '</div>' +
            (s.manualNote ? '<div class="cell-sub truncate" title="' + esc(s.manualNote) + '">' + esc(s.manualNote) + '</div>' : '') + '</td>' +
          '<td>' + (s.stockDeducted
            ? '<span class="badge success">списано</span>'
            : '<span class="badge neutral">без списания</span>') +
            (s.stockDeducted ? '' : '<div class="cell-sub">только в отчёте</div>') + '</td>' +
          '<td><div class="actions"><button type="button" class="icon-btn danger" data-del-manual="' + s.id + '" title="Удалить продажу">' + icon('trash', 16) + '</button></div></td>' +
          '</tr>';
      }).join('');

      root.innerHTML =
        '<div class="page">' +
          '<div class="page-head">' +
            '<div><h1>Ручные продажи</h1>' +
              '<div class="sub">Добавление продаж за любую дату и время — они попадают во все отчёты и аналитику</div></div>' +
            '<div class="page-actions">' +
              '<div class="segmented">' +
                '<button type="button" data-period="today" class="' + (state.period === 'today' ? 'active' : '') + '">Сегодня</button>' +
                '<button type="button" data-period="week" class="' + (state.period === 'week' ? 'active' : '') + '">7 дней</button>' +
                '<button type="button" data-period="month" class="' + (state.period === 'month' ? 'active' : '') + '">30 дней</button>' +
                '<button type="button" data-period="quarter" class="' + (state.period === 'quarter' ? 'active' : '') + '">90 дней</button>' +
                '<button type="button" data-period="all" class="' + (state.period === 'all' ? 'active' : '') + '">Всё время</button>' +
              '</div>' +
              '<button type="button" class="btn btn-primary" id="manualAdd">' + icon('plus', 16) + ' Добавить продажу</button>' +
            '</div>' +
          '</div>' +

          '<div class="kpi-inline" style="margin-bottom:16px">' +
            '<div class="kpi-mini"><div class="l">Добавлено вручную</div><div class="v">' + list.length + '</div></div>' +
            '<div class="kpi-mini"><div class="l">Сумма</div><div class="v">' + fmtMoney(sum) + '</div></div>' +
            '<div class="kpi-mini"><div class="l">Списано со склада</div><div class="v">' + deducted + '</div></div>' +
            '<div class="kpi-mini"><div class="l">Всего за всё время</div><div class="v">' + all.length + '</div></div>' +
          '</div>' +

          '<div class="card">' +
            '<div class="card-head" style="padding-bottom:14px">' +
              '<div><h3>Список ручных продаж</h3><div class="sub">' + (list.length ? list.length + ' ' + plural(list.length, 'запись', 'записи', 'записей') : 'пока пусто') + '</div></div>' +
              '<select class="select" id="manualPoint" style="width:auto;height:36px">' +
                '<option value="all"' + (state.pointId === 'all' ? ' selected' : '') + '>Все точки</option>' + pointOptions +
              '</select>' +
            '</div>' +
            '<div class="card-body" style="padding-top:0">' +
              (list.length
                ? '<div class="table-wrap"><table class="tbl"><thead><tr>' +
                    '<th>Дата продажи</th><th>Точка</th><th>Товары</th><th>Оплата</th>' +
                    '<th class="text-right">Сумма</th><th>Кто · комментарий</th><th>Склад</th><th></th>' +
                  '</tr></thead><tbody>' + rows + '</tbody></table></div>'
                : '<div class="tbl-empty">' + (all.length
                    ? 'За выбранный период ручных продаж нет'
                    : 'Ручных продаж ещё не было. Нажмите «Добавить продажу».') + '</div>') +
            '</div>' +
          '</div>' +

          '<div class="form-note info" style="margin-top:14px">' + icon('info', 15) +
            '<span>Продажа сохраняется с выбранной датой: она сразу видна в <b>панели</b>, <b>аналитике</b> и в колонке <b>«Продано»</b> отчёта по складу за эту дату. Продажи за прошлые даты <b>не меняют остатки</b> — отчёты за следующие дни остаются такими же, как были. Склад списывается только у продажи за сегодня.</span>' +
          '</div>' +
        '</div>';

      root.querySelectorAll('[data-period]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          state.period = btn.getAttribute('data-period');
          ctx.rerender();
        });
      });
      root.querySelector('#manualPoint').addEventListener('change', function (e) {
        state.pointId = e.target.value;
        ctx.rerender();
      });
      root.querySelector('#manualAdd').addEventListener('click', function () {
        var pointId = state.pointId !== 'all' ? state.pointId : (DB.points[0] && DB.points[0].id);
        openManualSaleModal(ctx, { pointId: pointId });
      });

      root.querySelectorAll('[data-del-manual]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var id = btn.getAttribute('data-del-manual');
          var sale = DB.sales.find(function (s) { return s.id === id; });
          if (!sale) return;
          confirmDialog({
            title: 'Удалить ручную продажу?',
            message: 'Продажа #' + esc(sale.code) + ' на ' + fmtMoney(sale.total) + ' от ' + fmtDate(sale.createdAt) + ' ' + fmtTime(sale.createdAt) +
              ' исчезнет из статистики.' + (sale.stockDeducted ? ' Товары вернутся на склад.' : ''),
            danger: true,
            confirmText: 'Удалить'
          }).then(function (ok) {
            if (!ok) return;
            var res = deleteManualSale(id, user);
            if (res.error) { toast(res.error, 'error'); return; }
            toast('Продажа удалена' + (sale.stockDeducted ? ', товары возвращены на склад' : ''), 'success', 3600);
            ctx.rerender();
          });
        });
      });
    }
  };

  window.openManualSaleModal = openManualSaleModal;
})();
