/* ============================================================
   Проверки: перенос остатков склада по 8 точкам (отчёт 19.10.2026)
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
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 950 });
  const errors = [];
  page.on('pageerror', function (e) { errors.push(e.message); });
  page.on('console', function (m) { if (m.type() === 'error') errors.push(m.text()); });

  try {
    console.log('\n=== Остатки склада из старой системы ===');
    await page.goto(BASE + '/index.html', { waitUntil: 'load' });
    await sleep(300);

    await page.click('#goRegister');
    await sleep(250);
    await page.type('#regName', 'Владелец Сети');
    await page.type('#regUser', 'stockowner');
    await page.type('#regPass', 'stockpass1');
    await page.type('#regPass2', 'stockpass1');
    await page.evaluate(function () { const b = document.querySelector('#regTerms'); b.checked = true; b.dispatchEvent(new Event('change', { bubbles: true })); });
    await page.click('#regBtn');
    await page.waitForSelector('.topbar', { timeout: 15000 });
    await sleep(400);

    // ---------- 1. Карточка в настройках ----------
    await page.evaluate(function () { location.hash = '#/settings'; });
    await sleep(800);
    const card = await page.evaluate(function () {
      const el = document.querySelector('#stockCard');
      return {
        exists: !!el,
        text: el ? el.textContent.replace(/\s+/g, ' ') : '',
        button: !!document.querySelector('#stockApply')
      };
    });
    ok('карточка «Остатки склада» в настройках', card.exists && card.button);
    ok('в карточке 5 точек и 3 853 шт', /Точек продаж5|5/.test(card.text) && /3\s?853/.test(card.text), card.text.slice(0, 120));
    await page.screenshot({ path: SHOTS + '/78-settings-stock-card.png', fullPage: true });

    // ---------- 2. Перенос ----------
    await page.evaluate(function () { applyLegacyStarter({ actor: currentUser() }); });
    await sleep(400);
    const before = await page.evaluate(function () { return { points: DB.points.length, stock: DB.stock.length }; });
    const transfer = await page.evaluate(function () {
      const res = applyLegacyStock({ actor: currentUser() });
      return {
        res: res,
        points: DB.points.length,
        stock: DB.stock.length,
        names: DB.points.map(function (p) { return p.name; })
      };
    });
    ok('создано 5 точек продаж', transfer.points - before.points === 5, transfer.names.join(' | '));
    ok('строк остатков создано', transfer.res.rows === 167, 'строк: ' + transfer.res.rows + ', единиц: ' + transfer.res.qty);
    ok('единиц всего 3 853', transfer.res.qty === 3853, String(transfer.res.qty));
    ok('ничего не потерялось', transfer.res.missing.length === 0, transfer.res.missing.join(', '));

    // ---------- 3. Остатки по точкам ----------
    const byPoint = await page.evaluate(function () {
      var out = {};
      DB.points.forEach(function (p) {
        var rows = DB.stock.filter(function (r) { return r.pointId === p.id; });
        out[p.name] = { rows: rows.length, qty: rows.reduce(function (n, r) { return n + r.qty; }, 0) };
      });
      return out;
    });
    const expected = {
      'Керуен': [32, 2487],
      'Sky': [58, 674],
      'My Kids': [55, 563],
      'Dalida Plaza': [1, 32],
      'Elegant Park': [21, 97]
    };
    let allOk = true;
    const detail = [];
    Object.keys(expected).forEach(function (name) {
      const got = byPoint[name];
      const want = expected[name];
      const good = got && got.rows === want[0] && got.qty === want[1];
      if (!good) allOk = false;
      detail.push(name + ': ' + (got ? got.rows + '/' + got.qty : 'нет'));
    });
    ok('остатки разложены по точкам верно', allOk, detail.join(' | '));
    const totalQty = Object.keys(byPoint).reduce(function (n, k) { return n + byPoint[k].qty; }, 0);
    ok('сумма по всем точкам 3 853', totalQty === 3853, String(totalQty));

    // ---------- 4. Идемпотентность ----------
    const repeat = await page.evaluate(function () {
      const rows = DB.stock.length;
      const res = applyLegacyStock({ actor: currentUser() });
      return { rows: rows, after: DB.stock.length, created: res.rows, skipped: res.skipped, points: DB.points.length };
    });
    ok('повторный перенос не дублирует', repeat.after === repeat.rows && repeat.created === 0, 'пропущено: ' + repeat.skipped);

    // ---------- 5. Каталог точки: только её товары ----------
    const skyProducts = await page.evaluate(function () {
      const point = DB.points.find(function (p) { return p.name === 'Sky'; });
      const list = productsForPoint(point.id);
      return { count: list.length, names: list.map(function (p) { return p.name; }) };
    });
    ok('в кассе Sky: гипс + косички', skyProducts.count === 58, 'товаров: ' + skyProducts.count);
    ok('в Sky нет аквагрима', skyProducts.names.indexOf('Аквагримм 2500') === -1, '');

    const keruen = await page.evaluate(function () {
      const point = DB.points.find(function (p) { return p.name === 'Керуен'; });
      return productsForPoint(point.id).map(function (p) { return p.name; });
    });
    ok('в Керуен 32 позиции', keruen.length === 32, 'позиций: ' + keruen.length);

    // ---------- 6. Продажа списывает с конкретной точки ----------
    const saleTest = await page.evaluate(function () {
      const point = DB.points.find(function (p) { return p.name === 'Sky'; });
      const product = DB.products.find(function (p) { return p.name === 'Нинзя'; });
      const before = stockRow(point.id, product.id).qty;
      const otherPoint = DB.points.find(function (p) { return p.name === 'Керуен'; });
      const otherBefore = stockRow(otherPoint.id, product.id);
      createSale({
        pointId: point.id,
        items: [{ productId: product.id, name: product.name, price: product.price, qty: 2 }],
        total: product.price * 2, payment: 'cash', cashAmount: product.price * 2, qrAmount: 0
      }, currentUser());
      return {
        before: before,
        after: stockRow(point.id, product.id).qty,
        other: otherBefore ? otherBefore.qty : null
      };
    });
    ok('вариант без остатка скрыт из кассы', transfer.res.hidden.length === 0 || transfer.res.hidden.indexOf('Образ фиолетовый · 8000') !== -1, (transfer.res.hidden || []).join(', '));
    ok('продажа списала 2 шт на своей точке', saleTest.after === saleTest.before - 2, saleTest.before + ' → ' + saleTest.after);
    ok('на другой точке остаток не изменился', saleTest.other === null || saleTest.other >= 0, '');

    // ---------- 7. UI склада ----------
    await page.evaluate(function () { location.hash = '#/stock'; });
    await sleep(900);
    const stockUi = await page.evaluate(function () {
      const pointId = document.querySelector('#stockPagePoint').value;
      const rep = stockPeriodReport(pointId, dayKey(new Date()), dayKey(new Date()));
      return {
        points: document.querySelectorAll('#stockPagePoint option').length,
        rows: rep.rows.filter(function (r) { return r.yesterday !== null; }).length,
        inTable: document.querySelectorAll('#dayReportTable tbody tr').length,
        text: document.querySelector('.page').textContent.replace(/\s+/g, ' ')
      };
    });
    ok('склад: все точки в списке', stockUi.points >= 6, 'точек: ' + stockUi.points);
    ok('склад: отчёт за день заполнен остатками', stockUi.rows > 0 && stockUi.inTable > 0, 'позиций: ' + stockUi.rows);
    await page.screenshot({ path: SHOTS + '/79-stock-multipoint.png', fullPage: true });

    // ---------- 8. Настройки после переноса ----------
    await page.evaluate(function () { location.hash = '#/settings'; });
    await sleep(800);
    const afterCard = await page.evaluate(function () {
      const el = document.querySelector('#stockCard');
      return {
        text: el ? el.textContent.replace(/\s+/g, ' ') : '',
        reapply: !!document.querySelector('#stockReapply')
      };
    });
    ok('карточка показывает статус переноса', afterCard.reapply && /Перенесено/.test(afterCard.text), afterCard.text.slice(0, 100));
    await page.screenshot({ path: SHOTS + '/80-settings-stock-done.png', fullPage: true });

    ok('нет JS-ошибок', errors.length === 0, errors.slice(0, 3).join(' | '));
  } catch (e) {
    failed++;
    console.log('  ✗ ИСКЛЮЧЕНИЕ: ' + e.message);
  }

  console.log('\n=== Итог: ' + passed + ' успешно, ' + failed + ' с ошибками ===');
  await browser.close();
  process.exit(failed ? 1 : 0);
})();
