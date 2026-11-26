/* Проверка: мастер установки на iPhone, рамка браузера, скрытие в приложении */
const puppeteer = require('puppeteer');
const { installDayClock } = require('./helpers/clock');

const BASE = process.env.BASE || 'http://127.0.0.1:8099';
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36';

let passed = 0, failed = 0;
const ok = (n, c, e) => { if (c) { passed++; console.log('  ✓ ' + n + (e ? ' — ' + e : '')); } else { failed++; console.log('  ✗ ' + n + (e ? ' — ' + e : '')); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function openAs(page, ua, viewport) {
  await page.setUserAgent(ua);
  await page.setViewport(viewport);
  await page.goto(BASE + '/index.html', { waitUntil: 'networkidle2' });
  await sleep(500);
  await page.evaluate(async () => {
    const a = await createUser({ fullName: 'Владелец', username: 'iosg' + Math.floor(Math.random() * 9999), password: 'iosg1234' }, { autoRole: true });
    setSession(a.id);
    location.hash = '#/dashboard';
  });
  await sleep(1300);
}

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage();
  await installDayClock(page);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  try {
    console.log('\n=== Мастер установки на iPhone ===');
    await openAs(page, IPHONE_UA, { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

    const inBrowser = await page.evaluate(() => ({
      bar: !!document.getElementById('iosBar'),
      btn: !!document.getElementById('iosGetBtn'),
      barText: (document.getElementById('iosBar') || {}).innerText || ''
    }));
    ok('в Safari видна подсказка о браузере', inBrowser.bar === true, inBrowser.barText.replace(/\s+/g, ' ').slice(0, 60));
    ok('кнопка «Установить» в шапке', inBrowser.btn === true);

    await page.evaluate(() => document.getElementById('iosGetBtn').click());
    await sleep(500);
    const guide = await page.evaluate(() => {
      const m = document.querySelector('.modal');
      return {
        open: !!m,
        title: m ? m.querySelector('h2').textContent : '',
        steps: document.querySelectorAll('.ios-step').length,
        hasAddress: !!(document.querySelector('#iosAddr') || {}).value,
        hasCopy: !!document.querySelector('#iosCopy')
      };
    });
    ok('мастер открылся', guide.open === true, guide.title);
    ok('четыре шага', guide.steps === 4, String(guide.steps));
    ok('есть адрес для копирования', guide.hasAddress === true);
    ok('есть кнопка «Копировать»', guide.hasCopy === true);

    await page.evaluate(() => { const c = document.querySelector('#iosCopy'); if (c) c.click(); });
    await sleep(300);
    const copied = await page.evaluate(() => (document.querySelector('.toast') || {}).textContent || '');
    ok('копирование даёт подтверждение', /скопир/i.test(copied), copied);

    // закрытие рамки
    await page.evaluate(() => { const x = document.querySelector('.modal [data-close]'); if (x) x.click(); });
    await sleep(400);
    await page.evaluate(() => { const x = document.querySelector('#iosBarX'); if (x) x.click(); });
    await sleep(300);
    ok('рамку браузера можно скрыть', await page.evaluate(() => !document.getElementById('iosBar')));

    // в установленном приложении (standalone) ничего лишнего
    const page2 = await browser.newPage();
    await installDayClock(page2);
    await page2.evaluateOnNewDocument(() => { window.navigator.standalone = true; });
    await openAs(page2, IPHONE_UA, { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const standalone = await page2.evaluate(() => ({
      bar: !!document.getElementById('iosBar'),
      btn: !!document.getElementById('iosGetBtn'),
      hint: !!document.querySelector('.ios-install')
    }));
    ok('в приложении с Домой нет рамки', standalone.bar === false);
    ok('в приложении нет кнопки «Установить»', standalone.btn === false);
    ok('в приложении нет всплывающей подсказки', standalone.hint === false);
    await page2.close();

    // Android: мастер есть, но предупреждает
    const page3 = await browser.newPage();
    await installDayClock(page3);
    await openAs(page3, ANDROID_UA, { width: 412, height: 915, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const android = await page3.evaluate(() => ({
      bar: !!document.getElementById('iosBar'),
      btn: !!document.getElementById('iosGetBtn'),
      hint: !!document.querySelector('.ios-install')
    }));
    ok('на Android нет iOS-рамки', android.bar === false);
    ok('на Android нет кнопки установки для iPhone', android.btn === false);
    ok('на Android нет iOS-подсказки', android.hint === false);
    await page3.close();

    // компьютер
    const page4 = await browser.newPage();
    await installDayClock(page4);
    await page4.setViewport({ width: 1600, height: 1000 });
    await page4.goto(BASE + '/index.html', { waitUntil: 'networkidle2' });
    await sleep(1200);
    ok('на компьютере ничего лишнего', await page4.evaluate(() => !document.getElementById('iosGetBtn') && !document.querySelector('.ios-install')));
    await page4.close();

    ok('нет JS-ошибок', errors.length === 0, errors.slice(0, 2).join(' | ') || 'чисто');
  } catch (e) {
    failed++;
    console.log('  ✗ исключение: ' + e.message);
  } finally {
    await browser.close();
    console.log('\n=== Итог: ' + passed + ' успешно, ' + failed + ' с ошибками ===');
    process.exit(failed ? 1 : 0);
  }
})();
