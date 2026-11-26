/* ============================================================
   Проверки: доступ продавца к кассе
   1) ночное окно 02:00–06:00
   2) сообщение «отметьте приход», пока приход не отмечен
   3) сообщение + переход на склад, пока склад не сверен
   4) сверка — две кнопки без ввода цифр
   5) результат виден админу в разделе «Время»
   ============================================================ */
const puppeteer = require('puppeteer');
const { installDayClock } = require('./helpers/clock');
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
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage',
      '--unsafely-treat-insecure-origin-as-secure=http://127.0.0.1:8099']
  });
  const context = browser.defaultBrowserContext();
  await context.overridePermissions(BASE, ['geolocation']);
  const page = await browser.newPage();
  await installDayClock(page);
  await page.setViewport({ width: 1440, height: 960 });
  await page.setGeolocation({ latitude: 50.2839, longitude: 57.1660, accuracy: 25 });
  const errors = [];
  page.on('pageerror', function (e) { errors.push(e.message); });
  page.on('console', function (m) { if (m.type() === 'error') errors.push(m.text()); });

  try {
    console.log('\n=== Касса продавца: приход → сверка склада ===');
    await page.goto(BASE + '/index.html', { waitUntil: 'networkidle0' });
    await sleep(400);

    const seed = await page.evaluate(async () => {
      const admin = await createUser({ fullName: 'Владелец Сети', username: 'gateadmin', password: 'gate1234' }, { autoRole: true });
      setSession(admin.id);
      const now = Date.now();
      const cat = { id: uid(), name: 'Тестовая категория', createdAt: now, updatedAt: now };
      DB.categories.push(cat);
      const pt1 = { id: uid(), name: 'Точка Первая', address: 'Актобе', createdAt: now, updatedAt: now };
      const pt2 = { id: uid(), name: 'Точка Вторая', address: 'Актобе', createdAt: now, updatedAt: now };
      DB.points.push(pt1, pt2);
      const p1 = { id: uid(), name: 'Товар А', categoryId: cat.id, price: 500, pointIds: [pt1.id, pt2.id], createdAt: now, updatedAt: now };
      DB.products.push(p1);
      saveDB();
      setStockQty(pt1.id, p1.id, 10, 'Перенос остатка', admin);
      setStockQty(pt2.id, p1.id, 6, 'Перенос остатка', admin);
      const seller = await createUser({
        fullName: 'Айгуль Сапарова', username: 'gateseller', password: 'gate1234',
        role: 'seller', pointIds: [pt1.id, pt2.id], pointId: pt1.id
      });
      return { adminId: admin.id, sellerId: seller.id, pt1: pt1.id, pt1Name: pt1.name, pt2: pt2.id, pt2Name: pt2.name, product: p1.id };
    });
    ok('данные подготовлены', !!seed.sellerId, seed.pt1Name + ' · ' + seed.pt2Name);

    // ---------- 1. Ночное окно ----------
    const nightLogic = await page.evaluate(() => {
      function at(h, m) { const d = new Date(); d.setHours(h, m || 0, 0, 0); return d.getTime(); }
      return {
        at0100: cashNightWindow(at(1, 0)).blocked,
        at0200: cashNightWindow(at(2, 0)).blocked,
        at0559: cashNightWindow(at(5, 59)).blocked,
        at0600: cashNightWindow(at(6, 0)).blocked,
        at1200: cashNightWindow(at(12, 0)).blocked,
        label: cashNightWindow(at(3, 0)).label
      };
    });
    ok('в 01:00 касса открыта', nightLogic.at0100 === false);
    ok('в 02:00 касса закрыта', nightLogic.at0200 === true);
    ok('в 05:59 касса закрыта', nightLogic.at0559 === true);
    ok('в 06:00 касса уже открыта', nightLogic.at0600 === false);
    ok('днём касса открыта', nightLogic.at1200 === false);
    ok('окно подписано 02:00–06:00', nightLogic.label === '02:00–06:00', nightLogic.label);

    // ---------- 2. Сообщение «отметьте приход» ----------
    await page.evaluate((id) => { setSession(id); location.hash = '#/cash'; }, seed.sellerId);
    await sleep(1000);
    const noArrival = await page.evaluate(() => ({
      gate: !!document.querySelector('.gate-card'),
      title: (document.querySelector('.gate-card h2') || {}).textContent,
      text: (document.querySelector('.gate-text') || {}).textContent,
      catalog: !!document.querySelector('#catalogGrid .product-card'),
      arriveBtn: !!document.querySelector('#gateArrive')
    }));
    ok('без прихода касса не открывается', noArrival.gate && !noArrival.catalog);
    ok('сообщение: нужно отметить приход', noArrival.title === 'Отметьте приход на работу' && /отметьте приход/i.test(noArrival.text || ''), noArrival.title);
    ok('есть кнопка «Я на месте»', noArrival.arriveBtn);
    await page.screenshot({ path: SHOTS + '/100-gate-arrival.png' });

    // ---------- 3. Приход → переход на склад ----------
    await page.evaluate(() => document.querySelector('#gateArrive').click());
    await sleep(1800);
    const afterArrival = await page.evaluate(() => ({
      hash: location.hash,
      onStock: !!document.querySelector('#stockCheckCard') || !!document.querySelector('#stockCheckYes'),
      toast: !!document.querySelector('.toast'),
      toastText: document.querySelector('.toast') ? document.querySelector('.toast').textContent : '',
      checkButtons: ['#stockCheckYes', '#stockCheckNo'].filter(function (sel) { return !!document.querySelector(sel); }).length,
      arrives: !!(timeEntryFor(currentUser().id) || {}).arriveAt
    }));
    ok('приход отмечен', afterArrival.arrives);
    ok('продавца перекинуло на склад', afterArrival.hash === '#/stock' && afterArrival.onStock, afterArrival.hash);
    ok('на складе ровно две кнопки сверки', afterArrival.checkButtons === 2, 'кнопок: ' + afterArrival.checkButtons);
    await page.screenshot({ path: SHOTS + '/101-gate-stock-check.png' });

    // ---------- 4. Попытка вернуться в кассу без сверки ----------
    await page.evaluate(() => { location.hash = '#/cash'; });
    await sleep(900);
    const stillBlocked = await page.evaluate(() => ({ hash: location.hash, cash: !!document.querySelector('#catalogGrid .product-card') }));
    ok('без сверки касса снова отправляет на склад', stillBlocked.hash === '#/stock' && !stillBlocked.cash, stillBlocked.hash);

    // ---------- 5. «Данные не сходятся» ----------
    const cardState = await page.evaluate(() => ({
      hasCard: !!document.querySelector('#stockCheckCard'),
      status: document.querySelector('#stockCheckCard') ? document.querySelector('#stockCheckCard .badge').textContent.trim() : null,
      hasInputs: document.querySelectorAll('#stockCheckCard input, .check-qty').length,
      yes: (document.querySelector('#stockCheckYes') || {}).textContent,
      no: (document.querySelector('#stockCheckNo') || {}).textContent
    }));
    ok('нет никаких полей ввода', cardState.hasInputs === 0, 'полей: ' + cardState.hasInputs);
    ok('две кнопки: «Данные сходятся» / «Данные не сходятся»',
      /сходятся/i.test(cardState.yes || '') && /не сходятся/i.test(cardState.no || ''), (cardState.yes || '') + ' | ' + (cardState.no || ''));
    ok('до отметки статус «Не проверялся»', /Не проверялся/i.test(cardState.status || ''), cardState.status);

    await page.evaluate(() => document.querySelector('#stockCheckNo').click());
    await sleep(1200);
    const afterMismatch = await page.evaluate((s) => {
      const chk = stockCheckForDay(currentUser().id, s.pt1);
      return {
        hash: location.hash,
        cash: !!document.querySelector('#catalogGrid .product-card'),
        result: chk ? chk.result : null,
        user: chk ? chk.userName : null,
        qty: stockRow(s.pt1, s.product).qty,
        total: stockChecksList().length
      };
    }, seed);
    ok('отметка «данные не сходятся» сохранена', afterMismatch.result === 'mismatch' && afterMismatch.total === 1, String(afterMismatch.result));
    ok('склад не меняется без цифр', afterMismatch.qty === 10, String(afterMismatch.qty));
    ok('после отметки касса открылась', afterMismatch.hash === '#/cash' && afterMismatch.cash, afterMismatch.hash);
    await page.screenshot({ path: SHOTS + '/98-seller-cash-after-check.png' });

    // ---------- 6. Вторая точка — своя сверка ----------
    await page.evaluate((s) => {
      const sel = document.querySelector('#topbarPoint');
      sel.value = s.pt2;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }, seed);
    await sleep(1100);
    const secondBlocked = await page.evaluate((s) => ({
      hash: location.hash,
      active: activePointId(currentUser()),
      check: stockCheckForDay(currentUser().id, s.pt2)
    }), seed);
    ok('на второй точке своя сверка', secondBlocked.hash === '#/stock' && !secondBlocked.check, secondBlocked.hash);
    await page.evaluate(() => document.querySelector('#stockCheckYes').click());
    await sleep(1200);
    const secondDone = await page.evaluate((s) => ({
      hash: location.hash,
      result: (stockCheckForDay(currentUser().id, s.pt2) || {}).result,
      cash: !!document.querySelector('#catalogGrid .product-card')
    }), seed);
    ok('«данные сходятся» на второй точке → касса открыта', secondDone.hash === '#/cash' && secondDone.result === 'match' && secondDone.cash, secondDone.hash + ' · ' + secondDone.result);

    // ---------- 7. Админ видит результат в «Времени» ----------
    await page.evaluate((id) => { setSession(id); location.hash = '#/time'; }, seed.adminId);
    await sleep(1100);
    const adminView = await page.evaluate(() => {
      const ths = Array.from(document.querySelectorAll('.tbl thead th')).map(t => t.textContent.trim());
      const btns = Array.from(document.querySelectorAll('[data-check-view]')).map(b => b.textContent.trim());
      return { ths, btns, rows: document.querySelectorAll('.tbl tbody tr').length };
    });
    ok('в «Времени» есть колонка «Сверка склада»', adminView.ths.indexOf('Сверка склада') !== -1, adminView.ths.join(' | '));
    ok('по продавцу видна сверка', adminView.btns.length === 1 && /Не сходятся/.test(adminView.btns[0]), adminView.btns.join(', '));

    await page.evaluate(() => document.querySelector('[data-check-view]').click());
    await sleep(600);
    const detail = await page.evaluate(() => {
      const m = document.querySelector('.modal');
      return m ? { text: m.textContent.replace(/\s+/g, ' ').trim(), hasInputs: m.querySelectorAll('input').length } : null;
    });
    ok('детали сверки без цифр и пояснений', !!detail && /Данные не сходятся/.test(detail.text) && !detail.hasInputs, detail ? detail.text.slice(0, 80) : '');
    await page.evaluate(() => { const b = document.querySelector('.modal [data-close]'); if (b) b.click(); });
    await sleep(300);
    await page.screenshot({ path: SHOTS + '/99-admin-time-stock-check.png' });

    // ---------- 8. У админа нет ограничений ----------
    const adminAccess = await page.evaluate((s) => {
      const admin = DB.users.find(u => u.id === s.adminId);
      const d = new Date(); d.setHours(3, 30, 0, 0);
      return { night: cashAccessGate(admin, s.pt1, d.getTime()).allowed, day: cashAccessGate(admin, s.pt1).allowed };
    }, seed);
    ok('админу ночное окно не мешает', adminAccess.night === true && adminAccess.day === true);
    await page.evaluate(() => { location.hash = '#/cash'; });
    await sleep(900);
    const adminCash = await page.evaluate(() => ({ catalog: document.querySelectorAll('#catalogGrid .product-card').length, gate: !!document.querySelector('.gate-card') }));
    ok('у админа касса открывается без прихода и сверки', adminCash.catalog > 0 && !adminCash.gate, 'карточек: ' + adminCash.catalog);

    // ---------- 9. Повторная отметка обновляет статус ----------
    const repeat = await page.evaluate((s) => {
      const seller = DB.users.find(u => u.id === s.sellerId);
      const before = stockChecksList().length;
      const r1 = saveStockCheck({ pointId: s.pt1, result: 'match' }, seller);
      return { ok: !!(r1 && r1.ok), before, after: stockChecksList().length, last: stockCheckForDay(seller.id, s.pt1).result };
    }, seed);
    ok('повторная отметка добавляет запись', repeat.ok && repeat.after === repeat.before + 1, repeat.before + ' → ' + repeat.after);
    ok('последняя отметка — «сходятся»', repeat.last === 'match', repeat.last);

    // ---------- 10. Сверка не пишет в склад ----------
    const stockSafe = await page.evaluate((s) => {
      const seller = DB.users.find(u => u.id === s.sellerId);
      const before = stockRow(s.pt1, s.product).qty;
      const histLen = stockRow(s.pt1, s.product).history.length;
      saveStockCheck({ pointId: s.pt1, result: 'mismatch' }, seller);
      const row = stockRow(s.pt1, s.product);
      return { before, after: row.qty, histLen, histNow: row.history.length };
    }, seed);
    ok('отметка «не сходятся» не трогает остатки', stockSafe.before === stockSafe.after && stockSafe.histLen === stockSafe.histNow, stockSafe.before + ' / ' + stockSafe.after);

    ok('нет JS-ошибок', errors.length === 0, errors.slice(0, 2).join(' | '));
  } catch (e) {
    failed++;
    console.log('  ✗ ИСКЛЮЧЕНИЕ: ' + e.message);
  }

  await browser.close();
  console.log('\n=== Итог: ' + passed + ' успешно, ' + failed + ' с ошибками ===');
  process.exit(failed ? 1 : 0);
})();
