const puppeteer = require('puppeteer');
const path = require('path');
(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://127.0.0.1:8098/index.html', { waitUntil: 'networkidle0' });
  await page.evaluate(async () => {
    localStorage.clear();
    const u = await createUser({ fullName: 'Юлия', username: 'yulia', password: 'secret123' }, { autoRole: true });
    setSession(u.id); await loadDemoData(u); setThemePreference('dark');
  });
  await page.reload({ waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 700));
  await page.evaluate(() => { location.hash = '#/cash'; });
  await new Promise(r => setTimeout(r, 800));
  await page.click('#catalogGrid .product-card:nth-child(1)');
  await new Promise(r => setTimeout(r, 250));
  await page.click('#catalogGrid .product-card:nth-child(2)');
  await new Promise(r => setTimeout(r, 350));
  // прокручиваем к корзине
  await page.evaluate(() => document.querySelector('#cartPanel').scrollIntoView({ block: 'start' }));
  await new Promise(r => setTimeout(r, 400));
  await page.screenshot({ path: path.join(__dirname, '..', 'screenshots', '41-mobile-cart-dark.png') });
  await page.click('#checkoutBtn');
  await new Promise(r => setTimeout(r, 900));
  const modal = await page.$('.modal');
  const info = await page.evaluate(() => {
    const m = document.querySelector('.modal');
    if (!m) return null;
    const r = m.getBoundingClientRect();
    const foot = m.querySelector('.modal-foot');
    const fr = foot ? foot.getBoundingClientRect() : null;
    return {
      modal: { top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height) },
      viewportH: window.innerHeight,
      footerVisible: fr ? fr.bottom <= window.innerHeight + 1 : null,
      bodyOverflow: getComputedStyle(document.querySelector('.modal-body')).overflowY,
      btnVisible: !!m.querySelector('[data-close-sale]') && m.querySelector('[data-close-sale]').getBoundingClientRect().bottom <= window.innerHeight + 1
    };
  });
  console.log('модалка на телефоне:', JSON.stringify(info));
  await page.screenshot({ path: path.join(__dirname, '..', 'screenshots', '42-mobile-sale-modal-dark.png') });
  console.log('ошибки:', errors.filter(e => !/favicon|Service/i.test(e)));
  await browser.close();
})();
