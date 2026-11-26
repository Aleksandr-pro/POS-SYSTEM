/* ============================================================
   Проверки: несколько точек у сотрудника + разбивка оплат
   ============================================================ */
const puppeteer = require('puppeteer');
const { installDayClock } = require('./helpers/clock');

const BASE = process.env.BASE || 'http://127.0.0.1:8099';
const SHOTS = require('path').join(__dirname, '..', 'screenshots');

let passed = 0, failed = 0;
function ok(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name + (extra ? ' — ' + extra : '')); }
  else { failed++; console.log('  ✗ ' + name + (extra ? ' — ' + extra : '')); }
}
const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

async function login(page, username, password) {
  await page.waitForSelector('#loginUser', { timeout: 10000 });
  await sleep(600);
  await page.evaluate(function (u, p) {
    const user = document.querySelector('#loginUser');
    const pass = document.querySelector('#loginPass');
    user.value = u;
    pass.value = p;
    user.dispatchEvent(new Event('input', { bubbles: true }));
    pass.dispatchEvent(new Event('input', { bubbles: true }));
  }, username, password);
  await page.evaluate(function () { document.querySelector('#loginBtn').click(); });
  try {
    await page.waitForSelector('.topbar', { timeout: 15000 });
  } catch (e) {
    const info = await page.evaluate(function () {
      const box = document.querySelector('#authError');
      return {
        err: box && !box.classList.contains('hide') ? box.textContent.trim() : '(нет)',
        users: DB.users.map(function (u) { return u.username + '/' + u.role; }),
        session: DB.session
      };
    });
    throw new Error('вход не удался: ' + JSON.stringify(info));
  }
  await sleep(700);
}

async function logout(page) {
  await page.evaluate(function () { logoutUser(); location.hash = '#/login'; });
  await sleep(700);
}

