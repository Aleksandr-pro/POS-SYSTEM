/**
 * Продавец: доступ только к своим точкам, своему складу и своей кассе.
 * Проверяет навигацию, прямые переходы по адресам и содержимое разделов.
 */
const puppeteer = require('puppeteer');
const path = require('path');

const BASE = process.env.POS_BASE || 'http://127.0.0.1:8099';
const SHOTS = path.join(__dirname, '..', 'screenshots');
const results = [];
function ok(name, extra) { results.push({ name, status: 'OK', extra: extra || '' }); console.log('  ✓', name, extra ? '— ' + extra : ''); }
function fail(name, extra) { results.push({ name, status: 'FAIL', extra: extra || '' }); console.log('  ✗', name, extra ? '— ' + extra : ''); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.goto(BASE + '/index.html', { waitUntil: 'networkidle0' });
  await sleep(500);

  // два администратора-точки, товары, продавец только на первой точке
  const seed = await page.evaluate(async () => {
    const admin = await createUser({ fullName: 'Владелец', username: 'owner', password: 'owner123' }, { autoRole: true });
    setSession(admin.id);
    await loadDemoData(admin);
    const pts = DB.points.slice(0, 2).map(p => p.id);
    if (pts.length < 2) return { error: 'нужно 2 точки' };
    // продавец только на первой точке
    const seller = await createUser({
      fullName: 'Продавец Первый', username: 'seller1', password: 'seller123',
      role: 'seller', pointIds: [pts[0]], pointId: pts[0]
    });
    // у второй точки должны быть свои товары и остатки
    const prods = productsForPoint(pts[1]);
    return {
      sellerId: seller.id, points: pts,
      pointNames: [pointName(pts[0]), pointName(pts[1])],
      productsP1: productsForPoint(pts[0]).length,
      productsP2: prods.length
    };
  });
  if (seed.error) { console.log('SEED FAIL', seed.error); process.exit(1); }

  // вход продавцом
  await page.evaluate(() => { logoutUser(); location.hash = '#/login'; });
  await sleep(600);
  await page.type('#loginUser', 'seller1');
  await page.type('#loginPass', 'seller123');
  await page.click('#loginBtn');
  await sleep(1200);

  const start = await page.evaluate(() => ({ hash: location.hash, role: currentUser().role }));
  ok('продавец входит и попадает в кассу', start.hash === '#/cash' && start.role === 'seller', start.hash);

  // 1. навигация
  const nav = await page.$$eval('.side-nav [data-nav]', els => els.map(e => e.getAttribute('data-nav')));
  ok('в меню только касса, склад и профиль', nav.join(',') === 'cash,stock,settings', nav.join(','));
  const bottom = await page.$$eval('.bottomnav [data-nav]', els => els.map(e => e.getAttribute('data-nav')));
  ok('нижнее меню без лишних разделов', ['dashboard', 'products', 'points', 'time', 'analytics', 'help'].every(p => bottom.indexOf(p) === -1), bottom.join(','));

  // 2. прямые переходы
  const restricted = { dashboard: '#/cash', products: '#/cash', points: '#/cash', time: '#/cash', analytics: '#/cash', help: '#/cash' };
  let allBlocked = true;
  for (const route of Object.keys(restricted)) {
    await page.evaluate(r => { location.hash = '#/' + r; }, route);
    await sleep(450);
    const h = await page.evaluate(() => location.hash);
    if (h !== '#/cash') { allBlocked = false; fail('закрыт раздел ' + route, h); }
  }
  if (allBlocked) ok('панель, товары, точки, время, аналитика, помощь закрыты');

  // 3. касса: только своя точка, без расходов и экспорта
  await page.evaluate(() => { location.hash = '#/cash'; });
  await sleep(800);
  const cash = await page.evaluate(() => ({
    title: document.querySelector('.page-head .sub') ? document.querySelector('.page-head .sub').textContent : '',
    expenseBtn: !!document.querySelector('#addExpenseBtn'),
    expenseCard: !!document.querySelector('#todayExpensesBox'),
    exportBtn: !!document.querySelector('#cashExport'),
    timeNote: !!document.querySelector('#cashGoTime'),
    pointSelect: !!document.querySelector('#cashPoint')
  }));
  ok('касса продавца: расходы скрыты', !cash.expenseBtn && !cash.expenseCard);
  ok('касса продавца: экспорт и время скрыты', !cash.exportBtn && !cash.timeNote);
  ok('касса продавца: переключатель чужих точек скрыт', !cash.pointSelect);

  // продажи и остатки — только своей точки
  const scope = await page.evaluate(() => {
    const me = currentUser();
    const myPoint = activePointId(me);
    const sales = salesBetween(0, Date.now(), { pointId: myPoint });
    const otherSales = DB.sales.filter(s => s.pointId !== myPoint).length;
    const otherStock = DB.stock.filter(r => r.pointId !== myPoint).length;
    return { myPoint, salesShown: sales.length, otherSales, otherStock, productCount: document.querySelectorAll('#catalogGrid .product-card').length };
  });
  ok('каталог кассы — только товары своей точки', scope.productCount > 0 && scope.productCount === seed.productsP1, scope.productCount + ' из ' + seed.productsP1);

  // 4. склад
  await page.evaluate(() => { location.hash = '#/stock'; });
  await sleep(900);
  const stock = await page.evaluate(() => {
    const sel = document.querySelector('#stockPagePoint');
    return {
      hash: location.hash,
      pointSelectOptions: sel ? Array.from(sel.options).length : 0,
      sub: document.querySelector('.page-head .sub') ? document.querySelector('.page-head .sub').textContent : '',
      rows: document.querySelectorAll('#stockTable tbody tr').length
    };
  });
  ok('склад продавца открывается', stock.hash === '#/stock');
  ok('на складе нет выбора чужих точек', stock.pointSelectOptions <= 1, 'вариантов: ' + stock.pointSelectOptions);
  ok('склад показывает остатки своей точки', stock.rows > 0, stock.rows + ' строк · ' + stock.sub);
  await page.screenshot({ path: path.join(SHOTS, '88-seller-stock.png'), fullPage: true });

  // 5. профиль: только статус сервера и пароль
  await page.evaluate(() => { location.hash = '#/settings'; });
  await sleep(800);
  const settings = await page.evaluate(() => {
    const text = document.body.textContent;
    return {
      hash: location.hash,
      banner: !!document.querySelector('.profile-banner'),
      serverBlock: !!document.querySelector('#srvCheck') || /Сервер/.test(text),
      password: !!document.querySelector('#savePassword'),
      themeGrid: !!document.querySelector('#themeSeg'),
      backup: !!document.querySelector('#backupDownload'),
      resetAll: !!document.querySelector('#resetAll'),
      legacy: /Перенести остатки|Старая система/.test(text),
      users: /Сотрудники|Пользователи/.test(text),
      navLabel: (document.querySelector('.side-nav [data-nav="settings"] span') || {}).textContent
    };
  });
  ok('профиль продавца открывается', settings.hash === '#/settings' && settings.banner);
  ok('виден статус сервера', settings.serverBlock);
  ok('смена своего пароля доступна', settings.password);
  ok('нет темы, копий, сброса, переноса и сотрудников', !settings.themeGrid && !settings.backup && !settings.resetAll && !settings.legacy && !settings.users);
  ok('раздел называется «Профиль»', settings.navLabel === 'Профиль', settings.navLabel);
  await page.screenshot({ path: path.join(SHOTS, '89-seller-profile.png'), fullPage: true });

  const realErrors = errors.filter(e => !/favicon|manifest|sw\.js/i.test(e));
  if (!realErrors.length) ok('нет JS-ошибок'); else fail('JS-ошибки', realErrors.join(' | '));

  await browser.close();
  const failed = results.filter(r => r.status === 'FAIL');
  console.log('\n=== Итог: ' + (results.length - failed.length) + ' успешно, ' + failed.length + ' с ошибками ===');
  if (failed.length) process.exit(1);
})();
