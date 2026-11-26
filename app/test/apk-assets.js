const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 412, height: 892, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  // Мок нативного моста AndroidPos (как в APK)
  await page.evaluateOnNewDocument(() => {
    window.__exported = [];
    window.__themeCalls = [];
    window.AndroidPos = {
      exportFile: function (name, base64, mime) { window.__exported.push({ name: name, size: base64.length, mime: mime }); return true; },
      setTheme: function (t) { window.__themeCalls.push(t); },
      getVersion: function () { return '2.3.0'; },
      toast: function (m) { window.__toasts = window.__toasts || []; window.__toasts.push(m); }
    };
  });

  await page.goto('http://127.0.0.1:8098/index.html', { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 600));
  console.log('1. экран входа из APK-ассетов:', !!await page.$('#loginForm'));

  // первый запуск: кнопки демо нет, регистрация создаёт администратора
  const demoBtn = await page.$('#startDemo');
  console.log('2a. кнопка демо отсутствует:', demoBtn === null);

  await page.evaluate(async () => {
    const u = await createUser({ fullName: 'Тест Админ', username: 'testadmin', password: 'test1234' }, { autoRole: true });
    setSession(u.id);
    await loadDemoData(u);
  });
  await page.reload({ waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 900));
  const afterDemo = await page.evaluate(() => ({ hash: location.hash, sales: DB.sales.length, user: currentUser() && currentUser().username }));
  console.log('2b. тестовые данные:', JSON.stringify(afterDemo));

  // тёмная тема → мост получил вызов setTheme
  await page.evaluate(() => setThemePreference('dark'));
  await new Promise(r => setTimeout(r, 300));
  const themeCalls = await page.evaluate(() => window.__themeCalls);
  console.log('3. мост темы:', JSON.stringify(themeCalls), '| data-theme:', await page.evaluate(() => document.documentElement.getAttribute('data-theme')));

  // экспорт Excel через нативный мост
  await page.evaluate(() => { location.hash = '#/analytics'; });
  await new Promise(r => setTimeout(r, 900));
  await page.click('#anExport');
  await new Promise(r => setTimeout(r, 1200));
  const exported = await page.evaluate(() => window.__exported);
  console.log('4. экспорт через мост:', JSON.stringify(exported));

  // продажа
  await page.evaluate(() => { location.hash = '#/cash'; });
  await new Promise(r => setTimeout(r, 900));
  await page.click('#catalogGrid .product-card:nth-child(1)');
  await new Promise(r => setTimeout(r, 300));
  const before = await page.evaluate(() => DB.sales.length);
  await page.click('#checkoutBtn');
  await new Promise(r => setTimeout(r, 900));
  const after = await page.evaluate(() => DB.sales.length);
  console.log('5. продажа:', before, '→', after, after === before + 1 ? 'OK' : 'FAIL');
  await page.screenshot({ path: path.join(__dirname, '..', 'screenshots', '40-apk-assets-cash-dark.png') });

  // проверка что в APK-версии нет service worker
  const noSw = await page.evaluate(() => !navigator.serviceWorker || !navigator.serviceWorker.controller);
  console.log('6. service worker не используется:', noSw);

  const real = errors.filter(e => !/favicon|manifest|sw\.js|Service worker|Failed to load resource/i.test(e));
  console.log('ошибки JS:', real.length ? real.slice(0, 5) : 'нет');
  await browser.close();
  process.exit(real.length ? 1 : 0);
})();
