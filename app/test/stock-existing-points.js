/* ============================================================
   Проверки: остатки вливаются в УЖЕ существующие точки,
   новые не создаются (в т.ч. при латинских названиях)
   ============================================================ */
const puppeteer = require('puppeteer');

const BASE = process.env.BASE || 'http://127.0.0.1:8099';

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

  try {
    console.log('\n=== Остатки в существующие точки ===');
    await page.goto(BASE + '/index.html', { waitUntil: 'load' });
    await sleep(300);

    await page.click('#goRegister');
    await sleep(250);
    await page.type('#regName', 'Владелец Сети');
    await page.type('#regUser', 'existpoints');
    await page.type('#regPass', 'existpass1');
    await page.type('#regPass2', 'existpass1');
    await page.evaluate(function () { const b = document.querySelector('#regTerms'); b.checked = true; b.dispatchEvent(new Event('change', { bubbles: true })); });
    await page.click('#regBtn');
    await page.waitForSelector('.topbar', { timeout: 15000 });
    await sleep(400);

    // у пользователя уже были свои точки (в т.ч. латиницей)
    const created = await page.evaluate(function () {
      ['Керуен', 'Keruen', 'Sky', 'MY KIDS', 'Dalida Plaza', 'Elegant Park'].forEach(function (name) {
        DB.points.push({ id: uid(), name: name, address: '', createdAt: Date.now(), updatedAt: Date.now() });
      });
      saveDB();
      return DB.points.map(function (p) { return p.name; });
    });
    ok('созданы свои точки', created.length === 6, created.join(' | '));

    await page.evaluate(function () { applyLegacyStarter({ actor: currentUser() }); });
    await sleep(300);
    const res = await page.evaluate(function () {
      const r = applyLegacyStock({ actor: currentUser() });
      return {
        res: r,
        points: DB.points.map(function (p) { return p.name; }),
        keruen: DB.points.filter(function (p) { return /керуен|keruen/i.test(p.name); }).length
      };
    });
    ok('новые точки не создавались', res.res.pointsCreated === 0, 'создано: ' + res.res.pointsCreated);
    ok('все 167 строк разложены по существующим точкам', res.res.rows === 167, 'строк: ' + res.res.rows);
    ok('дублей «Керуен» не появилось', res.keruen <= 2, res.points.join(' | '));

    const byPoint = await page.evaluate(function () {
      var out = {};
      DB.points.forEach(function (p) {
        var rows = DB.stock.filter(function (r) { return r.pointId === p.id; });
        if (!rows.length) return;
        out[p.name] = rows.reduce(function (n, r) { return n + r.qty; }, 0);
      });
      return out;
    });
    const total = Object.keys(byPoint).reduce(function (n, k) { return n + byPoint[k]; }, 0);
    ok('остаток распределён по точкам', total === 3853, JSON.stringify(byPoint).slice(0, 160));
    ok('нет точки с «нулевым» остатком', Object.keys(byPoint).length >= 5, 'точек с остатком: ' + Object.keys(byPoint).length);

    // отчёт за день в существующей точке
    await page.evaluate(function () { location.hash = '#/stock'; });
    await sleep(900);
    const day = await page.evaluate(function () {
      const point = DB.points.find(function (p) { return /керуен|keruen/i.test(p.name) && DB.stock.some(function (r) { return r.pointId === p.id; }); });
      const rep = stockDayReport(point.id, dayKey(new Date()));
      return { point: point.name, rows: rep.rows.length, qty: rep.totals.yesterday };
    });
    ok('отчёт за день работает в существующей точке', day.rows > 0 && day.qty > 0, day.point + ': ' + day.rows + ' позиций, ' + day.qty + ' шт');
    await page.screenshot({ path: require('path').join(__dirname, '..', 'screenshots', '85-stock-existing-points.png'), fullPage: true });

    ok('нет JS-ошибок', errors.length === 0, errors.slice(0, 3).join(' | '));
  } catch (e) {
    failed++;
    console.log('  ✗ ИСКЛЮЧЕНИЕ: ' + e.message);
  }

  console.log('\n=== Итог: ' + passed + ' успешно, ' + failed + ' с ошибками ===');
  await browser.close();
  process.exit(failed ? 1 : 0);
})();
