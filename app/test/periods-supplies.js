/* ============================================================
   Проверки: выбор даты/месяца/периода, смешанная оплата
   с явными суммами нал + QR, поставки на склад и статистика
   ============================================================ */
const puppeteer = require('puppeteer');
const fs = require('fs');
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
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 950 });
  const errors = [];
  page.on('pageerror', function (e) { errors.push(e.message); });
  page.on('console', function (m) { if (m.type() === 'error') errors.push(m.text()); });

  try {
    console.log('\n=== Даты, смешанная оплата, поставки ===');
    await page.goto(BASE + '/index.html', { waitUntil: 'load' });
    await sleep(300);

    // ---------- регистрация + демо ----------
    await page.click('#goRegister');
    await sleep(250);
    await page.type('#regName', 'Владелец Сети');
    await page.type('#regUser', 'netowner');
    await page.type('#regPass', 'netpass1');
    await page.type('#regPass2', 'netpass1');
    await page.evaluate(function () { const b = document.querySelector('#regTerms'); b.checked = true; b.dispatchEvent(new Event('change', { bubbles: true })); });
    await page.click('#regBtn');
    await page.waitForSelector('.topbar', { timeout: 15000 });
    await page.evaluate(async function () {
      await loadDemoData(currentUser());
      if (typeof resetCashStatePoint === 'function') resetCashStatePoint();
    });
    await sleep(500);

    // ---------- 1. Дашборд: выбор даты ----------
    const bar = await page.evaluate(function () {
      return {
        hasBar: !!document.querySelector('#periodDateBar'),
        date: (document.querySelector('[data-date-input]') || {}).value,
        today: todayKey()
      };
    });
    ok('на дашборде есть панель даты', bar.hasBar && bar.date === bar.today, bar.date);

    // выбираем вчера
    await page.evaluate(function () {
      const inp = document.querySelector('[data-date-input]');
      const d = new Date(); d.setDate(d.getDate() - 1);
      inp.value = dayKey(d);
      inp.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await sleep(700);
    const yesterday = await page.evaluate(function () {
      const d = addDays(new Date(), -1);
      const st = summarize(startOfDay(d), endOfDay(d), {});
      const kpi = document.querySelector('.stat-card .stat-value');
      return { value: kpi ? kpi.textContent.trim() : '', expected: fmtMoney(st.revenue), title: document.querySelector('.date-result') ? document.querySelector('.date-result').textContent : '' };
    });
    ok('дата «вчера»: KPI совпадает', yesterday.value === yesterday.expected, yesterday.value + ' / ' + yesterday.title);
    await page.screenshot({ path: SHOTS + '/67-dashboard-yesterday.png', fullPage: true });

    // стрелка назад ещё на день
    await page.click('[data-step="-1"]');
    await sleep(700);
    const stepBack = await page.evaluate(function () {
      const d = addDays(new Date(), -2);
      return {
        date: document.querySelector('[data-date-input]').value,
        expected: dayKey(d),
        kpi: document.querySelector('.stat-card .stat-value').textContent.trim(),
        revenue: fmtMoney(summarize(startOfDay(d), endOfDay(d), {}).revenue)
      };
    });
    ok('стрелка «предыдущий день»', stepBack.date === stepBack.expected && stepBack.kpi === stepBack.revenue, stepBack.date);

    // ---------- 2. Месяц ----------
    await page.evaluate(function () { document.querySelector('[data-period="month"]').click(); });
    await sleep(700);
    const monthNow = await page.evaluate(function () {
      const inp = document.querySelector('[data-month-input]');
      const now = new Date();
      const from = startOfDay(new Date(now.getFullYear(), now.getMonth(), 1));
      const to = Date.now();
      return { value: inp && inp.value, expected: now.getFullYear() + '-' + pad2(now.getMonth() + 1),
        kpi: document.querySelector('.stat-card .stat-value').textContent.trim(),
        revenue: fmtMoney(summarize(from, to, {}).revenue) };
    });
    ok('месяц: выбран текущий', monthNow.value === monthNow.expected, monthNow.value);
    ok('месяц: KPI совпадает', monthNow.kpi === monthNow.revenue, monthNow.kpi);

    // предыдущий месяц
    await page.click('[data-month-step="-1"]');
    await sleep(700);
    const prevMonth = await page.evaluate(function () {
      const now = new Date();
      const from = startOfDay(new Date(now.getFullYear(), now.getMonth() - 1, 1));
      const to = endOfDay(new Date(now.getFullYear(), now.getMonth(), 0));
      const inp = document.querySelector('[data-month-input]');
      return {
        month: inp.value,
        kpi: document.querySelector('.stat-card .stat-value').textContent.trim(),
        revenue: fmtMoney(summarize(from, to, {}).revenue),
        sub: document.querySelector('.date-result') ? document.querySelector('.date-result').textContent : ''
      };
    });
    ok('месяц: переключение на предыдущий', prevMonth.month < monthNow.expected, prevMonth.sub);
    ok('месяц: KPI предыдущего совпадает', prevMonth.kpi === prevMonth.revenue, prevMonth.kpi);
    await page.screenshot({ path: SHOTS + '/68-dashboard-month.png', fullPage: true });

    // ---------- 3. Произвольный период ----------
    await page.evaluate(function () { document.querySelector('[data-period="period"]').click(); });
    await sleep(600);
    await page.evaluate(function () {
      const from = document.querySelector('[data-from-input]');
      const to = document.querySelector('[data-to-input]');
      const d = new Date(); d.setDate(d.getDate() - 3);
      from.value = dayKey(d); from.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await sleep(600);
    const custom = await page.evaluate(function () {
      const from = parseDayKey(document.querySelector('[data-from-input]').value);
      const to = parseDayKey(document.querySelector('[data-to-input]').value);
      const st = summarize(startOfDay(from), endOfDay(to), {});
      return {
        from: dayKey(from), to: dayKey(to),
        kpi: document.querySelector('.stat-card .stat-value').textContent.trim(),
        revenue: fmtMoney(st.revenue),
        days: document.querySelector('.date-result') ? document.querySelector('.date-result').textContent : ''
      };
    });
    ok('период: 4 дня выбраны', custom.from && custom.to, custom.from + ' — ' + custom.to);
    ok('период: KPI совпадает', custom.kpi === custom.revenue, custom.kpi + ' · ' + custom.days);
    await page.screenshot({ path: SHOTS + '/69-dashboard-period.png', fullPage: true });

    // ---------- 4. Смешанная оплата с двумя суммами ----------
    await page.evaluate(function () { location.hash = '#/cash'; });
    await sleep(800);
    await page.click('#catalogGrid .product-card:nth-child(1)');
    await sleep(400);
    await page.click('[data-pay="mixed"]');
    await sleep(400);
    const mixFields = await page.evaluate(function () {
      return {
        cash: !!document.querySelector('#cashPart'),
        qr: !!document.querySelector('#qrPart'),
        check: !!document.querySelector('#mixCheck'),
        total: document.querySelector('.cart-total .val').textContent.trim()
      };
    });
    ok('смешанная оплата: два поля (нал + QR)', mixFields.cash && mixFields.qr && mixFields.check, mixFields.total);

    // вводим наличные 500 → QR подставляется
    await page.evaluate(function () {
      const inp = document.querySelector('#cashPart');
      inp.value = '500';
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await sleep(250);
    const autoQr = await page.evaluate(function () {
      const total = parseAmount(document.querySelector('.cart-total .val').textContent);
      return {
        total: total,
        cash: document.querySelector('#cashPart').value,
        qr: document.querySelector('#qrPart').value,
        expectedQr: String(Math.round(total - 500)),
        check: document.querySelector('#mixCheck').textContent.replace(/\s+/g, ' ')
      };
    });
    ok('QR подставляется автоматически', autoQr.qr === autoQr.expectedQr, autoQr.cash + ' + ' + autoQr.qr + ' = ' + autoQr.total);

    // вводим QR 300 → наличные подставляются
    await page.evaluate(function () {
      const inp = document.querySelector('#qrPart');
      inp.value = '300';
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await sleep(250);
    const autoCash = await page.evaluate(function () {
      const total = parseAmount(document.querySelector('.cart-total .val').textContent);
      return {
        total: total,
        cash: document.querySelector('#cashPart').value,
        qr: document.querySelector('#qrPart').value,
        expectedCash: String(Math.round(total - 300))
      };
    });
    ok('наличные подставляются автоматически', autoCash.cash === autoCash.expectedCash, autoCash.cash + ' + ' + autoCash.qr);

    // ставим красивое разделение: 400 нал + остальное QR
    const split = await page.evaluate(function () {
      const total = parseAmount(document.querySelector('.cart-total .val').textContent);
      const inp = document.querySelector('#cashPart');
      inp.value = '400';
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      return { total: total, cash: 400, qr: Math.round(total - 400) };
    });
    await sleep(200);

    // чек через input file
    const receiptData = await page.evaluate(function () {
      const c = document.createElement('canvas'); c.width = 300; c.height = 400;
      const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 300, 400);
      x.fillStyle = '#111'; x.font = '20px sans-serif'; x.fillText('KASPI RECEIPT', 20, 60);
      return c.toDataURL('image/jpeg', 0.8);
    });
    const tmpFile = '/tmp/receipt-mix.jpg';
    fs.writeFileSync(tmpFile, Buffer.from(receiptData.split(',')[1], 'base64'));
    const inputEl = await page.$('#receiptInput');
    if (inputEl) { await inputEl.uploadFile(tmpFile); await sleep(900); }

    const before = await page.evaluate(function () { return DB.sales.length; });
    await page.click('#checkoutBtn');
    await sleep(900);
    const sale = await page.evaluate(function () {
      const s = DB.sales[DB.sales.length - 1];
      return { count: DB.sales.length, payment: s.payment, cash: s.cashAmount, qr: s.qrAmount, total: s.total };
    });
    ok('смешанная продажа оформлена', sale.count === before + 1 && sale.payment === 'mixed', JSON.stringify({ cash: sale.cash, qr: sale.qr, total: sale.total }));
    ok('суммы нал + QR = чек', sale.cash + sale.qr === sale.total && sale.cash === 400, sale.cash + ' + ' + sale.qr + ' = ' + sale.total);
    await page.screenshot({ path: SHOTS + '/70-mixed-sale-done.png' });
    const closeSale = await page.$('[data-close-sale]');
    if (closeSale) await closeSale.click();
    await sleep(400);

    const todaySplit = await page.evaluate(function () {
      const st = summarize(startOfDay(new Date()), Date.now(), {});
      const text = document.querySelector('.cash-split') ? document.querySelector('.cash-split').textContent.replace(/\s+/g, ' ') : '';
      return { mixedCash: st.mixedCash, mixedQr: st.mixedQr, mixedCount: st.mixedCount, text: text };
    });
    ok('касса: смешанные суммы в статистике', todaySplit.mixedCash >= 400 && todaySplit.mixedQr >= 1, 'нал ' + todaySplit.mixedCash + ' / QR ' + todaySplit.mixedQr);

    const rowSplit = await page.evaluate(function () {
      const rows = Array.from(document.querySelectorAll('#todaySalesBox tbody tr'));
      const row = rows[0];
      return row ? row.textContent.replace(/\s+/g, ' ') : '';
    });
    ok('касса: в чеке видно нал и QR', /нал\s?400/.test(rowSplit), rowSplit.slice(0, 90));

    // аналитика
    await page.evaluate(function () { location.hash = '#/analytics'; });
    await sleep(900);
    const anText = await page.evaluate(function () {
      const card = Array.from(document.querySelectorAll('.card')).find(function (c) { return /Структура оплат/.test(c.textContent); });
      return card ? card.textContent.replace(/\s+/g, ' ') : '';
    });
    ok('аналитика: доля нал и QR смешанных', /наличными/.test(anText) && /Kaspi QR/.test(anText), anText.slice(0, 120));

    // ---------- 5. Поставка на склад ----------
    await page.evaluate(function () { location.hash = '#/stock'; });
    await sleep(900);
    const beforeSupply = await page.evaluate(function () {
      const pointId = DB.points[0].id;
      return { pointId: pointId, supplies: DB.supplies.length, rows: DB.stock.length };
    });
    await page.click('#stockPageSupply');
    await sleep(500);
    const modal = await page.evaluate(function () {
      return {
        form: !!document.querySelector('#supplyForm'),
        rows: document.querySelectorAll('.supply-row').length,
        product: document.querySelector('.supply-row [data-f="product"]') ? document.querySelector('.supply-row [data-f="product"]').value : null
      };
    });
    ok('окно поставки открылось', modal.form && modal.rows >= 1, 'позиций: ' + modal.rows);

    const supplyProduct = modal.product;
    const stockBefore = await page.evaluate(function (pid) { const r = stockRow(DB.points[0].id, pid); return r ? r.qty : 0; }, supplyProduct);

    // добавляем вторую позицию и заполняем
    const onlySimple = await page.evaluate(function () {
      return !document.querySelector('#supSupplier') && !document.querySelector('#supNote') &&
        !document.querySelector('.supply-row [data-f="cost"]');
    });
    ok('в поставке только товар и количество', onlySimple);

    await page.evaluate(function () {
      const qty = document.querySelector('.supply-row [data-f="qty"]');
      qty.value = '10'; qty.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await sleep(200);
    const totals = await page.evaluate(function () { return document.querySelector('#supplyTotals').textContent.replace(/\s+/g, ' '); });
    ok('итог поставки считается', /10\s?шт/.test(totals), totals);

    await page.click('#supplySave');
    await sleep(900);
    const afterSupply = await page.evaluate(function (pid) {
      const s = DB.supplies[DB.supplies.length - 1];
      const row = stockRow(DB.points[0].id, pid);
      return {
        count: DB.supplies.length, qty: row ? row.qty : 0, code: s && s.code,
        totalQty: s && s.totalQty, supplier: s && s.supplier, items: s ? (s.items || []).length : 0,
        hist: row && row.history ? row.history[0].note : ''
      };
    }, supplyProduct);
    ok('поставка создана', afterSupply.count === beforeSupply.supplies + 1, afterSupply.code + ' · ' + afterSupply.totalQty + ' шт');
    ok('остаток увеличился на 10', afterSupply.qty === stockBefore + 10, stockBefore + ' → ' + afterSupply.qty);
    ok('поставщик и комментарий не сохраняются', afterSupply.supplier === undefined, String(afterSupply.supplier));
    ok('в поставке 1 позиция', afterSupply.items === 1, String(afterSupply.items));
    ok('в истории склада запись «Поставка»', /Поставка/.test(afterSupply.hist), afterSupply.hist);
    await page.screenshot({ path: SHOTS + '/71-stock-supply.png', fullPage: true });

    const stockCard = await page.evaluate(function () { return document.body.textContent.replace(/\s+/g, ' '); });
    ok('склад без раздела «Остатки» и без поставщика', !/Поставки на точку/.test(stockCard) && !/Поставщик/.test(stockCard) && /Отчёт по складу/.test(stockCard), stockCard.slice(0, 60));
    const supplySaved = await page.evaluate(function (code) {
      return DB.supplies.some(function (s) { return s.code === code && s.pointId === DB.points[0].id; });
    }, afterSupply.code);
    ok('поставка сохранена на точке', supplySaved, afterSupply.code);

    // ---------- 6. Продажа списывает остаток ----------
    const saleResult = await page.evaluate(async function (pid) {
      const user = currentUser();
      const pointId = DB.points[0].id;
      const p = getProduct(pid);
      const before = stockRow(pointId, pid).qty;
      const s = createSale({
        pointId: pointId,
        items: [{ productId: pid, name: p.name, price: p.price, qty: 1 }],
        total: p.price, payment: 'cash', cashAmount: p.price, qrAmount: 0
      }, user);
      return { before: before, after: stockRow(pointId, pid).qty, code: s.code };
    }, supplyProduct);
    ok('продажа уменьшает остаток', saleResult.after === saleResult.before - 1, saleResult.before + ' → ' + saleResult.after);
    await page.evaluate(function () { location.hash = '#/stock'; });
    await sleep(800);
    const histText = await page.evaluate(function (pid) {
      const row = stockRow(DB.points[0].id, pid);
      return row && row.history ? row.history.slice(0, 3).map(function (h) { return h.note; }).join(' | ') : '';
    }, supplyProduct);
    ok('история: продажа после поставки', /Продажа/.test(histText), histText);

    // ---------- 7. Поставки в аналитике и дашборде ----------
    await page.evaluate(function () { location.hash = '#/analytics'; });
    await sleep(900);
    const anSupply = await page.evaluate(function () {
      const card = Array.from(document.querySelectorAll('.card')).find(function (c) { return /Поступления на склад/.test(c.textContent); });
      return card ? card.textContent.replace(/\s+/g, ' ') : '';
    });
    ok('аналитика: блок «Поступления на склад»', /Поступления на склад/.test(anSupply) && /10\s?шт/.test(anSupply), anSupply.slice(0, 140));
    await page.screenshot({ path: SHOTS + '/72-analytics-supplies.png', fullPage: true });

    await page.evaluate(function () { location.hash = '#/dashboard'; });
    await sleep(800);
    const dashSupply = await page.evaluate(function () {
      const strip = document.querySelector('.supply-strip');
      return strip ? strip.textContent.replace(/\s+/g, ' ') : '';
    });
    ok('дашборд: полоса поставок', /Поступления на склад/.test(dashSupply) && /10/.test(dashSupply), dashSupply.slice(0, 100));

    // ---------- 8. Отмена поставки ----------
    await page.evaluate(function () { location.hash = '#/stock'; });
    await sleep(800);
    const stockBeforeDelete = await page.evaluate(function (pid) { return stockRow(DB.points[0].id, pid).qty; }, supplyProduct);
    const deleted = await page.evaluate(function (pid) {
      const supply = DB.supplies[DB.supplies.length - 1];
      const res = deleteSupply(supply.id, currentUser());
      return { res: res, count: DB.supplies.length, qty: stockRow(DB.points[0].id, pid).qty };
    }, supplyProduct);
    ok('отмена поставки списывает товар', deleted.res && deleted.qty === stockBeforeDelete - 10, stockBeforeDelete + ' → ' + deleted.qty);

    ok('нет JS-ошибок', errors.length === 0, errors.slice(0, 3).join(' | '));
  } catch (e) {
    failed++;
    console.log('  ✗ ИСКЛЮЧЕНИЕ: ' + e.message);
  }

  console.log('\n=== Итог: ' + passed + ' успешно, ' + failed + ' с ошибками ===');
  await browser.close();
  process.exit(failed ? 1 : 0);
})();
