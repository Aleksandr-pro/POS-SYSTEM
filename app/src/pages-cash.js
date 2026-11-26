/* ============================================================
   POS Контроль — касса: продажи, оплата, чеки, расходы
   ============================================================ */
(function () {
  'use strict';
  var PAGES = window.PAGES = window.PAGES || {};

  var state = {
    cart: {},
    category: 'all',
    search: '',
    payment: 'cash',
    receipt: null,
    cashPart: '',
    qrPart: '',
    cashTouched: false,
    qrTouched: false,
    pointId: null
  };

  function cartItems() {
    return Object.keys(state.cart).map(function (id) {
      var product = getProduct(id);
      if (!product) return null;
      var qty = state.cart[id];
      return { product: product, qty: qty, sum: product.price * qty };
    }).filter(Boolean);
  }

  function cartTotal() {
    return cartItems().reduce(function (s, it) { return s + it.sum; }, 0);
  }

  function cartCount() {
    return cartItems().reduce(function (s, it) { return s + it.qty; }, 0);
  }

  function availableStock(pointId, productId) {
    var row = stockRow(pointId, productId);
    return row ? row.qty : null;
  }

  window.openExpenseModal = function (args) {
    var user = args.user;
    var pointId = args.pointId || (user.role === 'seller' ? activePointId(user) : (DB.points[0] && DB.points[0].id));
    var points = user.role === 'seller' ? userPoints(user) : DB.points;
    var pointField = '';
    if (user.role !== 'seller' && points.length > 1) {
      pointField = '<div class="field"><label>Точка продаж</label><select class="select" id="expPoint">' +
        points.map(function (p) { return '<option value="' + p.id + '"' + (p.id === pointId ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }).join('') +
        '</select></div>';
    }
    var modal = openModal({
      title: 'Добавить расход',
      subtitle: 'Расходы уменьшают прибыль в аналитике',
      size: 'sm',
      body:
        '<form id="expForm" style="display:flex;flex-direction:column;gap:14px">' +
          '<div class="field"><label for="expAmount">Стоимость, ' + APP_CONFIG.currency + '</label>' +
            '<input class="input" id="expAmount" inputmode="numeric" placeholder="0" autofocus></div>' +
          '<div class="field"><label for="expReason">Причина расхода</label>' +
            '<textarea class="input" id="expReason" placeholder="Например: закупка воды, расходники, транспорт"></textarea></div>' +
          pointField +
          '<div class="form-note warn">' + icon('info', 15) + '<span>Детальные данные о расходах автоматически удаляются через 7 дней, статистика сохраняется.</span></div>' +
        '</form>',
      footer: '<button type="button" class="btn btn-secondary" data-cancel>Отмена</button>' +
        '<button type="button" class="btn btn-primary" data-save>Добавить расход</button>',
      onMount: function (el, close) {
        el.querySelector('[data-cancel]').addEventListener('click', close);
        el.querySelector('[data-save]').addEventListener('click', function () {
          var amount = parseAmount(el.querySelector('#expAmount').value);
          var reason = el.querySelector('#expReason').value.trim();
          var selectedPoint = el.querySelector('#expPoint') ? el.querySelector('#expPoint').value : pointId;
          if (!(amount > 0)) { toast('Укажите стоимость расхода', 'error'); el.querySelector('#expAmount').focus(); return; }
          if (!reason) { toast('Опишите причину расхода', 'error'); el.querySelector('#expReason').focus(); return; }
          if (!selectedPoint) { toast('Сначала создайте точку продаж', 'error'); return; }
          addExpense(amount, reason, selectedPoint, user);
          close();
          toast('Расход ' + fmtMoney(amount) + ' добавлен', 'success');
          if (typeof args.onDone === 'function') args.onDone();
        });
      }
    });
    return modal;
  };

  /* ---------- правка и отмена продажи (2 суток) ---------- */
  function saleWindowText(sale) {
    var left = saleEditLeftMs(sale);
    if (left <= 0) return 'время правки истекло';
    var hours = Math.floor(left / 3600000);
    var mins = Math.floor((left % 3600000) / 60000);
    return 'осталось ' + hours + ' ч ' + mins + ' мин из 2 суток';
  }

  function openSaleEditModal(sale, user, onDone) {
    var payment = sale.payment || 'cash';
    var cashAmount = sale.cashAmount || 0;
    var qrAmount = sale.qrAmount || 0;
    var receipt = sale.receipt || null;
    var total = sale.total || 0;

    openModal({
      title: 'Изменить продажу #' + (sale.code || ''),
      subtitle: fmtDateTime(sale.createdAt) + ' · ' + (sale.pointName || pointName(sale.pointId)) + ' · ' + saleWindowText(sale),
      size: 'sm',
      body:
        '<div class="field"><label>Способ оплаты</label>' +
          '<div class="segmented pay-seg" id="editPay">' +
            '<button type="button" data-pay="cash"' + (payment === 'cash' ? ' class="active"' : '') + '>Наличные</button>' +
            '<button type="button" data-pay="qr"' + (payment === 'qr' ? ' class="active"' : '') + '>Kaspi QR</button>' +
            '<button type="button" data-pay="mixed"' + (payment === 'mixed' ? ' class="active"' : '') + '>Смешанный</button>' +
          '</div></div>' +
        '<div class="field" id="editMixedBox" style="' + (payment === 'mixed' ? '' : 'display:none') + '">' +
          '<label>Разбивка оплаты, ₸</label>' +
          '<div class="form-grid">' +
            '<div class="field"><label for="editCash">Наличными</label>' +
              '<input class="input" id="editCash" inputmode="numeric" value="' + (payment === 'mixed' ? cashAmount : '') + '" placeholder="0"></div>' +
            '<div class="field"><label for="editQr">Kaspi QR</label>' +
              '<input class="input" id="editQr" inputmode="numeric" value="' + (payment === 'mixed' ? qrAmount : '') + '" placeholder="0"></div>' +
          '</div>' +
          '<div class="hint" id="editSplitHint">Сумма продажи: ' + fmtMoney(total) + '</div>' +
        '</div>' +
        '<div class="field"><label>Чек об оплате</label>' +
          '<div id="editReceiptBox"></div>' +
          '<input type="file" id="editReceiptInput" accept="image/*" hidden>' +
          '<input type="file" id="editReceiptCameraInput" accept="image/*" capture="environment" hidden>' +
        '</div>' +
        '<div class="form-note info">' + icon('info', 15) +
          '<span>Правка доступна <b>2 суток</b> с момента продажи. Все изменения попадут в раздел «Изменения» у администратора.</span></div>',
      footer:
        '<button type="button" class="btn btn-secondary" id="editCancel">Отмена</button>' +
        '<button type="button" class="btn btn-primary" id="editSave">' + icon('check', 16) + ' Сохранить</button>',
      onMount: function (el, close) {
        var mixedBox = el.querySelector('#editMixedBox');
        var cashInput = el.querySelector('#editCash');
        var qrInput = el.querySelector('#editQr');
        var hint = el.querySelector('#editSplitHint');
        var galleryInput = el.querySelector('#editReceiptInput');
        var cameraInput = el.querySelector('#editReceiptCameraInput');

        function paintReceipt() {
          var box = el.querySelector('#editReceiptBox');
          box.innerHTML = (receipt
              ? '<div class="receipt-thumb"><img src="' + receipt + '" alt="Чек"><button type="button" class="rm" id="editReceiptRemove" title="Удалить чек">' + icon('x', 15) + '</button></div>'
              : '<button type="button" class="receipt-drop" id="editReceiptDrop">' + icon('receipt', 17) + ' Добавить фото чека</button>') +
            '<div class="receipt-actions">' +
              '<button type="button" class="btn btn-sm btn-secondary" id="editReceiptCamera">' + icon('camera', 15) + ' Снять на камеру</button>' +
              '<button type="button" class="btn btn-sm btn-secondary" id="editReceiptGallery">' + icon('image', 15) + ' Из галереи</button>' +
            '</div>';
          var drop = box.querySelector('#editReceiptDrop');
          var cam = box.querySelector('#editReceiptCamera');
          var gal = box.querySelector('#editReceiptGallery');
          if (drop) drop.addEventListener('click', function () { galleryInput.click(); });
          if (cam) cam.addEventListener('click', function () { cameraInput.click(); });
          if (gal) gal.addEventListener('click', function () { galleryInput.click(); });
          var rm = box.querySelector('#editReceiptRemove');
          if (rm) rm.addEventListener('click', function () { receipt = null; paintReceipt(); });
        }

        function paintSplit() {
          var cash = Math.round(Number(parseAmount(cashInput.value)) || 0);
          var qr = Math.round(Number(parseAmount(qrInput.value)) || 0);
          var diff = total - cash - qr;
          hint.innerHTML = diff === 0
            ? '<span style="color:var(--success-600)">Сходится: ' + fmtMoney(total) + '</span>'
            : 'Сумма продажи: ' + fmtMoney(total) + ' · осталось распределить <b>' + fmtMoney(diff) + '</b>';
        }

        el.querySelectorAll('#editPay [data-pay]').forEach(function (btn) {
          btn.addEventListener('click', function () {
            payment = btn.getAttribute('data-pay');
            el.querySelectorAll('#editPay [data-pay]').forEach(function (b) { b.classList.toggle('active', b === btn); });
            mixedBox.style.display = payment === 'mixed' ? '' : 'none';
            if (payment === 'mixed') {
              if (!cashInput.value && !qrInput.value) { cashInput.value = total; qrInput.value = 0; }
              paintSplit();
            }
          });
        });
        cashInput.addEventListener('input', paintSplit);
        qrInput.addEventListener('input', paintSplit);
        function bindInput(input) {
          if (!input) return;
          input.addEventListener('change', async function () {
            var file = input.files && input.files[0];
            if (!file) return;
            try {
              receipt = await compressImage(file, 1280, 0.72);
            } catch (e) {
              toast('Не удалось обработать фото', 'error');
            }
            input.value = '';
            paintReceipt();
          });
        }
        bindInput(galleryInput);
        bindInput(cameraInput);

        paintReceipt();
        paintSplit();
        el.querySelector('#editCancel').addEventListener('click', close);
        el.querySelector('#editSave').addEventListener('click', function () {
          var patch = { payment: payment, receipt: receipt };
          if (payment === 'mixed') {
            patch.cashAmount = Math.round(Number(parseAmount(cashInput.value)) || 0);
            patch.qrAmount = Math.round(Number(parseAmount(qrInput.value)) || 0);
          }
          var res = updateSale(sale.id, patch, user);
          if (res.error) { toast(res.error, 'error', 5000); return; }
          close();
          toast('Продажа #' + sale.code + ' изменена', 'success');
          if (onDone) onDone();
        });
      }
    });
  }

  window.openSaleEditModal = openSaleEditModal;

  /* ---------- продажи за последние 2 суток: правки и отмены ---------- */
  function openSalesWindowModal(user, pointId, onDone) {
    function listHtml() {
      var from = Date.now() - SALE_EDIT_WINDOW_MS;
      var list = DB.sales.filter(function (s) {
        if (s.pointId !== pointId || s.createdAt < from) return false;
        if (user.role === 'seller' && !canEditSale(user, s) && !s.cancelled) return false;
        return true;
      }).sort(function (a, b) { return b.createdAt - a.createdAt; });

      if (!list.length) {
        return '<div class="tbl-empty">За последние 2 суток продаж на этой точке не было</div>';
      }
      return '<div class="table-wrap"><table class="tbl"><thead><tr><th>Дата и время</th><th>Продавец</th><th>Оплата</th><th class="text-right">Сумма</th><th>Правка</th></tr></thead><tbody>' +
        list.map(function (s) {
          var editable = canEditSale(user, s);
          return '<tr data-win-sale="' + s.id + '">' +
            '<td><div class="cell-main nowrap">' + fmtDate(s.createdAt) + ' ' + fmtTime(s.createdAt) + '</div>' +
              '<div class="cell-sub">#' + esc(s.code || '') + (s.cancelled ? ' · отменена' : (s.edits ? ' · правок: ' + s.edits : '')) + '</div></td>' +
            '<td><span class="cell-main">' + esc(s.userName) + '</span></td>' +
            '<td>' + badge(paymentLabel(s.payment), paymentBadgeClass(s.payment)) +
              (s.payment === 'mixed' ? '<div class="cell-sub nowrap">нал ' + fmtCompact(s.cashAmount) + ' · QR ' + fmtCompact(s.qrAmount) + '</div>' : '') + '</td>' +
            '<td class="text-right"><b class="money">' + fmtMoney(s.total) + '</b></td>' +
            '<td>' + (editable
              ? '<div class="actions">' +
                  '<button class="icon-btn" data-win-edit="' + s.id + '" title="Изменить">' + icon('edit', 15) + '</button>' +
                  '<button class="icon-btn danger" data-win-cancel="' + s.id + '" title="Отменить">' + icon('x', 15) + '</button>' +
                '</div>'
              : '<span class="badge neutral">' + (s.cancelled ? 'отменена' : 'время истекло') + '</span>') + '</td>' +
          '</tr>';
        }).join('') + '</tbody></table></div>' +
        '<div class="hint" style="margin-top:10px">Продавец может править и отменять продажи только в течение 2 суток с момента продажи.</div>';
    }

    var handle = openModal({
      title: 'Продажи за 2 суток',
      subtitle: pointName(pointId) + ' · правка оплаты, чека и отмена',
      size: 'lg',
      body: '<div id="windowSalesBox">' + listHtml() + '</div>',
      footer: '<button type="button" class="btn btn-secondary" data-close>Закрыть</button>',
      onMount: function (el, close) {
        el.querySelector('[data-close]').addEventListener('click', close);

        function refresh() {
          var box = el.querySelector('#windowSalesBox');
          if (box) box.innerHTML = listHtml();
          bind();
          if (onDone) onDone();
        }

        function bind() {
          el.querySelectorAll('[data-win-edit]').forEach(function (btn) {
            btn.addEventListener('click', function () {
              var sale = DB.sales.find(function (s) { return s.id === btn.getAttribute('data-win-edit'); });
              if (!sale) return;
              openSaleEditModal(sale, user, refresh);
            });
          });
          el.querySelectorAll('[data-win-cancel]').forEach(function (btn) {
            btn.addEventListener('click', async function () {
              var sale = DB.sales.find(function (s) { return s.id === btn.getAttribute('data-win-cancel'); });
              if (!sale) return;
              var ok = await confirmDialog({
                title: 'Отменить продажу #' + sale.code + '?',
                message: 'Сумма <b>' + fmtMoney(sale.total) + '</b>, товары вернутся на склад. Запись останется в разделе «Изменения».',
                confirmText: 'Отменить продажу',
                danger: true
              });
              if (!ok) return;
              var res = cancelSale(sale.id, user);
              if (res.error) { toast(res.error, 'error', 5000); return; }
              toast('Продажа #' + sale.code + ' отменена', 'success');
              refresh();
            });
          });
        }

        bind();
      }
    });
    return handle;
  }

  /* ---------- Допуск продавца к кассе: ночь → приход → сверка склада ---------- */
  function bindShiftStrip(root, ctx, user, pointId) {
    var arrive = root.querySelector('#shiftArrive');
    if (arrive) arrive.addEventListener('click', function () { window.posMarkArrival(user, ctx, arrive); });
    var leave = root.querySelector('#shiftLeave');
    if (leave) leave.addEventListener('click', function () { window.posMarkLeave(user, ctx, leave); });
    var check = root.querySelector('#shiftCheck');
    if (check) check.addEventListener('click', function () {
      if (ctx && ctx.navigate) ctx.navigate('stock');
    });
  }

  function sellerShiftStrip(user, pointId, gate) {
    var entry = gate.entry || timeEntryFor(user.id);
    var check = gate.check || null;
    return '<div class="card shift-strip">' +
      '<div class="shift-item">' +
        '<span class="shift-lbl">' + icon('arrive', 14) + ' Приход</span>' +
        '<span class="shift-val">' + (entry && entry.arriveAt ? fmtTime(entry.arriveAt) : 'не отмечен') + '</span>' +
        (entry && entry.arriveAt
          ? '<button type="button" class="btn btn-sm btn-secondary" id="shiftLeave">Уход</button>'
          : '<button type="button" class="btn btn-sm btn-primary" id="shiftArrive">Я на месте</button>') +
      '</div>' +
      '<div class="shift-item">' +
        '<span class="shift-lbl">' + icon('layers', 14) + ' Сверка склада</span>' +
        '<span class="shift-val">' + (check
          ? (check.result === 'match' ? 'сходятся' : 'не сходятся')
          : 'не проводилась') + '</span>' +
        '<button type="button" class="btn btn-sm btn-secondary" id="shiftCheck">Склад</button>' +
      '</div>' +
    '</div>';
  }

  /** Сообщение вместо кассы: одна кнопка действия */
  function renderCashGate(root, ctx, user, pointId, gate) {
    var head = '<div class="page-head"><div><h1>Касса</h1><div class="sub">' + fmtDateHuman(Date.now()) +
      (pointId ? ' · ' + esc(pointName(pointId)) : '') + '</div></div></div>';

    if (gate.reason === 'night') {
      root.innerHTML = '<div class="page">' + head +
        '<div class="card gate-card">' +
          '<div class="gate-icon night">' + icon('clock', 30) + '</div>' +
          '<h2>Касса закрыта</h2>' +
          '<div class="gate-text">Продажи недоступны ежедневно с <b>' + gate.night.label + '</b>.<br>Касса откроется в <b>' + fmtTime(gate.night.until) + '</b>.</div>' +
          '<div class="gate-timer" data-until="' + gate.night.until + '">до открытия ' + fmtDuration(gate.night.until - Date.now()) + '</div>' +
        '</div>' +
      '</div>';
      var timerEl = root.querySelector('.gate-timer');
      if (timerEl) {
        var until = Number(timerEl.getAttribute('data-until'));
        var tick = setInterval(function () {
          if (!document.body.contains(timerEl)) { clearInterval(tick); return; }
          var left = until - Date.now();
          if (left <= 0) { clearInterval(tick); ctx.rerender(); return; }
          timerEl.textContent = 'до открытия ' + fmtDuration(left);
        }, 1000);
      }
      return;
    }

    if (gate.reason === 'arrival') {
      root.innerHTML = '<div class="page">' + head +
        '<div class="card gate-card">' +
          '<div class="gate-icon arrive">' + icon('arrive', 30) + '</div>' +
          '<h2>Отметьте приход на работу</h2>' +
          '<div class="gate-text">Чтобы работать с кассой, отметьте приход на рабочем месте.</div>' +
          '<button type="button" class="btn btn-primary btn-lg" id="gateArrive">' + icon('arrive', 18) + ' Я на месте</button>' +
        '</div>' +
      '</div>';
      var gateArrive = root.querySelector('#gateArrive');
      gateArrive.addEventListener('click', function () { window.posMarkArrival(user, ctx, gateArrive); });
      return;
    }

    // reason === 'check' — приход есть, но склад не сверен: сообщение и переход в склад
    root.innerHTML = '<div class="page">' + head +
      '<div class="card gate-card">' +
        '<div class="gate-icon check">' + icon('layers', 30) + '</div>' +
        '<h2>Проверьте склад</h2>' +
        '<div class="gate-text">Приход отмечен в <b>' + fmtTime(gate.entry.arriveAt) + '</b>.<br>' +
          'Чтобы открыть кассу, перейдите в склад и отметьте, сходятся ли данные.</div>' +
        '<button type="button" class="btn btn-primary btn-lg" id="gateToStock">' + icon('layers', 18) + ' Перейти в склад</button>' +
      '</div>' +
      sellerShiftStrip(user, pointId, gate) +
    '</div>';
    bindShiftStrip(root, ctx, user, pointId);
    root.querySelector('#gateToStock').addEventListener('click', function () { ctx.navigate('stock'); });
  }

  PAGES.cash = {
    render: function (root, ctx) {
      var user = ctx.user;
      var isSeller = user.role === 'seller';
      var points = isSeller ? userPoints(user) : DB.points;

      if (isSeller) {
        // активная точка хранится в сессии устройства — переключение не смешивает данные
        var active = activePointId(user);
        if (active) state.pointId = active;
      } else if (!state.pointId || !getPoint(state.pointId) || !productsForPoint(state.pointId).length) {
        state.pointId = defaultPointId();
      }
      var pointId = state.pointId;

      if (isSeller && !points.length) {
        root.innerHTML = '<div class="page">' +
          '<div class="page-head"><div><h1>Касса</h1><div class="sub">' + fmtDateHuman(Date.now()) + '</div></div></div>' +
          '<div class="card">' + emptyState('pin', 'Вам не назначена точка продаж', 'Обратитесь к администратору: он назначит вам точку в разделе «Точки продаж → Пользователи».', '') + '</div>' +
          '</div>';
        return;
      }
      if (!pointId) {
        root.innerHTML = '<div class="page">' +
          '<div class="page-head"><div><h1>Касса</h1><div class="sub">' + fmtDateHuman(Date.now()) + '</div></div></div>' +
          '<div class="card">' + emptyState('pin', 'Сначала создайте точку продаж', 'Касса привязана к точке продаж. Создайте её в разделе «Точки продаж».',
            '<button class="btn btn-primary" id="cashGoPoints">' + icon('plus', 16) + ' Создать точку</button>') + '</div>' +
          '</div>';
        var goPoints = root.querySelector('#cashGoPoints');
        if (goPoints) goPoints.addEventListener('click', function () { ctx.navigate('points'); });
        return;
      }

      // продавец: ночь 02:00–06:00 → приход → сверка склада → касса
      var gate = null;
      if (isSeller) {
        gate = cashAccessGate(user, pointId);
        if (!gate.allowed) {
          // приход есть, но склад не сверен — сообщение и переход на склад
          if (gate.reason === 'check' && ctx && ctx.navigate) {
            window.__returnToCashAfterCheck = true;
            toast('Сначала сверьте склад: отметьте, сходятся ли данные', 'warn', 5200);
            ctx.navigate('stock');
            return;
          }
          renderCashGate(root, ctx, user, pointId, gate);
          return;
        }
      }

      // очищаем корзину от товаров, недоступных на точке
      Object.keys(state.cart).forEach(function (id) {
        var p = getProduct(id);
        if (!p || !productsForPoint(pointId).some(function (x) { return x.id === id; })) delete state.cart[id];
      });

      var todayStart = startOfDay(new Date());
      var todaySales = salesBetween(todayStart, Date.now(), { pointId: pointId }).sort(function (a, b) { return b.createdAt - a.createdAt; });
      var todayExpenses = expensesBetween(todayStart, Date.now(), { pointId: pointId }).sort(function (a, b) { return b.createdAt - a.createdAt; });
      var todayTotal = todaySales.reduce(function (s, x) { return s + x.total; }, 0);
      var todayStats = summarize(todayStart, Date.now(), { pointId: pointId });
      var todayExpenseTotal = todayExpenses.reduce(function (s, x) { return s + x.amount; }, 0);

      root.innerHTML =
        '<div class="page">' +
          '<div class="page-head">' +
            '<div><h1>Касса</h1>' +
              '<div class="sub">' + fmtDateHuman(Date.now()) + ' · ' + esc(pointName(pointId)) + '</div></div>' +
            '<div class="page-actions">' +
              (points.length > 1 && !(isSeller && document.getElementById('topbarPoint'))
                ? '<select class="select" id="cashPoint" style="width:auto;height:40px;min-width:170px">' +
                    points.map(function (p) { return '<option value="' + p.id + '"' + (p.id === pointId ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }).join('') +
                  '</select>'
                : '') +
              '<button type="button" class="btn btn-secondary" id="salesWindowBtn">' + icon('history', 16) + ' Продажи за 2 суток</button>' +
              (isSeller ? '' : '<button type="button" class="btn btn-secondary" id="addExpenseBtn">' + icon('plus', 16) + ' Расход</button>') +
            '</div>' +
          '</div>' +

          (isSeller ? sellerShiftStrip(user, pointId, gate) : '') +

          '<div class="cash-layout">' +
            '<div style="min-width:0">' +
              '<div class="card card-pad">' +
                '<div class="catalog-head">' +
                  '<div class="input-icon search">' + icon('search', 17) +
                    '<input class="input" id="cashSearch" placeholder="Поиск товара…" value="' + esc(state.search) + '">' +
                  '</div>' +
                  '<div class="muted small nowrap" id="catalogCount"></div>' +
                '</div>' +
                '<div class="cat-chips" id="catChips"></div>' +
                '<div class="product-grid" id="catalogGrid"></div>' +
              '</div>' +
            '</div>' +
            '<div class="card cart" id="cartPanel"></div>' +
          '</div>' +

          '<div class="section-gap cash-cols">' +
            '<div class="card" style="min-width:0">' +
              '<div class="card-head"><div><h3>Продажи за сегодня</h3><div class="sub">' + todaySales.length + ' ' + plural(todaySales.length, 'продажа', 'продажи', 'продаж') + ' на ' + fmtMoney(todayTotal) + '</div></div>' +
                badge('Касса', 'badge-cash', true) +
              '</div>' +
              '<div class="card-body" style="padding-top:10px" id="todaySalesBox"></div>' +
              (todaySales.length
                ? '<div class="cash-split">' +
                    '<div class="row"><span class="nm">Наличные</span><span class="val">' + fmtMoney(todayStats.byMethod.cash) + '</span></div>' +
                    '<div class="row"><span class="nm">Kaspi QR</span><span class="val">' + fmtMoney(todayStats.byMethod.qr) + '</span></div>' +
                    '<div class="row"><span class="nm">Смешанная оплата <span class="muted">(' + todayStats.mixedCount + ')</span></span><span class="val">' + fmtMoney(todayStats.mixedTotal) + '</span></div>' +
                    (todayStats.mixedTotal
                      ? '<div class="row sub"><span class="nm">· наличными / Kaspi</span><span class="val">' + fmtMoney(todayStats.mixedCash) + ' / ' + fmtMoney(todayStats.mixedQr) + '</span></div>'
                      : '') +
                    '<div class="row total"><span class="nm">Итого наличными</span><span class="val">' + fmtMoney(todayStats.cashTotal) + '</span></div>' +
                    '<div class="row total"><span class="nm">Итого Kaspi QR</span><span class="val">' + fmtMoney(todayStats.qrTotal) + '</span></div>' +
                  '</div>'
                : '') +
            '</div>' +
            (isSeller ? '' :
            '<div class="card" style="min-width:0">' +
              '<div class="card-head"><div><h3>Расходы за сегодня</h3><div class="sub">' + fmtMoney(todayExpenseTotal) + ' · ' + todayExpenses.length + ' ' + plural(todayExpenses.length, 'запись', 'записи', 'записей') + '</div></div>' +
                '<button type="button" class="btn btn-sm btn-secondary" id="addExpenseBtn2">' + icon('plus', 14) + ' Добавить</button>' +
              '</div>' +
              '<div class="card-body" style="padding-top:10px" id="todayExpensesBox"></div>' +
            '</div>') +
          '</div>' +
        '</div>' +
        (isSeller ? '' : '<button type="button" class="fab" id="cashExport">' + icon('download', 17) + ' Экспорт<span class="kbd">XLSX</span></button>');

      /* ---------- каталог ---------- */
      var catalog = productsForPoint(pointId);
      var gridEl = root.querySelector('#catalogGrid');
      var chipsEl = root.querySelector('#catChips');
      var countEl = root.querySelector('#catalogCount');

      function renderChips() {
        var cats = DB.categories.filter(function (c) {
          return catalog.some(function (p) { return p.categoryId === c.id; });
        });
        var total = catalog.length;
        var html = '<button type="button" class="chip ' + (state.category === 'all' ? 'active' : '') + '" data-cat="all">Все <span class="count">' + total + '</span></button>';
        cats.forEach(function (c) {
          var n = catalog.filter(function (p) { return p.categoryId === c.id; }).length;
          html += '<button type="button" class="chip ' + (state.category === c.id ? 'active' : '') + '" data-cat="' + c.id + '">' + esc(c.name) + ' <span class="count">' + n + '</span></button>';
        });
        chipsEl.innerHTML = html;
        chipsEl.querySelectorAll('[data-cat]').forEach(function (btn) {
          btn.addEventListener('click', function () {
            state.category = btn.getAttribute('data-cat');
            renderChips();
            renderGrid();
          });
        });
      }

      function renderGrid() {
        var q = state.search.trim().toLowerCase();
        var list = catalog.filter(function (p) {
          if (state.category !== 'all' && p.categoryId !== state.category) return false;
          if (q && p.name.toLowerCase().indexOf(q) === -1) return false;
          return true;
        });
        countEl.textContent = list.length + ' ' + plural(list.length, 'товар', 'товара', 'товаров');

        if (!catalog.length) {
          gridEl.innerHTML = emptyState('package', 'На точке нет товаров',
            user.role === 'seller' ? 'Товары для вашей точки ещё не добавлены администратором.' : 'Добавьте товары в каталог и назначьте их этой точке.',
            user.role !== 'seller' ? '<button class="btn btn-primary btn-sm" id="cashGoProducts">' + icon('plus', 15) + ' Добавить товар</button>' : '');
          var gp = gridEl.querySelector('#cashGoProducts');
          if (gp) gp.addEventListener('click', function () { ctx.navigate('products'); });
          return;
        }
        if (!list.length) {
          gridEl.innerHTML = '<div class="muted small" style="grid-column:1/-1;padding:24px 0;text-align:center">Ничего не найдено — измените запрос или категорию</div>';
          return;
        }

        gridEl.innerHTML = list.map(function (p) {
          var stock = availableStock(pointId, p.id);
          var inCart = state.cart[p.id] || 0;
          var isOut = stock !== null && stock <= inCart;
          var stockLabel = stock === null ? 'не учтён' : (stock === 0 ? 'нет' : stock + ' шт');
          var stockCls = stock === null ? 'none' : (stock === 0 ? 'zero' : (stock <= 5 ? 'low' : ''));
          return '<button type="button" class="product-card' + (isOut ? ' out' : '') + '" data-product="' + p.id + '"' + (isOut ? ' aria-disabled="true"' : '') + '>' +
            '<div class="product-photo">' + productPhotoHtml(p) +
              (inCart ? '<span class="badge badge-admin photo-badge">' + inCart + ' в корзине</span>' : '') +
              '<span class="add-hint">' + icon('plus', 15) + '</span>' +
            '</div>' +
            '<div class="body">' +
              '<div class="nm">' + esc(p.name) + '</div>' +
              '<div class="cat">' + esc(categoryName(p.categoryId)) + '</div>' +
              '<div class="foot"><span class="price">' + fmtMoney(p.price) + '</span>' +
              '<span class="stock ' + stockCls + '">' + stockLabel + '</span></div>' +
            '</div>' +
          '</button>';
        }).join('');

        gridEl.querySelectorAll('[data-product]').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var p = getProduct(btn.getAttribute('data-product'));
            if (!p) return;
            var stock = availableStock(pointId, p.id);
            var inCart = state.cart[p.id] || 0;
            if (stock !== null && inCart >= stock) {
              toast(stock === 0 ? 'Товара нет в наличии на этой точке' : 'Доступно только ' + stock + ' шт «' + p.name + '»', 'warn');
              return;
            }
            state.cart[p.id] = inCart + 1;
            renderCart();
            renderGrid();
            if (window.matchMedia('(max-width: 1020px)').matches) {
              var panel = root.querySelector('#cartPanel');
              if (panel && !panel.dataset.hinted) {
                panel.dataset.hinted = '1';
                toast('Товар добавлен в корзину — она ниже, прокрутите страницу', 'info', 2600);
                panel.classList.add('flash');
              }
            }
          });
        });
      }

      if (isSeller) bindShiftStrip(root, ctx, user, pointId);

      root.querySelector('#cashSearch').addEventListener('input', function (e) {
        state.search = e.target.value;
        renderGrid();
      });

      /* ---------- корзина ---------- */
      var cartEl = root.querySelector('#cartPanel');

      function mixCheckHtml(total, cash, qr) {
        var sum = (cash || 0) + (qr || 0);
        var ok = cash > 0 && qr > 0 && Math.round(sum) === Math.round(total);
        return '<div class="flex between small" id="mixCheck" style="color:' + (ok ? 'var(--success-600)' : 'var(--danger-600)') + '">' +
          '<span>Наличными + Kaspi QR</span><b>' + fmtMoney(sum) + ' из ' + fmtMoney(total) + '</b></div>';
      }

      function paymentExtraHtml(total) {
        if (state.payment === 'cash') {
          return '<div class="mini-note">' + icon('info', 13) + '<span>Примите наличные и проверьте сумму. Сдача рассчитывается продавцом.</span></div>';
        }
        var receiptActions =
          '<div class="receipt-actions">' +
            '<button type="button" class="btn btn-sm btn-secondary" id="receiptCamera">' + icon('camera', 15) + ' Снять на камеру</button>' +
            '<button type="button" class="btn btn-sm btn-secondary" id="receiptGallery">' + icon('image', 15) + ' Из галереи</button>' +
          '</div>';
        var receiptBlock = state.receipt
          ? '<div class="receipt-thumb"><img src="' + state.receipt + '" alt="Чек"><button type="button" class="rm" id="receiptRemove" title="Удалить чек">' + icon('x', 15) + '</button></div>' +
            receiptActions
          : '<button type="button" class="receipt-drop" id="receiptDrop">' + icon('receipt', 17) + ' Загрузить фото чека <span class="muted tiny">(обязательно)</span></button>' +
            receiptActions;
        var mixedBlock = '';
        if (state.payment === 'mixed' && total > 0) {
          var touched = state.cashTouched || state.qrTouched;
          var cashVal = touched ? state.cashPart : String(Math.round((total * 0.6) / 100) * 100);
          var qrVal = touched ? state.qrPart : String(Math.max(0, total - (parseAmount(cashVal) || 0)));
          if (touched && Math.round(parseAmount(cashVal) + parseAmount(qrVal)) !== Math.round(total)) {
            var balanced = Math.max(0, Math.min(total, parseAmount(cashVal)));
            state.qrPart = String(Math.round(total - balanced));
            state.cashPart = String(Math.round(balanced));
            cashVal = state.cashPart;
            qrVal = state.qrPart;
          }
          mixedBlock =
            '<div class="pay-split-fields">' +
              '<div class="field"><label style="font-size:12px">Наличными, ' + APP_CONFIG.currency + '</label>' +
                '<input class="input" id="cashPart" inputmode="numeric" value="' + cashVal + '" placeholder="0"></div>' +
              '<div class="field"><label style="font-size:12px">Kaspi QR, ' + APP_CONFIG.currency + '</label>' +
                '<input class="input" id="qrPart" inputmode="numeric" value="' + qrVal + '" placeholder="0"></div>' +
            '</div>' +
            mixCheckHtml(total, parseAmount(cashVal), parseAmount(qrVal));
        }
        return mixedBlock + receiptBlock +
          '<input type="file" id="receiptInput" accept="image/*" hidden>' +
          '<input type="file" id="receiptCameraInput" accept="image/*" capture="environment" hidden>' +
          '<div class="mini-note">' + icon('info', 13) + '<span>Чек хранится 7 дней, затем удаляется автоматически.</span></div>';
      }

      function bindPaymentExtra() {
        var receiptInput = cartEl.querySelector('#receiptInput');
        var cameraInput = cartEl.querySelector('#receiptCameraInput');
        function pickGallery() { if (receiptInput) receiptInput.click(); }
        function pickCamera() { if (cameraInput) cameraInput.click(); }
        var drop = cartEl.querySelector('#receiptDrop');
        if (drop) drop.addEventListener('click', pickGallery);
        var galleryBtn = cartEl.querySelector('#receiptGallery');
        if (galleryBtn) galleryBtn.addEventListener('click', pickGallery);
        var cameraBtn = cartEl.querySelector('#receiptCamera');
        if (cameraBtn) cameraBtn.addEventListener('click', pickCamera);

        function applyReceiptInput(input) {
          if (!input) return;
          input.addEventListener('change', async function () {
            var file = input.files && input.files[0];
            if (!file) return;
            try {
              var data = await compressImage(file, 760, 0.68);
              state.receipt = data;
              renderCart();
              toast('Чек прикреплён', 'success');
            } catch (err) {
              toast(err.message, 'error');
            }
          });
        }
        applyReceiptInput(receiptInput);
        applyReceiptInput(cameraInput);
        var remove = cartEl.querySelector('#receiptRemove');
        if (remove) remove.addEventListener('click', function () { state.receipt = null; renderCart(); });
        var cashPart = cartEl.querySelector('#cashPart');
        var qrPart = cartEl.querySelector('#qrPart');

        function paintMix() {
          var total = cartTotal();
          var box = cartEl.querySelector('#mixCheck');
          if (!box) return;
          var sum = parseAmount(state.cashPart) + parseAmount(state.qrPart);
          var ok = parseAmount(state.cashPart) > 0 && parseAmount(state.qrPart) > 0 && Math.round(sum) === Math.round(total);
          box.style.color = ok ? 'var(--success-600)' : 'var(--danger-600)';
          box.innerHTML = '<span>Наличными + Kaspi QR</span><b>' + fmtMoney(sum) + ' из ' + fmtMoney(total) + '</b>';
        }

        if (cashPart && qrPart) {
          cashPart.addEventListener('input', function () {
            state.cashTouched = true;
            state.qrTouched = true;
            state.cashPart = cashPart.value;
            var total = cartTotal();
            var cash = Math.max(0, Math.min(total, parseAmount(cashPart.value)));
            state.qrPart = String(Math.round(total - cash));
            qrPart.value = state.qrPart;
            cashPart.classList.toggle('invalid', parseAmount(cashPart.value) > total);
            paintMix();
          });
          qrPart.addEventListener('input', function () {
            state.cashTouched = true;
            state.qrTouched = true;
            state.qrPart = qrPart.value;
            var total = cartTotal();
            var qr = Math.max(0, Math.min(total, parseAmount(qrPart.value)));
            state.cashPart = String(Math.round(total - qr));
            cashPart.value = state.cashPart;
            qrPart.classList.toggle('invalid', parseAmount(qrPart.value) > total);
            paintMix();
          });
        }
      }

      function renderCart() {
        var items = cartItems();
        var total = cartTotal();
        var count = cartCount();

        cartEl.innerHTML =
          '<div class="cart-head">' +
            '<h3>' + icon('cash', 18) + ' Корзина <span class="cart-count">' + count + '</span></h3>' +
            (items.length ? '<button type="button" class="btn btn-sm btn-ghost" id="cartClear">' + icon('trash', 14) + ' Очистить</button>' : '') +
          '</div>' +
          '<div class="cart-items">' +
            (!items.length
              ? '<div class="cart-empty"><div class="ic">' + icon('cash', 20) + '</div><div>Корзина пуста<br><span class="tiny muted">Нажмите на товар, чтобы добавить</span></div></div>'
              : items.map(function (it) {
                  var stock = availableStock(pointId, it.product.id);
                  return '<div class="cart-item" data-item="' + it.product.id + '">' +
                    '<div class="thumb" style="background:' + productGradient(it.product.name) + '">' +
                      (it.product.photo ? '<img src="' + it.product.photo + '" alt="">' : esc(it.product.name.slice(0, 1).toUpperCase())) +
                    '</div>' +
                    '<div class="info"><div class="nm">' + esc(it.product.name) + '</div>' +
                      '<div class="pr">' + fmtMoney(it.product.price) + ' × ' + it.qty + (stock !== null && stock < it.qty ? ' · <span style="color:var(--danger)">остаток ' + stock + '</span>' : '') + '</div></div>' +
                    '<div class="qty">' +
                      '<button type="button" data-dec="' + it.product.id + '" aria-label="Меньше">' + icon('minus', 13) + '</button>' +
                      '<span class="v">' + it.qty + '</span>' +
                      '<button type="button" data-inc="' + it.product.id + '" aria-label="Больше">' + icon('plus', 13) + '</button>' +
                    '</div>' +
                    '<div class="line-sum">' + fmtMoney(it.sum, false) + '</div>' +
                  '</div>';
                }).join('')) +
          '</div>' +
          '<div class="cart-foot">' +
            '<div class="cart-total"><span class="lbl">К оплате</span><span class="val">' + fmtMoney(total) + '</span></div>' +
            '<div class="pay-tabs" id="payTabs">' +
              '<button type="button" data-pay="cash" class="' + (state.payment === 'cash' ? 'active' : '') + '">' + icon('wallet', 15) + ' Наличные</button>' +
              '<button type="button" data-pay="qr" class="' + (state.payment === 'qr' ? 'active' : '') + '">' + icon('qr', 15) + ' Kaspi QR</button>' +
              '<button type="button" data-pay="mixed" class="' + (state.payment === 'mixed' ? 'active' : '') + '">' + icon('split', 15) + ' Смешанный</button>' +
            '</div>' +
            '<div class="pay-extra" id="payExtra">' + paymentExtraHtml(total) + '</div>' +
            '<button type="button" class="btn btn-primary btn-lg btn-block" id="checkoutBtn"' + (items.length ? '' : ' disabled') + '>' +
              icon('checkCircle', 18) + ' Оформить продажу</button>' +
          '</div>';

        if (items.length) {
          cartEl.querySelector('#cartClear').addEventListener('click', function () {
            state.cart = {};
            state.receipt = null;
            state.cashTouched = false;
            state.qrTouched = false;
            state.cashPart = '';
            state.qrPart = '';
            renderCart();
            renderGrid();
            toast('Корзина очищена', 'info');
          });
          cartEl.querySelectorAll('[data-inc]').forEach(function (btn) {
            btn.addEventListener('click', function () {
              var id = btn.getAttribute('data-inc');
              var stock = availableStock(pointId, id);
              var current = state.cart[id] || 0;
              if (stock !== null && current >= stock) {
                toast('Больше нет в наличии: доступно ' + stock + ' шт', 'warn');
                return;
              }
              state.cart[id] = current + 1;
              renderCart();
              renderGrid();
            });
          });
          cartEl.querySelectorAll('[data-dec]').forEach(function (btn) {
            btn.addEventListener('click', function () {
              var id = btn.getAttribute('data-dec');
              var current = state.cart[id] || 0;
              if (current <= 1) delete state.cart[id];
              else state.cart[id] = current - 1;
              renderCart();
              renderGrid();
            });
          });
        }

        cartEl.querySelectorAll('[data-pay]').forEach(function (btn) {
          btn.addEventListener('click', function () {
            state.payment = btn.getAttribute('data-pay');
            state.cashTouched = false;
            state.qrTouched = false;
            state.cashPart = '';
            state.qrPart = '';
            if (state.payment === 'cash') state.receipt = null;
            renderCart();
          });
        });
        if (items.length) {
          cartEl.querySelector('#checkoutBtn').addEventListener('click', function () { checkout(this); });
        }
        bindPaymentExtra();
      }

      /* ---------- оформление ---------- */
      async function checkout(btn) {
        var items = cartItems();
        if (!items.length) { toast('Добавьте товары в корзину', 'error'); return; }
        if (!pointId) { toast('Не выбрана точка продаж', 'error'); return; }

        for (var i = 0; i < items.length; i++) {
          var stock = availableStock(pointId, items[i].product.id);
          if (stock !== null && items[i].qty > stock) {
            toast('Недостаточно «' + items[i].product.name + '»: остаток ' + stock + ' шт', 'error', 4200);
            return;
          }
        }

        var total = cartTotal();
        var cashAmount = 0, qrAmount = 0;
        if (state.payment === 'mixed') {
          cashAmount = parseAmount(state.cashPart);
          qrAmount = parseAmount(state.qrPart);
          if (!(cashAmount > 0) || !(qrAmount > 0)) {
            toast('Укажите, сколько оплачено наличными и сколько через Kaspi QR', 'error', 4600);
            var emptyInp = cartEl.querySelector(!(cashAmount > 0) ? '#cashPart' : '#qrPart');
            if (emptyInp) { emptyInp.classList.add('invalid'); emptyInp.focus(); }
            return;
          }
          if (Math.round(cashAmount + qrAmount) !== Math.round(total)) {
            toast('Наличные + Kaspi QR должны равняться сумме чека ' + fmtMoney(total), 'error', 4600);
            var badInp = cartEl.querySelector('#cashPart');
            if (badInp) { badInp.classList.add('invalid'); badInp.focus(); }
            return;
          }
        } else if (state.payment === 'qr') {
          qrAmount = total;
        } else {
          cashAmount = total;
        }

        if ((state.payment === 'qr' || state.payment === 'mixed') && !state.receipt) {
          toast('Загрузите фото чека Kaspi — без него продажа с QR не оформляется', 'error', 4600);
          var drop = cartEl.querySelector('#receiptDrop');
          if (drop) {
            drop.style.borderColor = 'var(--danger)';
            drop.style.background = 'var(--danger-soft)';
            drop.style.color = 'var(--danger-600)';
          }
          return;
        }

        setButtonBusy(btn, true, 'Оформляем…');
        var sale = createSale({
          pointId: pointId,
          items: items.map(function (it) {
            return { productId: it.product.id, name: it.product.name, price: it.product.price, qty: it.qty };
          }),
          total: total,
          payment: state.payment,
          cashAmount: Math.round(cashAmount),
          qrAmount: Math.round(qrAmount),
          receipt: state.receipt
        }, user);

        state.cart = {};
        state.receipt = null;
        state.cashPart = '';
        state.qrPart = '';
        state.cashTouched = false;
        state.qrTouched = false;
        var savedPayment = sale.payment;

        ctx.rerender();

        openModal({
          title: 'Продажа оформлена',
          size: 'sm',
          body:
            '<div style="text-align:center;padding:2px 0 6px">' +
              '<div style="width:62px;height:62px;border-radius:50%;background:var(--success-soft);color:var(--success-600);display:flex;align-items:center;justify-content:center;margin:0 auto 12px">' + icon('checkCircle', 30) + '</div>' +
              '<div class="muted small">Чек #' + esc(sale.code) + ' · ' + fmtTime(sale.createdAt) + '</div>' +
              '<div style="font-size:30px;font-weight:800;letter-spacing:-.02em;margin:6px 0 2px">' + fmtMoney(sale.total) + '</div>' +
              '<div style="margin-top:8px">' + badge(paymentLabel(savedPayment), paymentBadgeClass(savedPayment)) + '</div>' +
            '</div>' +
            '<div class="divider"></div>' +
            '<div style="display:flex;flex-direction:column;gap:7px;font-size:13px">' +
              sale.items.map(function (it) {
                return '<div class="flex between gap-12"><span style="min-width:0" class="truncate">' + esc(it.name) + ' <span class="muted">× ' + it.qty + '</span></span><b class="nowrap">' + fmtMoney(it.price * it.qty) + '</b></div>';
              }).join('') +
            '</div>' +
            (savedPayment === 'mixed'
              ? '<div class="form-note info" style="margin-top:14px">' + icon('info', 15) + '<span>Наличными: <b>' + fmtMoney(sale.cashAmount) + '</b> · Kaspi QR: <b>' + fmtMoney(sale.qrAmount) + '</b></span></div>'
              : '') +
            '<div class="form-note success" style="margin-top:12px">' + icon('check', 15) + '<span>Товары списаны со склада, продажа добавлена в аналитику.</span></div>',
          footer:
            '<button type="button" class="btn btn-secondary" data-close-sale>Новая продажа</button>' +
            (sale.receipt ? '<button type="button" class="btn btn-primary" data-view-receipt>' + icon('image', 16) + ' Чек</button>' : ''),
          onMount: function (el, close) {
            el.querySelector('[data-close-sale]').addEventListener('click', close);
            var view = el.querySelector('[data-view-receipt]');
            if (view) view.addEventListener('click', function () {
              openImageViewer(sale.receipt, 'Чек об оплате', 'Продажа #' + sale.code + ' · ' + fmtMoney(sale.total));
            });
          }
        });
        toast('Продажа на ' + fmtMoney(sale.total) + ' оформлена', 'success');
      }

      /* ---------- списки за сегодня ---------- */
      function renderTodaySales() {
        var box = root.querySelector('#todaySalesBox');
        var list = salesBetween(startOfDay(new Date()), Date.now(), { pointId: pointId, includeCancelled: true }).sort(function (a, b) { return b.createdAt - a.createdAt; });
        if (!list.length) {
          box.innerHTML = '<div class="muted small" style="padding:8px 0 12px">Сегодня ещё не было продаж</div>';
          return;
        }
        box.innerHTML = '<div class="table-wrap"><table class="tbl"><thead><tr><th>Время</th><th>Продавец</th><th>Состав</th><th>Оплата</th><th class="text-right">Сумма</th><th></th></tr></thead><tbody>' +
          list.slice(0, 12).map(function (s) {
            var itemsText = (s.items && s.items.length)
              ? (s.items || []).map(function (it) { return it.name + ' ×' + it.qty; }).join(', ')
              : (s.imported ? 'Импорт из старой системы' : '—');
            var editable = canEditSale(user, s);
            return '<tr' + (s.cancelled ? ' style="opacity:.55"' : '') + '>' +
              '<td class="nowrap"><span class="cell-main">' + fmtTime(s.createdAt) + '</span>' +
                (s.cancelled ? '<div class="cell-sub" style="color:var(--danger-600)">отменена</div>' : (s.edits ? '<div class="cell-sub">правок: ' + s.edits + '</div>' : '')) + '</td>' +
              '<td><span class="cell-main">' + esc(s.userName) + '</span>' + (s.manual ? '<div class="cell-sub">вручную</div>' : '') + '</td>' +
              '<td style="max-width:200px"><span class="truncate" style="display:block" title="' + esc(itemsText) + '">' + esc(itemsText) + '</span></td>' +
              '<td>' + badge(paymentLabel(s.payment), paymentBadgeClass(s.payment)) +
                (s.payment === 'mixed'
                  ? '<div class="cell-sub nowrap">нал ' + fmtCompact(s.cashAmount || 0) + ' · QR ' + fmtCompact(s.qrAmount || 0) + '</div>'
                  : '') +
                (s.editedAt ? '<div class="cell-sub nowrap">изменена ' + fmtTime(s.editedAt) + '</div>' : '') + '</td>' +
              '<td class="text-right"><b class="money"' + (s.cancelled ? ' style="text-decoration:line-through"' : '') + '>' + fmtMoney(s.total) + '</b></td>' +
              '<td><div class="actions">' +
                (s.receipt ? '<button class="icon-btn" data-receipt="' + s.id + '" title="Чек">' + icon('image', 15) + '</button>' : '') +
                (editable ? '<button class="icon-btn" data-edit-sale="' + s.id + '" title="Изменить">' + icon('edit', 15) + '</button>' : '') +
                (editable ? '<button class="icon-btn danger" data-cancel-sale="' + s.id + '" title="Отменить продажу">' + icon('x', 15) + '</button>' : '') +
                (user.role === 'admin' && !s.cancelled ? '<button class="icon-btn danger" data-del-sale="' + s.id + '" title="Удалить навсегда">' + icon('trash', 15) + '</button>' : '') +
              '</div></td>' +
            '</tr>';
          }).join('') + '</tbody></table></div>' +
          (list.length > 12 ? '<div class="muted tiny" style="margin-top:8px">Показаны последние 12 из ' + list.length + '. Полный список — в экспорте и на панели.</div>' : '');

        box.querySelectorAll('[data-receipt]').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var sale = DB.sales.find(function (s) { return s.id === btn.getAttribute('data-receipt'); });
            if (sale && sale.receipt) openImageViewer(sale.receipt, 'Чек об оплате', 'Продажа #' + (sale.code || '') + ' · ' + fmtMoney(sale.total));
          });
        });
        box.querySelectorAll('[data-edit-sale]').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var sale = DB.sales.find(function (s) { return s.id === btn.getAttribute('data-edit-sale'); });
            if (!sale) return;
            openSaleEditModal(sale, user, function () { ctx.rerender(); });
          });
        });
        box.querySelectorAll('[data-cancel-sale]').forEach(function (btn) {
          btn.addEventListener('click', async function () {
            var sale = DB.sales.find(function (s) { return s.id === btn.getAttribute('data-cancel-sale'); });
            if (!sale) return;
            var ok = await confirmDialog({
              title: 'Отменить продажу #' + sale.code + '?',
              message: 'Продажа на <b>' + fmtMoney(sale.total) + '</b> будет отменена, товары вернутся на склад. Запись останется в разделе «Изменения».',
              confirmText: 'Отменить продажу',
              danger: true
            });
            if (!ok) return;
            var res = cancelSale(sale.id, user);
            if (res.error) { toast(res.error, 'error', 5000); return; }
            toast('Продажа #' + sale.code + ' отменена', 'success');
            ctx.rerender();
          });
        });
        box.querySelectorAll('[data-del-sale]').forEach(function (btn) {
          btn.addEventListener('click', async function () {
            var id = btn.getAttribute('data-del-sale');
            var sale = DB.sales.find(function (s) { return s.id === id; });
            if (!sale) return;
            var ok = await confirmDialog({ title: 'Удалить продажу?', message: 'Транзакция на <b>' + fmtMoney(sale.total) + '</b> будет удалена, остатки восстановлены.', confirmText: 'Удалить', danger: true });
            if (!ok) return;
            deleteSale(id, true, user);
            toast('Продажа удалена');
            ctx.rerender();
          });
        });
      }

      function renderTodayExpenses() {
        var box = root.querySelector('#todayExpensesBox');
        if (!box) return;
        var list = expensesBetween(startOfDay(new Date()), Date.now(), { pointId: pointId }).sort(function (a, b) { return b.createdAt - a.createdAt; });
        if (!list.length) {
          box.innerHTML = '<div class="muted small" style="padding:8px 0 12px">Расходов за сегодня нет</div>';
          return;
        }
        box.innerHTML = list.slice(0, 8).map(function (e) {
          return '<div class="today-line" style="padding-left:0;padding-right:0">' +
            '<div style="min-width:0"><div class="nm truncate">' + esc(e.reason || 'Расход') + '</div>' +
            '<div class="tm">' + fmtTime(e.createdAt) + ' · ' + esc(e.userName) + '</div></div>' +
            '<div class="flex gap-6"><span class="sum" style="color:var(--danger-600)">−' + fmtMoney(e.amount) + '</span>' +
              (user.role === 'admin' ? '<button class="icon-btn danger" style="width:26px;height:26px" data-del-exp="' + e.id + '" title="Удалить">' + icon('trash', 13) + '</button>' : '') +
            '</div></div>';
        }).join('') +
        (list.length > 8 ? '<div class="muted tiny" style="margin-top:8px">И ещё ' + (list.length - 8) + '. Полный список — в экспорте.</div>' : '');

        box.querySelectorAll('[data-del-exp]').forEach(function (btn) {
          btn.addEventListener('click', async function () {
            var ok = await confirmDialog({ title: 'Удалить расход?', message: 'Запись будет удалена из статистики.', confirmText: 'Удалить', danger: true });
            if (!ok) return;
            deleteExpense(btn.getAttribute('data-del-exp'));
            toast('Расход удалён');
            ctx.rerender();
          });
        });
      }

      /* ---------- экспорт ---------- */
      function exportCash() {
        var list = salesBetween(startOfDay(new Date()), Date.now(), { pointId: pointId }).sort(function (a, b) { return b.createdAt - a.createdAt; });
        var exp = expensesBetween(startOfDay(new Date()), Date.now(), { pointId: pointId }).sort(function (a, b) { return b.createdAt - a.createdAt; });
        var revenue = list.reduce(function (s, x) { return s + x.total; }, 0);
        var expensesSum = exp.reduce(function (s, x) { return s + x.amount; }, 0);
        var summary = [
          ['Показатель', 'Значение'],
          ['Дата', fmtDate(Date.now())],
          ['Точка продаж', pointName(pointId)],
          ['Выручка, ₸', revenue],
          ['Расходы, ₸', expensesSum],
          ['Продаж', list.length],
          ['Средний чек, ₸', list.length ? Math.round(revenue / list.length) : 0]
        ];
        var salesRows = [['№', 'Время', 'Продавец', 'Товары', 'Кол-во', 'Сумма, ₸', 'Оплата', 'Наличные, ₸', 'QR, ₸', 'Чек']];
        list.forEach(function (s) {
          salesRows.push([s.code || '', fmtTime(s.createdAt), s.userName, (s.items || []).map(function (i) { return i.name + ' ×' + i.qty; }).join(', '),
            (s.items || []).reduce(function (n, i) { return n + i.qty; }, 0), s.total, paymentLabel(s.payment), s.cashAmount || 0, s.qrAmount || 0, s.receipt ? 'Да' : '—']);
        });
        var expRows = [['Время', 'Сотрудник', 'Причина', 'Сумма, ₸']];
        exp.forEach(function (e) { expRows.push([fmtTime(e.createdAt), e.userName, e.reason, e.amount]); });
        PosXlsx.downloadXlsx('kassa_' + dayKey(Date.now()) + '.xlsx', [
          { name: 'Сводка', rows: summary },
          { name: 'Продажи', rows: salesRows },
          { name: 'Расходы', rows: expRows }
        ]);
        toast('Данные кассы выгружены', 'success');
      }

      // обработчики шапки
      var pointSelect = root.querySelector('#cashPoint');
      if (pointSelect) {
        pointSelect.addEventListener('change', function () {
          var next = pointSelect.value;
          if (isSeller) setActivePoint(user, next);
          state.pointId = next;
          state.cart = {};
          state.receipt = null;
          state.cashTouched = false;
          state.qrTouched = false;
          state.cashPart = '';
          state.qrPart = '';
          toast('Точка продаж: ' + pointName(next) + ' — корзина очищена', 'info', 3200);
          ctx.rerender();
        });
      }
      function openExpense() {
        window.openExpenseModal({ user: user, pointId: pointId, onDone: function () { ctx.rerender(); } });
      }
      var winBtn = root.querySelector('#salesWindowBtn');
      if (winBtn) winBtn.addEventListener('click', function () {
        openSalesWindowModal(user, pointId, function () { ctx.rerender(); });
      });
      var addExpBtn = root.querySelector('#addExpenseBtn');
      if (addExpBtn) addExpBtn.addEventListener('click', openExpense);
      var addExpBtn2 = root.querySelector('#addExpenseBtn2');
      if (addExpBtn2) addExpBtn2.addEventListener('click', openExpense);
      var cashExportBtn = root.querySelector('#cashExport');
      if (cashExportBtn) cashExportBtn.addEventListener('click', exportCash);

      renderChips();
      renderGrid();
      renderCart();
      renderTodaySales();
      renderTodayExpenses();
    }
  };

  // сброс корзины при смене точки из шапки
  window.resetCashStatePoint = function () {
    state.cart = {};
    state.receipt = null;
    state.cashTouched = false;
    state.qrTouched = false;
    state.cashPart = '';
    state.qrPart = '';
    state.pointId = null;
  };

  // сброс корзины при выходе из системы
  window.resetCashState = function () {
    state.cart = {};
    state.receipt = null;
    state.cashTouched = false;
    state.qrTouched = false;
    state.cashPart = '';
    state.qrPart = '';
    state.payment = 'cash';
    state.search = '';
    state.category = 'all';
    state.pointId = null;
  };
})();
