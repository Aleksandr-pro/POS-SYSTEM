/* Проверка: заглушки не суммируются с внесёнными данными и убираются одной кнопкой */
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
    console.log('\n=== Заглушки: не суммируются и убираются ===');
    await page.goto(BASE + '/index.html', { waitUntil: 'networkidle0' });
    await sleep(400);

    await page.evaluate(async () => {
      const now = Date.now();
      const admin = await createUser({ fullName: 'Владелец Сети', username: 'stubadmin', password: 'stubadmin1' }, { autoRole: true });
      setSession(admin.id);
      ['Керуен', 'Sky', 'My Kids', 'Dalida Plaza', 'Elegant Park'].forEach((n) => DB.points.push({ id: uid(), name: n, createdAt: now, updatedAt: now }));
      const p = DB.points[0];
      DB.products.push({ id: uid(), name: 'Аквагримм 1500', price: 1500, cost: 0, stock: 0, pointId: null, createdAt: now, updatedAt: now });
      saveDB();
      window.__adminId = admin.id;
      window.__pointId = p.id;
    });

    // «своя» продажа за 1 октября, внесённая как обычная продажа
    const own = await page.evaluate(() => {
      const at = new Date(2026, 9, 1, 12, 0, 0).getTime();
      const s = {
        id: uid(), code: shortId(), userId: getUser(window.__adminId).id, userName: getUser(window.__adminId).fullName,
        pointId: window.__pointId, pointName: DB.points[0].name,
        items: [{ productId: null, name: 'Своя продажа', price: 1000, qty: 1 }],
        total: 1000, payment: 'cash', cashAmount: 1000, qrAmount: 0,
        createdAt: at, updatedAt: at
      };
      DB.sales.push(s); saveDB();
      return summarize(startOfDay(new Date(2026, 9, 1)), endOfDay(new Date(2026, 9, 1))).revenue;
    });
    ok('своя продажа за 1 октября = 1 000', own === 1000, String(own));

    // 1. сводная заглушка на 19 300
    const withStub = await page.evaluate((adminId) => {
      const parsed = parseHistoryText('01.10.2026 19300 11700 7600 11', { avgCheck: 3000 });
      importHistoryDays(parsed.days, { actor: getUser(adminId), replace: true });
      return {
        revenue: summarize(startOfDay(new Date(2026, 9, 1)), endOfDay(new Date(2026, 9, 1))).revenue,
        stubs: historyStubSummary()
      };
    }, await page.evaluate(() => window.__adminId));
    ok('заглушка добавила 19 300', withStub.revenue === 20300, String(withStub.revenue));
    ok('заглушек 11', withStub.stubs.count === 11, JSON.stringify(withStub.stubs));

    // 2. импорт транзакций за тот же день должен убрать заглушки, а не сложиться
    const afterTx = await page.evaluate((text, adminId) => {
      const res = parseTransactionsText(text, { date: '2026-10-01' });
      const out = importTransactions(res.transactions, { actor: getUser(adminId), replace: true });
      const day = summarize(startOfDay(new Date(2026, 9, 1)), endOfDay(new Date(2026, 9, 1)));
      return { out, revenue: day.revenue, stubs: historyStubSummary(), history: DB.sales.filter((s) => s.historyImport).length };
    }, sample, await page.evaluate(() => window.__adminId));
    ok('заглушки удалены автоматически', afterTx.stubs.count === 0, 'осталось заглушек: ' + afterTx.stubs.count);
    ok('выручка дня 20 300 без удвоения', afterTx.revenue === 20300, String(afterTx.revenue));
    ok('в истории 11 транзакций', afterTx.history === 11, String(afterTx.history));

    // 3. повторный импорт того же дня не задваивает
    const twice = await page.evaluate((text, adminId) => {
      const res = parseTransactionsText(text, { date: '2026-10-01' });
      importTransactions(res.transactions, { actor: getUser(adminId), replace: true });
      const day = summarize(startOfDay(new Date(2026, 9, 1)), endOfDay(new Date(2026, 9, 1)));
      return { revenue: day.revenue, history: DB.sales.filter((s) => s.historyImport).length };
    }, sample, await page.evaluate(() => window.__adminId));
    ok('повторный импорт заменяет, а не суммирует', twice.revenue === 20300 && twice.history === 11, twice.revenue + ' / ' + twice.history);

    // 4. снова добавляем заглушку и убираем кнопкой в интерфейсе
    await page.evaluate((adminId) => {
      const parsed = parseHistoryText('02.10.2026 50000 30000 20000 20', { avgCheck: 3000 });
      importHistoryDays(parsed.days, { actor: getUser(adminId), replace: true });
      setSession(adminId);
      location.hash = '#/settings';
    }, await page.evaluate(() => window.__adminId));
    await sleep(1200);
    const card = await page.evaluate(() => {
      const btn = document.querySelector('#historyClearStubs');
      return { hasBtn: !!btn, text: btn ? btn.textContent.trim() : '', badge: (document.querySelector('#historyCard .badge.warn') || {}).textContent || '' };
    });
    ok('в карточке есть кнопка «Убрать заглушки»', card.hasBtn && /Убрать заглушки/.test(card.text), card.text);
    ok('и предупреждение о сумме', /20/.test(card.badge), card.badge.trim());
    await page.screenshot({ path: require('path').join(__dirname, '..', 'screenshots', '114-stubs-badge.png') });

    await page.evaluate(() => document.querySelector('#historyClearStubs').click());
    await sleep(400);
    const dlg = await page.evaluate(() => ({ text: (document.querySelector('.modal') || {}).textContent || '' }));
    ok('диалог перечисляет, что удалится', /20 шт|20 записей|50 000/.test(dlg.text), dlg.text.replace(/\s+/g, ' ').slice(0, 120));
    await page.evaluate(() => document.querySelector('.modal [data-ok]').click());
    await sleep(1200);
    const cleaned = await page.evaluate(() => {
      const day1 = summarize(startOfDay(new Date(2026, 9, 1)), endOfDay(new Date(2026, 9, 1)));
      const day2 = summarize(startOfDay(new Date(2026, 9, 2)), endOfDay(new Date(2026, 9, 2)));
      return {
        d1: day1.revenue, d2: day2.revenue,
        stubs: historyStubSummary().count,
        history: DB.sales.filter((s) => s.historyImport).length,
        own: DB.sales.filter((s) => !s.historyImport).length,
        stock: DB.stock.length
      };
    });
    ok('заглушка 2 октября удалена', cleaned.d2 === 0, String(cleaned.d2));
    ok('транзакции 1 октября остались', cleaned.d1 === 20300 && cleaned.history === 11, cleaned.d1 + ' / ' + cleaned.history);
    ok('своя продажа не тронута', cleaned.own === 1, String(cleaned.own));
    ok('склад не тронут', cleaned.stock === 0, String(cleaned.stock));
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
