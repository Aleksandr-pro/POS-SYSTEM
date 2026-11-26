const puppeteer = require('puppeteer');
const path = require('path');
(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.goto('http://127.0.0.1:8099/index.html', { waitUntil: 'networkidle0' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 500));

  // 1. Переключение темы на экране входа
  const startTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  await page.click('#authTheme');
  await new Promise(r => setTimeout(r, 350));
  const afterToggle = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  console.log('тема на входе:', startTheme, '→', afterToggle);
  await page.screenshot({ path: path.join(__dirname, '..', 'screenshots', '30-login-dark.png') });

  // 2. Регистрация в тёмной теме + демо
  await page.evaluate(async () => {
    const u = await createUser({ fullName: 'Юлия Иванова', username: 'yulia', password: 'secret123' }, { autoRole: true });
    setSession(u.id);
    await loadDemoData(u);
  });
  await page.reload({ waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 800));

  const themeAfterReload = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  console.log('тема после перезагрузки:', themeAfterReload);

  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  console.log('фон body:', bg);

  const routes = ['dashboard', 'cash', 'products', 'stock', 'points', 'time', 'analytics', 'help', 'settings'];
  for (const r of routes) {
    await page.evaluate(x => { location.hash = '#/' + x; }, r);
    await new Promise(r => setTimeout(r, 700));
    await page.screenshot({ path: path.join(__dirname, '..', 'screenshots', `31-dark-${r}.png`), fullPage: false });
  }

  // 3. Светлые элементы не остались?
  const audit = await page.evaluate(() => {
    const bad = [];
    document.querySelectorAll('.card, .modal, .input, .btn-secondary, .sidebar, .topbar, .bottomnav').forEach(el => {
      const c = getComputedStyle(el).backgroundColor;
      if (c === 'rgb(255, 255, 255)' || c === 'rgb(244, 245, 250)') {
        bad.push((el.className || el.tagName) + ' → ' + c);
      }
    });
    return bad.slice(0, 12);
  });
  console.log('светлые пятна в тёмной теме:', audit.length ? audit : 'нет');

  // 4. Настройки: выбрать светлую → тёмную → системную
  await page.evaluate(() => { location.hash = '#/settings'; });
  await new Promise(r => setTimeout(r, 700));
  for (const mode of ['light', 'dark', 'system']) {
    await page.click(`[data-theme-option="${mode}"]`);
    await new Promise(r => setTimeout(r, 250));
    const state = await page.evaluate(() => ({
      attr: document.documentElement.getAttribute('data-theme'),
      pref: themePreference(),
      stored: localStorage.getItem('poskontrol_theme'),
      db: DB.settings.theme
    }));
    console.log('режим', mode, '→', JSON.stringify(state));
  }
  await page.screenshot({ path: path.join(__dirname, '..', 'screenshots', '32-dark-settings.png'), fullPage: true });

  // 5. Мобильный вид в тёмной теме
  const mobile = await browser.newPage();
  await mobile.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await mobile.goto('http://127.0.0.1:8099/index.html', { waitUntil: 'networkidle0' });
  await mobile.evaluate(async () => {
    const u = await loginUser('yulia', 'secret123');
    setThemePreference('dark');
    location.hash = '#/cash';
  });
  await new Promise(r => setTimeout(r, 900));
  await mobile.screenshot({ path: path.join(__dirname, '..', 'screenshots', '33-dark-mobile-cash.png'), fullPage: true });

  const real = errors.filter(e => !/favicon|manifest|sw\.js|Service worker|Failed to load resource/i.test(e));
  console.log('ошибки JS:', real.length ? real.slice(0, 6) : 'нет');
  await browser.close();
  process.exit(real.length ? 1 : 0);
})();
