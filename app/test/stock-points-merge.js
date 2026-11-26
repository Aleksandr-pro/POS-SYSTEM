/* ============================================================
   Проверки: слияние точек «Аквагрим Керуен» + «Косички Керуен»
   в одну точку «Керуен» (данные из версий 2.6.0 / 2.7.0)
   ============================================================ */
const puppeteer = require('puppeteer');

const BASE = process.env.BASE || 'http://127.0.0.1:8099';
const SHOTS = require('path').join(__dirname, '..', 'screenshots');

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
    console.log('\n=== Слияние неправильно созданных точек 2.6/2.7 ===');
    await page.goto(BASE + '/index.html', { waitUntil: 'load' });
    await sleep(300);

    await page.click('#goRegister');
    await sleep(250);
    await page.type('#regName', 'Владелец Сети');
    await page.type('#regUser', 'mergeowner');
    await page.type('#regPass', 'mergepass1');
    await page.type('#regPass2', 'mergepass1');
    await page.evaluate(function () { const b = document.querySelector('#regTerms'); b.checked = true; b.dispatchEvent(new Event('change', { bubbles: true })); });
    await page.click('#regBtn');
    await page.waitForSelector('.topbar', { timeout: 15000 });
    await sleep(400);

    await page.evaluate(function () { applyLegacyStarter({ actor: currentUser() }); });
    await sleep(300);
    await page.evaluate(function () { applyLegacyStock({ actor: currentUser() }); });
    await sleep(400);

    // имитируем состояние из 2.6.0: две отдельные точки Керуен + Sky + My Kids
    const before = await page.evaluate(function () {
      const user = currentUser();
      function renamePoint(fromName, toName) {
        const p = DB.points.find(function (x) { return x.name === fromName; });
        p.name = toName;
        DB.sales.forEach(function (s) { if (s.pointId === p.id) s.pointName = toName; });
        return p;
      }
      renamePoint('Керуен', 'Аквагрим Керуен');
      renamePoint('Sky', 'Косички Sky');
      renamePoint('My Kids', 'Гипс MyKids');

      // отделяем «Косички» в свои точки, как делала версия 2.6.0
      const keruen = DB.points.find(function (p) { return p.name === 'Аквагрим Керуен'; });
      const kos = { id: uid(), name: 'Косички Керуен', address: '', createdAt: Date.now(), updatedAt: Date.now() };
      DB.points.push(kos);
      const tatu = DB.products.find(function (p) { return p.name === 'Тату 700'; });
      const row = stockRow(keruen.id, tatu.id);
      const moved = 10;
      row.qty -= moved;
      row.history.unshift({ at: Date.now(), delta: -moved, qtyAfter: row.qty, note: 'перенос', by: 'тест' });
      setStockQty(kos.id, tatu.id, moved, 'остаток', user);
      tatu.pointIds = tatu.pointIds.concat([kos.id]);
      saveDB();
      return {
        points: DB.points.map(function (p) { return p.name; }),
        keruenQty: stockRow(keruen.id, tatu.id).qty,
        kosQty: stockRow(kos.id, tatu.id).qty,
        rows: DB.stock.length
      };
    });
    ok('подготовлено состояние 2.6.0', before.points.indexOf('Аквагрим Керуен') !== -1 && before.points.indexOf('Косички Керуен') !== -1,
      before.points.join(' | '));
    ok('Тату 700 разделён между двумя точками', before.keruenQty + before.kosQty === 29, before.keruenQty + ' + ' + before.kosQty);

    // перезагрузка → миграция при старте
    await page.reload({ waitUntil: 'load' });
    await sleep(900);

    const after = await page.evaluate(function () {
      const keruen = DB.points.find(function (p) { return p.name === 'Керуен'; });
      const tatu = DB.products.find(function (p) { return p.name === 'Тату 700'; });
      return {
        points: DB.points.map(function (p) { return p.name; }),
        qty: keruen ? stockRow(keruen.id, tatu.id).qty : null,
        rows: DB.stock.length,
        legacyLeft: DB.points.filter(function (p) { return /·/.test(p.name) || /Аквагрим Керуен|Косички|Гипс|MyKids/.test(p.name); }).map(function (p) { return p.name; })
      };
    });
    ok('получилась одна точка «Керуен»', after.points.filter(function (n) { return n === 'Керуен'; }).length === 1, after.points.join(' | '));
    ok('остатки двух точек сложились', after.qty === 29, 'Тату 700: ' + after.qty);
    ok('старых названий не осталось', after.legacyLeft.length === 0, after.legacyLeft.join(', '));
    ok('Sky и My Kids собраны', after.points.indexOf('Sky') !== -1 && after.points.indexOf('My Kids') !== -1, after.points.join(' | '));

    // точек ровно 5 + техническая
    ok('итого точек: 5 точек старой системы', after.points.filter(function (n) { return ['Керуен', 'Sky', 'My Kids', 'Dalida Plaza', 'Elegant Park'].indexOf(n) !== -1; }).length === 5, after.points.join(' | '));

    // повторная миграция не должна ничего ломать
    await page.reload({ waitUntil: 'load' });
    await sleep(800);
    const twice = await page.evaluate(function () {
      const keruen = DB.points.find(function (p) { return p.name === 'Керуен'; });
      const tatu = DB.products.find(function (p) { return p.name === 'Тату 700'; });
      return { qty: stockRow(keruen.id, tatu.id).qty, points: DB.points.length, stock: DB.stock.length };
    });
    ok('повторная миграция не меняет данные', twice.qty === 29 && twice.points === after.points.length, 'точек: ' + twice.points + ', строк: ' + twice.stock);

    await page.evaluate(function () { location.hash = '#/points'; });
    await sleep(900);
    const pointsUi = await page.evaluate(function () {
      return document.body.textContent.replace(/\s+/g, ' ');
    });
    ok('в разделе «Точки продаж» пять точек', ['Керуен', 'Sky', 'My Kids', 'Dalida Plaza', 'Elegant Park'].every(function (n) { return pointsUi.indexOf(n) !== -1; }), '');
    await page.screenshot({ path: SHOTS + '/84-points-merged.png', fullPage: true });

    ok('нет JS-ошибок', errors.length === 0, errors.slice(0, 3).join(' | '));
  } catch (e) {
    failed++;
    console.log('  ✗ ИСКЛЮЧЕНИЕ: ' + e.message);
  }

  console.log('\n=== Итог: ' + passed + ' успешно, ' + failed + ' с ошибками ===');
  await browser.close();
  process.exit(failed ? 1 : 0);
})();
