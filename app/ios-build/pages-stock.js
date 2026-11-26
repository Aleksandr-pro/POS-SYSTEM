/* ============================================================
   POS Контроль — склад: остатки по точкам, история изменений
   ============================================================ */
(function () {
  'use strict';
  var PAGES = window.PAGES = window.PAGES || {};
  var pageState = { pointId: null, search: '', periodFrom: null, periodTo: null };

  function stockData(pointId) {
    return productsForPoint(pointId).map(function (product) {
      var row = stockRow(pointId, product.id);
      return { product: product, row: row };
    }).sort(function (a, b) { return a.product.name.localeCompare(b.product.name, 'ru'); });
  }

  function stats(pointId) {
    var data = stockData(pointId);
    var tracked = data.filter(function (x) { return x.row; });
    return {
      positions: tracked.length,
      total: tracked.reduce(function (s, x) { return s + x.row.qty; }, 0),
      low: tracked.filter(function (x) { return x.row.qty > 0 && x.row.qty <= 5; }).length,
      out: tracked.filter(function (x) { return x.row.qty === 0; }).length,
      untracked: data.length - tracked.length,
      products: data.length
    };
  }

  function openHistoryModal(user, pointId, product) {
    var row = stockRow(pointId, product.id);
    var history = row && row.history ? row.history : [];
    openModal({
      title: 'История остатков',
      subtitle: product.name + ' · ' + pointName(pointId),
      size: 'sm',
      body: history.length
        ? '<div class="history-list">' + history.slice(0, 40).map(function (h) {
            return '<div class="history-row">' +
              '<div class="d ' + (h.delta >= 0 ? 'plus' : 'minus') + '">' + (h.delta > 0 ? '+' : '') + h.delta + '</div>' +
              '<div class="grow"><div class="flex between gap-8"><span class="semibold">' + esc(h.note || 'Изменение') + '</span>' +
                '<span class="stock-qty" style="font-size:12px">' + h.qtyAfter + ' шт</span></div>' +
                '<div class="tm">' + fmtDateTime(h.at) + ' · ' + esc(h.by || '') + '</div></div>' +
            '</div>';
          }).join('') + '</div>'
        : '<div class="muted small" style="padding:6px 0 10px">История пуста — остаток ещё не изменялся.</div>',
      footer: '<button type="button" class="btn btn-secondary" data-close>Закрыть</button>',
      onMount: function (el, close) { el.querySelector('[data-close]').addEventListener('click', close); }
    });
  }

  function openStockModal(args) {
    var user = args.user;
    var pointId = args.pointId;
    var products = productsForPoint(pointId);
    if (!products.length) {
      toast('Сначала добавьте товары в каталог', 'warn');
      return;
    }
    var presetProduct = args.product || null;
    var currentRow = presetProduct ? stockRow(pointId, presetProduct.id) : null;

    var selectField = presetProduct
      ? '<div class="field"><label>Товар</label><div class="input" style="display:flex;align-items:center">' + esc(presetProduct.name) + '</div></div>'
      : '<div class="field"><label for="stockProduct">Товар</label><select class="select" id="stockProduct">' +
          products.map(function (p) {
            var row = stockRow(pointId, p.id);
            return '<option value="' + p.id + '">' + esc(p.name) + (row ? ' — сейчас ' + row.qty + ' шт' : ' — не учитывается') + '</option>';
          }).join('') +
        '</select></div>';

    openModal({
      title: presetProduct ? 'Изменить остаток' : 'Добавить остаток',
      subtitle: pointName(pointId),
      size: 'sm',
      body: '<form id="stockForm" style="display:flex;flex-direction:column;gap:14px">' +
        selectField +
        '<div class="field"><label for="stockQty">Количество, шт</label>' +
          '<input class="input" id="stockQty" inputmode="numeric" value="' + (currentRow ? currentRow.qty : '') + '" placeholder="0" autofocus></div>' +
        '<div class="field"><label for="stockNote">Комментарий</label>' +
          '<input class="input" id="stockNote" placeholder="Например: поставка, пересчёт, списание"></div>' +
        '<div class="form-note info">' + icon('info', 15) + '<span>Все изменения остатков сохраняются в истории с датой и сотрудником.</span></div>' +
      '</form>',
      footer:
        (currentRow ? '<button type="button" class="btn btn-danger-soft" id="stockRemove">' + icon('trash', 15) + ' Убрать из учёта</button>' : '') +
        '<button type="button" class="btn btn-secondary" id="stockCancel">Отмена</button>' +
        '<button type="button" class="btn btn-primary" id="stockSave">Сохранить</button>',
      onMount: function (el, close) {
        el.querySelector('#stockCancel').addEventListener('click', close);
        var removeBtn = el.querySelector('#stockRemove');
        if (removeBtn) {
          removeBtn.addEventListener('click', async function () {
            var ok = await confirmDialog({
              title: 'Убрать из учёта?',
              message: 'Остаток товара «' + esc(presetProduct.name) + '» на этой точке перестанет учитываться. История удалится.',
              confirmText: 'Убрать',
              danger: true
            });
            if (!ok) return;
            DB.stock = DB.stock.filter(function (r) { return !(r.pointId === pointId && r.productId === presetProduct.id); });
            saveDB();
            close();
            toast('Товар убран из учёта остатков');
            if (args.onDone) args.onDone();
          });
        }
        el.querySelector('#stockSave').addEventListener('click', function () {
          var productId = presetProduct ? presetProduct.id : el.querySelector('#stockProduct').value;
          var qty = parseAmount(el.querySelector('#stockQty').value);
          var note = el.querySelector('#stockNote').value.trim();
          if (el.querySelector('#stockQty').value === '' || !isFinite(qty) || qty < 0) {
            toast('Укажите корректное количество', 'error');
            el.querySelector('#stockQty').focus();
            return;
          }
          if (!productId) { toast('Выберите товар', 'error'); return; }
          var product = getProduct(productId);
          setStockQty(pointId, productId, qty, note || (currentRow ? 'Корректировка остатка' : 'Добавление остатка'), user);
          close();
          toast('Остаток «' + (product ? product.name : '') + '»: ' + qty + ' шт', 'success');
          if (args.onDone) args.onDone();
        });
      }
    });
  }

  function supplyDetailHtml(supply) {
    return '<div class="flex between wrap gap-8" style="margin-bottom:12px">' +
        '<div><div class="semibold">Поставка на склад</div>' +
          '<div class="muted tiny">' + fmtDateTime(supply.createdAt) + ' · ' + esc(supply.userName || '') + '</div></div>' +
        '<span class="badge neutral">' + (supply.code || '') + '</span>' +
      '</div>' +
      '<div class="table-wrap"><table class="tbl"><thead><tr><th>Товар</th><th class="text-right">Кол-во</th></tr></thead><tbody>' +
        supply.items.map(function (it) {
          return '<tr><td><div class="cell-main truncate" style="max-width:260px">' + esc(it.name) + '</div></td>' +
            '<td class="text-right"><span class="badge neutral">' + it.qty + ' шт</span></td></tr>';
        }).join('') +
      '</tbody></table></div>' +
      '<div class="pay-totals" style="margin-top:12px">' +
        '<div class="row total"><span class="nm">Всего единиц</span><span class="val">' + supply.totalQty + ' шт</span></div>' +
      '</div>';
  }

  function openSupplyDetail(supply, opts) {
    opts = opts || {};
    openModal({
      title: 'Поставка ' + (supply.code || ''),
      subtitle: (supply.pointName || pointName(supply.pointId)),
      size: 'sm',
      body: supplyDetailHtml(supply),
      footer:
        (opts.canDelete ? '<button type="button" class="btn btn-danger-soft" id="supplyDel">' + icon('trash', 15) + ' Отменить поставку</button>' : '') +
        '<button type="button" class="btn btn-secondary" data-close>Закрыть</button>',
      onMount: function (el, close) {
        el.querySelector('[data-close]').addEventListener('click', close);
        var del = el.querySelector('#supplyDel');
        if (del) del.addEventListener('click', async function () {
          var ok = await confirmDialog({
            title: 'Отменить поставку?',
            message: 'Товары поставки <b>' + esc(supply.code || '') + '</b> будут списаны со склада, запись удалена из статистики.',
            confirmText: 'Отменить поставку',
            danger: true
          });
          if (!ok) return;
          deleteSupply(supply.id, opts.actor);
          close();
          toast('Поставка отменена');
          if (opts.onDeleted) opts.onDeleted();
        });
      }
    });
  }

  function openSuppliesModal(args) {
    var pointId = args.pointId;
    var actor = args.user;
    var canDelete = actor.role === 'admin';
    function listHtml() {
      var list = DB.supplies.filter(function (x) { return x.pointId === pointId; })
        .sort(function (a, b) { return b.createdAt - a.createdAt; });
      if (!list.length) return '<div class="tbl-empty">Поставок на эту точку ещё не было</div>';
      return '<div class="table-wrap"><table class="tbl"><thead><tr><th>Дата</th><th>Позиций</th><th>Единиц</th><th></th></tr></thead><tbody>' +
        list.map(function (sp) {
          return '<tr data-supply="' + sp.id + '" style="cursor:pointer">' +
            '<td><div class="cell-main nowrap">' + fmtDate(sp.createdAt) + '</div><div class="cell-sub">' + esc(sp.code || '') + '</div></td>' +
            '<td><span class="badge neutral">' + (sp.items || []).length + '</span></td>' +
            '<td><span class="badge neutral">' + (sp.totalQty || 0) + ' шт</span></td>' +
            '<td><span class="icon-btn">' + icon('chevronRight', 15) + '</span></td></tr>';
        }).join('') + '</tbody></table></div>';
    }
    var handle = openModal({
      title: 'Поставки',
      subtitle: pointName(pointId),
      size: 'lg',
      body: '<div id="supplyList">' + listHtml() + '</div>',
      footer: '<button type="button" class="btn btn-secondary" data-close>Закрыть</button>',
      onMount: function (el, close) {
        el.querySelector('[data-close]').addEventListener('click', close);
        el.addEventListener('click', function (e) {
          var tr = e.target.closest('[data-supply]');
          if (!tr) return;
          var sp = DB.supplies.find(function (x) { return x.id === tr.getAttribute('data-supply'); });
          if (!sp) return;
          openSupplyDetail(sp, { actor: actor, canDelete: canDelete, onDeleted: function () {
            var box = el.querySelector('#supplyList');
            if (box) box.innerHTML = listHtml();
            if (args.onDone) args.onDone();
          } });
        });
      }
    });
    return handle;
  }

  function openSupplyModal(args) {
    var user = args.user;
    var points = user.role === 'seller' ? userPoints(user) : DB.points;
    if (!points.length) { toast('Сначала создайте точку продаж', 'warn'); return; }
    var pointId = args.pointId || points[0].id;
    var products = productsForPoint(pointId).slice().sort(function (a, b) { return a.name.localeCompare(b.name, 'ru'); });
    if (!products.length) { toast('Сначала добавьте товары в каталог', 'warn'); return; }

    var rows = [{ productId: products[0].id, qty: '' }];

    function productOptions(selected) {
      return products.map(function (p) {
        return '<option value="' + p.id + '"' + (p.id === selected ? ' selected' : '') + '>' + esc(p.name) + '</option>';
      }).join('');
    }

    function rowHtml(r, i) {
      return '<div class="supply-row" data-row="' + i + '">' +
        '<select class="select" data-f="product">' + productOptions(r.productId) + '</select>' +
        '<input class="input" data-f="qty" inputmode="numeric" placeholder="Кол-во" value="' + esc(r.qty) + '">' +
        '<button type="button" class="icon-btn danger" data-row-remove title="Убрать">' + icon('x', 15) + '</button>' +
      '</div>';
    }

    function totals() {
      var qty = 0;
      rows.forEach(function (r) {
        qty += Math.round(Number(parseAmount(r.qty)) || 0);
      });
      return { qty: qty, positions: rows.filter(function (r) { return parseAmount(r.qty) > 0; }).length };
    }

    openModal({
      title: 'Поставка на склад',
      subtitle: 'Приход товара увеличивает остаток точки',
      size: 'lg',
      body:
        '<form id="supplyForm" class="supply-form">' +
          (points.length > 1
            ? '<div class="field"><label for="supPoint">Точка продаж</label><select class="select" id="supPoint">' +
                points.map(function (p) { return '<option value="' + p.id + '"' + (p.id === pointId ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }).join('') +
              '</select></div>'
            : '') +
          '<div class="field"><label>Товары в поставке</label>' +
            '<div class="supply-head"><span>Товар</span><span>Кол-во</span><span></span></div>' +
            '<div id="supplyRows"></div>' +
            '<button type="button" class="btn btn-sm btn-secondary" id="supplyAddRow" style="margin-top:8px">' + icon('plus', 14) + ' Добавить позицию</button>' +
          '</div>' +
          '<div class="form-note info">' + icon('info', 15) + '<span>Выберите товар и количество — остаток на точке увеличится, приход попадёт в историю склада и в статистику.</span></div>' +
          '<div class="pay-totals" id="supplyTotals"></div>' +
        '</form>',
      footer:
        '<button type="button" class="btn btn-secondary" id="supplyCancel">Отмена</button>' +
        '<button type="button" class="btn btn-primary" id="supplySave">' + icon('check', 16) + ' Оприходовать</button>',
      onMount: function (el, close) {
        var box = el.querySelector('#supplyRows');

        function paint() {
          box.innerHTML = rows.map(rowHtml).join('');
          box.querySelectorAll('[data-row]').forEach(function (rowEl) {
            var i = Number(rowEl.getAttribute('data-row'));
            rowEl.querySelector('[data-f="product"]').addEventListener('change', function (e) { rows[i].productId = e.target.value; });
            rowEl.querySelector('[data-f="qty"]').addEventListener('input', function (e) { rows[i].qty = e.target.value; paintTotals(); });
            rowEl.querySelector('[data-row-remove]').addEventListener('click', function () {
              if (rows.length === 1) { rows[0] = { productId: products[0].id, qty: '' }; }
              else rows.splice(i, 1);
              paint();
            });
          });
          paintTotals();
        }
        function paintTotals() {
          var t = totals();
          el.querySelector('#supplyTotals').innerHTML =
            '<div class="row total"><span class="nm">Позиций: ' + t.positions + '</span><span class="val">' + fmtNumber(t.qty) + ' шт</span></div>';
        }

        paint();
        el.querySelector('#supplyAddRow').addEventListener('click', function () {
          rows.push({ productId: products[0].id, qty: '' });
          paint();
        });
        el.querySelector('#supplyCancel').addEventListener('click', close);

        var pointSel = el.querySelector('#supPoint');
        if (pointSel) pointSel.addEventListener('change', function () {
          pointId = pointSel.value;
          products = productsForPoint(pointId).slice().sort(function (a, b) { return a.name.localeCompare(b.name, 'ru'); });
          rows = [{ productId: products[0].id, qty: '' }];
          paint();
        });

        el.querySelector('#supplySave').addEventListener('click', function () {
          var items = rows.map(function (r) {
            return { productId: r.productId, qty: parseAmount(r.qty) };
          }).filter(function (it) { return it.qty > 0; });
          if (!items.length) {
            toast('Укажите количество хотя бы для одного товара', 'error');
            return;
          }
          var supply = addSupply({ pointId: pointId, items: items }, user);
          if (!supply) { toast('Не удалось провести поставку', 'error'); return; }
          close();
          toast('Поставка ' + supply.code + ': ' + supply.totalQty + ' шт на ' + pointName(pointId), 'success', 4200);
          if (args.onDone) args.onDone();
        });
      }
    });
  }

  window.openSupplyModal = openSupplyModal;

  window.openStockModal = openStockModal;

  /* ---------- Сверка склада: две кнопки, без ввода цифр ---------- */
  function stockCheckCard(user, pointId, ctx) {
    var check = stockCheckForDay(user.id, pointId);
    var isMismatch = check && check.result === 'mismatch';
    var statusHtml = !check
      ? badge('Не проверялся', 'badge-neutral', true)
      : (check.result === 'match' ? badge('Данные сходятся', 'badge-success', true) : badge('Данные не сходятся', 'badge-warn', true));
    return '<div class="card check-card" id="stockCheckCard">' +
      '<div class="check-card-head">' +
        '<div><h3>Сверка склада</h3><div class="sub">' + esc(pointName(pointId)) + ' · ' + fmtDateHuman(Date.now()) + '</div></div>' +
        statusHtml +
      '</div>' +
      '<div class="check-card-body">' +
        '<div class="check-q">Данные склада сходятся?</div>' +
        '<div class="check-actions">' +
          '<button type="button" class="btn ' + (check && check.result === 'match' ? 'btn-primary' : 'btn-secondary') + ' btn-lg" id="stockCheckYes"' +
            (isMismatch ? '' : '') + '>Данные сходятся</button>' +
          '<button type="button" class="btn ' + (isMismatch ? 'btn-danger-soft' : 'btn-secondary') + ' btn-lg" id="stockCheckNo">Данные не сходятся</button>' +
        '</div>' +
        (check ? '<div class="check-time">Отмечено в ' + fmtTime(check.at) + ' · ' + esc(check.userName || '') + '</div>' : '') +
      '</div>' +
    '</div>';
  }

  function bindStockCheckCard(root, user, pointId, ctx) {
    function save(result) {
      var res = saveStockCheck({ pointId: pointId, result: result }, user);
      if (res && res.error) { toast(res.error, 'error'); return; }
      toast(result === 'match' ? 'Отмечено: данные сходятся' : 'Отмечено: данные не сходятся', 'success', 4200);
      // если продавца сюда отправили с кассы — возвращаем обратно, касса уже открыта
      if (window.__returnToCashAfterCheck && ctx && ctx.navigate) {
        window.__returnToCashAfterCheck = false;
        ctx.navigate('cash');
        return;
      }
      if (ctx && ctx.rerender) ctx.rerender();
    }
    var yes = root.querySelector('#stockCheckYes');
    if (yes) yes.addEventListener('click', function () { save('match'); });
    var no = root.querySelector('#stockCheckNo');
    if (no) no.addEventListener('click', function () { save('mismatch'); });
  }

  window.renderStockCheckCard = function (container, user, pointId, ctx) {
    container.innerHTML = stockCheckCard(user, pointId, ctx);
    bindStockCheckCard(container, user, pointId, ctx);
  };

  window.renderStockTable = function (container, opts) {
    var user = opts.user;
    var pointId = opts.pointId;
    var showPointSelect = !!opts.showPointSelect;
    var onChanged = opts.onChange || function () {};

    function render() {
      if (!pointId) {
        container.innerHTML = emptyState('layers', 'Выберите точку продаж', 'Остатки ведутся отдельно для каждой точки.');
        return;
      }
      var data = stockData(pointId);
      var s = stats(pointId);
      var points = user.role === 'seller' ? userPoints(user) : DB.points;
      var supplyMonth = supplyTotals(suppliesBetween(startOfDay(addDays(new Date(), -29)), Date.now(), { pointId: pointId }));
      var supplyRecent = DB.supplies.filter(function (x) { return x.pointId === pointId; })
        .sort(function (a, b) { return b.createdAt - a.createdAt; });
      var soldMonth = salesBetween(startOfDay(addDays(new Date(), -29)), Date.now(), { pointId: pointId })
        .reduce(function (n, sale) { return n + (sale.items || []).reduce(function (m, it) { return m + (it.qty || 0); }, 0); }, 0);

      if (!data.length) {
        container.innerHTML =
          '<div class="card">' + emptyState('package', 'На точке нет товаров', 'Добавьте товары в каталог и назначьте их этой точке.',
            user.role !== 'seller' ? '<button class="btn btn-primary" id="stockGoProducts">' + icon('plus', 16) + ' Перейти к товарам</button>' : '') + '</div>';
        var gp = container.querySelector('#stockGoProducts');
        if (gp) gp.addEventListener('click', function () { opts.ctx.navigate('products'); });
        return;
      }

      var rowsHtml = data.map(function (item) {
        var p = item.product, row = item.row;
        var qty = row ? row.qty : null;
        var qtyCls = qty === null ? '' : (qty === 0 ? 'zero' : (qty <= 5 ? 'low' : ''));
        return '<tr data-stock-row data-name="' + esc(p.name.toLowerCase()) + '" data-cat="' + esc(categoryName(p.categoryId).toLowerCase()) + '">' +
          '<td><div class="user-cell">' +
            '<div class="thumb" style="width:36px;height:36px;border-radius:9px;overflow:hidden;flex:0 0 auto;background:' + productGradient(p.name) + ';display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700">' +
              (p.photo ? '<img src="' + p.photo + '" alt="" style="width:100%;height:100%;object-fit:cover">' : esc(p.name.slice(0, 1).toUpperCase())) +
            '</div>' +
            '<div style="min-width:0"><div class="nm truncate">' + esc(p.name) + '</div><div class="un">' + esc(categoryName(p.categoryId)) + ' · ' + fmtMoney(p.price) + '</div></div>' +
          '</div></td>' +
          '<td' + (user.role === 'admin' ? ' data-qty="' + p.id + '" class="qty-cell" title="Нажмите, чтобы изменить остаток"' : '') + '>' +
            '<span class="stock-qty ' + qtyCls + '">' + (qty === null ? '<span class="badge neutral">не учтён</span>' : qty + ' шт') + '</span>' +
            (user.role === 'admin' ? '<span class="qty-edit-hint">' + icon('edit', 12) + '</span>' : '') + '</td>' +
          '<td class="hide-sm">' + (row
            ? '<div class="muted small nowrap">' + fmtDateTime(row.updatedAt) + '</div>' +
              (row.history && row.history[0] ? '<div class="cell-sub truncate" style="max-width:170px" title="' + esc(row.history[0].note) + '">' + esc(row.history[0].note) + '</div>' : '')
            : '<span class="muted small">—</span>') + '</td>' +
          '<td><div class="actions">' +
            (row
              ? '<div class="stock-btns">' +
                  '<button type="button" class="icon-btn" data-step="-1" data-id="' + p.id + '" title="Убавить">' + icon('minus', 15) + '</button>' +
                  '<button type="button" class="icon-btn" data-step="1" data-id="' + p.id + '" title="Прибавить">' + icon('plus', 15) + '</button>' +
                '</div>' +
                '<button type="button" class="icon-btn" data-edit="' + p.id + '" title="Изменить остаток">' + icon('edit', 15) + '</button>' +
                '<button type="button" class="icon-btn" data-history="' + p.id + '" title="История">' + icon('history', 16) + '</button>'
              : '<button type="button" class="btn btn-sm btn-secondary" data-edit="' + p.id + '">' + icon('plus', 14) + ' Добавить</button>') +
          '</div></td>' +
        '</tr>';
      }).join('');

      container.innerHTML =
        '<div class="kpi-inline" style="margin-bottom:16px">' +
          '<div class="kpi-mini"><div class="l">Позиций на учёте</div><div class="v">' + s.positions + ' <span class="tiny muted">из ' + s.products + '</span></div></div>' +
          '<div class="kpi-mini"><div class="l">Всего единиц</div><div class="v">' + fmtNumber(s.total) + ' шт</div></div>' +
          '<div class="kpi-mini"><div class="l">Заканчивается</div><div class="v" style="color:var(--warning)">' + s.low + '</div></div>' +
          '<div class="kpi-mini"><div class="l">Нет в наличии</div><div class="v" style="color:var(--danger)">' + s.out + '</div></div>' +
          '<div class="kpi-mini"><div class="l">Поставки за 30 дней</div><div class="v">' + supplyMonth.count + ' <span class="tiny muted">· ' + fmtNumber(supplyMonth.qty) + ' шт</span></div></div>' +
          '<div class="kpi-mini"><div class="l">Продано за 30 дней</div><div class="v">' + fmtNumber(soldMonth) + ' <span class="tiny muted">шт</span></div></div>' +
        '</div>' +
        '<div class="card">' +
          '<div class="card-head" style="padding-bottom:14px">' +
            '<div><h3>Остатки товаров</h3><div class="sub">' + (pointId ? esc(pointName(pointId)) : '') + '</div></div>' +
            '<div class="flex gap-8 wrap">' +
              '<div class="input-icon" style="width:190px">' + icon('search', 15) +
                '<input class="input" id="stockSearch" style="height:36px" placeholder="Найти товар…" value="' + esc(pageState.search) + '"></div>' +
              (showPointSelect && points.length > 1
                ? '<select class="select" id="stockPointSelect" style="height:36px;width:auto;min-width:150px">' +
                    points.map(function (p) { return '<option value="' + p.id + '"' + (p.id === pointId ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }).join('') +
                  '</select>'
                : '') +
              (showPointSelect
                ? (user.role === 'admin'
                    ? '<button type="button" class="btn btn-primary btn-sm" id="stockSupplyBtn">' + icon('package', 15) + ' Поставка</button>'
                    : '') +
                  '<button type="button" class="btn btn-secondary btn-sm" id="stockAddBtn">' + icon('plus', 15) + ' Добавить остаток</button>'
                : '') +
            '</div>' +
          '</div>' +
          '<div class="card-body" style="padding-top:0">' +
            '<div class="table-wrap"><table class="tbl" id="stockTable"><thead><tr>' +
              '<th>Товар</th><th>Остаток</th><th class="hide-sm">Обновлено</th><th style="width:170px"></th>' +
            '</tr></thead><tbody>' + rowsHtml + '</tbody></table></div>' +
          '</div>' +
        '</div>' +
        '<div class="card" style="margin-top:16px">' +
          '<div class="card-head">' +
            '<div><h3>Поставки на точку</h3><div class="sub">' + (supplyRecent.length ? supplyRecent.length + ' ' + plural(supplyRecent.length, 'поставка', 'поставки', 'поставок') + ' · последняя ' + fmtDateTime(supplyRecent[0].createdAt) : 'Пока не было') + '</div></div>' +
            (supplyRecent.length
              ? '<button type="button" class="btn btn-sm btn-secondary" id="stockSupplyAll">Все поставки' + icon('chevronRight', 14) + '</button>'
              : '') +
          '</div>' +
          '<div class="card-body" style="padding-top:10px">' +
            '<div id="stockSupplyRecentBox">' + (supplyRecent.length
              ? '<div class="table-wrap"><table class="tbl"><thead><tr><th>Дата</th><th>Позиций</th><th>Единиц</th><th></th></tr></thead><tbody>' +
                  supplyRecent.slice(0, 5).map(function (sp) {
                    return '<tr data-recent-supply="' + sp.id + '" style="cursor:pointer">' +
                      '<td><div class="cell-main nowrap">' + fmtDate(sp.createdAt) + '</div><div class="cell-sub">' + esc(sp.code || '') + '</div></td>' +
                      '<td><span class="badge neutral">' + (sp.items || []).length + '</span></td>' +
                      '<td><span class="badge neutral">' + (sp.totalQty || 0) + ' шт</span></td>' +
                      '<td><span class="icon-btn">' + icon('chevronRight', 15) + '</span></td></tr>';
                  }).join('') + '</tbody></table></div>'
              : '<div class="muted small" style="padding:6px 0 10px">Поставок ещё не было. Нажмите «Поставка», чтобы оприходовать товар на точку.</div>') +
            '</div>' +
          '</div>' +
        '</div>';

      var searchInput = container.querySelector('#stockSearch');
      searchInput.addEventListener('input', function () {
        pageState.search = searchInput.value;
        var q = pageState.search.trim().toLowerCase();
        container.querySelectorAll('[data-stock-row]').forEach(function (tr) {
          var hay = tr.getAttribute('data-name') + ' ' + tr.getAttribute('data-cat');
          tr.style.display = hay.indexOf(q) === -1 ? 'none' : '';
        });
      });
      container.querySelectorAll('[data-edit]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var p = getProduct(btn.getAttribute('data-edit'));
          if (p) openStockModal({ user: user, pointId: pointId, product: p, onDone: function () { render(); onChanged(); } });
        });
      });
      container.querySelectorAll('[data-history]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var p = getProduct(btn.getAttribute('data-history'));
          if (p) openHistoryModal(user, pointId, p);
        });
      });
      // правка остатка прямо в таблице: новая цифра сразу становится текущей
      container.querySelectorAll('[data-qty]').forEach(function (td) {
        td.addEventListener('click', function () {
          if (td.querySelector('input')) return;
          var productId = td.getAttribute('data-qty');
          var product = getProduct(productId);
          var row = stockRow(pointId, productId);
          var oldQty = row ? row.qty : 0;
          td.innerHTML = '<input class="input qty-inline" inputmode="numeric" value="' + oldQty + '">';
          var input = td.querySelector('input');
          input.focus();
          input.select();
          var done = false;
          function cancel() {
            if (done) return;
            done = true;
            render();
          }
          function commit() {
            if (done) return;
            done = true;
            var raw = input.value.trim();
            var next = parseAmount(raw);
            if (raw === '' || !isFinite(next) || next < 0) {
              toast('Укажите корректное количество', 'error');
              render();
              return;
            }
            if (next === oldQty) { render(); return; }
            setStockQty(pointId, productId, next, 'Правка остатка в таблице', user);
            toast('Остаток «' + (product ? product.name : '') + '»: ' + next + ' шт', 'success');
            render();
            onChanged();
          }
          input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') { e.preventDefault(); commit(); }
            else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
          });
          input.addEventListener('blur', commit);
          td.addEventListener('click', function (e) { e.stopPropagation(); }, { once: true });
        });
      });

      container.querySelectorAll('[data-step]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var productId = btn.getAttribute('data-id');
          var step = Number(btn.getAttribute('data-step'));
          var row = stockRow(pointId, productId);
          if (!row) return;
          var next = Math.max(0, row.qty + step);
          if (next === row.qty) { toast('Остаток уже 0', 'warn'); return; }
          setStockQty(pointId, productId, next, step > 0 ? 'Быстрое пополнение' : 'Быстрое списание', user);
          render();
          onChanged();
        });
      });
      var addBtnEl = container.querySelector('#stockAddBtn');
      if (addBtnEl) addBtnEl.addEventListener('click', function () {
        openStockModal({ user: user, pointId: pointId, onDone: function () { render(); onChanged(); } });
      });
      var supplyBtn = container.querySelector('#stockSupplyBtn');
      if (supplyBtn) supplyBtn.addEventListener('click', function () {
        openSupplyModal({ user: user, pointId: pointId, onDone: function () { render(); onChanged(); } });
      });
      var supplyAll = container.querySelector('#stockSupplyAll');
      if (supplyAll) supplyAll.addEventListener('click', function () {
        openSuppliesModal({ user: user, pointId: pointId, onDone: function () { render(); onChanged(); } });
      });
      container.querySelectorAll('[data-recent-supply]').forEach(function (tr) {
        tr.addEventListener('click', function () {
          var sp = DB.supplies.find(function (x) { return x.id === tr.getAttribute('data-recent-supply'); });
          if (!sp) return;
          openSupplyDetail(sp, { actor: user, canDelete: user.role === 'admin', onDeleted: function () { render(); onChanged(); } });
        });
      });
      var pointSelect = container.querySelector('#stockPointSelect');
      if (pointSelect) {
        pointSelect.addEventListener('change', function () {
          pointId = pointSelect.value;
          pageState.pointId = pointId;
          if (user.role === 'seller') setActivePoint(user, pointId);
          render();
          onChanged();
        });
      }
    }

    render();
    return { refresh: render };
  };

  function renderDayReport(container, opts) {
    var pointId = opts.pointId;
    var ctx = opts.ctx;
    var user = opts.user || currentUser();
    var todayKey = dayKey(new Date());
    var fromKey = pageState.periodFrom || dayKey(new Date());
    var toKey = pageState.periodTo || fromKey;
    if (fromKey > todayKey) fromKey = todayKey;
    if (toKey > todayKey) toKey = todayKey;
    if (toKey < fromKey) toKey = fromKey;
    pageState.periodFrom = fromKey;
    pageState.periodTo = toKey;

    var report = stockPeriodReport(pointId, fromKey, toKey);
    var single = report.single;
    var t = report.totals;
    var L = single
      ? { start: 'Остаток вчера', supply: 'Поставка сегодня', adjust: 'Корректировка', sold: 'Продано', end: 'Конец дня', head: 'Отчёт по складу за день' }
      : { start: 'Остаток на начало', supply: 'Поставка за период', adjust: 'Корректировка', sold: 'Продано', end: 'Остаток на конец', head: 'Отчёт по складу за период' };
    var showAdjust = !!report.hasAdjust;
    // админ правит числа прямо в таблице, и только в отчёте за сегодня:
    // любая правка меняет остаток на точке, а следующие цифры считаются уже от него
    var canEditQty = user.role === 'admin' && single && fromKey === todayKey;

    function cell(v) {
      if (v === null || v === undefined) return '<span class="muted">—</span>';
      return fmtNumber(v) + ' <span class="tiny muted">шт</span>';
    }

    // ячейка с правкой по клику
    function editCell(field, productId, current, html, opts) {
      opts = opts || {};
      var editable = canEditQty && (!opts.needTracked || !opts.zero);
      return '<td class="text-right num' + (editable ? ' qty-cell' : '') + '"' +
        (editable ? ' data-day-edit="' + field + '" data-pid="' + productId + '" data-cur="' + (current === null || current === undefined ? 0 : current) +
          '" title="Нажмите, чтобы изменить"' : '') + '>' +
        html + (editable ? '<span class="qty-edit-hint">' + icon('edit', 12) + '</span>' : '') + '</td>';
    }

    var rowsHtml = report.rows.map(function (r) {
      var zero = r.yesterday === null;
      return '<tr data-day-row data-name="' + esc((r.name + ' ' + r.category).toLowerCase()) + '">' +
        '<td><div class="cell-main truncate" style="max-width:260px">' + esc(r.name) + '</div>' +
          '<div class="cell-sub">' + fmtMoney(r.price) + '</div></td>' +
        '<td><span class="badge neutral">' + esc(r.category) + '</span></td>' +
        editCell('yesterday', r.productId, zero ? 0 : r.yesterday, cell(r.yesterday)) +
        editCell('supply', r.productId, r.supply,
          (r.supply ? '<b style="color:var(--success-600)">+' + fmtNumber(r.supply) + '</b>' : '<span class="muted">0</span>'),
          { needTracked: true, zero: zero }) +
        (showAdjust ? '<td class="text-right num">' + (r.adjust
          ? '<b style="color:' + (r.adjust > 0 ? 'var(--success-600)' : 'var(--danger-600)') + '">' + (r.adjust > 0 ? '+' : '−') + fmtNumber(Math.abs(r.adjust)) + '</b>'
          : '<span class="muted">0</span>') + '</td>' : '') +
        editCell('sold', r.productId, r.sold,
          (r.sold ? '<b style="color:var(--danger-600)">−' + fmtNumber(r.sold) + '</b>' : '<span class="muted">0</span>') +
            (r.manualSold ? '<div class="cell-sub">ручных: ' + fmtNumber(r.manualSold) + '</div>' : ''),
          { needTracked: true, zero: zero }) +
        editCell('end', r.productId, zero ? 0 : r.end,
          (zero ? '<span class="muted">—</span>' : '<b>' + fmtNumber(r.end) + '</b> <span class="tiny muted">шт</span>'),
          { needTracked: true, zero: zero }) +
      '</tr>';
    }).join('');

    var rangeLabel = single
      ? fmtDateHuman(parseDayKey(fromKey))
      : fmtDateHuman(parseDayKey(fromKey)) + ' — ' + fmtDateHuman(parseDayKey(toKey)) + ' · ' + report.days + ' ' + plural(report.days, 'день', 'дня', 'дней');

    function chip(key, label, active) {
      return '<button type="button" class="chip' + (active ? ' active' : '') + '" data-range="' + key + '">' + label + '</button>';
    }
    var weekFrom = dayKey(addDays(new Date(), -6));
    var monthFrom = dayKey(new Date(new Date().getFullYear(), new Date().getMonth(), 1));

    container.innerHTML =
      '<div class="day-report-head">' +
        '<label class="date-field"><span>С</span><input class="input" type="date" id="stockDayDate" value="' + fromKey + '" max="' + todayKey + '"></label>' +
        '<label class="date-field"><span>По</span><input class="input" type="date" id="stockDayTo" value="' + toKey + '" max="' + todayKey + '"></label>' +
        '<div class="date-quick">' +
          chip('today', 'Сегодня', single && fromKey === todayKey) +
          chip('yesterday', 'Вчера', single && fromKey === dayKey(addDays(new Date(), -1))) +
          chip('week', '7 дней', fromKey === weekFrom && toKey === todayKey) +
          chip('month', '30 дней', toKey === todayKey && fromKey === dayKey(addDays(new Date(), -29))) +
          chip('thisMonth', 'Этот месяц', fromKey === monthFrom && toKey === todayKey) +
        '</div>' +
        '<span class="date-result">' + rangeLabel + '</span>' +
      '</div>' +
      '<div class="kpi-inline" style="margin-bottom:16px">' +
        '<div class="kpi-mini"><div class="l">' + L.start + '</div><div class="v">' + fmtNumber(t.yesterday) + ' <span class="tiny muted">шт</span></div></div>' +
        '<div class="kpi-mini"><div class="l">' + L.supply + '</div><div class="v">+' + fmtNumber(t.supply) + '</div></div>' +
        '<div class="kpi-mini"><div class="l">' + L.sold + '</div><div class="v" style="color:var(--danger-600)">−' + fmtNumber(t.sold) + '</div></div>' +
        '<div class="kpi-mini"><div class="l">' + L.end + '</div><div class="v">' + fmtNumber(t.end) + ' <span class="tiny muted">шт</span></div></div>' +
      '</div>' +
      '<div class="card">' +
        '<div class="card-head" style="padding-bottom:14px">' +
          '<div><h3>' + L.head + '</h3><div class="sub">' + esc(pointName(pointId)) + ' · ' + rangeLabel + '</div></div>' +
          '<div class="flex gap-8 wrap">' +
            '<div class="input-icon" style="width:180px">' + icon('search', 15) +
              '<input class="input" id="dayReportSearch" style="height:36px" placeholder="Найти товар…"></div>' +
            '<button type="button" class="btn btn-secondary btn-sm" id="dayReportExport">' + icon('download', 15) + ' Excel</button>' +
            '<button type="button" class="btn btn-secondary btn-sm" id="dayReportCopy">' + icon('upload', 15) + ' Скопировать таблицу</button>' +
          '</div>' +
        '</div>' +
        '<div class="card-body" style="padding-top:0">' +
          '<div class="table-wrap"><table class="tbl" id="dayReportTable"><thead><tr>' +
            '<th>Товар</th><th>Категория</th>' +
            '<th class="text-right">' + L.start + '</th>' +
            '<th class="text-right">' + L.supply + '</th>' +
            (showAdjust ? '<th class="text-right">' + L.adjust + '</th>' : '') +
            '<th class="text-right">' + L.sold + '</th>' +
            '<th class="text-right">' + L.end + '</th>' +
          '</tr></thead><tbody>' +
            (rowsHtml || '<tr><td colspan="' + (showAdjust ? 7 : 6) + '"><div class="tbl-empty">На этой точке нет товаров</div></td></tr>') +
            '<tr class="row-total"><td colspan="2"><b>Итого</b></td>' +
              '<td class="text-right num"><b>' + fmtNumber(t.yesterday) + '</b></td>' +
              '<td class="text-right num"><b>' + (t.supply ? '+' + fmtNumber(t.supply) : '0') + '</b></td>' +
              (showAdjust ? '<td class="text-right num"><b>' + (t.adjust ? (t.adjust > 0 ? '+' : '−') + fmtNumber(Math.abs(t.adjust)) : '0') + '</b></td>' : '') +
              '<td class="text-right num"><b>' + (t.sold ? '−' + fmtNumber(t.sold) : '0') + '</b></td>' +
              '<td class="text-right num"><b>' + fmtNumber(t.end) + '</b></td>' +
            '</tr>' +
          '</tbody></table></div>' +
        '</div>' +
      '</div>' +
      '<div class="form-note info" style="margin-top:14px">' + icon('info', 15) +
        '<span>Остаток на начало + поставки ' + (showAdjust ? '+ корректировки ' : '') + '− продажи = остаток на конец. Продажи и поставки подтягиваются автоматически.' +
        (canEditQty
          ? ' Администратор может изменить любую цифру — «' + L.start + '», «' + L.supply + '», «' + L.sold + '», «' + L.end + '»: нажмите на число и введите новое. Все следующие цифры будут считаться от новых данных.'
          : '') + '</span>' +
      '</div>' +
      (report.manualSold
        ? '<div class="form-note warn" style="margin-top:10px">' + icon('info', 15) +
            '<span>В «Продано» входит <b>' + fmtNumber(report.manualSold) + ' шт</b> из ручных продаж за прошлые даты. Они не меняют остатки, поэтому на эту же величину стоит корректировка — отчёты за следующие дни остаются прежними.</span>' +
          '</div>'
        : '');

    var fromInput = container.querySelector('#stockDayDate');
    fromInput.addEventListener('change', function () {
      if (!fromInput.value) return;
      pageState.periodFrom = fromInput.value > todayKey ? todayKey : fromInput.value;
      if (pageState.periodTo < pageState.periodFrom) pageState.periodTo = pageState.periodFrom;
      ctx.rerender();
    });
    var toInput = container.querySelector('#stockDayTo');
    toInput.addEventListener('change', function () {
      if (!toInput.value) return;
      pageState.periodTo = toInput.value > todayKey ? todayKey : toInput.value;
      if (pageState.periodTo < pageState.periodFrom) pageState.periodFrom = pageState.periodTo;
      ctx.rerender();
    });
    container.querySelectorAll('[data-range]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var key = btn.getAttribute('data-range');
        if (key === 'today') { pageState.periodFrom = todayKey; pageState.periodTo = todayKey; }
        else if (key === 'yesterday') { pageState.periodFrom = dayKey(addDays(new Date(), -1)); pageState.periodTo = pageState.periodFrom; }
        else if (key === 'week') { pageState.periodFrom = weekFrom; pageState.periodTo = todayKey; }
        else if (key === 'month') { pageState.periodFrom = dayKey(addDays(new Date(), -29)); pageState.periodTo = todayKey; }
        else if (key === 'thisMonth') { pageState.periodFrom = monthFrom; pageState.periodTo = todayKey; }
        ctx.rerender();
      });
    });

    // правка любой колонки по клику: Остаток вчера / Поставка / Продано / Конец дня
    var FIELD_LABEL = { yesterday: 'Остаток вчера', supply: 'Поставка сегодня', sold: 'Продано', end: 'Конец дня' };
    container.querySelectorAll('[data-day-edit]').forEach(function (td) {
      td.addEventListener('click', function (e) {
        if (td.querySelector('input')) return;
        e.stopPropagation();
        var field = td.getAttribute('data-day-edit');
        var productId = td.getAttribute('data-pid');
        var cur = Number(td.getAttribute('data-cur')) || 0;
        var product = getProduct(productId);
        td.innerHTML = '<input class="input qty-inline" inputmode="numeric" value="' + cur + '">';
        var input = td.querySelector('input');
        input.focus();
        input.select();
        var done = false, finished = false;
        function finish() {
          if (finished) return;
          finished = true;
          ctx.rerender();
          if (opts.onChanged) opts.onChanged();
        }
        function commit() {
          if (done) return;
          done = true;
          var raw = input.value.trim();
          var next = parseAmount(raw);
          if (raw === '' || !isFinite(next) || next < 0) {
            toast('Укажите корректное количество', 'error');
            finish();
            return;
          }
          if (next === cur) { finish(); return; }
          var res = editStockReportCell(pointId, productId, field, next, dayKey(new Date()), user);
          if (res && res.error) {
            toast(res.error, 'error');
          } else if (res && res.changed) {
            toast('«' + (FIELD_LABEL[field] || '') + '» — ' + (product ? product.name : '') + ': ' + next, 'success');
          }
          finish();
        }
        input.addEventListener('keydown', function (ev) {
          if (ev.key === 'Enter') { ev.preventDefault(); commit(); }
          else if (ev.key === 'Escape') { ev.preventDefault(); finish(); }
        });
        input.addEventListener('blur', commit);
      });
    });

    var search = container.querySelector('#dayReportSearch');
    if (search) search.addEventListener('input', function () {
      var q = search.value.trim().toLowerCase();
      container.querySelectorAll('[data-day-row]').forEach(function (tr) {
        tr.style.display = tr.getAttribute('data-name').indexOf(q) === -1 ? 'none' : '';
      });
    });

    function headerRow() {
      return showAdjust
        ? ['Товар', 'Категория', L.start, L.supply, L.adjust, L.sold, L.end]
        : ['Товар', 'Категория', L.start, L.supply, L.sold, L.end];
    }
    function rowCells(r) {
      var cells = [r.name, r.category, r.yesterday === null ? '—' : r.yesterday, r.supply];
      if (showAdjust) cells.push(r.adjust);
      cells.push(r.sold, r.end === null ? '—' : r.end);
      return cells;
    }
    function totalCells() {
      var cells = ['Итого', '', t.yesterday, t.supply];
      if (showAdjust) cells.push(t.adjust);
      cells.push(t.sold, t.end);
      return cells;
    }

    container.querySelector('#dayReportCopy').addEventListener('click', function () {
      var lines = [headerRow().join('\t')];
      report.rows.forEach(function (r) { lines.push(rowCells(r).join('\t')); });
      lines.push(totalCells().join('\t'));
      var text = lines.join('\n');
      function fallbackCopy() {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); toast('Таблица скопирована — вставьте в Excel', 'success'); }
        catch (e) { toast('Не удалось скопировать', 'error'); }
        ta.remove();
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () {
          toast('Таблица скопирована — вставьте в Excel', 'success');
        }).catch(fallbackCopy);
      } else fallbackCopy();
    });

    container.querySelector('#dayReportExport').addEventListener('click', function () {
      var rows = [headerRow()];
      report.rows.forEach(function (r) {
        var line = rowCells(r).slice();
        line[2] = r.yesterday === null ? '' : r.yesterday;
        line[line.length - 1] = r.end === null ? '' : r.end;
        rows.push(line);
      });
      rows.push(totalCells());
      var name = single ? ('otchet_sklad_' + fromKey + '.xlsx') : ('otchet_sklad_' + fromKey + '_' + toKey + '.xlsx');
      PosXlsx.downloadXlsx(name, [
        { name: single ? 'Отчёт за день' : 'Отчёт за период', rows: rows }
      ]);
      toast('Отчёт по складу выгружен', 'success');
    });
  }

  PAGES.stock = {
    render: function (root, ctx) {
      var user = ctx.user;
      var isSeller = user.role === 'seller';
      var points = isSeller ? userPoints(user) : DB.points;

      if (isSeller && !points.length) {
        root.innerHTML = '<div class="page">' +
          '<div class="page-head"><div><h1>Склад</h1><div class="sub">Остатки товаров</div></div></div>' +
          '<div class="card">' + emptyState('pin', 'Вам не назначена точка продаж', 'Обратитесь к администратору для назначения точки.', '') + '</div>' +
          '</div>';
        return;
      }
      // у продавца склад всегда на активной точке (её же переключает шапка)
      if (isSeller) {
        var activePt = activePointId(user);
        if (activePt) pageState.pointId = activePt;
      }
      if (!pageState.pointId || !getPoint(pageState.pointId)) {
        pageState.pointId = isSeller ? activePointId(user) : defaultPointId();
      }
      if (isSeller && userPointIds(user).indexOf(pageState.pointId) === -1) {
        pageState.pointId = activePointId(user);
      }
      var pointId = pageState.pointId;

      root.innerHTML =
        '<div class="page">' +
          '<div class="page-head">' +
            '<div><h1>Склад</h1><div class="sub">' + (pointId ? esc(pointName(pointId)) + ' · отчёт по складу' : 'Отчёт по складу') + '</div></div>' +
            '<div class="page-actions">' +
              (points.length > 1 && !isSeller
                ? '<select class="select" id="stockPagePoint" style="width:auto;height:40px;min-width:170px">' +
                    points.map(function (p) { return '<option value="' + p.id + '"' + (p.id === pointId ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }).join('') +
                  '</select>'
                : '') +
              (user.role === 'admin'
                ? '<button type="button" class="btn btn-primary" id="stockPageSupply">' + icon('package', 16) + ' Поставка</button>'
                : '') +
              (user.role !== 'seller'
                ? '<button type="button" class="btn btn-secondary" id="stockPageAdd">' + icon('plus', 16) + ' Добавить остаток</button>'
                : '') +
            '</div>' +
          '</div>' +
          '<div id="stockCheckBox"></div>' +
          '<div id="stockSection"></div>' +
        '</div>';

      // продавцу сверху — карточка сверки с двумя кнопками
      var checkBox = root.querySelector('#stockCheckBox');
      if (checkBox && user.role === 'seller') {
        checkBox.innerHTML = stockCheckCard(user, pointId, ctx);
        bindStockCheckCard(checkBox, user, pointId, ctx);
      } else if (checkBox) {
        checkBox.remove();
      }

      var section = root.querySelector('#stockSection');
      renderDayReport(section, { user: user, pointId: pointId, ctx: ctx });

      var pageAdd = root.querySelector('#stockPageAdd');
      if (pageAdd) pageAdd.addEventListener('click', function () {
        openStockModal({ user: user, pointId: pointId, onDone: function () { ctx.rerender(); } });
      });
      var pageSupply = root.querySelector('#stockPageSupply');
      if (pageSupply) pageSupply.addEventListener('click', function () {
        openSupplyModal({ user: user, pointId: pointId, onDone: function () { ctx.rerender(); } });
      });
      var pointSelect = root.querySelector('#stockPagePoint');
      if (pointSelect) {
        pointSelect.addEventListener('change', function () {
          pageState.pointId = pointSelect.value;
          if (isSeller) setActivePoint(user, pointSelect.value);
          ctx.rerender();
        });
      }
    }
  };
})();
