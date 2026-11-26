/* Проверка: разработчик правит показатели и удаляет продажи (только дни до 22.10.2026) */
const puppeteer = require('puppeteer');
const { installDayClock } = require('./helpers/clock');
const sample = require('./fixtures-oct1-full');

const BASE = process.env.BASE || 'http://127.0.0.1:8099';
let passed = 0, failed = 0;
const ok = (n, c, e) => { if (c) { passed++; console.log('  ✓ ' + n + (e ? ' — ' + e : '')); } else { failed++; console.log('  ✗ ' + n + (e ? ' — ' + e : '')); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage();
  await installDayClock(page);
  await page.setViewport({ width: 1440, height: 1100 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  try {
    console.log('\n=== Корректировка показателей (разработчик) ===');
    await page.goto(BASE + '/index.html', { waitUntil: 'networkidle0' });
    await sleep(400);

    const seed = await page.evaluate(async (text) => {
      const now = Date.now();
      const dev = await createUser({ fullName: 'Разработчик', username: 'devuser', password: 'devpass1' }, { autoRole: true });
      DB.users.find((u) => u.id === dev.id).role = 'dev';
      setSession(dev.id);
      ['Керуен', 'Sky', 'My Kids'].forEach((n) => DB.points.push({ id: uid(), name: n, createdAt: now, updatedAt: now }));
      await createUser({ fullName: 'Арина Турланова', username: 'ar1', password: 'ar12345', role: 'seller', pointIds: [] });
      await createUser({ fullName: 'Дарья', username: 'da1', password: 'da12345', role: 'seller', pointIds: [] });
      await createUser({ fullName: 'Айнэлля Нагметова', username: 'an1', password: 'an12345', role: 'seller', pointIds: [] });
      await createUser({ fullName: 'Нурдана Калыбай', username: 'nu1', password: 'nu12345', role: 'seller', pointIds: [] });
      saveDB();
      window.__devId = dev.id;
      return { role: getUser(dev.id).role };
    }, sample);
    ok('создан пользователь с ролью dev', seed.role === 'dev', seed.role);

    const rights = await page.evaluate((text) => {
      const dev = getUser(window.__devId);
      const parsed = parseTransactionsText(text, { date: '2026-10-01' });
      importTransactions(parsed.transactions, { actor: dev, replace: true });
      const seller = DB.users.find((u) => u.role === 'seller');
      const admin = { id: 'x', role: 'admin', fullName: 'Админ' };
      return {
        sellerSet: setDayAdjustment(seller, '2026-10-01', { revenue: 1 }).error || '',
        adminSet: setDayAdjustment(admin, '2026-10-01', { revenue: 1 }).error || '',
        devSet: setDayAdjustment(dev, '2026-10-01', { revenue: 1 }).error || '',
        future: setDayAdjustment(dev, '2026-10-22', { revenue: 1 }).error || '',
        today: setDayAdjustment(dev, dayKey(new Date()), { revenue: 1 }).error || '',
        sellerDel: deleteDaySales(seller, '2026-10-01', {}).error || ''
      };
    }, sample);
    ok('продавцу нельзя', /разработчик/i.test(rights.sellerSet), rights.sellerSet);
    ok('администратору нельзя', /разработчик/i.test(rights.adminSet), rights.adminSet);
    ok('разработчику можно', rights.devSet === '', rights.devSet || 'нет ошибки');
    ok('22.10 закрыто', /до 22.10.2026/.test(rights.future), rights.future);
    ok('сегодня закрыто', /до 22.10.2026/.test(rights.today), rights.today);
    ok('продавец не удаляет продажи', /разработчик/i.test(rights.sellerDel), rights.sellerDel);

    await page.evaluate(() => { resetDayAdjustment(getUser(window.__devId), '2026-10-01'); });

    // факт по дню
    const before = await page.evaluate(() => {
      const s = dayEditSummary('2026-10-01');
      return { revenue: s.revenue, cash: s.cash, qr: s.qr, count: s.count, history: s.history, profit: s.profit };
    });
    ok('факт 1 октября = 19 300 / 11 чеков', before.revenue === 19300 && before.count === 11, before.revenue + ' / ' + before.count);
    ok('факт: наличные 11 700, QR 7 600', before.cash === 11700 && before.qr === 7600, before.cash + ' / ' + before.qr);
    ok('прибыль равна выручке (расходов нет)', before.profit === 19300, String(before.profit));

    // корректировка
    const fixed = await page.evaluate(() => {
      const dev = getUser(window.__devId);
      const res = setDayAdjustment(dev, '2026-10-01', {
        revenue: 25000, expenses: 4000, profit: 21000, avgCheck: 2500, cash: 15000, qr: 8000, mixed: 2000
      }, { replace: true });
      const s = summarize(startOfDay(new Date(2026, 9, 1)), endOfDay(new Date(2026, 9, 1)));
      const m = summarize(startOfDay(new Date(2026, 9, 1)), endOfDay(new Date(2026, 9, 30)));
      return { err: res.error || '', revenue: s.revenue, expenses: s.expenses, profit: s.profit, avg: s.avgCheck, cash: s.cashTotal, qr: s.qrTotal, mixed: s.mixedTotal, count: s.salesCount, month: m.revenue };
    });
    ok('корректировка сохранена', fixed.err === '', fixed.err || 'ok');
    ok('выручка заменена на 25 000', fixed.revenue === 25000, String(fixed.revenue));
    ok('расходы 4 000', fixed.expenses === 4000, String(fixed.expenses));
    ok('прибыль задана 21 000', fixed.profit === 21000, String(fixed.profit));
    ok('средний чек 2 500', Math.round(fixed.avg) === 2500, String(Math.round(fixed.avg)));
    ok('чеков пересчитано 10', fixed.count === 10, String(fixed.count));
    ok('наличные 15 000', fixed.cash === 15000, String(fixed.cash));
    ok('QR 8 000', fixed.qr === 8000, String(fixed.qr));
    ok('смешанные 2 000', fixed.mixed === 2000, String(fixed.mixed));
    ok('в месячном итоге тоже 25 000', fixed.month === 25000, String(fixed.month));

    const isolated = await page.evaluate(() => {
      const s = summarize(startOfDay(new Date(2026, 9, 2)), endOfDay(new Date(2026, 9, 2)));
      return s.revenue;
    });
    ok('другие дни не затронуты', isolated === 0, String(isolated));

    // сброс
    const reset = await page.evaluate(() => {
      const dev = getUser(window.__devId);
      resetDayAdjustment(dev, '2026-10-01');
      const s = dayEditSummary('2026-10-01');
      return { r: s.revenue, c: s.count };
    });
    ok('сброс вернул факт 19 300 / 11', reset.r === 19300 && reset.c === 11, reset.r + ' / ' + reset.c);

    // UI
    await page.evaluate(() => { setSession(window.__devId); location.hash = '#/settings'; });
    await sleep(1300);
    const ui = await page.evaluate(() => {
      const card = document.querySelector('#devAdjustCard');
      return {
        exists: !!card,
        max: (document.querySelector('#devAdjDate') || {}).max,
        fields: ['devAdjRevenue', 'devAdjExpenses', 'devAdjProfit', 'devAdjAvg', 'devAdjCash', 'devAdjQr', 'devAdjMixed'].filter((id) => document.querySelector('#' + id)).length,
        buttons: ['devAdjSave', 'devAdjClear', 'devAdjDelStubs', 'devAdjDelHistory', 'devAdjDelAll'].filter((id) => document.querySelector('#' + id)).length
      };
    });
    ok('карточка есть у разработчика', ui.exists === true);
    ok('дата ограничена 21.10.2026', ui.max === '2026-10-21', ui.max);
    ok('7 полей показателей', ui.fields === 7, String(ui.fields));
    ok('5 кнопок действий', ui.buttons === 5, String(ui.buttons));

    await page.evaluate(() => {
      const d = document.querySelector('#devAdjDate');
      d.value = '2026-10-01';
      d.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await sleep(300);
    await page.evaluate(() => {
      document.querySelector('#devAdjRevenue').value = '31000';
      document.querySelector('#devAdjExpenses').value = '1000';
      document.querySelector('#devAdjSave').click();
    });
    await sleep(1200);
    const saved = await page.evaluate(() => {
      const s = dayEditSummary('2026-10-01');
      return { rev: s.revenue, exp: s.expenses, profit: s.profit, adj: !!s.adjustment };
    });
    ok('правка через интерфейс сохранена', saved.rev === 31000 && saved.exp === 1000 && saved.profit === 30000, saved.rev + ' / ' + saved.exp + ' / ' + saved.profit);
    await page.screenshot({ path: require('path').join(__dirname, '..', 'screenshots', '115-dev-adjust.png'), fullPage: false });

    // пустая дата-защита в интерфейсе
    const guard = await page.evaluate(() => {
      const d = document.querySelector('#devAdjDate');
      d.value = '2026-10-25';
      d.dispatchEvent(new Event('change', { bubbles: true }));
      return d.value;
    });
    ok('интерфейс не даёт выбрать 25.10', guard === '2026-10-21', guard);

    // удаление истории дня
    const del = await page.evaluate((text) => {
      const dev = getUser(window.__devId);
      const a = deleteDaySales(dev, '2026-10-01', { onlyHistory: true });
      const s = dayEditSummary('2026-10-01');
      return { removed: a.removed, left: s.sales, revenue: s.revenue };
    }, sample);
    ok('история дня удалена', del.removed === 11 && del.left === 0, del.removed + ' / осталось ' + del.left);

    // заглушки
    const stubs = await page.evaluate(() => {
      const dev = getUser(window.__devId);
      const parsed = parseHistoryText('02.10.2026 50000 30000 20000 20', { avgCheck: 2500 });
      importHistoryDays(parsed.days, { actor: dev, replace: true });
      const before = dayEditSummary('2026-10-02');
      const r = deleteDaySales(dev, '2026-10-02', { onlyStubs: true });
      const after = dayEditSummary('2026-10-02');
      return { stubsBefore: before.stubs, removed: r.removed, left: after.sales };
    });
    ok('заглушки найдены и удалены', stubs.stubsBefore === 20 && stubs.removed === 20 && stubs.left === 0, stubs.stubsBefore + ' → ' + stubs.left);

    // продажи за 21.10 не удаляются за пределами лимита
    const limit = await page.evaluate(() => {
      const dev = getUser(window.__devId);
      return deleteDaySales(dev, '2026-10-23', {}).error || '';
    });
    ok('запрет на дни ≥ 22.10 держится', /до 22.10.2026/.test(limit), limit);
    ok('нет JS-ошибок', errors.length === 0, errors.slice(0, 3).join(' | ') || 'чисто');
  } catch (e) {
    failed++;
    console.log('  ✗ исключение: ' + e.message);
  } finally {
    await browser.close();
    console.log('\n=== Итог: ' + passed + ' успешно, ' + failed + ' с ошибками ===');
    process.exit(failed ? 1 : 0);
  }
})();
