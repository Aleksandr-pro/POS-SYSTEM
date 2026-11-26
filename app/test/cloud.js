/* ============================================================
   Облачный сценарий: регистрация через сервер, синхронизация
   между устройствами, права продавца, офлайн-очередь.
   Требует: wrangler dev --local на 8787 и статику dist на 8110.
   ============================================================ */
const puppeteer = require('puppeteer');

const APP = process.env.POS_APP_URL || 'http://127.0.0.1:8110/index.html';
const API = process.env.POS_API_URL || 'http://127.0.0.1:8787';

let passed = 0;
let failed = 0;
const problems = [];

function ok(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name + (extra ? ' — ' + extra : '')); }
  else { failed++; problems.push(name + (extra ? ' — ' + extra : '')); console.log('  ✗ ' + name + (extra ? ' — ' + extra : '')); }
}

async function waitText(page, selector, needle, timeout) {
  const limit = Date.now() + (timeout || 10000);
  while (Date.now() < limit) {
    const text = await page.evaluate(function (sel) {
      const el = document.querySelector(sel);
      return el ? el.textContent : '';
    }, selector);
    if (text && text.indexOf(needle) !== -1) return text;
    await new Promise(function (r) { setTimeout(r, 150); });
  }
  const text = await page.evaluate(function (sel) {
    const el = document.querySelector(sel);
    return el ? el.textContent : '';
  }, selector);
  throw new Error('Не дождались «' + needle + '» в ' + selector + ', сейчас: ' + JSON.stringify(text));
}

async function newDevice(browser, label) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 1440, height: 940 });
  page.on('pageerror', function (err) { console.log('  [JS ' + label + '] ' + err.message); });
  await page.goto(APP, { waitUntil: 'load' });
  await page.waitForSelector('#app');
  return { context: context, page: page, label: label };
}

async function connectServer(page) {
  await page.waitForSelector('#srvStripBtn');
  await page.click('#srvStripBtn');
  await page.waitForSelector('#mSrvUrl');
  await page.evaluate(function (url) {
    const input = document.querySelector('#mSrvUrl');
    input.value = url;
  }, API);
  await page.click('#mSrvTest');
  const note = await waitText(page, '#mSrvNote', 'доступен', 10000);
  await page.click('[data-save]');
  await page.waitForFunction(function () { return !document.querySelector('#mSrvUrl'); });
  return note;
}

