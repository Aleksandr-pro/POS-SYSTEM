/* ============================================================
   Проверка переноса данных из старой системы:
   товары из выгрузки + история продаж за 1–18 октября
   ============================================================ */
const puppeteer = require('puppeteer');
const SHOTS = require('path').join(__dirname, '..', 'screenshots');

const BASE = process.env.BASE || 'http://127.0.0.1:8099';
const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

let passed = 0, failed = 0;
function ok(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name + (extra ? ' — ' + extra : '')); }
  else { failed++; console.log('  ✗ ' + name + (extra ? ' — ' + extra : '')); }
}

(async function () {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  const errors = [];
  page.on('pageerror', function (e) { errors.push(e.message); });
  page.on('console', function (m) { if (m.type() === 'error') errors.push(m.text()); });

  try {
    console.log('\n=== Перенос из старой системы ===');
    await page.goto(BASE + '/index.html', { waitUntil: 'load' });
    await page.evaluate(function () { localStorage.clear(); });
    await page.reload({ waitUntil: 'load' });
    await sleep(400);

    await page.click('#goRegister');
    await sleep(300);
    await page.evaluate(function () {
      const set = function (id, v) { const el = document.querySelector(id); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
      set('#regName', 'Владелец Магазина');
      set('#regUser', 'owner');
      set('#regPass', 'secret1');
      set('#regPass2', 'secret1');
      const b = document.querySelector('#regTerms');
      b.checked = true;
      b.dispatchEvent(new Event('change', { bubbles: true }));
      document.querySelector('#regBtn').click();
    });
    await page.waitForSelector('.topbar', { timeout: 15000 });
    await sleep(700);

    const starter = await page.evaluate(function () {
      return {
        products: window.POS_IMPORT_DATA.products.length,
        history: window.POS_IMPORT_DATA.history.length,
        sales: window.POS_IMPORT_DATA.totalSales,
        revenue: window.POS_IMPORT_DATA.totalRevenue
      };
    });
    ok('данные переноса встроены', starter.products === 71 && starter.sales === 692,
      'товаров: ' + starter.products + ', чеков: ' + starter.sales);

    await page.evaluate(function () { location.hash = '#/settings'; });
    await sleep(800);
    const hasCard = await page.evaluate(function () { return !!document.querySelector('#legacyImport'); });
    ok('карточка переноса в настройках', hasCard);
    await page.screenshot({ path: SHOTS + '/65-settings-legacy-card.png' });

    // запускаем перенос
    await page.evaluate(function () { document.querySelector('#legacyImport').click(); });
    await sleep(500);
    await page.evaluate(function () {
      const btn = Array.from(document.querySelectorAll('.modal-overlay .btn')).find(function (b) { return /Внести данные/.test(b.textContent); });
      if (btn) btn.click();
    });
    await sleep(2500);

    const after = await page.evaluate(function () {
      const sales = DB.sales.filter(function (s) { return s.imported; });
      const oct = sales.filter(function (s) {
        const d = new Date(s.createdAt);
        return d.getFullYear() === 2026 && d.getMonth() === 9 && d.getDate() <= 18;
      });
      const oct18 = sales.filter(function (s) {
        const d = new Date(s.createdAt);
        return d.getFullYear() === 2026 && d.getMonth() === 9 && d.getDate() === 18;
      });
      const sum = function (list, key) { return list.reduce(function (n, s) { return n + (s[key] || 0); }, 0); };
      const stats = summarize(new Date(2026, 9, 1).getTime(), new Date(2026, 9, 18, 23, 59, 59).getTime(), {});
      return {
        products: DB.products.filter(function (p) { return p.imported; }).length,
        categories: DB.categories.length,
        points: DB.points.length,
        sales: sales.length,
        oct: oct.length,
        oct18: oct18.length,
        revenue: sum(sales, 'total'),
        cash: sum(sales, 'cashAmount'),
        qr: sum(sales, 'qrAmount'),
        mixed: sales.filter(function (s) { return s.payment === 'mixed'; }).reduce(function (n, s) { return n + s.total; }, 0),
        cashPay: sales.filter(function (s) { return s.payment === 'cash'; }).reduce(function (n, s) { return n + s.total; }, 0),
        qrPay: sales.filter(function (s) { return s.payment === 'qr'; }).reduce(function (n, s) { return n + s.total; }, 0),
        statsRevenue: stats.revenue,
        statsCashTotal: stats.cashTotal,
        statsQrTotal: stats.qrTotal,
        statsMixed: stats.mixedTotal,
        statsMixedCash: stats.mixedCash,
        statsMixedQr: stats.mixedQr,
        statsCount: stats.salesCount
      };
    });

    ok('товары добавлены', after.products === 71, 'товаров: ' + after.products);
    ok('категории созданы', after.categories >= 9, 'категорий: ' + after.categories);
    ok('точка создана', after.points === 1);
    ok('чеков столько же', after.sales === 692, 'чеков: ' + after.sales);
    ok('выручка совпала', after.revenue === 1405350, after.revenue + ' ₸');
    ok('наличные совпали', after.cash === 426400, after.cash + ' ₸');
    ok('Kaspi QR совпал', after.qr === 978950, after.qr + ' ₸');
    ok('смешанные совпали', after.mixed === 47100, after.mixed + ' ₸');
    ok('чистые наличные', after.cashPay === 396250, after.cashPay + ' ₸');
    ok('чистый QR', after.qrPay === 962000, after.qrPay + ' ₸');

    // разрез 1–17 и 18 октября
    const split = await page.evaluate(function () {
      const range = function (from, to) {
        const st = summarize(new Date(2026, 9, from).getTime(), new Date(2026, 9, to, 23, 59, 59).getTime(), {});
        return { count: st.salesCount, revenue: st.revenue, cash: st.cashTotal, qr: st.qrTotal, mixed: st.mixedTotal, mCash: st.mixedCash, mQr: st.mixedQr };
      };
      return { first: range(1, 17), day: range(18, 18), other: (function () {
        const st = summarize(new Date(2026, 8, 1).getTime(), new Date(2026, 8, 30, 23, 59, 59).getTime(), {});
        return st.salesCount;
      })() };
    });
    ok('18 октября: 87 чеков', split.day.count === 87, 'чеков: ' + split.day.count);
    ok('18 октября: выручка', split.day.revenue === 160600, split.day.revenue + ' ₸');
    ok('18 октября: наличные', split.day.cash === 43900, split.day.cash + ' ₸');
    ok('18 октября: QR', split.day.qr === 116700, split.day.qr + ' ₸');
    ok('18 октября: смешанные', split.day.mixed === 6800, split.day.mixed + ' ₸');
    ok('18 октября: нал/Qr в смешанных', split.day.mCash === 6000 && split.day.mQr === 800, split.day.mCash + ' / ' + split.day.mQr);
    ok('1–17 октября: 605 чеков', split.first.count === 605, 'чеков: ' + split.first.count);
    ok('1–17 октября: выручка', split.first.revenue === 1244750, split.first.revenue + ' ₸');
    ok('за сентябрь ничего не попало', split.other === 0);

    // повторный запуск не дублирует
    const repeat = await page.evaluate(function () {
      const before = DB.sales.length;
      const res = applyLegacyStarter({ actor: currentUser() });
      return { before: before, after: DB.sales.length, created: res.sales.created, products: DB.products.length };
    });
    ok('повторный перенос не дублирует', repeat.after === repeat.before && repeat.created === 0,
      'было ' + repeat.before + ', стало ' + repeat.after);

    // аналитика показывает правильные цифры
    await page.evaluate(function () {
      if (resolvedTheme() !== 'dark') toggleTheme();
      location.hash = '#/analytics';
    });
    await sleep(900);
    await page.evaluate(function () {
      const btns = Array.from(document.querySelectorAll('[data-period]'));
      const month = btns.find(function (b) { return b.getAttribute('data-period') === 'month'; });
      if (month) month.click();
    });
    await sleep(900);
    const analyticsText = await page.evaluate(function () {
      const card = Array.from(document.querySelectorAll('.card')).find(function (c) { return /Структура оплат/.test(c.textContent); });
      const kpi = Array.from(document.querySelectorAll('.stat-card')).map(function (c) { return c.textContent.replace(/\s+/g, ' ').trim(); });
      return { pay: card ? card.textContent.replace(/\s+/g, ' ') : '', kpi: kpi.join(' | ') };
    });
    ok('аналитика: выручка 1 405 350 ₸', /1\s?405\s?350/.test(analyticsText.kpi), analyticsText.kpi.slice(0, 80));
    ok('аналитика: итого наличными', /Итого наличными/.test(analyticsText.pay) && /426\s?400/.test(analyticsText.pay), '');
    ok('аналитика: итого Kaspi', /Итого Kaspi QR/.test(analyticsText.pay) && /978\s?950/.test(analyticsText.pay), '');
    await page.screenshot({ path: SHOTS + '/66-analytics-imported-data-dark.png' });

    // товары в каталоге
    await page.evaluate(function () { location.hash = '#/products'; });
    await sleep(800);
    const catalog = await page.evaluate(function () {
      return {
        rows: document.querySelectorAll('[data-product], .product-row').length,
        text: document.querySelector('.page') ? document.querySelector('.page').textContent.replace(/\s+/g, ' ') : ''
      };
    });
    ok('каталог показывает товары', /Этно Брошь|Колосок|Аквагрим/i.test(catalog.text));

    // продажа по импортированному товару проходит
    const sell = await page.evaluate(function () {
      const p = DB.products.find(function (x) { return x.name === 'Этно Брошь'; });
      const point = DB.points[0];
      const before = DB.sales.length;
      createSale({ pointId: point.id, items: [{ productId: p.id, name: p.name, price: p.price, qty: 2 }], total: p.price * 2, payment: 'cash' }, currentUser());
      return { before: before, after: DB.sales.length, price: p.price };
    });
    ok('продажа нового товара оформляется', sell.after === sell.before + 1, 'цена: ' + sell.price + ' ₸');

    // CSV-импорт
    const csv = await page.evaluate(function () {
      const text = 'Название;Категория;Цена\nПроверка CSV;Тест;1234\nЭтно Брошь;Косы;1200\n';
      const rows = parseProductsCsv(text);
      const res = importProducts(rows, {});
      return { rows: rows.length, created: res.created, skipped: res.skipped };
    });
    ok('CSV-импорт разбирает файл', csv.rows === 2, 'строк: ' + csv.rows);
    ok('CSV-импорт добавляет новый и пропускает дубль', csv.created === 1 && csv.skipped === 1,
      'добавлено ' + csv.created + ', пропущено ' + csv.skipped);

    ok('нет JS-ошибок', errors.length === 0, errors.slice(0, 2).join(' | '));
  } catch (err) {
    failed++;
    console.log('\n✗ Исключение: ' + err.message);
  } finally {
    await browser.close();
  }

  console.log('\n=== Итог: ' + passed + ' успешно, ' + failed + ' с ошибками ===');
  process.exit(failed ? 1 : 0);
})();