(async function () {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage();
  await installDayClock(page);
  await page.setViewport({ width: 1440, height: 950 });
  const errors = [];
  page.on('pageerror', function (e) { errors.push(e.message); });
  page.on('console', function (m) { if (m.type() === 'error') errors.push(m.text()); });

  try {
    console.log('\n=== Несколько точек и разбивка оплат ===');
    await page.goto(BASE + '/index.html', { waitUntil: 'load' });
    await sleep(300);

    // админ + демо-данные
    await page.click('#goRegister');
    await sleep(250);
    await page.type('#regName', 'Владелец Сети');
    await page.type('#regUser', 'netowner');
    await page.type('#regPass', 'netpass1');
    await page.type('#regPass2', 'netpass1');
    await page.evaluate(function () { const b = document.querySelector('#regTerms'); b.checked = true; b.dispatchEvent(new Event('change', { bubbles: true })); });
    await page.click('#regBtn');
    await page.waitForSelector('.topbar', { timeout: 15000 });
    await page.evaluate(async function () {
      await loadDemoData(currentUser());
      if (typeof resetCashStatePoint === 'function') resetCashStatePoint();
    });
    await sleep(400);

    // --- карточка сотрудника: две точки отмечены ---
    await page.evaluate(function () { location.hash = '#/points'; });
    await sleep(500);
    await page.evaluate(function () { document.querySelector('[data-tab="users"]').click(); });
    await sleep(400);
    const rowInfo = await page.evaluate(function () {
      return Array.from(document.querySelectorAll('[data-edit-user]')).length;
    });
    ok('вкладка пользователей открылась', rowInfo >= 2, 'строк: ' + rowInfo);

    const totalPoints = await page.evaluate(function () { return DB.points.length; });
    await page.evaluate(function () {
      const u = DB.users.find(function (x) { return x.username === 'aigul'; });
      document.querySelector('[data-edit-user="' + u.id + '"]').click();
    });
    await sleep(400);
    const checks = await page.evaluate(function () {
      const boxes = Array.from(document.querySelectorAll('#usPoints input[type=checkbox]'));
      return { total: boxes.length, checked: boxes.filter(function (b) { return b.checked; }).length };
    });
    ok('в карточке сотрудника список точек', checks.total === totalPoints, 'точек: ' + checks.total);
    ok('у демо-продавца отмечены 2 точки', checks.checked === 2, 'отмечено: ' + checks.checked);
    await page.screenshot({ path: SHOTS + '/62-user-multipoint-modal-dark.png' });
    await page.evaluate(function () {
      const btn = Array.from(document.querySelectorAll('.modal-overlay button')).find(function (b) { return /Отмена|cancel/i.test(b.textContent); });
      if (btn) btn.click();
    });
    await sleep(250);

    // --- вход продавцом: переключатель в шапке ---
    await logout(page);
    await login(page, 'aigul', '123456');

    // продавец проходит допуск к кассе: приход + сверка склада на каждой своей точке
    await page.evaluate(function () {
      const u = currentUser();
      const key = dayKey(new Date());
      let t = timeEntryFor(u.id, key);
      if (!t) {
        t = { id: uid(), userId: u.id, date: key, arriveAt: Date.now(), arriveGeo: null, leaveAt: null, leaveGeo: null, updatedAt: Date.now() };
        DB.time.push(t);
      } else { t.arriveAt = Date.now(); t.leaveAt = null; t.updatedAt = Date.now(); }
      saveDB();
      userPointIds(u).forEach(function (pid) {
        if (stockCheckForDay(u.id, pid, key)) return;
        saveStockCheck({ pointId: pid, result: 'match', items: productsForPoint(pid).map(function (p) {
          const r = stockRow(pid, p.id); const q = r ? r.qty : 0;
          return { productId: p.id, name: p.name, system: q, actual: q };
        }) }, u);
      });
      location.hash = '#/cash';
    });
    await sleep(900);

    const sellerState = await page.evaluate(function () {
      const sw = document.querySelector('#topbarPoint');
      return {
        role: currentUser().role,
        active: activePointId(currentUser()),
        points: userPointIds(currentUser()).length,
        hasSwitch: !!sw,
        options: sw ? sw.options.length : 0
      };
    });
    ok('продавец видит переключатель точек', sellerState.hasSwitch && sellerState.options === 2, 'опций: ' + sellerState.options);
    ok('активная точка выбрана', !!sellerState.active);

    // --- продажа на точке 1 ---
    const saleInfo = await page.evaluate(async function () {
      const user = currentUser();
      const pt1 = userPointIds(user)[0];
      const pt2 = userPointIds(user)[1];
      const product = productsForPoint(pt1)[0];
      setStockQty(pt1, product.id, 20, 'тест', user);
      const sale = createSale({
        pointId: pt1,
        items: [{ productId: product.id, name: product.name, price: product.price, qty: 1 }],
        total: product.price, payment: 'cash'
      }, user);
      saveDB();
      return { pt1: pt1, pt2: pt2, saleId: sale.id, price: product.price };
    });
    await sleep(300);

    // переключаем точку через шапку
    await page.select('#topbarPoint', saleInfo.pt2);
    await sleep(900);
    const afterSwitch = await page.evaluate(function () {
      const user = currentUser();
      return {
        pointId: activePointId(user),
        header: document.querySelector('.page-head .sub') ? document.querySelector('.page-head .sub').textContent : '',
        todayRows: document.querySelectorAll('#todaySalesBox tbody tr').length,
        expectedRows: Math.min(12, salesBetween(startOfDay(new Date()), Date.now(), { pointId: activePointId(currentUser()) }).length),
        foreignRows: salesBetween(startOfDay(new Date()), Date.now(), { pointId: activePointId(currentUser()) }).filter(function (s) { return s.pointId !== activePointId(currentUser()); }).length,
        topSwitch: document.querySelector('#topbarPoint') ? document.querySelector('#topbarPoint').value : '',
        pageSelect: !!document.querySelector('#cashPoint')
      };
    });
    ok('переключение на вторую точку', afterSwitch.pointId === saleInfo.pt2);
    ok('касса открылась на второй точке', afterSwitch.topSwitch === saleInfo.pt2, 'заголовок: ' + afterSwitch.header.trim());
    ok('выбор точки не дублируется (только в шапке)', afterSwitch.pageSelect === false);
    ok('в кассе только продажи активной точки', afterSwitch.foreignRows === 0 && afterSwitch.todayRows === afterSwitch.expectedRows,
      'строк: ' + afterSwitch.todayRows + ' из ' + afterSwitch.expectedRows + ', чужих: ' + afterSwitch.foreignRows);

    // возвращаемся на первую точку
    await page.select('#topbarPoint', saleInfo.pt1);
    await sleep(900);
    const back = await page.evaluate(function () {
      return {
        pointId: activePointId(currentUser()),
        todayRows: document.querySelectorAll('#todaySalesBox tbody tr').length,
        expectedRows: Math.min(12, salesBetween(startOfDay(new Date()), Date.now(), { pointId: activePointId(currentUser()) }).length),
        foreignRows: salesBetween(startOfDay(new Date()), Date.now(), { pointId: activePointId(currentUser()) }).filter(function (s) { return s.pointId !== activePointId(currentUser()); }).length,
        splitText: document.querySelector('.cash-split') ? document.querySelector('.cash-split').textContent.replace(/\s+/g, ' ') : ''
      };
    });
    ok('возврат на первую точку', back.pointId === saleInfo.pt1);
    ok('продажа первой точки снова видна', back.todayRows >= 1, 'строк: ' + back.todayRows);
    ok('в кассе есть разбивка оплат', /Итого наличными/.test(back.splitText), back.splitText.slice(0, 70));

    // --- данные не смешались: склад у каждой точки свой ---
    const stockCheck = await page.evaluate(function () {
      const user = currentUser();
      const ids = userPointIds(user);
      const product = productsForPoint(ids[0])[0];
      const r1 = stockRow(ids[0], product.id);
      const r2 = stockRow(ids[1], product.id);
      return { first: r1 ? r1.qty : null, second: r2 ? r2.qty : null };
    });
    ok('остатки точек независимы', stockCheck.first !== null && stockCheck.first !== stockCheck.second,
      'точка1: ' + stockCheck.first + ', точка2: ' + stockCheck.second);

    // --- админ: разбивка смешанной оплаты в отчётах ---
    await logout(page);
    await login(page, 'netowner', 'netpass1');

    const mixed = await page.evaluate(function () {
      const user = currentUser();
      const point = DB.points[0];
      const product = productsForPoint(point.id)[0];
      setStockQty(point.id, product.id, 50, 'тест', user);
      const before = summarize(startOfDay(new Date()), Date.now(), { pointId: point.id });
      const sale = createSale({
        pointId: point.id,
        items: [{ productId: product.id, name: product.name, price: product.price, qty: 1 }],
        total: 10000, payment: 'mixed', cashAmount: 4000, qrAmount: 6000
      }, user);
      saveDB();
      const stats = summarize(startOfDay(new Date()), Date.now(), { pointId: point.id });
      return {
        mixedTotal: stats.mixedTotal - before.mixedTotal,
        mixedCash: stats.mixedCash - before.mixedCash,
        mixedQr: stats.mixedQr - before.mixedQr,
        cashTotal: stats.cashTotal - before.cashTotal,
        qrTotal: stats.qrTotal - before.qrTotal,
        total: stats.revenue - before.revenue
      };
    });
    ok('смешанная оплата учтена полностью', mixed.mixedTotal >= 10000, mixed.mixedTotal + ' ₸');
    ok('наличная часть смешанной', mixed.mixedCash === 4000, mixed.mixedCash + ' ₸');
    ok('Kaspi-часть смешанной', mixed.mixedQr === 6000, mixed.mixedQr + ' ₸');
    ok('итого наличными = нал. + доля смешанных', mixed.cashTotal >= 4000, mixed.cashTotal + ' ₸');
    ok('итого Kaspi = QR + доля смешанных', mixed.qrTotal >= 6000, mixed.qrTotal + ' ₸');

    await page.evaluate(function () {
      if (resolvedTheme() !== 'dark') toggleTheme();
      location.hash = '#/analytics';
    });
    await sleep(1000);
    const analText = await page.evaluate(function () {
      const card = Array.from(document.querySelectorAll('.card')).find(function (c) { return /Структура оплат/.test(c.textContent); });
      return card ? card.textContent.replace(/\s+/g, ' ') : '';
    });
    ok('в отчётах видна строка «Итого наличными»', /Итого наличными/.test(analText));
    ok('в отчётах видна строка «Итого Kaspi QR»', /Итого Kaspi QR/.test(analText));
    ok('в смешанных показаны доли', /наличными/.test(analText) && /Kaspi QR/.test(analText), analText.slice(0, 90));
    await page.screenshot({ path: SHOTS + '/60-analytics-mixed-dark.png' });

    // дашборд
    await page.evaluate(function () { location.hash = '#/dashboard'; });
    await sleep(800);
    const dashText = await page.evaluate(function () {
      const card = Array.from(document.querySelectorAll('.card')).find(function (c) { return /Способы оплаты/.test(c.textContent); });
      return card ? card.textContent.replace(/\s+/g, ' ') : '';
    });
    ok('на панели видна разбивка оплат', /Всего наличными/.test(dashText) && /Всего Kaspi/.test(dashText));

    // мобильная касса продавца с переключателем
    await page.evaluate(function () { if (resolvedTheme() !== 'dark') toggleTheme(); });
    await logout(page);
    await login(page, 'aigul', '123456');
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await sleep(900);
    const mobileSwitch = await page.evaluate(function () {
      const sw = document.querySelector('#topbarPoint');
      if (!sw) return null;
      const r = sw.getBoundingClientRect();
      return { w: Math.round(r.width), x: Math.round(r.x), visible: r.width > 0 && r.x >= 0 };
    });
    ok('на телефоне переключатель точек помещается', mobileSwitch && mobileSwitch.visible && mobileSwitch.w <= 130, mobileSwitch ? mobileSwitch.w + 'px' : 'нет');
    await page.screenshot({ path: SHOTS + '/61-seller-multipoint-mobile-dark.png' });

    ok('нет JS-ошибок', errors.length === 0, errors.slice(0, 3).join(' | '));

  } catch (err) {
    failed++;
    console.log('\n✗ Исключение: ' + err.message);
  } finally {
    await browser.close();
  }

  console.log('\n=== Итог: ' + passed + ' успешно, ' + failed + ' с ошибками ===');
  process.exit(failed ? 1 : 0);
})();
