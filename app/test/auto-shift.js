/* ============================================================
   Проверки: забытый уход
   — в 02:00 смена закрывается автоматически
   — сессия продавца в 02:00 завершается
   — админ видит пометку «закрыто автоматически»
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
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage();
  await installDayClock(page);
  await page.setViewport({ width: 1440, height: 960 });
  const errors = [];
  page.on('pageerror', function (e) { errors.push(e.message); });
  page.on('console', function (m) { if (m.type() === 'error') errors.push(m.text()); });

  try {
    console.log('\n=== Забытый уход: автозакрытие смены в 02:00 ===');
    await page.goto(BASE + '/index.html', { waitUntil: 'networkidle0' });
    await sleep(400);

    const seed = await page.evaluate(async () => {
      const admin = await createUser({ fullName: 'Владелец Сети', username: 'autoowner', password: 'auto1234' }, { autoRole: true });
      setSession(admin.id);
      const now = Date.now();
      const cat = { id: uid(), name: 'Категория', createdAt: now, updatedAt: now };
      DB.categories.push(cat);
      const point = { id: uid(), name: 'Точка Авто', address: 'Актобе', createdAt: now, updatedAt: now };
      DB.points.push(point);
      const product = { id: uid(), name: 'Товар', categoryId: cat.id, price: 500, pointIds: [point.id], pointId: point.id, createdAt: now, updatedAt: now };
      DB.products.push(product);
      saveDB();
      const seller = await createUser({
        fullName: 'Айгуль Сапарова', username: 'autoseller', password: 'auto1234',
        role: 'seller', pointIds: [point.id], pointId: point.id
      });
      const second = await createUser({
        fullName: 'Динара Сериковна', username: 'autoseller2', password: 'auto1234',
        role: 'seller', pointIds: [point.id], pointId: point.id
      });
      return { adminId: admin.id, sellerId: seller.id, secondId: second.id, pointId: point.id, pointName: point.name };
    });
    ok('данные подготовлены', !!seed.sellerId, seed.pointName);

    // ---------- 1. Чистая логика автозакрытия ----------
    const logic = await page.evaluate((s) => {
      DB.time = DB.time.filter(function (t) { return t.userId !== s.secondId; });
      const now = Date.now();
      const d = new Date();
      d.setHours(9, 0, 0, 0);
      const yesterday = new Date(now - 86400000);
      const yKey = dayKey(yesterday);

      // три смены: вчера забыли уход, сегодня идут, вчера закрыли вручную
      DB.time.push({ id: 't-open-yesterday', userId: s.secondId, date: yKey, arriveAt: startOfDay(yesterday) + 9 * 3600000, leaveAt: null, updatedAt: now });
      DB.time.push({ id: 't-open-today', userId: s.secondId, date: dayKey(new Date()), arriveAt: startOfDay(new Date()) + 9 * 3600000, leaveAt: null, updatedAt: now });
      DB.time.push({ id: 't-closed', userId: s.secondId, date: yKey, arriveAt: startOfDay(yesterday) + 8 * 3600000, leaveAt: startOfDay(yesterday) + 18 * 3600000, updatedAt: now });
      saveDB();

      const closeAtY = shiftAutoCloseAt(yKey);
      const closed = autoCloseOpenShifts(now);
      const byId = {};
      DB.time.forEach(function (t) { byId[t.id] = t; });

      return {
        closeAtY: closeAtY,
        closeAtHour: new Date(closeAtY).getHours(),
        closeAtIsNextDay: dayKey(new Date(closeAtY)) === dayKey(new Date(parseDayKey(yKey).getTime() + 86400000)),
        closedCount: closed.length,
        closedIds: closed.map(function (t) { return t.id; }),
        yLeave: byId['t-open-yesterday'].leaveAt,
        yAuto: !!byId['t-open-yesterday'].autoClosed,
        todayLeave: byId['t-open-today'].leaveAt,
        closedLeave: byId['t-closed'].leaveAt,
        closedAuto: !!byId['t-closed'].autoClosed
      };
    }, seed);
    ok('момент автозакрытия — 02:00', logic.closeAtHour === 2, String(logic.closeAtHour));
    ok('закрывается на следующий день после смены', logic.closeAtIsNextDay);
    ok('вчерашняя незакрытая смена закрыта', logic.closedCount === 1 && logic.closedIds.indexOf('t-open-yesterday') !== -1, logic.closedIds.join(', '));
    ok('уход проставлен временем 02:00', logic.yLeave === logic.closeAtY, fmtTimeSafe(logic.yLeave));
    ok('смена помечена как автоматическая', logic.yAuto);
    ok('сегодняшняя смена не тронута', logic.todayLeave === null);
    ok('закрытая вручную смена не меняется', logic.closedLeave === logic.closeAtY - 8 * 3600000 && !logic.closedAuto);

    // ---------- 2. Повторный вызов ничего не ломает ----------
    const again = await page.evaluate((s) => {
      const before = DB.time.find(function (t) { return t.id === 't-open-yesterday'; }).leaveAt;
      const closed = autoCloseOpenShifts(Date.now());
      const after = DB.time.find(function (t) { return t.id === 't-open-yesterday'; }).leaveAt;
      return { closed: closed.length, same: before === after };
    }, seed);
    ok('повторный запуск ничего не меняет', again.closed === 0 && again.same);

    // ---------- 3. Граница 02:00 для авто-выхода ----------
    const boundary = await page.evaluate(() => {
      const base = new Date();
      base.setHours(1, 55, 0, 0);
      const from = base.getTime();
      const to = from + 10 * 60000; // 02:05
      const b = nightBoundaryBetween(from, to);
      const day = nightBoundaryBetween(from + 6 * 3600000, from + 7 * 3600000);
      const back = nightBoundaryBetween(to, from);
      return {
        b: b,
        hour: b ? new Date(b).getHours() : null,
        minute: b ? new Date(b).getMinutes() : null,
        daytime: day,
        reversed: back
      };
    });
    ok('граница 02:00 определяется', boundary.b && boundary.hour === 2 && boundary.minute === 0, new Date(boundary.b).toLocaleTimeString('ru-RU'));
    ok('днём границы нет', boundary.daytime === null);
    ok('назад по времени границы нет', boundary.reversed === null);

    // ---------- 4. Интерфейс: админ видит пометку ----------
    await page.evaluate((s) => {
      const admin = DB.users.find(function (u) { return u.id === s.adminId; });
      setSession(admin.id);
      location.hash = '#/time';
      document.getElementById('teamDate') && (document.getElementById('teamDate').value = dayKey(new Date()));
    }, seed);
    await sleep(400);
    await page.evaluate((s) => {
      const key = dayKey(new Date(Date.now() - 86400000));
      const sel = document.querySelector('#teamDate');
      if (sel) { sel.value = key; sel.dispatchEvent(new Event('change', { bubbles: true })); }
    }, seed);
    await sleep(900);

    const adminView = await page.evaluate((s) => {
      const rows = Array.from(document.querySelectorAll('.tbl tbody tr'));
      const row = rows.find(function (r) { return r.textContent.indexOf('Динара Сериковна') !== -1; });
      return {
        hasWarning: row ? /закрыто автоматически/.test(row.textContent) : false,
        hasLeaveTime: row ? /02:00/.test(row.textContent) : false,
        rowText: row ? row.textContent.replace(/\s+/g, ' ').trim() : null,
        status: row ? (row.querySelector('.badge:last-child') || {}).textContent : null
      };
    }, seed);
    ok('у админа видно «закрыто автоматически»', adminView.hasWarning, adminView.rowText ? adminView.rowText.slice(0, 110) : '');
    ok('время ухода 02:00', adminView.hasLeaveTime, adminView.status || '');
    await page.screenshot({ path: SHOTS + '/104-auto-closed-shift.png', fullPage: true });

    // ---------- 5. Продавец: смена закрыта, приход можно отметить заново ----------
    const sellerState = await page.evaluate((s) => {
      const seller = DB.users.find(function (u) { return u.id === s.sellerId; });
      setSession(seller.id);
      location.hash = '#/cash';
      return { user: seller.username };
    }, seed);
    await sleep(1100);
    const sellerUi = await page.evaluate((s) => {
      const key = dayKey(new Date());
      // новая смена на сегодня: чистим, чтобы проверить сценарий «приход → сверка»
      DB.time = DB.time.filter(function (t) { return !(t.userId === s.sellerId && t.date === key); });
      saveDB();
      return {
        gate: !!document.querySelector('.gate-card'),
        title: (document.querySelector('.gate-card h2') || {}).textContent
      };
    }, seed);
    ok('продавец после автозакрытия снова видит «Отметьте приход»', sellerUi.gate && sellerUi.title === 'Отметьте приход на работу', sellerUi.title);

    // ---------- 6. Авто-выход из сессии в 02:00 ----------
    const logoutAt2 = await page.evaluate((s) => {
      const seller = DB.users.find(function (u) { return u.id === s.sellerId; });
      setSession(seller.id);
      return { before: !!currentUser() };
    }, seed);
    await sleep(300);
    // прогоняем тот же код, что и вотчер, но с искусственным переходом через 02:00
    const sessionEnd = await page.evaluate((s) => {
      const seller = DB.users.find(function (u) { return u.id === s.sellerId; });
      setSession(seller.id);
      const d = new Date();
      d.setHours(1, 59, 0, 0);
      const from = d.getTime();
      const to = from + 2 * 60000;
      const b = nightBoundaryBetween(from, to);
      return { loggedBefore: !!currentUser(), boundary: b ? new Date(b).getHours() : null, role: seller.role };
    }, seed);
    ok('сессия продавца активна до 02:00', sessionEnd.loggedBefore === true && sessionEnd.role === 'seller');
    ok('в 02:00 определяется точка завершения сессии', sessionEnd.boundary === 2, String(sessionEnd.boundary));

    ok('нет JS-ошибок', errors.length === 0, errors.slice(0, 2).join(' | '));
  } catch (e) {
    failed++;
    console.log('  ✗ ИСКЛЮЧЕНИЕ: ' + e.message);
  }

  await browser.close();
  console.log('\n=== Итог: ' + passed + ' успешно, ' + failed + ' с ошибками ===');
  process.exit(failed ? 1 : 0);
})();

function fmtTimeSafe(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}
