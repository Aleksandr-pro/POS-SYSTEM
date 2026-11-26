/* ============================================================
   Проверки: отчёт по складу за день в структуре старой системы
   Остаток вчера → Поставка сегодня → Начало дня → Продано → Конец дня
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
    console.log('\n=== Отчёт по складу за день ===');
    await page.goto(BASE + '/index.html', { waitUntil: 'load' });
    await sleep(300);

    await page.click('#goRegister');
    await sleep(250);
    await page.type('#regName', 'Владелец Сети');
    await page.type('#regUser', 'dayreport');
    await page.type('#regPass', 'dayreport1');
    await page.type('#regPass2', 'dayreport1');
    await page.evaluate(function () { const b = document.querySelector('#regTerms'); b.checked = true; b.dispatchEvent(new Event('change', { bubbles: true })); });
    await page.click('#regBtn');
    await page.waitForSelector('.topbar', { timeout: 15000 });
    await sleep(400);

    // импорт товаров + остатков
    await page.evaluate(function () { applyLegacyStarter({ actor: currentUser() }); });
    await sleep(300);
    await page.evaluate(function () { applyLegacyStock({ actor: currentUser() }); });
    await sleep(300);

    // ---------- 1. Точка с остатками и вкладка отчёта ----------
    await page.evaluate(function () { location.hash = '#/stock'; });
    await sleep(900);
    const hasSwitch = await page.evaluate(function () { return !!document.querySelector('#stockView'); });
    ok('подраздел «Остатки» убран — в складе только отчёт', !hasSwitch);

    const header = await page.evaluate(function () {
      const ths = Array.from(document.querySelectorAll('#dayReportTable thead th')).map(function (t) { return t.textContent.trim(); });
      return { ths: ths, date: document.querySelector('#stockDayDate') ? document.querySelector('#stockDayDate').value : '' };
    });
    ok('столбцы как в старой системе',
      JSON.stringify(header.ths) === JSON.stringify(['Товар', 'Категория', 'Остаток вчера', 'Поставка сегодня', 'Продано', 'Конец дня']),
      header.ths.join(' | '));
    ok('дата по умолчанию — сегодня', header.date === await page.evaluate(function () { return dayKey(new Date()); }), header.date);
    await page.screenshot({ path: SHOTS + '/82-stock-day-report.png', fullPage: true });

    // ---------- 2. Цифры перенесённого остатка ----------
    const initial = await page.evaluate(function () {
      const point = DB.points.find(function (p) { return p.name === 'Sky'; });
      const pointSelect = document.querySelector('#stockPagePoint');
      pointSelect.value = point.id;
      pointSelect.dispatchEvent(new Event('change', { bubbles: true }));
      return { pointId: point.id };
    });
    await sleep(900);
    const skyReport = await page.evaluate(function (pid) {
      const rep = stockDayReport(pid, dayKey(new Date()));
      const row = rep.rows.find(function (r) { return r.name === 'Нинзя'; });
      return { row: row, totals: rep.totals, rows: rep.rows.length };
    }, initial.pointId);
    ok('отчёт строится по точке', skyReport.rows === 58, 'позиций: ' + skyReport.rows);
    ok('«Остаток вчера» = перенесённый остаток', skyReport.row.yesterday === 3, 'Нинзя: ' + skyReport.row.yesterday);
    ok('«Начало дня» = вчера + поставка', skyReport.row.start === 3, String(skyReport.row.start));
    ok('«Конец дня» = начало − продано', skyReport.row.end === 3, String(skyReport.row.end));

    // ---------- 3. Поставка + продажа за день ----------
    const afterOps = await page.evaluate(function (pid) {
      const user = currentUser();
      const product = DB.products.find(function (p) { return p.name === 'Нинзя'; });
      addSupply({ pointId: pid, supplier: 'Тест', items: [{ productId: product.id, qty: 5, cost: 1000 }] }, user);
      createSale({
        pointId: pid,
        items: [{ productId: product.id, name: product.name, price: product.price, qty: 2 }],
        total: product.price * 2, payment: 'cash', cashAmount: product.price * 2, qrAmount: 0
      }, user);
      const rep = stockDayReport(pid, dayKey(new Date()));
      return rep.rows.find(function (r) { return r.name === 'Нинзя'; });
    }, initial.pointId);
    ok('поставка попала в «Поставка сегодня»', afterOps.supply === 5, '+' + afterOps.supply);
    ok('«Начало дня» = 3 + 5', afterOps.start === 8, String(afterOps.start));
    ok('«Продано» = 2', afterOps.sold === 2, '−' + afterOps.sold);
    ok('«Конец дня» = 8 − 2 = 6', afterOps.end === 6, String(afterOps.end));

    await page.evaluate(function () { location.hash = '#/dashboard'; });
    await sleep(300);
    await page.evaluate(function () { location.hash = '#/stock'; });
    await sleep(900);
    // ещё раз открываем отчёт за день (состояние вкладки сохраняется)
    const uiRow = await page.evaluate(function () {
      const rows = Array.from(document.querySelectorAll('#dayReportTable tbody tr'));
      const row = rows.find(function (tr) { return /Нинзя/.test(tr.textContent); });
      return row ? row.textContent.replace(/\s+/g, ' ').trim() : '';
    });
    ok('в таблице виден весь расчёт периода', /3.*\+5.*−2.*6/.test(uiRow), uiRow.slice(0, 90));
    await page.screenshot({ path: SHOTS + '/83-stock-day-report-filled.png', fullPage: true });

    // ---------- 4. Прошлый день ----------
    await page.evaluate(function () {
      document.querySelector('[data-range="yesterday"]').click();
    });
    await sleep(800);
    const yesterday = await page.evaluate(function (pid) {
      const key = dayKey(addDays(new Date(), -1));
      const rep = stockDayReport(pid, key);
      const row = rep.rows.find(function (r) { return r.name === 'Нинзя'; });
      return {
        date: document.querySelector('#stockDayDate').value,
        expected: key,
        row: row,
        totals: rep.totals
      };
    }, initial.pointId);
    ok('переключение на «Вчера»', yesterday.date === yesterday.expected, yesterday.date);
    ok('за вчера продаж и поставок нет', yesterday.row.supply === 0 && yesterday.row.sold === 0, JSON.stringify({ s: yesterday.row.supply, p: yesterday.row.sold }));

    // период до переноса — нет данных
    await page.evaluate(function () {
      const inp = document.querySelector('#stockDayDate');
      inp.value = '2026-09-15';
      inp.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await sleep(800);
    const oldDay = await page.evaluate(function (pid) {
      const rep = stockDayReport(pid, '2026-09-15');
      return { tracked: rep.totals.tracked, row: rep.rows[0] };
    }, initial.pointId);
    ok('на дату до переноса остатков нет', oldDay.tracked === 0 && oldDay.row.yesterday === null, 'учтённых строк: ' + oldDay.tracked);

    // ---------- 4b. Период ----------
    await page.evaluate(function () { document.querySelector('[data-range="week"]').click(); });
    await sleep(900);
    const week = await page.evaluate(function (pid) {
      const rep = stockPeriodReport(pid, dayKey(addDays(new Date(), -6)), dayKey(new Date()));
      const ths = Array.from(document.querySelectorAll('#dayReportTable thead th')).map(function (t) { return t.textContent.trim(); });
      const row = rep.rows.find(function (r) { return r.name === 'Нинзя'; });
      return {
        ths: ths, days: rep.days, from: rep.from, to: rep.to,
        hasAdjust: rep.hasAdjust,
        row: Object.assign({ qty: stockRow(pid, row.productId).qty }, row), totals: rep.totals,
        domFrom: document.querySelector('#stockDayDate').value,
        domTo: document.querySelector('#stockDayTo').value
      };
    }, initial.pointId);
    ok('период «7 дней» проставлен в полях', week.days === 7 && week.domFrom === week.from && week.domTo === week.to, week.domFrom + ' — ' + week.domTo);
    const baseCols = ['Товар', 'Категория', 'Остаток на начало', 'Поставка за период'];
    const tailCols = ['Продано', 'Остаток на конец'];
    const expectedThs = week.hasAdjust
      ? baseCols.concat(['Корректировка'], tailCols)
      : baseCols.concat(tailCols);
    ok('заголовки перестроены под период',
      JSON.stringify(week.ths) === JSON.stringify(expectedThs),
      week.ths.join(' | '));
    ok('за период поставка и продажи просуммированы', week.row.supply === 5 && week.row.sold === 2, JSON.stringify({ s: week.row.supply, p: week.row.sold }));
    ok('конец периода = начало + поставка + корректировка − продано',
      week.row.end === week.row.yesterday + week.row.supply + week.row.adjust - week.row.sold,
      week.row.yesterday + ' + ' + week.row.supply + ' + ' + week.row.adjust + ' − ' + week.row.sold + ' = ' + week.row.end);
    ok('конец периода совпадает с остатком на складе', week.row.end === week.row.qty, week.row.end + ' / ' + week.row.qty);
    await page.screenshot({ path: SHOTS + '/82b-stock-period.png', fullPage: true });

    // ---------- 5. Экспорт ----------
    await page.evaluate(function () { document.querySelector('[data-range="today"]').click(); });
    await sleep(700);
    const exportBtn = await page.$('#dayReportExport');
    if (exportBtn) await exportBtn.click();
    await sleep(600);
    ok('кнопка Excel есть', !!exportBtn);

    ok('нет JS-ошибок', errors.length === 0, errors.slice(0, 3).join(' | '));
  } catch (e) {
    failed++;
    console.log('  ✗ ИСКЛЮЧЕНИЕ: ' + e.message);
  }

  console.log('\n=== Итог: ' + passed + ' успешно, ' + failed + ' с ошибками ===');
  await browser.close();
  process.exit(failed ? 1 : 0);
})();
