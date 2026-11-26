const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  // имитируем sandboxed iframe: localStorage бросает SecurityError
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(window, 'localStorage', {
      get() { throw new DOMException('The operation is insecure.', 'SecurityError'); }
    });
  });

  const html = fs.readFileSync(path.join(__dirname, '..', 'dist', 'index.html'), 'utf8');
  await page.setContent(html, { waitUntil: 'load' });
  await new Promise(r => setTimeout(r, 900));

  const state = await page.evaluate(() => ({
    hasLogin: !!document.querySelector('#loginForm'),
    note: (document.querySelector('.auth-foot') ? document.querySelector('.auth-foot').parentElement.textContent : '').includes('Режим предпросмотра')
  }));
  console.log('sandbox preview:', JSON.stringify(state));

  // регистрация и продажа в режиме без хранилища
  await page.evaluate(async () => {
    const u = await createUser({ fullName: 'Тест Предпросмотр', username: 'sandbox', password: '123456' }, { autoRole: true });
    setSession(u.id);
    DB.points.push({ id: 'p1', name: 'Точка', address: '', lat: null, lng: null, createdAt: Date.now() });
    DB.products.push({ id: 'pr1', name: 'Кофе', price: 500, categoryId: DB.categories[0].id, photo: null, pointIds: [] });
    setStockQty('p1', 'pr1', 10, 'старт', u);
    location.hash = '#/cash';
  });
  await new Promise(r => setTimeout(r, 900));
  const cash = await page.evaluate(() => !!document.querySelector('#catalogGrid .product-card'));
  console.log('cash renders in memory mode:', cash);
  await page.click('#catalogGrid .product-card');
  await new Promise(r => setTimeout(r, 300));
  await page.click('#checkoutBtn');
  await new Promise(r => setTimeout(r, 800));
  const sold = await page.evaluate(() => DB.sales.length);
  console.log('sale in memory mode:', sold === 1);
  await page.evaluate(() => { const b = document.querySelector('[data-close-sale]'); if (b) b.click(); });
  await new Promise(r => setTimeout(r, 300));
  await page.screenshot({ path: path.join(__dirname, '..', 'screenshots', '19-sandbox-cash.png') });

  const real = errors.filter(e => !/favicon|manifest|sw\.js|Service worker|Failed to load resource|insecure|SecurityError|localStorage/i.test(e));
  console.log('errors:', real.length ? real.slice(0, 5) : 'нет');
  await browser.close();
  process.exit(real.length ? 1 : 0);
})();
