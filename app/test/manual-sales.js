/* ============================================================
   Проверки: ручные продажи за любую дату (владелец, разработчик)
   1) доступ только у владельца и разработчика
   2) дата/время в прошлом, продажа попадает в статистику за этот день
   3) списание со склада на нужную дату и сходимость отчётов
   4) оплата, продавец, комментарий, удаление с возвратом склада
   5) интерфейс раздела и форма добавления
   ============================================================ */
const puppeteer = require('puppeteer');
const path = require('path');

const BASE = process.env.BASE || 'http://127.0.0.1:8099';
const SHOTS = path.join(__dirname, '..', 'screenshots');

let passed = 0, failed = 0;
function ok(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name + (extra ? ' — ' + extra : '')); }
  else { failed++; console.log('  ✗ ' + name + (extra ? ' — ' + extra : '')); }
}
const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

(async function () {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage',
      '--unsafely-treat-insecure-origin-as-secure=http://127.0.0.1:8099']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 960 });
  const errors = [];
  page.on('pageerror', function (e) { errors.push(e.message); });
  page.on('console', function (m) { if (m.type() === 'error') errors.push(m.text()); });

  try {
    console.log('\n=== Ручные продажи: любая дата, всё в статистике ===');
    await page.goto(BASE + '/index.html', { waitUntil: 'networkidle0' });
    await sleep(400);

    // ---------- данные ----------
    const seed = await page.evaluate(async () => {
      const now = Date.now();
      const admin = await createUser({ fullName: 'Владелец Сети', username: 'manualadmin', password: 'manual1234' }, { autoRole: true });
      setSession(admin.id);
      const cat = { id: uid(), name: 'Тестовая категория', createdAt: now, updatedAt: now };
      DB.categories.push(cat);
      const pt1 = { id: uid(), name: 'Точка Ручная', address: 'Актобе', createdAt: now, updatedAt: now };
      DB.points.push(pt1);
      const p1 = { id: uid(), name: 'Товар А', categoryId: cat.id, price: 500, pointIds: [pt1.id], createdAt: now, updatedAt: now };
      const p2 = { id: uid(), name: 'Товар Б', categoryId: cat.id, price: 1200, pointIds: [pt1.id], createdAt: now, updatedAt: now };
      DB.products.push(p1, p2);
      saveDB();
      const longAgo = startOfDay(addDays(new Date(), -10));
      setStockQty(pt1.id, p1.id, 20, 'Перенос остатка', admin, longAgo);
      setStockQty(pt1.id, p2.id, 10, 'Перенос остатка', admin, longAgo);
      const dev = await createUser({ fullName: 'Разработчик Системы', username: 'manualdev', password: 'manual1234', role: 'dev' });
      const seller = await createUser({
        fullName: 'Айгуль Сапарова', username: 'manualseller', password: 'manual1234',
        role: 'seller', pointIds: [pt1.id], pointId: pt1.id
      });
      return {
        adminId: admin.id, devId: dev.id, sellerId: seller.id,
        pt1: pt1.id, pt1Name: pt1.name, p1: p1.id, p1Name: p1.name, p2: p2.id,
        saleDay: startOfDay(addDays(new Date(), -5)),
        quietDay: startOfDay(addDays(new Date(), -4))
      };
    });
    ok('данные подготовлены', !!seed.devId, seed.pt1Name);

    // ---------- 1. Доступ ----------
    const access = await page.evaluate((s) => ({
      admin: canAccess(getUser(s.adminId), 'manual'),
      dev: canAccess(getUser(s.devId), 'manual'),
      seller: canAccess(getUser(s.sellerId), 'manual'),
      devCash: canAccess(getUser(s.devId), 'cash')
    }), seed);
    ok('владельцу раздел доступен', access.admin === true);
    ok('разработчику раздел доступен', access.dev === true);
    ok('продавцу раздел закрыт', access.seller === false);
    ok('касса разработчику по-прежнему закрыта', access.devCash === false);

    // ---------- 2. Разбор даты и времени ----------
    const parse = await page.evaluate(() => {
      const at = parseSaleMoment('2026-10-15', '14:35');
      const d = new Date(at);
      return {
        valid: at,
        y: d.getFullYear(), m: d.getMonth() + 1, day: d.getDate(), hh: d.getHours(), mm: d.getMinutes(),
        badDate: parseSaleMoment('2026-02-31', '10:00'),
        badTime: parseSaleMoment('2026-02-10', '25:00'),
        badFormat: parseSaleMoment('15.10.2026', '10:00')
      };
    });
    ok('дата и время разбираются верно', parse.y === 2026 && parse.m === 10 && parse.day === 15 && parse.hh === 14 && parse.mm === 35,
      parse.day + '.' + parse.m + '.' + parse.y + ' ' + parse.hh + ':' + parse.mm);
    ok('31 февраля отклоняется', parse.badDate === null);
    ok('25:00 отклоняется', parse.badTime === null);
    ok('формат 15.10.2026 отклоняется', parse.badFormat === null);

    // ---------- 3. Продажа 5 дней назад ----------
    const created = await page.evaluate((s) => {
      const dev = getUser(s.devId);
      const at = s.saleDay + 14 * 3600000 + 35 * 60000;
      const before = stockRow(s.pt1, s.p1).qty;
      function todaySnap() {
        const rep = stockPeriodReport(s.pt1, dayKey(new Date()), dayKey(new Date()));
        const r = rep.rows.filter((x) => x.productId === s.p1)[0];
        return { yesterday: r.yesterday, supply: r.supply, adjust: r.adjust, sold: r.sold, end: r.end, qty: stockRow(s.pt1, s.p1).qty };
      }
      const todayBefore = todaySnap();
      const res = createManualSale({
        pointId: s.pt1, at: at,
        items: [{ productId: s.p1, qty: 2, price: 500 }],
        payment: 'cash', sellerId: s.sellerId, deductStock: true,
        note: 'Продажа за прошлую неделю'
      }, dev);
      const row = stockRow(s.pt1, s.p1);
      const entry = (row.history || []).filter((h) => h.saleId === (res.sale || {}).id)[0] || null;
      return {
        error: res.error || null,
        id: res.sale ? res.sale.id : null,
        code: res.sale ? res.sale.code : null,
        at: res.sale ? res.sale.createdAt : null,
        total: res.sale ? res.sale.total : null,
        manual: res.sale ? !!res.sale.manual : false,
        user: res.sale ? res.sale.userName : null,
        by: res.sale ? res.sale.manualBy : null,
        note: res.sale ? res.sale.manualNote : null,
        updatedAt: res.sale ? res.sale.updatedAt : null,
        qtyBefore: before,
        qtyAfter: row.qty,
        stockDeducted: res.sale ? res.sale.stockDeducted : null,
        entries: (row.history || []).filter((h) => h.saleId === (res.sale || {}).id).length,
        todayBefore: todayBefore,
        todayAfter: todaySnap(),
        dayMatch: res.sale ? salesBetween(s.saleDay, endOfDay(new Date(s.saleDay)), { pointId: s.pt1 }).some((x) => x.id === res.sale.id) : false
      };
    }, seed);
    ok('продажа создана без ошибок', !created.error && !!created.id, created.error || ('#' + created.code));
    ok('дата продажи — выбранная, а не сегодня', created.at === seed.saleDay + 14 * 3600000 + 35 * 60000, fmt(created.at));
    ok('сумма 2 × 500 = 1000', created.total === 1000, String(created.total));
    ok('стоит отметка «вручную»', created.manual === true);
    ok('продавец в статистике — выбранный', created.user === 'Айгуль Сапарова', created.user);
    ok('видно, кто добавил', created.by === 'Разработчик Системы', created.by);
    ok('комментарий сохранён', created.note === 'Продажа за прошлую неделю', created.note);
    ok('метка синхронизации свежая', created.updatedAt > created.at, 'updatedAt > createdAt');
    ok('продажа видна в выборке за этот день', created.dayMatch === true);
    ok('склад не тронут: 20 → 20', created.qtyBefore === 20 && created.qtyAfter === 20, created.qtyBefore + ' → ' + created.qtyAfter);
    ok('галочка списания на прошлую дату игнорируется', created.stockDeducted === false);
    ok('история склада не изменилась', created.entries === 0, 'движений: ' + created.entries);
    ok('отчёт за сегодня не изменился',
      JSON.stringify(created.todayBefore) === JSON.stringify(created.todayAfter),
      'было ' + JSON.stringify(created.todayBefore) + ' · стало ' + JSON.stringify(created.todayAfter));

    // ---------- 4. Отчёты и аналитика ----------
    const reports = await page.evaluate((s) => {
      const dayKeyStr = dayKey(new Date(s.saleDay));
      const nextKey = dayKey(new Date(s.saleDay + 86400000));
      const rep = stockPeriodReport(s.pt1, dayKeyStr, dayKeyStr);
      const nextRep = stockPeriodReport(s.pt1, nextKey, nextKey);
      const r1 = rep.rows.filter((r) => r.productId === s.p1)[0];
      const r2 = nextRep.rows.filter((r) => r.productId === s.p1)[0];
      const stats = summarize(s.saleDay, endOfDay(new Date(s.saleDay)), { pointId: s.pt1 });
      const week = summarize(startOfDay(addDays(new Date(), -6)), Date.now(), { pointId: s.pt1 });
      const period = stockPeriodReport(s.pt1, dayKeyStr, nextKey);
      const rp = period.rows.filter((r) => r.productId === s.p1)[0];
      return {
        sold: r1 ? r1.sold : null,
        end: r1 ? r1.end : null,
        adjust: r1 ? r1.adjust : null,
        yesterday: r1 ? r1.yesterday : null,
        manualSold: r1 ? r1.manualSold : null,
        reportManual: rep.manualSold,
        nextYesterday: r2 ? r2.yesterday : null,
        nextEnd: r2 ? r2.end : null,
        nextSold: r2 ? r2.sold : null,
        periodSold: rp ? rp.sold : null,
        periodEnd: rp ? rp.end : null,
        revenue: stats.revenue,
        count: stats.salesCount,
        cash: stats.cashTotal,
        weekRevenue: week.revenue
      };
    }, seed);
    ok('в отчёте склада за этот день «Продано» = 2', reports.sold === 2, String(reports.sold));
    ok('продажа помечена как ручная в отчёте', reports.manualSold === 2 && reports.reportManual === 2, String(reports.manualSold));
    ok('остаток на конец дня не изменился — 20', reports.end === 20, String(reports.end));
    ok('в корректировке та же величина, чтобы баланс сходился', reports.adjust === 2, String(reports.adjust));
    ok('следующий день без изменений: 20 → 20', reports.nextYesterday === 20 && reports.nextEnd === 20 && reports.nextSold === 0,
      reports.nextYesterday + ' → ' + reports.nextEnd + ', продано ' + reports.nextSold);
    ok('в отчёте за период продажа тоже видна', reports.periodSold === 2 && reports.periodEnd === 20,
      'продано ' + reports.periodSold + ', конец ' + reports.periodEnd);
    ok('выручка за день = 1000', reports.revenue === 1000 && reports.count === 1, reports.revenue + ' · продаж ' + reports.count);
    ok('оплата попала в «Наличные»', reports.cash === 1000, String(reports.cash));
    ok('попадает в недельную статистику', reports.weekRevenue === 1000, String(reports.weekRevenue));

    // ---------- 5. Ошибки валидации ----------
    const invalid = await page.evaluate((s) => {
      const dev = getUser(s.devId);
      const seller = getUser(s.sellerId);
      const items = [{ productId: s.p1, qty: 1, price: 500 }];
      const future = createManualSale({ pointId: s.pt1, at: Date.now() + 86400000, items: items, payment: 'cash' }, dev);
      const noItems = createManualSale({ pointId: s.pt1, at: Date.now() - 3600000, items: [], payment: 'cash' }, dev);
      const badMixed = createManualSale({ pointId: s.pt1, at: Date.now() - 3600000, items: items, payment: 'mixed', cashAmount: 100, qrAmount: 100 }, dev);
      const badSeller = createManualSale({ pointId: s.pt1, at: Date.now() - 3600000, items: items, payment: 'cash' }, seller);
      const badPoint = createManualSale({ pointId: 'nope', at: Date.now() - 3600000, items: items, payment: 'cash' }, dev);
      const total = DB.sales.length;
      return {
        future: future.error, noItems: noItems.error, badMixed: badMixed.error, badSeller: badSeller.error, badPoint: badPoint.error, total: total
      };
    }, seed);
    ok('будущая дата не принимается', /будущ/i.test(invalid.future || ''), invalid.future);
    ok('без товаров не принимается', /товар/i.test(invalid.noItems || ''), invalid.noItems);
    ok('смешанная оплата проверяет сумму', /равняться/i.test(invalid.badMixed || ''), invalid.badMixed);
    ok('продавец не может добавить продажу', /прав/i.test(invalid.badSeller || ''), invalid.badSeller);
    ok('несуществующая точка отклоняется', /точк/i.test(invalid.badPoint || ''), invalid.badPoint);
    ok('ошибочные попытки не создали продаж', invalid.total === 1, String(invalid.total));

    // ---------- 6. Смешанная оплата и продажа без списания ----------
    const mixed = await page.evaluate((s) => {
      const dev = getUser(s.devId);
      const res = createManualSale({
        pointId: s.pt1, at: s.quietDay + 11 * 3600000,
        items: [{ productId: s.p2, qty: 1, price: 1200 }],
        payment: 'mixed', cashAmount: 700, qrAmount: 500, deductStock: false
      }, dev);
      const row = stockRow(s.pt1, s.p2);
      return {
        error: res.error || null,
        cash: res.sale ? res.sale.cashAmount : null,
        qr: res.sale ? res.sale.qrAmount : null,
        qty: row.qty,
        deducted: res.sale ? res.sale.stockDeducted : null,
        sold: (stockPeriodReport(s.pt1, dayKey(new Date(s.quietDay)), dayKey(new Date(s.quietDay))).rows.filter((r) => r.productId === s.p2)[0] || {}).sold
      };
    }, seed);
    ok('смешанная оплата 700 + 500 принята', !mixed.error && mixed.cash === 700 && mixed.qr === 500, mixed.error || '700 / 500');
    ok('без галочки склад не тронут', mixed.qty === 10 && mixed.deducted === false, String(mixed.qty));
    ok('но в отчёте дня продажа учтена', mixed.sold === 1, String(mixed.sold));

    // ---------- 7. Интерфейс: раздел и форма ----------
    await page.evaluate((id) => { setSession(id); location.hash = '#/manual'; }, seed.devId);
    await sleep(1100);
    const pageState = await page.evaluate(() => ({
      hash: location.hash,
      h1: (document.querySelector('.page-head h1') || {}).textContent,
      nav: document.querySelectorAll('[data-nav="manual"]').length,
      rows: document.querySelectorAll('[data-manual-row]').length,
      kpi: (document.querySelector('.kpi-mini .v') || {}).textContent,
      addBtn: !!document.querySelector('#manualAdd')
    }));
    ok('раздел открывается у разработчика', pageState.hash === '#/manual' && pageState.h1 === 'Ручные продажи', pageState.h1);
    ok('пункт меню «Ручные продажи» есть', pageState.nav > 0, 'пунктов: ' + pageState.nav);
    ok('обе продажи в списке за 30 дней', pageState.rows === 2, 'строк: ' + pageState.rows);
    ok('кнопка добавления на месте', pageState.addBtn);
    await page.screenshot({ path: SHOTS + '/105-manual-sales.png' });

    await page.evaluate(() => document.querySelector('#manualAdd').click());
    await sleep(500);
    const modalState = await page.evaluate(() => ({
      open: !!document.querySelector('.modal-overlay'),
      date: (document.querySelector('#msDate') || {}).value,
      time: (document.querySelector('#msTime') || {}).value,
      maxDate: (document.querySelector('#msDate') || {}).getAttribute('max'),
      products: document.querySelectorAll('#msProduct option').length,
      deduct: (document.querySelector('#msDeduct') || {}).checked,
      mixedHidden: (document.querySelector('#msMixed') || {}).style.display === 'none'
    }));
    ok('форма открылась', modalState.open === true);
    ok('дата по умолчанию — сегодня', modalState.date === todayStr(), modalState.date);
    ok('дата в будущем недоступна', modalState.maxDate === todayStr(), modalState.maxDate);
    ok('товары точки есть в списке', modalState.products >= 2, String(modalState.products));
    ok('списание со склада включено', modalState.deduct === true);
    ok('поля смешанной оплаты скрыты', modalState.mixedHidden === true);

    // выбираем прошлую дату — списание отключается
    await page.evaluate(() => {
      const d = document.querySelector('#msDate');
      const back = new Date(Date.now() - 5 * 86400000);
      d.value = back.getFullYear() + '-' + String(back.getMonth() + 1).padStart(2, '0') + '-' + String(back.getDate()).padStart(2, '0');
      d.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await sleep(300);
    const pastState = await page.evaluate(() => ({
      disabled: (document.querySelector('#msDeduct') || {}).disabled,
      checked: (document.querySelector('#msDeduct') || {}).checked,
      hint: (document.querySelector('#msHintText') || {}).textContent || ''
    }));
    ok('на прошлой дате списание заблокировано', pastState.disabled === true && pastState.checked === false);
    ok('подсказка объясняет, что остатки не меняются', /не изменит остатки/i.test(pastState.hint), pastState.hint.slice(0, 70));

    // возвращаем сегодняшнюю дату
    await page.evaluate(() => {
      const d = document.querySelector('#msDate');
      const now = new Date();
      d.value = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
      d.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await sleep(250);
    const backState = await page.evaluate(() => ({
      disabled: (document.querySelector('#msDeduct') || {}).disabled,
      hint: (document.querySelector('#msHintText') || {}).textContent || ''
    }));
    ok('на сегодняшней дате списание снова доступно', backState.disabled === false);
    ok('подсказка про списание со склада', /спишутся со склада/i.test(backState.hint), backState.hint.slice(0, 70));

    // добавляем товар и сохраняем
    await page.evaluate(() => {
      const sel = document.querySelector('#msProduct');
      sel.value = sel.options[0].value;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      document.querySelector('#msQty').value = '3';
      document.querySelector('#msAdd').click();
    });
    await sleep(300);
    const cartState = await page.evaluate(() => ({
      rows: document.querySelectorAll('#msCart tbody tr').length,
      total: (document.querySelector('#msCart .flex.between span:last-child') || {}).textContent
    }));
    ok('товар добавлен в список', cartState.rows === 1, 'строк: ' + cartState.rows);
    await page.screenshot({ path: SHOTS + '/106-manual-sale-form.png' });

    const beforeSave = await page.evaluate((s) => ({ count: DB.sales.length, qty: stockRow(s.pt1, s.p1).qty }), seed);
    await page.evaluate(() => document.querySelector('#msSave').click());
    await sleep(900);
    const afterSave = await page.evaluate((s) => {
      const list = manualSales().slice().sort((a, b) => b.createdAt - a.createdAt);
      const last = list[0] || null;
      return {
        qty: stockRow(s.pt1, s.p1).qty,
        deducted: last ? last.stockDeducted : null,
        count: DB.sales.length,
        modalClosed: !document.querySelector('.modal-overlay'),
        rows: document.querySelectorAll('[data-manual-row]').length,
        saleTotal: last ? last.total : null,
        saleQty: last ? last.items[0].qty : null,
        isToday: last ? last.createdAt >= startOfDay(new Date()) : false,
        toast: document.querySelector('.toast') ? document.querySelector('.toast').textContent : ''
      };
    }, seed);
    ok('продажа сохранена из формы', afterSave.count === beforeSave.count + 1, beforeSave.count + ' → ' + afterSave.count);
    ok('продажа за сегодня списала склад: 20 → 17', afterSave.deducted === true && afterSave.qty === beforeSave.qty - 3,
      beforeSave.qty + ' → ' + afterSave.qty);
    ok('форма закрылась, список обновился', afterSave.modalClosed && afterSave.rows === 1, 'строк за сегодня: ' + afterSave.rows);
    ok('количество и сумма из формы', afterSave.saleQty === 3 && afterSave.saleTotal === 1500, afterSave.saleQty + ' × 500 = ' + afterSave.saleTotal);
    ok('дата — сегодня', afterSave.isToday === true);
    ok('показано подтверждение', /добавлена/i.test(afterSave.toast || ''), afterSave.toast);

    // отметка «вручную» в кассе
    await page.evaluate((id) => { setSession(id); location.hash = '#/cash'; }, seed.adminId);
    await sleep(1100);
    const cashMark = await page.evaluate(() => ({
      mark: /вручную/i.test((document.querySelector('#todaySalesBox') || {}).textContent || ''),
      total: (document.querySelector('#todaySalesBox') || {}).textContent || ''
    }));
    ok('в кассе видно, что продажа ручная', cashMark.mark === true);

    // и на панели за неделю
    await page.evaluate(() => { location.hash = '#/dashboard'; });
    await sleep(900);
    await page.evaluate(() => {
      const btn = document.querySelector('#periodSwitch [data-period="week"]');
      if (btn) btn.click();
    });
    await sleep(900);
    const dashMark = await page.evaluate(() => {
      const text = (document.querySelector('#dashBottom') || {}).textContent || '';
      return { mark: /вручную/i.test(text) };
    });
    ok('на панели за неделю продажа помечена «вручную»', dashMark.mark === true);

    // ---------- 8. Удаление и возврат склада ----------
    await page.evaluate((id) => { setSession(id); location.hash = '#/manual'; }, seed.devId);
    await sleep(1000);
    await page.evaluate(() => {
      const btn = document.querySelector('[data-period="month"]');
      if (btn) btn.click();
    });
    await sleep(700);
    const beforeDelete = await page.evaluate((s) => ({
      qty: stockRow(s.pt1, s.p1).qty,
      count: DB.sales.length,
      rows: document.querySelectorAll('[data-manual-row]').length
    }), seed);
    const delId = await page.evaluate(() => document.querySelector('[data-del-manual]').getAttribute('data-del-manual'));
    await page.evaluate(() => document.querySelector('[data-del-manual]').click());
    await sleep(500);
    const confirmText = await page.evaluate(() => {
      const m = document.querySelector('.modal-overlay');
      return m ? m.textContent : '';
    });
    ok('перед удалением спрашивают подтверждение', /вернутся на склад/i.test(confirmText), 'вопрос задан');
    await page.evaluate(() => {
      const btns = document.querySelectorAll('.modal-overlay [data-ok]');
      btns[btns.length - 1].click();
    });
    await sleep(900);
    const afterDelete = await page.evaluate((s, saleId) => ({
      count: DB.sales.length,
      rows: document.querySelectorAll('[data-manual-row]').length,
      qty: stockRow(s.pt1, s.p1).qty,
      entries: (stockRow(s.pt1, s.p1).history || []).filter((h) => h.saleId === saleId).length,
      dayRevenue: summarize(startOfDay(new Date()), Date.now(), { pointId: s.pt1 }).revenue
    }), seed, delId);
    ok('продажа удалена', afterDelete.count === beforeDelete.count - 1, beforeDelete.count + ' → ' + afterDelete.count);
    ok('список перерисован', afterDelete.rows === beforeDelete.rows - 1, 'строк: ' + afterDelete.rows);
    ok('товар вернулся на склад', afterDelete.qty === beforeDelete.qty + 3, beforeDelete.qty + ' → ' + afterDelete.qty);
    ok('движение склада убрано', afterDelete.entries === 0);
    ok('выручка сегодня снова 0', afterDelete.dayRevenue === 0, String(afterDelete.dayRevenue));

    // ---------- 9. Продавцу раздел недоступен ----------
    await page.evaluate((id) => { setSession(id); location.hash = '#/cash'; }, seed.sellerId);
    await sleep(900);
    await page.evaluate(() => { location.hash = '#/manual'; });
    await sleep(1100);
    const sellerView = await page.evaluate(() => ({
      hash: location.hash,
      nav: document.querySelectorAll('[data-nav="manual"]').length
    }));
    ok('продавца перебрасывает из раздела', sellerView.hash !== '#/manual', sellerView.hash);
    ok('у продавца нет пункта меню', sellerView.nav === 0);

    ok('нет JS-ошибок', errors.length === 0, errors.slice(0, 3).join(' | ') || 'чисто');
  } catch (e) {
    failed++;
    console.log('  ✗ исключение: ' + (e && e.message));
    console.log(e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n') : '');
  } finally {
    await browser.close();
    console.log('\n=== Итог: ' + passed + ' успешно, ' + failed + ' с ошибками ===');
    process.exit(failed ? 1 : 0);
  }
})();

function fmt(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.getDate() + '.' + (d.getMonth() + 1) + '.' + d.getFullYear() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
