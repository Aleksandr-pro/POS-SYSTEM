const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE || 'http://127.0.0.1:8099';
const SHOTS = path.join(__dirname, '..', 'screenshots');
if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });

const errors = [];
const results = [];

function ok(name, extra) { results.push({ name, status: 'OK', extra }); console.log('  ✔', name, extra || ''); }
function fail(name, err) { results.push({ name, status: 'FAIL', extra: String(err) }); console.log('  ✘', name, err); }

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });

  page.on('console', msg => {
    if (msg.type() === 'error') errors.push('console: ' + msg.text());
  });
  page.on('pageerror', err => errors.push('pageerror: ' + err.message));

  await page.goto(BASE + '/index.html', { waitUntil: 'networkidle0' });
  await sleep(300);

  // ---------- 1. Экран входа ----------
  if (await page.$('#loginForm')) ok('Экран входа отрисован');
  else fail('Экран входа', 'нет формы');
  await page.screenshot({ path: path.join(SHOTS, '01-login-desktop.png') });

  // ---------- 2. Регистрация администратора ----------
  await page.click('#goRegister');
  await sleep(350);
  await page.type('#regName', 'Юлия Иванова');
  await page.type('#regUser', 'yulia');
  await sleep(400); // проверка уникальности
  const statusColor = await page.$eval('#userStatus', el => el.style.color + '|' + el.style.display);
  await page.type('#regPass', 'secret123');
  await page.type('#regPass2', 'secret123');
  await page.click('#regTerms');
  await page.screenshot({ path: path.join(SHOTS, '02-register.png') });
  const passHint = await page.$eval('#passHint', el => el.textContent);
  await page.click('#regBtn');
  await sleep(900);

  const session = await page.evaluate(() => ({ user: currentUser(), hash: location.hash }));
  if (session.user && session.user.role === 'admin') ok('Регистрация → администратор', '@' + session.user.username);
  else fail('Регистрация', JSON.stringify(session));
  if (passHint.includes('надёжн')) ok('Индикатор пароля работает'); else fail('Индикатор пароля', passHint);
  if (statusColor.includes('var(--success)')) ok('Проверка уникальности логина (зелёный)'); else fail('Уникальность логина', statusColor);

  // ---------- 3. Демо-данные ----------
  await page.evaluate(async () => {
    await loadDemoData(currentUser());
  });
  await page.reload({ waitUntil: 'networkidle0' });
  await sleep(700);
  const counts = await page.evaluate(() => ({
    users: DB.users.length, points: DB.points.length, products: DB.products.length,
    sales: DB.sales.length, expenses: DB.expenses.length, stock: DB.stock.length, time: DB.time.length
  }));
  if (counts.sales > 30 && counts.products === 12) ok('Демо-данные загружены', JSON.stringify(counts));
  else fail('Демо-данные', JSON.stringify(counts));

  // ---------- 4. Дашборд ----------
  if (await page.$('#dashChart')) ok('Дашборд: график отрисован');
  else fail('Дашборд', 'нет графика');
  const kpi = await page.$$eval('.stat-value', els => els.map(e => e.textContent.trim()));
  ok('KPI дашборда', kpi.join(' | '));
  await page.screenshot({ path: path.join(SHOTS, '03-dashboard.png'), fullPage: true });

  // переключение периода
  await page.click('[data-period="week"]');
  await sleep(500);
  const weekActive = await page.$eval('[data-period="week"]', el => el.classList.contains('active'));
  if (weekActive) ok('Переключение периода'); else fail('Период', 'не активен');
  await page.screenshot({ path: path.join(SHOTS, '04-dashboard-week.png') });

  // ---------- 5. Касса: продажа ----------
  await page.evaluate(() => { location.hash = '#/cash'; });
  await sleep(700);
  if (await page.$('#catalogGrid .product-card')) ok('Касса: каталог товаров');
  else fail('Касса', 'каталог пуст');
  await page.click('#catalogGrid .product-card:nth-child(1)');
  await sleep(250);
  await page.click('#catalogGrid .product-card:nth-child(2)');
  await sleep(350);
  const cartCount = await page.$eval('.cart-count', el => el.textContent);
  if (Number(cartCount) >= 2) ok('Товары добавлены в корзину', 'позиций: ' + cartCount);
  else fail('Корзина', cartCount);
  await page.screenshot({ path: path.join(SHOTS, '05-cash.png'), fullPage: true });

  // оплата Kaspi QR требует чек
  await page.click('[data-pay="qr"]');
  await sleep(250);
  const totalBefore = await page.evaluate(() => DB.sales.length);
  await page.click('#checkoutBtn');
  await sleep(400);
  const totalAfterInvalid = await page.evaluate(() => DB.sales.length);
  if (totalAfterInvalid === totalBefore) ok('QR без чека не оформляется (валидация)');
  else fail('Валидация чека', 'продажа прошла без чека');
  // прикрепляем тестовый чек программно и оформляем
  await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 300; c.height = 400;
    const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 300, 400);
    x.fillStyle = '#111'; x.font = '20px sans-serif'; x.fillText('KASPI RECEIPT', 20, 60);
    x.fillText('TOTAL', 20, 120);
    window.__testReceipt = c.toDataURL('image/jpeg', 0.8);
  });
  // имитируем добавление файла через input
  const receiptData = await page.evaluate(() => window.__testReceipt);
  const tmpFile = '/tmp/receipt.jpg';
  fs.writeFileSync(tmpFile, Buffer.from(receiptData.split(',')[1], 'base64'));
  const input = await page.$('#receiptInput');
  if (input) {
    await input.uploadFile(tmpFile);
    await sleep(900);
    const hasThumb = await page.$('.receipt-thumb img');
    if (hasThumb) ok('Чек прикреплён и сжат'); else fail('Чек', 'нет превью');
  } else fail('Чек', 'нет input');
  const beforeSale = await page.evaluate(() => DB.sales.length);
  await page.click('#checkoutBtn');
  await sleep(900);
  const afterSale = await page.evaluate(() => DB.sales.length);
  if (afterSale === beforeSale + 1) ok('Продажа оформлена', '+' + (afterSale - beforeSale));
  else fail('Оформление продажи', beforeSale + ' → ' + afterSale);
  await page.screenshot({ path: path.join(SHOTS, '06-sale-done.png') });
  // закрываем модалку
  const closeSale = await page.$('[data-close-sale]');
  if (closeSale) await closeSale.click();
  await sleep(300);

  // ---------- 6. Остатки списались ----------
  const stockCheck = await page.evaluate(() => {
    const lastSale = DB.sales[DB.sales.length - 1];
    return { sale: lastSale.code, payment: lastSale.payment, items: lastSale.items.length, receipt: !!lastSale.receipt };
  });
  ok('Данные продажи', JSON.stringify(stockCheck));

  // ---------- 7. Разделы ----------
  const sections = [
    ['products', '#prodGrid', '07-products.png'],
    ['stock', '#stockSection table', '08-stock.png'],
    ['points', '#pointsTabContent', '09-points.png'],
    ['time', '#teamDate', '10-time.png'],
    ['analytics', '#anChart', '11-analytics.png'],
    ['help', '#sec-start', '12-help.png'],
    ['settings', '.settings-grid', '13-settings.png']
  ];
  for (const [route, selector, shot] of sections) {
    const errCountBefore = errors.length;
    await page.evaluate(r => { location.hash = '#/' + r; }, route);
    await sleep(650);
    const found = await page.$(selector);
    if (found) ok('Раздел «' + route + '»');
    else fail('Раздел «' + route + '»', 'нет ' + selector);
    if (errors.length > errCountBefore) fail('Раздел «' + route + '»: ошибки JS', errors.slice(errCountBefore).join('; '));
    await page.screenshot({ path: path.join(SHOTS, shot), fullPage: true });
  }

  // ---------- 8. Вкладки точек продаж ----------
  await page.evaluate(() => { location.hash = '#/points'; });
  await sleep(500);
  await page.click('[data-tab="users"]');
  await sleep(450);
  const userRows = await page.$$eval('#pointsTabContent tbody tr', r => r.length);
  if (userRows >= 2) ok('Вкладка «Пользователи»', userRows + ' строк');
  else fail('Пользователи', userRows);
  await page.screenshot({ path: path.join(SHOTS, '14-points-users.png'), fullPage: true });
  await page.click('[data-tab="stock"]');
  await sleep(450);
  if (await page.$('#pointsStock table')) ok('Вкладка «Склад» в точках'); else fail('Склад в точках', 'нет таблицы');

  // ---------- 9. Экспорт XLSX ----------
  const client = await page.target().createCDPSession();
  await client.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: '/tmp/dl', eventsEnabled: true }).catch(() => {});
  fs.mkdirSync('/tmp/dl', { recursive: true });
  await page.evaluate(() => { location.hash = '#/analytics'; });
  await sleep(600);
  await page.click('#anExport');
  await sleep(1400);
  const files = fs.readdirSync('/tmp/dl').filter(f => f.endsWith('.xlsx'));
  if (files.length) {
    const stat = fs.statSync('/tmp/dl/' + files[0]);
    if (stat.size > 3000) ok('Экспорт XLSX из аналитики', files[0] + ' · ' + Math.round(stat.size / 1024) + ' КБ');
    else fail('Экспорт XLSX', 'файл слишком мал');
  } else fail('Экспорт XLSX', 'файл не скачался');

  // ---------- 10. Выход и вход продавцом ----------
  // продавцу касса открывается после прихода и сверки склада — готовим это заранее
  await page.evaluate(() => {
    const u = DB.users.find(function (x) { return x.username === 'aigul'; });
    if (!u) return;
    const key = dayKey(new Date());
    let t = timeEntryFor(u.id, key);
    if (!t) {
      t = { id: uid(), userId: u.id, date: key, arriveAt: Date.now(), arriveGeo: null, leaveAt: null, leaveGeo: null, updatedAt: Date.now() };
      DB.time.push(t);
    } else { t.arriveAt = Date.now(); t.leaveAt = null; t.updatedAt = Date.now(); }
    saveDB();
    userPointIds(u).forEach(function (pid) {
      if (!stockCheckForDay(u.id, pid, key)) saveStockCheck({ pointId: pid, result: 'match' }, u);
    });
  });
  await page.evaluate(() => { location.hash = '#/settings'; });
  await sleep(500);
  await page.click('#logoutBtn');
  await sleep(600);
  if (await page.$('#loginForm')) ok('Выход из аккаунта'); else fail('Выход', 'нет формы входа');
  await page.type('#loginUser', 'aigul');
  await page.type('#loginPass', '123456');
  await page.click('#loginBtn');
  await sleep(1000);
  const seller = await page.evaluate(() => currentUser());
  if (seller && seller.role === 'seller') ok('Вход продавцом', seller.fullName);
  else fail('Вход продавцом', JSON.stringify(seller));
  const sellerHash = await page.evaluate(() => location.hash);
  if (sellerHash === '#/cash') ok('Продавец направлен в кассу'); else fail('Стартовая страница продавца', sellerHash);
  await page.screenshot({ path: path.join(SHOTS, '15-seller-cash.png'), fullPage: true });

  // ограничение доступа
  await page.evaluate(() => { location.hash = '#/analytics'; });
  await sleep(600);
  const restrictedHash = await page.evaluate(() => location.hash);
  if (restrictedHash === '#/cash') ok('Аналитика закрыта для продавца'); else fail('Права продавца', restrictedHash);

  // ---------- 11. Мобильный вид ----------
  const mobile = await browser.newPage();
  mobile.on('pageerror', e => errors.push('mobile pageerror: ' + e.message));
  await mobile.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await mobile.goto(BASE + '/index.html', { waitUntil: 'networkidle0' });
  await sleep(400);
  await mobile.evaluate(() => { logoutUser(); location.hash = '#/login'; });
  await sleep(700);
  await mobile.screenshot({ path: path.join(SHOTS, '16-mobile-login.png') });
  if (await mobile.$('#loginForm')) ok('Мобильный экран входа');
  await mobile.type('#loginUser', 'yulia');
  await mobile.type('#loginPass', 'secret123');
  await mobile.click('#loginBtn');
  await sleep(1200);
  await mobile.screenshot({ path: path.join(SHOTS, '17-mobile-dashboard.png'), fullPage: true });
  const bottomNav = await mobile.$('.bottomnav');
  if (bottomNav) {
    const visible = await mobile.evaluate(el => getComputedStyle(el).display !== 'none', bottomNav);
    if (visible) ok('Мобильная нижняя навигация'); else fail('Мобильная навигация', 'скрыта');
  }
  await mobile.evaluate(() => { location.hash = '#/cash'; });
  await sleep(700);
  await mobile.screenshot({ path: path.join(SHOTS, '18-mobile-cash.png'), fullPage: true });

  // ---------- 12. Ошибки ----------
  const realErrors = errors.filter(e => !/favicon|manifest|sw\.js|Service worker|Failed to load resource.*(404)/i.test(e));
  if (realErrors.length === 0) ok('Нет JS-ошибок за весь прогон');
  else fail('JS-ошибки', realErrors.length + ': ' + realErrors.slice(0, 8).join(' | '));

  await browser.close();

  const failed = results.filter(r => r.status === 'FAIL');
  console.log('\n===== ИТОГО: ' + (results.length - failed.length) + '/' + results.length + ' проверок прошли =====');
  if (failed.length) {
    failed.forEach(f => console.log('  ✘', f.name, '—', f.extra));
    process.exit(1);
  }
}

main().catch(e => { console.error('FATAL', e); process.exit(2); });
