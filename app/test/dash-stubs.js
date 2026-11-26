/* Проверка: заглушки из переноса старой системы видны и удаляются кнопкой на панели */
const puppeteer = require('puppeteer');
const { installDayClock } = require('./helpers/clock');

const BASE = process.env.BASE || 'http://127.0.0.1:8099';
let passed = 0, failed = 0;
const ok = (n, c, e) => { if (c) { passed++; console.log('  ✓ ' + n + (e ? ' — ' + e : '')); } else { failed++; console.log('  ✗ ' + n + (e ? ' — ' + e : '')); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage();
  await installDayClock(page);
  await page.setViewport({ width: 420, height: 900, isMobile: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  try {
    console.log('\n=== Заглушки из старого переноса: удаление с панели ===');
    await page.goto(BASE + '/index.html', { waitUntil: 'networkidle0' });
    await sleep(400);

    const seed = await page.evaluate(async () => {
      const now = Date.now();
      const admin = await createUser({ fullName: 'Юлия', username: 'yulia', password: 'yulia123' }, { autoRole: true });
      setSession(admin.id);
      DB.points.push({ id: uid(), name: 'Керуен', address: '', createdAt: now, updatedAt: now });
      DB.points.push({ id: uid(), name: 'Sky', address: '', createdAt: now, updatedAt: now });
      saveDB();
      // ровно как в старой системе: 36 чеков на 74 124, без состава
      const res = importSalesHistory({
        actor: admin, from: '2026-10-01', to: '2026-10-01', count: 36,
        revenue: 74124, cashTotal: 30000, qrTotal: 44124, mixedCash: 0, mixedQr: 0, pointId: DB.points[0].id
      });
      // плюс настоящая продажа с составом за тот же день
      const at = new Date(2026, 9, 1, 21, 40, 0).getTime();
      DB.sales.push({
        id: uid(), code: shortId(), userId: admin.id, userName: admin.fullName,
        pointId: DB.points[1].id, pointName: 'Sky',
        items: [{ productId: null, name: 'Настоящая продажа', price: 5000, qty: 1 }],
        total: 5000, payment: 'cash', cashAmount: 5000, qrAmount: 0,
        createdAt: at, updatedAt: at
      });
      saveDB();
      return { created: res.created, stubs: historyStubSummary() };
    });
    ok('перенос создал 36 записей', seed.created === 36, String(seed.created));
    ok('они распознаны как заглушки', seed.stubs.count === 36, JSON.stringify(seed.stubs));

    await page.evaluate(() => { location.hash = '#/dashboard'; });
    await sleep(1500);
    const btn = await page.evaluate(() => {
      const b = document.querySelector('#dashClearStubs');
      return { exists: !!b, text: b ? b.textContent.trim() : '' };
    });
    ok('на панели есть кнопка удаления', btn.exists, btn.text);
    await page.screenshot({ path: require('path').join(__dirname, '..', 'screenshots', '116-dash-stubs-btn.png') });

    await page.evaluate(() => document.querySelector('#dashClearStubs').click());
    await sleep(500);
    const dlg = await page.evaluate(() => (document.querySelector('.modal') || {}).textContent || '');
    ok('подтверждение с числом и суммой', /36/.test(dlg) && /74/.test(dlg), dlg.replace(/\s+/g, ' ').slice(0, 120));
    await page.evaluate(() => document.querySelector('.modal [data-ok]').click());
    await sleep(1500);

    const after = await page.evaluate(() => {
      const day = summarize(startOfDay(new Date(2026, 9, 1)), endOfDay(new Date(2026, 9, 1)));
      return {
        left: DB.sales.length,
        stubs: historyStubSummary().count,
        revenue: day.revenue,
        count: day.salesCount,
        items: (day.sales[0] || {}).items ? day.sales[0].items.length : -1,
        ranges: (DB.settings.importedRanges || []).length,
        stock: DB.stock.length
      };
    });
    ok('все 36 заглушек удалены', after.stubs === 0 && after.left === 1, 'осталось записей: ' + after.left);
    ok('настоящая продажа на 5 000 осталась', after.revenue === 5000 && after.count === 1, after.revenue + ' / ' + after.count);
    ok('состав у неё на месте', after.items === 1, String(after.items));
    ok('список переноса очищен', after.ranges === 0, String(after.ranges));
    ok('склад не тронут', after.stock === 0, String(after.stock));
    ok('кнопка исчезла после удаления', await page.evaluate(() => !document.querySelector('#dashClearStubs')));
    await page.screenshot({ path: require('path').join(__dirname, '..', 'screenshots', '117-dash-stubs-cleared.png') });
    ok('нет JS-ошибок', errors.length === 0, errors.slice(0, 2).join(' | ') || 'чисто');
  } catch (e) {
    failed++;
    console.log('  ✗ исключение: ' + e.message);
  } finally {
    await browser.close();
    console.log('\n=== Итог: ' + passed + ' успешно, ' + failed + ' с ошибками ===');
    process.exit(failed ? 1 : 0);
  }
})();
