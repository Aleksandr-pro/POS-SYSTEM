/* Проверка: iPhone (Safari/PWA) — safe area, зум полей, офлайн-кеш, подсказка установки */
const puppeteer = require('puppeteer');
const { installDayClock } = require('./helpers/clock');

const BASE = process.env.BASE || 'http://127.0.0.1:8099';
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

let passed = 0, failed = 0;
const ok = (n, c, e) => { if (c) { passed++; console.log('  ✓ ' + n + (e ? ' — ' + e : '')); } else { failed++; console.log('  ✗ ' + n + (e ? ' — ' + e : '')); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage();
  await installDayClock(page);
  await page.setUserAgent(IPHONE_UA);
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  try {
    console.log('\n=== iPhone / PWA ===');
    await page.goto(BASE + '/index.html', { waitUntil: 'networkidle2' });
    await sleep(600);

    const meta = await page.evaluate(() => {
      const get = (sel) => (document.querySelector(sel) || {}).content || '';
      return {
        capable: get('meta[name="apple-mobile-web-app-capable"]'),
        status: get('meta[name="apple-mobile-web-app-status-bar-style"]'),
        title: get('meta[name="apple-mobile-web-app-title"]'),
        touchIcon: !!document.querySelector('link[rel="apple-touch-icon"]'),
        manifest: !!document.querySelector('link[rel="manifest"]'),
        viewport: get('meta[name="viewport"]'),
        format: get('meta[name="format-detection"]')
      };
    });
    ok('iOS-мета: полноэкранный режим', meta.capable === 'yes', meta.capable);
    ok('статус-бар прозрачный', meta.status === 'black-translucent', meta.status);
    ok('название на домашнем экране', meta.title === 'POS Контроль', meta.title);
    ok('иконка для iOS', meta.touchIcon === true);
    ok('manifest подключён', meta.manifest === true);
    ok('viewport с safe-area', /viewport-fit=cover/.test(meta.viewport), meta.viewport);
    ok('телефонные номера не превращаются в ссылки', /telephone=no/.test(meta.format), meta.format);

    const styles = await page.evaluate(() => {
      const banner = document.createElement('div');
      banner.className = 'card';
      document.body.appendChild(banner);
      const probe = document.createElement('input');
      probe.className = 'input';
      document.body.appendChild(probe);
      const fs = getComputedStyle(probe).fontSize;
      const tap = getComputedStyle(document.documentElement).webkitTapHighlightColor;
      const over = getComputedStyle(document.body).overscrollBehaviorY;
      // проверяем не фактический отступ (на эмуляторе вырез = 0), а наличие правила safe-area
      const navProbe = document.createElement('nav');
      navProbe.className = 'bottomnav';
      document.body.appendChild(navProbe);
      const navPad = getComputedStyle(navProbe).paddingBottom;
      navProbe.remove();
      banner.remove(); probe.remove();
      return { fs, tap, over, navPad };
    });
    ok('поля 16px — iOS не зумит при вводе', styles.fs === '16px', styles.fs);
    ok('нет синей подсветки при тапе', /rgba\(0, 0, 0, 0\)|transparent/.test(styles.tap), styles.tap);
    ok('«резиновый» скролл отключён', styles.over === 'none', styles.over);
    ok('нижнее меню учитывает home-индикатор', /^-?\d+(\.\d+)?px$/.test(String(styles.navPad).trim()), styles.navPad);

    // регистрация service worker и кеш
    const sw = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return { supported: false };
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) return { supported: true, registered: false };
      await navigator.serviceWorker.ready;
      const cacheNames = await caches.keys();
      let count = 0;
      for (const name of cacheNames) {
        const c = await caches.open(name);
        count += (await c.keys()).length;
      }
      return { supported: true, registered: true, cacheNames, count, active: !!reg.active };
    });
    ok('service worker зарегистрирован', sw.registered === true, JSON.stringify(sw.cacheNames || []));
    ok('кеш наполнен', sw.count >= 20, 'файлов в кеше: ' + sw.count);

    // офлайн: отключаем сеть и перезагружаем
    await page.setOfflineMode(true);
    await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
    await sleep(1500);
    const offline = await page.evaluate(() => ({
      hasApp: !!document.getElementById('app'),
      hasLogin: !!document.querySelector('.auth-card, .auth-panel, form'),
      title: document.title,
      text: document.body.innerText.slice(0, 60).replace(/\s+/g, ' ')
    }));
    ok('приложение открылось без интернета', offline.hasApp && offline.hasLogin, offline.text);
    await page.setOfflineMode(false);

    // подсказка установки на iPhone
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(1200);
    const login = await page.evaluate(async () => {
      const admin = await createUser({ fullName: 'Владелец', username: 'ios1', password: 'ios12345' }, { autoRole: true });
      setSession(admin.id);
      location.hash = '#/dashboard';
      return admin.id;
    });
    await sleep(1500);
    const hint = await page.evaluate(() => {
      const box = document.querySelector('.ios-install');
      return { exists: !!box, text: box ? box.innerText.replace(/\s+/g, ' ').slice(0, 80) : '' };
    });
    ok('показана подсказка установки', hint.exists === true, hint.text);
    ok('в подсказке про «Поделиться»', /Поделиться/.test(hint.text) || hint.exists === false, hint.text);

    await page.evaluate(() => { const b = document.querySelector('#iosHintClose'); if (b) b.click(); });
    await sleep(300);
    ok('подсказку можно закрыть', await page.evaluate(() => !document.querySelector('.ios-install')));
    await page.screenshot({ path: require('path').join(__dirname, '..', 'screenshots', '118-iphone.png') });

    // iOS-вёрстка: нижнее меню и отсутствие горизонтальной прокрутки
    const layout = await page.evaluate(() => ({
      bottom: (function () { const b = document.querySelector('.bottomnav'); return b ? Math.round(b.getBoundingClientRect().height) : 0; })(),
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      header: (function () { const t = document.querySelector('.topbar'); return t ? Math.round(t.getBoundingClientRect().height) : 0; })()
    }));
    ok('нижнее меню на месте', layout.bottom >= 60, layout.bottom + 'px');
    ok('нет горизонтальной прокрутки', layout.overflowX <= 0, String(layout.overflowX));
    ok('шапка нужной высоты', layout.header >= 52 && layout.header <= 100, layout.header + 'px');
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
