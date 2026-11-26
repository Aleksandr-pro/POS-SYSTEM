const puppeteer = require('puppeteer');
const { installDayClock } = require('./test/helpers/clock');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox','--disable-dev-shm-usage'] });
  const p = await b.newPage();
  await installDayClock(p);
  await p.setViewport({ width: 1600, height: 1000 });
  await p.goto('http://127.0.0.1:8099/index.html', { waitUntil: 'networkidle0' });
  await sleep(300);
  await p.evaluate(async () => {
    const now = Date.now();
    const admin = await createUser({ fullName: 'Владелец Сети', username: 'deskadmin', password: 'deskadmin1' }, { autoRole: true });
    setSession(admin.id);
    ['Керуен','Sky','My Kids','Dalida Plaza','Elegant Park'].forEach((n) => DB.points.push({ id: uid(), name: n, address: 'Актобе', createdAt: now, updatedAt: now }));
    const names = ['Аквагримм 1500','Тату 600','Тату 700','Пряди','Фонарик 3 висюльки','Брелок 2000','Хаги Ваги','София','Гипс набор','Косички'];
    const prices = [1500,600,700,700,3500,2000,2000,2000,2500,3000];
    names.forEach((n,i) => DB.products.push({ id: uid(), name: n, price: prices[i], cost: Math.round(prices[i]*0.4), categoryId: null, photo: null, pointIds: [], createdAt: now, updatedAt: now }));
    ['Арина Турланова','Айнэлля Нагметова','Дарья','Нурдана Калыбай','Юлия'].forEach((n,i) => DB.users.push({ id: uid(), fullName: n, username: 'sell'+i, passwordHash: hashPassword('seller1'), role: 'seller', pointIds: [DB.points[i % 5].id], createdAt: now, updatedAt: now }));
    saveDB();
    const parsed = parseTransactionsText(`13:27 — Арина Турланова\nУслуга/Точка: Аквагримм. Керуен\nОплата: Каспи QR\nТовары: Аквагримм 1500 × 1 шт\nСумма: 1 500.00 ₸\n\n15:23 — Дарья\nУслуга/Точка: Косички. My kids\nОплата: Наличные\nТовары: Фонарик 3 висюльки × 1 шт\nСумма: 3 500.00 ₸\n\n19:06 — Арина Турланова\nУслуга/Точка: Косички. Керуен\nОплата: Каспи QR\nТовары: Тату 600 × 1 шт, Пряди × 2 шт\nСумма: 2 000.00 ₸`, { date: dayKey(Date.now()) });
    importTransactions(parsed.transactions, { actor: admin, replace: true });
    DB.expenses.push({ id: uid(), amount: 12000, reason: 'Аренда', pointId: null, userId: admin.id, createdAt: Date.now() - 3600e3, updatedAt: Date.now() });
    saveDB();
    location.hash = '#/dashboard';
  });
  await sleep(1600);
  await p.screenshot({ path: 'screenshots/d1-dashboard-before.png' });
  for (const [hash, name] of [['#/cash','d2-cash-before'],['#/stock','d3-stock-before'],['#/analytics','d4-analytics-before'],['#/products','d5-products-before']]) {
    await p.evaluate((h) => { location.hash = h; }, hash);
    await sleep(1100);
    await p.screenshot({ path: 'screenshots/' + name + '.png' });
  }
  await b.close();
})();