(async function run() {
  console.log('\n=== Облако POS Контроль ===');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--lang=ru-RU']
  });

  try {
    /* ---------- устройство 1: настройка сервера + регистрация ---------- */
    console.log('\n1. Устройство 1 — подключение сервера и регистрация');
    const a = await newDevice(browser, 'A');
    await a.page.evaluate(function () { localStorage.clear(); });
    await a.page.reload({ waitUntil: 'load' });
    await a.page.waitForSelector('#srvStripBtn');

    const healthNote = await connectServer(a.page);
    ok('проверка связи с сервером', /доступен/.test(healthNote), healthNote.trim());

    const savedUrl = await a.page.evaluate(function () { return POS_API.serverConfig().url; });
    ok('адрес сервера сохранён', savedUrl === API, savedUrl);

    await a.page.click('#goRegister');
    await a.page.waitForSelector('#regForm');
    await a.page.type('#regName', 'Владелец Магазина');
    await a.page.type('#regUser', 'owner');
    await a.page.type('#regPass', 'secret1');
    await a.page.type('#regPass2', 'secret1');
    await a.page.evaluate(function () {
      const box = document.querySelector('#regTerms');
      box.checked = true;
      box.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await a.page.click('#regBtn');
    try {
      await a.page.waitForSelector('.topbar', { timeout: 20000 });
    } catch (e) {
      const errText = await a.page.evaluate(function () {
        const box = document.querySelector('#regError');
        return box && !box.classList.contains('hide') ? box.textContent.trim() : '(нет сообщения)';
      });
      throw new Error('регистрация не прошла: ' + errText);
    }
    await new Promise(function (r) { setTimeout(r, 1500); });

    const aState = await a.page.evaluate(function () {
      return {
        role: currentUser().role,
        users: DB.users.length,
        token: !!POS_API.serverConfig().token,
        configured: POS_API.isServerConfigured()
      };
    });
    ok('регистрация через сервер', aState.configured && aState.token);
    ok('первый пользователь = администратор', aState.role === 'admin', 'роль: ' + aState.role);

    /* ---------- данные и первая отправка ---------- */
    console.log('\n2. Устройство 1 — данные и отправка на сервер');
    const pushRes = await a.page.evaluate(async function () {
      const now = Date.now();
      DB.points.push({ id: 'pt-1', name: 'Точка А', address: 'Актобе', createdAt: now, updatedAt: now });
      DB.categories.push({ id: 'cat-1', name: 'Напитки', createdAt: now, updatedAt: now });
      DB.products.push({ id: 'pr-1', name: 'Кофе', price: 1200, categoryId: 'cat-1', pointIds: ['pt-1'], createdAt: now, updatedAt: now });
      DB.stock.push({ id: 'st-1', pointId: 'pt-1', productId: 'pr-1', qty: 10, history: [], updatedAt: now });
      createSale({
        pointId: 'pt-1',
        items: [{ productId: 'pr-1', name: 'Кофе', price: 1200, qty: 2 }],
        total: 2400,
        payment: 'cash'
      }, currentUser());
      saveDB();
      return POS_API.syncNow({ silent: true });
    });
    ok('отправка локальных данных', (pushRes.pushed || 0) >= 5, 'отправлено: ' + pushRes.pushed + ', получено: ' + pushRes.pulled);
    ok('нет отклонённых записей', Object.keys(pushRes.rejected || {}).every(function (k) { return !(pushRes.rejected[k] || []).length; }));

    /* ---------- устройство 2: вход и получение данных ---------- */
    console.log('\n3. Устройство 2 — вход и приём данных');
    const b = await newDevice(browser, 'B');
    await connectServer(b.page);
    await b.page.type('#loginUser', 'owner');
    await b.page.type('#loginPass', 'secret1');
    await b.page.click('#loginBtn');
    await b.page.waitForSelector('.topbar', { timeout: 20000 });
    await new Promise(function (r) { setTimeout(r, 1500); });

    const bState = await b.page.evaluate(async function () {
      await POS_API.syncNow({ silent: true });
      return {
        role: currentUser().role,
        sales: DB.sales.length,
        products: DB.products.length,
        points: DB.points.length,
        total: DB.sales.reduce(function (s, x) { return s + x.total; }, 0)
      };
    });
    ok('вход на втором устройстве', bState.role === 'admin', 'роль: ' + bState.role);
    ok('продажи пришли на устройство 2', bState.sales === 1, 'продаж: ' + bState.sales);
    ok('товары и точки пришли', bState.products === 1 && bState.points === 1);
    ok('сумма продажи совпадает', bState.total === 2400, bState.total + ' ₸');

    /* ---------- обратная синхронизация ---------- */
    console.log('\n4. Продажа на устройстве 2 → видна на устройстве 1');
    await b.page.evaluate(async function () {
      createSale({
        pointId: 'pt-1',
        items: [{ productId: 'pr-1', name: 'Кофе', price: 1200, qty: 1 }],
        total: 1200,
        payment: 'kaspi'
      }, currentUser());
      saveDB();
      await POS_API.syncNow({ silent: true });
    });
    const aAfter = await a.page.evaluate(async function () {
      await POS_API.syncNow({ silent: true });
      return { sales: DB.sales.length, total: DB.sales.reduce(function (s, x) { return s + x.total; }, 0) };
    });
    ok('устройство 1 получило продажу с устройства 2', aAfter.sales === 2, 'продаж: ' + aAfter.sales);
    ok('выручка сходится на обоих устройствах', aAfter.total === 3600, aAfter.total + ' ₸');

    /* ---------- права продавца ---------- */
    console.log('\n5. Продавец — вход и ограничения');
    const created = await a.page.evaluate(async function () {
      return POS_API.createServerUser({
        fullName: 'Айгуль Продавец',
        username: 'aigul2',
        password: 'seller1',
        role: 'seller',
        pointIds: ['pt-1'],
        pointId: 'pt-1'
      });
    });
    ok('админ создал продавца на сервере', created && created.user && created.user.role === 'seller');

    const c = await newDevice(browser, 'C');
    await connectServer(c.page);
    await c.page.type('#loginUser', 'aigul2');
    await c.page.type('#loginPass', 'seller1');
    await c.page.click('#loginBtn');
    await c.page.waitForSelector('.topbar', { timeout: 20000 });
    await new Promise(function (r) { setTimeout(r, 1200); });

    const cState = await c.page.evaluate(async function () {
      await POS_API.syncNow({ silent: true });
      return { role: currentUser().role, name: currentUser().fullName, sales: DB.sales.length, products: DB.products.length };
    });
    ok('продавец вошёл с ролью seller', cState.role === 'seller', cState.name);
    ok('продавец видит общие данные', cState.sales === 2 && cState.products === 1);

    const sellerWrite = await c.page.evaluate(async function () {
      const now = Date.now();
      DB.products.push({ id: 'pr-hack', name: 'Товар продавца', price: 500, categoryId: 'cat-1', pointIds: ['pt-1'], createdAt: now, updatedAt: now });
      saveDB();
      const res = await POS_API.syncNow({ silent: true });
      return { rejected: res.rejected || {}, written: res.pushed || 0 };
    });
    const foreignPoint = await c.page.evaluate(async function () {
      createSale({
        pointId: 'pt-999',
        items: [{ productId: 'pr-1', name: 'Кофе', price: 1200, qty: 1 }],
        total: 1200, payment: 'cash'
      }, currentUser());
      saveDB();
      const res = await POS_API.syncNow({ silent: true });
      return { rejected: (res.rejected.sales || []).length };
    });
    ok('сервер отклонил продажу на чужой точке', foreignPoint.rejected >= 1, 'отклонено: ' + foreignPoint.rejected);

    ok('сервер отклонил запись товара продавцом',
      (sellerWrite.rejected.products || []).indexOf('pr-hack') !== -1,
      'отклонено товаров: ' + ((sellerWrite.rejected.products || []).length));

    /* ---------- офлайн-очередь ---------- */
    console.log('\n6. Офлайн-очередь у продавца');
    await c.page.setOfflineMode(true);
    const offlineRes = await c.page.evaluate(async function () {
      const before = DB.sales.length;
      createSale({
        pointId: 'pt-1',
        items: [{ productId: 'pr-1', name: 'Кофе', price: 1200, qty: 1 }],
        total: 1200,
        payment: 'cash'
      }, currentUser());
      saveDB();
      const res = await POS_API.syncNow({ silent: true });
      return { res: res, pending: POS_API.pendingCount(), sales: DB.sales.length, added: DB.sales.length - before };
    });
    ok('продажа сохранена офлайн', offlineRes.added === 1, 'добавлено: ' + offlineRes.added);
    ok('синхронизация отложена', offlineRes.res.offline === true || offlineRes.res.skipped === true);
    ok('изменения в очереди', offlineRes.pending > 0, 'в очереди: ' + offlineRes.pending);

    await c.page.setOfflineMode(false);
    const backOnline = await c.page.evaluate(async function () {
      const res = await POS_API.syncNow({ silent: true });
      return { res: res, pending: POS_API.pendingCount(), details: POS_API.pendingDetails() };
    });
    ok('после появления сети данные ушли', !backOnline.res.error && backOnline.pending === 0,
      'осталось: ' + backOnline.pending + ' ' + JSON.stringify(backOnline.details));

    const aFinal = await a.page.evaluate(async function () {
      await POS_API.syncNow({ silent: true });
      return {
        sales: DB.sales.length,
        total: DB.sales.reduce(function (s, x) { return s + x.total; }, 0),
        sellerSales: DB.sales.filter(function (s) { return s.userName === 'Айгуль Продавец'; }).length
      };
    });
    ok('офлайн-продажа дошла до администратора', aFinal.sales === 3, 'продаж: ' + aFinal.sales);
    ok('продажа привязана к продавцу', aFinal.sellerSales === 1);

    /* ---------- интерфейс ---------- */
    console.log('\n7. Интерфейс сервера');
    await b.page.evaluate(function () { location.hash = '#/settings'; });
    await b.page.waitForSelector('#serverCard', { timeout: 8000 });
    const card = await b.page.evaluate(function () {
      const el = document.querySelector('#serverCard');
      return {
        text: el.textContent,
        hasSync: !!el.querySelector('#srvSync'),
        hasOff: !!el.querySelector('#srvOff'),
        pill: !!document.querySelector('#syncPill')
      };
    });
    ok('карточка «Сервер» в настройках', card.hasSync && card.hasOff);
    ok('адрес и статус видны', card.text.indexOf(API.replace('http://', '')) !== -1);
    ok('индикатор синхронизации в шапке', card.pill);

    await b.page.click('#srvSync');
    await new Promise(function (r) { setTimeout(r, 2500); });
    const syncToast = await b.page.evaluate(function () {
      const el = document.querySelector('.toast, .toast-item');
      return el ? el.textContent : '';
    });
    ok('кнопка «Синхронизировать» отработала', !/ошибк|не удалось/i.test(syncToast), syncToast.trim().slice(0, 60));

    /* ---------- тёмная тема не сломалась ---------- */
    const dark = await b.page.evaluate(function () {
      const before = document.documentElement.getAttribute('data-theme');
      toggleTheme();
      const after = document.documentElement.getAttribute('data-theme');
      toggleTheme();
      return { before: before, after: after };
    });
    ok('тёмная тема переключается', dark.before !== dark.after);

  } catch (err) {
    failed++;
    problems.push('Исключение: ' + err.message);
    console.log('\n✗ Исключение: ' + err.message);
  } finally {
    await browser.close();
  }

  console.log('\n=== Итог: ' + passed + ' успешно, ' + failed + ' с ошибками ===');
  if (problems.length) console.log('Проблемы:\n - ' + problems.join('\n - '));
  process.exit(failed ? 1 : 0);
})();
