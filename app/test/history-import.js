/* ============================================================
   Проверки: история продаж за прошлые дни (заглушка/перенос)
   1) разбор текста: даты, суммы, наличные/QR, число чеков, ошибки
   2) внесение: суммы попадают в панель и аналитику за свои дни
   3) склад и отчёты склада не меняются
   4) повторное внесение заменяет день, а не дублирует
   5) интерфейс: карточка в настройках, предпросмотр, очистка
   ============================================================ */
const puppeteer = require('puppeteer');
const path = require('path');
const { installDayClock } = require('./helpers/clock');

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
  await installDayClock(page);
  await page.setViewport({ width: 1440, height: 1000 });
  const errors = [];
  page.on('pageerror', function (e) { errors.push(e.message); });
  page.on('console', function (m) { if (m.type() === 'error') errors.push(m.text()); });

  try {
    console.log('\n=== История продаж за прошлые дни ===');
    await page.goto(BASE + '/index.html', { waitUntil: 'networkidle0' });
    await sleep(400);

    const seed = await page.evaluate(async () => {
      const now = Date.now();
      const admin = await createUser({ fullName: 'Владелец Сети', username: 'histadmin', password: 'hist1234' }, { autoRole: true });
      setSession(admin.id);
      const cat = { id: uid(), name: 'Напитки', createdAt: now, updatedAt: now };
      DB.categories.push(cat);
      const pt = { id: uid(), name: 'Керуен', address: 'Актобе', createdAt: now, updatedAt: now };
      DB.points.push(pt);
      const p1 = { id: uid(), name: 'Кола 0,5', categoryId: cat.id, price: 350, pointIds: [pt.id], createdAt: now, updatedAt: now };
      DB.products.push(p1);
      saveDB();
      setStockQty(pt.id, p1.id, 30, 'Перенос остатка', admin, startOfDay(addDays(new Date(), -20)));
      return { adminId: admin.id, pointId: pt.id, productId: p1.id };
    });
    ok('данные подготовлены', !!seed.adminId);

    // ---------- 1. Разбор текста ----------
    const parse = await page.evaluate(() => {
      const text = [
        '01.10.2026 125000 80000 45000 34',
        '02.10.2026; 138 500; 90 000; 48 500; 41',
        '2026-10-03 97000',
        '4 октября 2026 105000 60000 45000',
        '05.10.2026 88000 1200',
        '',
        '# комментарий',
        'Октябрь 2026',
        '06.10 64000 40000 24000 19'
      ].join('\n');
      const res = parseHistoryText(text, { avgCheck: 3000 });
      return {
        days: res.days.map((d) => ({ key: d.key, revenue: d.revenue, cash: d.cash, qr: d.qr, count: d.count })),
        errors: res.errors,
        revenue: res.revenue,
        receipts: res.receipts
      };
    });
    ok('разобрано 6 дней', parse.days.length === 6, 'дней: ' + parse.days.length);
    ok('ошибок нет', parse.errors.length === 0, parse.errors.join(' | ') || 'чисто');
    ok('день 1: 125000, нал 80000, QR 45000, 34 чека',
      parse.days[0].revenue === 125000 && parse.days[0].cash === 80000 && parse.days[0].qr === 45000 && parse.days[0].count === 34,
      JSON.stringify(parse.days[0]));
    ok('пробелы в тысячах понимаются (138 500)', parse.days[1].revenue === 138500 && parse.days[1].count === 41, String(parse.days[1].revenue));
    ok('одна сумма считается наличными', parse.days[2].revenue === 97000 && parse.days[2].cash === 97000 && parse.days[2].qr === 0, JSON.stringify(parse.days[2]));
    ok(' «4 октября 2026» понимается', parse.days[3].key === '2026-10-04' && parse.days[3].qr === 45000, parse.days[3].key);
    ok('две цифры: выручка и число чеков', parse.days[4].revenue === 88000 && parse.days[4].count === 1200, JSON.stringify(parse.days[4]));
    ok('заголовок «Октябрь 2026» задаёт месяц для 06.10', parse.days[5].key === '2026-10-06', parse.days[5].key);
    ok('дни идут по порядку', parse.days.map((d) => d.key).join(',') === '2026-10-01,2026-10-02,2026-10-03,2026-10-04,2026-10-05,2026-10-06');
    ok('итоговая выручка сложилась', parse.revenue === 125000 + 138500 + 97000 + 105000 + 88000 + 64000, fmtMoney(parse.revenue));

    const parseErrors = await page.evaluate(() => {
      const res = parseHistoryText([
        '01.10.2026 100000 90000 50000 10',
        'что-то непонятное 5000',
        '32.10.2026 50000'
      ].join('\n'));
      return { days: res.days.length, errors: res.errors };
    });
    ok('ошибки в цифрах ловятся', parseErrors.days === 0 && parseErrors.errors.length === 3, parseErrors.errors.join(' | '));

    // ---------- 2. Внесение ----------
    const beforeStock = await page.evaluate((s) => {
      const row = stockRow(s.pointId, s.productId);
      const rep = stockPeriodReport(s.pointId, dayKey(addDays(new Date(), -3)), dayKey(addDays(new Date(), -3)));
      const r = rep.rows.filter((x) => x.productId === s.productId)[0];
      return { qty: row.qty, hist: (row.history || []).length, sold: r.sold, end: r.end };
    }, seed);

    const imported = await page.evaluate((adminId) => {
      const text = [
        '01.10.2026 125000 80000 45000 34',
        '02.10.2026 138500 90000 48500 41',
        '03.10.2026 97000',
        '04.10.2026 105000 60000 45000'
      ].join('\n');
      const res = parseHistoryText(text, { avgCheck: 3000 });
      const out = importHistoryDays(res.days, { actor: getUser(adminId), replace: true });
      const sum = historyImportSummary();
      const april = DB.sales.filter((s) => s.historyImport).map((s) => s.createdAt);
      return {
        result: out,
        summary: sum,
        salesCount: DB.sales.length,
        importedCount: DB.sales.filter((s) => s.historyImport).length,
        allFlagged: DB.sales.filter((s) => s.historyImport).every((s) => s.imported === true && s.items.length === 0),
        noPoint: DB.sales.filter((s) => s.historyImport).every((s) => !s.pointId),
        minAt: Math.min.apply(null, april),
        maxAt: Math.max.apply(null, april)
      };
    }, seed.adminId);
    ok('внесено без ошибок', !imported.result.error, imported.result.error || String(imported.result.created) + ' записей');
    ok('созданы записи по всем дням', imported.importedCount >= 34 + 41 + 1 + 1, 'записей: ' + imported.importedCount);
    ok('все помечены как импорт и без состава', imported.allFlagged === true);
    ok('не привязаны к точке — это сводно', imported.noPoint === true);
    ok('сводка: 4 дня', imported.summary.days === 4, String(imported.summary.days));
    ok('сводка: выручка 465 500', imported.summary.revenue === 465500, fmtMoney(imported.summary.revenue));
    ok('даты внутри своих дней',
      new Date(imported.minAt).getDate() === 1 && new Date(imported.maxAt).getDate() === 4,
      fmt(imported.minAt) + ' … ' + fmt(imported.maxAt));

    // ---------- 3. Панель и аналитика ----------
    const stats = await page.evaluate(() => {
      const d1 = new Date(2026, 9, 1);
      const day = summarize(startOfDay(d1), endOfDay(d1));
      const period = summarize(startOfDay(new Date(2026, 9, 1)), endOfDay(new Date(2026, 9, 4)));
      return {
        day1Revenue: day.revenue,
        day1Count: day.salesCount,
        day1Cash: day.cashTotal,
        day1Qr: day.qrTotal,
        periodRevenue: period.revenue,
        periodCount: period.salesCount,
        avg: Math.round(period.revenue / period.salesCount)
      };
    });
    ok('за 1 октября выручка 125 000', stats.day1Revenue === 125000, fmtMoney(stats.day1Revenue));
    ok('наличные и QR за 1 октября сходятся', stats.day1Cash === 80000 && stats.day1Qr === 45000, fmtMoney(stats.day1Cash) + ' / ' + fmtMoney(stats.day1Qr));
    ok('за 1 октября 34 чека', stats.day1Count === 34, String(stats.day1Count));
    ok('за 1–4 октября выручка 465 500', stats.periodRevenue === 465500, fmtMoney(stats.periodRevenue));
    ok('средний чек разумный', stats.avg > 2000 && stats.avg < 6000, fmtMoney(stats.avg));

    // ---------- 4. Склад не изменился ----------
    const afterStock = await page.evaluate((s) => {
      const row = stockRow(s.pointId, s.productId);
      const rep = stockPeriodReport(s.pointId, dayKey(addDays(new Date(), -3)), dayKey(addDays(new Date(), -3)));
      const r = rep.rows.filter((x) => x.productId === s.productId)[0];
      const octRep = stockPeriodReport(s.pointId, '2026-10-01', '2026-10-04');
      const octRow = octRep.rows.filter((x) => x.productId === s.productId)[0];
      return { qty: row.qty, hist: (row.history || []).length, sold: r.sold, end: r.end, octSold: octRow.sold, octEnd: octRow.end };
    }, seed);
    ok('остаток на складе не изменился', afterStock.qty === beforeStock.qty, beforeStock.qty + ' → ' + afterStock.qty);
    ok('история склада не пополнилась', afterStock.hist === beforeStock.hist, String(afterStock.hist));
    ok('отчёт за последние дни прежний', afterStock.sold === beforeStock.sold && afterStock.end === beforeStock.end,
      'продано ' + afterStock.sold + ', конец ' + afterStock.end);
    ok('в отчёте склада за 1–4 октября «Продано» = 0', afterStock.octSold === 0,
      'продано ' + afterStock.octSold + ', конец ' + afterStock.octEnd);

    // ---------- 5. Повторное внесение ----------
    const again = await page.evaluate((adminId) => {
      const res = parseHistoryText('01.10.2026 130000 90000 40000 36', { avgCheck: 3000 });
      const out = importHistoryDays(res.days, { actor: getUser(adminId), replace: true });
      const day = summarize(startOfDay(new Date(2026, 9, 1)), endOfDay(new Date(2026, 9, 1)));
      const others = DB.sales.filter((s) => s.historyImport && dayKey(s.createdAt) !== '2026-10-01').length;
      return { out: out, revenue: day.revenue, count: day.salesCount, total: DB.sales.filter((s) => s.historyImport).length, others: others };
    }, seed.adminId);
    ok('замена дня удалила старые записи', again.out.removed === 34, 'удалено: ' + again.out.removed);
    ok('новая сумма применилась', again.revenue === 130000 && again.count === 36, fmtMoney(again.revenue) + ' · ' + again.count + ' чеков');
    ok('другие дни не задвоились', again.total === 36 + again.others, 'записей: ' + again.total + ' (ожидали ' + (36 + again.others) + ')');

    const noReplace = await page.evaluate((adminId) => {
      const res = parseHistoryText('01.10.2026 999999', { avgCheck: 3000 });
      const out = importHistoryDays(res.days, { actor: getUser(adminId), replace: false });
      const day = summarize(startOfDay(new Date(2026, 9, 1)), endOfDay(new Date(2026, 9, 1)));
      return { created: out.created, skipped: out.skipped, revenue: day.revenue };
    }, seed.adminId);
    ok('без замены день пропускается', noReplace.created === 0 && noReplace.skipped === 1 && noReplace.revenue === 130000, fmtMoney(noReplace.revenue));

    const future = await page.evaluate((adminId) => {
      const today = new Date();
      const key = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
      const res = importHistoryDays([{ key: key, date: startOfDay(today), revenue: 50000, cash: 50000, qr: 0, count: 10 }], { actor: getUser(adminId) });
      return res;
    }, seed.adminId);
    ok('сегодняшний день в историю не попадает', future.created === 0 && future.skipped === 1, 'пропущено: ' + future.skipped);

    const sellerGuard = await page.evaluate(async (adminId) => {
      const seller = await createUser({ fullName: 'Продавец Один', username: 'histseller', password: 'hist1234', role: 'seller', pointIds: [] });
      const res = importHistoryDays([{ key: '2026-09-01', date: new Date(2026, 8, 1).getTime(), revenue: 1000, cash: 1000, qr: 0, count: 1 }], { actor: seller });
      return { error: res.error };
    }, seed.adminId);
    ok('продавец не может вносить историю', /администратор|прав/i.test(sellerGuard.error || ''), sellerGuard.error);

    // ---------- 6. Интерфейс ----------
    await page.evaluate((id) => { setSession(id); location.hash = '#/settings'; }, seed.adminId);
    await sleep(1100);
    const card = await page.evaluate(() => ({
      card: !!document.querySelector('#historyCard'),
      title: (document.querySelector('#historyCard h3') || {}).textContent,
      addBtn: !!document.querySelector('#historyAdd'),
      clearBtn: !!document.querySelector('#historyClear'),
      text: (document.querySelector('#historyCard') || {}).textContent || ''
    }));
    ok('карточка истории есть в настройках', card.card === true, card.title);
    ok('видна внесённая история', /Дней внесено/.test(card.text) && /Выручка/.test(card.text) && /₸/.test(card.text), card.text.replace(/\s+/g, ' ').slice(0, 90));
    ok('есть кнопки внесения и очистки', card.addBtn && card.clearBtn);
    await page.screenshot({ path: SHOTS + '/111-history-card.png' });

    await page.evaluate(() => document.querySelector('#historyAdd').click());
    await sleep(500);
    await page.evaluate(() => {
      const area = document.querySelector('#histText');
      area.value = ['Октябрь 2026', '07.10.2026 77 000 50 000 27 000 21', '08.10.2026 91 500'].join('\n');
      area.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await sleep(500);
    const preview = await page.evaluate(() => ({
      kpi: Array.from(document.querySelectorAll('#histPreview .kpi-mini .v')).map((x) => x.textContent.trim()),
      rows: document.querySelectorAll('#histPreview tbody tr').length,
      errors: document.querySelectorAll('#histPreview .form-note.warn').length,
      goDisabled: (document.querySelector('#histGo') || {}).disabled
    }));
    ok('предпросмотр: 2 дня и строки', preview.rows === 2, 'строк: ' + preview.rows);
    ok('сумма в предпросмотре 168 500', /168/.test(preview.kpi[1] || ''), preview.kpi.join(' | '));
    ok('ошибок нет, кнопка активна', preview.errors === 0 && preview.goDisabled === false);
    await page.screenshot({ path: SHOTS + '/112-history-preview.png' });

    await page.evaluate(() => document.querySelector('#histGo').click());
    await sleep(1000);
    const afterUi = await page.evaluate(() => ({
      modalClosed: !document.querySelector('.modal-overlay'),
      summary: historyImportSummary(),
      toast: document.querySelector('.toast') ? document.querySelector('.toast').textContent : ''
    }));
    ok('история внесена из формы', afterUi.modalClosed && afterUi.summary.days === 6, 'дней: ' + afterUi.summary.days);
    ok('показано подтверждение', /Внесено/i.test(afterUi.toast || ''), afterUi.toast);

    // панель показывает историю
    await page.evaluate(() => { location.hash = '#/dashboard'; });
    await sleep(1000);
    // показываем именно 1 октября, чтобы проверка не зависела от текущей даты
    await page.evaluate(() => {
      const btn = document.querySelector('#periodSwitch [data-period="today"]');
      if (btn) btn.click();
    });
    await sleep(800);
    await page.evaluate(() => {
      const inp = document.querySelector('[data-date-input]');
      if (inp) { inp.value = '2026-10-01'; inp.dispatchEvent(new Event('change', { bubbles: true })); }
    });
    await sleep(1000);
    const dash = await page.evaluate(() => {
      const text = document.querySelector('#pageRoot').textContent.replace(/\s+/g, ' ');
      const dateLine = (document.querySelector('.page-head .sub') || {}).textContent || '';
      const kpi = Array.from(document.querySelectorAll('.stat-value, .kpi-mini .v'))
        .map((x) => x.textContent.replace(/\s+/g, ' ').trim());
      const monthRevenue = summarize(startOfDay(new Date(2026, 9, 1)), endOfDay(new Date(2026, 9, 23))).revenue;
      const dayRevenue = summarize(startOfDay(new Date(2026, 9, 1)), endOfDay(new Date(2026, 9, 1))).revenue;
      return { kpi: kpi, text: text.slice(0, 160), dateLine: dateLine, monthRevenue: monthRevenue, dayRevenue: dayRevenue };
    });
    ok('панель считает выручку с историей', dash.monthRevenue === 639000, fmtMoney(dash.monthRevenue));
    ok('выручка дня видна в карточках панели',
      dash.kpi.some((v) => v.replace(/[^0-9]/g, '') === String(dash.dayRevenue)),
      dash.kpi.slice(0, 4).join(' | ') + ' · ждали ' + fmtMoney(dash.dayRevenue));
    ok('дата на панели без «undefined»', !/undefined/.test(dash.dateLine), dash.dateLine);

    // ---------- 7. Очистка ----------
    const cleared = await page.evaluate((id) => {
      const res = clearHistoryImports(getUser(id));
      return { removed: res.removed, left: DB.sales.filter((s) => s.historyImport).length, summary: historyImportSummary(), qty: stockRow(DB.points[0].id, DB.products[0].id).qty };
    }, seed.adminId);
    ok('история очищена', cleared.left === 0 && cleared.summary.days === 0, 'осталось: ' + cleared.left);
    ok('склад при очистке не тронут', cleared.qty === beforeStock.qty, String(cleared.qty));

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
  return String(d.getDate()).padStart(2, '0') + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.' + d.getFullYear();
}
function fmtMoney(n) { return String(Math.round(n || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₸'; }
