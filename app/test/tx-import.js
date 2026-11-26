/* Проверка: импорт списка транзакций из старой системы */
const puppeteer = require('puppeteer');
const { installDayClock } = require('./helpers/clock');
const sample = require('./fixtures-oct1');

const BASE = process.env.BASE || 'http://127.0.0.1:8099';
let passed = 0, failed = 0;
const ok = (n, c, e) => { if (c) { passed++; console.log('  ✓ ' + n + (e ? ' — ' + e : '')); } else { failed++; console.log('  ✗ ' + n + (e ? ' — ' + e : '')); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage();
  await installDayClock(page);
  await page.setViewport({ width: 1440, height: 1000 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  try {
    console.log('\n=== Импорт транзакций за 1 октября ===');
    await page.goto(BASE + '/index.html', { waitUntil: 'networkidle0' });
    await sleep(400);

    const seed = await page.evaluate(async () => {
      const now = Date.now();
      const admin = await createUser({ fullName: 'Владелец Сети', username: 'txadmin', password: 'txadmin1' }, { autoRole: true });
      setSession(admin.id);
      ['Керуен', 'Sky', 'My Kids', 'Dalida Plaza', 'Elegant Park'].forEach((name) => {
        DB.points.push({ id: uid(), name, address: '', createdAt: now, updatedAt: now });
      });
      await createUser({ fullName: 'Арина Турланова', username: 'arina1', password: 'arina1', role: 'seller', pointIds: [] });
      await createUser({ fullName: 'Дарья', username: 'dashaa', password: 'dashaa', role: 'seller', pointIds: [] });
      await createUser({ fullName: 'Айнэлля Нагметова', username: '200730', password: '200730', role: 'seller', pointIds: [] });
      await createUser({ fullName: 'Нурдана Калыбай', username: 'nurdana', password: 'nurdana', role: 'seller', pointIds: [] });
      saveDB();
      return { adminId: admin.id, points: DB.points.map((p) => p.name) };
    });
    ok('подготовлено 5 точек и 4 продавца', seed.points.length === 5, seed.points.join(', '));

    const parsed = await page.evaluate((text) => {
      const res = parseTransactionsText(text, { date: '2026-10-01' });
      return {
        count: res.transactions.length,
        revenue: res.revenue,
        errors: res.errors,
        list: res.transactions.map((t) => ({
          time: new Date(t.at).getHours() + ':' + String(new Date(t.at).getMinutes()).padStart(2, '0'),
          seller: t.seller, point: t.pointName, payment: t.payment, total: t.total,
          items: t.items.map((i) => i.name + '×' + i.qty + '@' + i.price)
        }))
      };
    }, sample);
    ok('найдено 4 транзакции (в образце)', parsed.count === 4, String(parsed.count));
    ok('выручка образца 8 500', parsed.revenue === 8500, String(parsed.revenue));
    ok('без ошибок', parsed.errors.length === 0, parsed.errors.join(' | ') || 'чисто');
    ok('время и продавец верно', parsed.list[0].time === '13:27' && parsed.list[0].seller === 'Арина Турланова', JSON.stringify(parsed.list[0]));
    ok('точка «Керуен» найдена', parsed.list[0].point === 'Керуен', parsed.list[0].point);
    ok('«My kids» привязан к My Kids', parsed.list[1].point === 'My Kids', parsed.list[1].point);
    ok('QR распознан', parsed.list[0].payment === 'qr', parsed.list[0].payment);
    ok('состав с ценой разобран', parsed.list[1].items[0] === 'Фонарик 3 висюльки×1@3500', parsed.list[1].items.join(', '));
    ok('несколько товаров в чеке', parsed.list[3].items.length === 2 && parsed.list[3].items.join(', ') === 'Тату×1@600, Пряди×2@700',
      parsed.list[3].items.join(', '));

    const full = await page.evaluate((text, adminId) => {
      const res = parseTransactionsText(text, { date: '2026-10-01' });
      const out = importTransactions(res.transactions, { actor: getUser(adminId), replace: true });
      const day = summarize(startOfDay(new Date(2026, 9, 1)), endOfDay(new Date(2026, 9, 1)));
      const s1 = DB.sales.filter((s) => s.historyImport)[0];
      return {
        out, revenue: day.revenue, count: day.salesCount, cash: day.cashTotal, qr: day.qrTotal,
        seller: s1.userName, point: s1.pointName, items: s1.items.length, stockTouched: DB.stock.length
      };
    }, sample, seed.adminId);
    ok('транзакции внесены', full.out.created === 4, 'создано: ' + full.out.created);
    ok('выручка дня 8 500', full.revenue === 8500, String(full.revenue));
    ok('наличные 5 000, QR 3 500', full.cash === 5000 && full.qr === 3500, full.cash + ' / ' + full.qr);
    ok('продавец сохранён', full.seller === 'Арина Турланова', full.seller);
    ok('точка сохранена', full.point === 'Керуен', full.point);
    ok('состав сохранён', full.items >= 1, String(full.items));
    ok('склад не создан и не тронут', full.stockTouched === 0, String(full.stockTouched));

    const ui = await page.evaluate((text, adminId) => {
      setSession(adminId);
      location.hash = '#/settings';
      return true;
    }, sample, seed.adminId);
    await sleep(1200);
    await page.evaluate(() => document.querySelector('#historyAdd').click());
    await sleep(400);
    await page.evaluate((text) => {
      const area = document.querySelector('#histText');
      area.value = text;
      area.dispatchEvent(new Event('input', { bubbles: true }));
      const d = document.querySelector('#histDate');
      d.value = '2026-10-01';
      d.dispatchEvent(new Event('change', { bubbles: true }));
    }, sample);
    await sleep(500);
    const preview = await page.evaluate(() => ({
      rows: document.querySelectorAll('#histPreview tbody tr').length,
      kpi: Array.from(document.querySelectorAll('#histPreview .kpi-mini .v')).map((x) => x.textContent.trim()),
      go: !(document.querySelector('#histGo') || {}).disabled
    }));
    ok('предпросмотр показывает транзакции', preview.rows === 4, 'строк: ' + preview.rows);
    ok('в предпросмотре сумма', /8/.test(preview.kpi[1] || ''), preview.kpi.join(' | '));
    ok('кнопка активна', preview.go === true);
    await page.screenshot({ path: require('path').join(__dirname, '..', 'screenshots', '113-tx-preview.png') });

    await page.evaluate(() => document.querySelector('#histGo').click());
    await sleep(1200);
    const after = await page.evaluate(() => ({
      closed: !document.querySelector('.modal-overlay'),
      toast: (document.querySelector('.toast') || {}).textContent || '',
      history: DB.sales.filter((s) => s.historyImport).length
    }));
    ok('импорт из окна сработал', after.closed && after.history === 4, 'записей: ' + after.history);
    ok('есть подтверждение', /Внесено/i.test(after.toast), after.toast);
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
