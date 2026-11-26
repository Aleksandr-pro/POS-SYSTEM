const puppeteer = require('puppeteer');
const path = require('path');
(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  // desktop
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto('http://127.0.0.1:8099/index.html', { waitUntil: 'networkidle0' });
  await page.evaluate(async () => {
    localStorage.clear();
    const u = await createUser({ fullName: 'Юлия Иванова', username: 'yulia', password: 'secret123' }, { autoRole: true });
    setSession(u.id); await loadDemoData(u); setThemePreference('dark');
  });
  await page.reload({ waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 500));
  for (const r of ['cash', 'analytics', 'settings', 'help']) {
    await page.evaluate(x => { location.hash = '#/' + x; }, r);
    await new Promise(res => setTimeout(res, 700));
    await page.screenshot({ path: path.join(__dirname, '..', 'screenshots', `31-dark-${r}.png`), fullPage: false });
  }
  // mobile
  const mobile = await browser.newPage();
  await mobile.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await mobile.goto('http://127.0.0.1:8099/index.html', { waitUntil: 'networkidle0' });
  await mobile.evaluate(() => { location.hash = '#/cash'; });
  await new Promise(r => setTimeout(r, 900));
  await mobile.screenshot({ path: path.join(__dirname, '..', 'screenshots', '33-dark-mobile-cash.png'), fullPage: true });
  await mobile.evaluate(() => { location.hash = '#/dashboard'; });
  await new Promise(r => setTimeout(r, 900));
  await mobile.screenshot({ path: path.join(__dirname, '..', 'screenshots', '34-dark-mobile-dashboard.png'), fullPage: true });
  // light for comparison
  await page.evaluate(() => { setThemePreference('light'); location.hash = '#/cash'; });
  await new Promise(r => setTimeout(r, 800));
  await page.screenshot({ path: path.join(__dirname, '..', 'screenshots', '35-light-cash.png') });
  console.log('screenshots updated');
  await browser.close();
})();
