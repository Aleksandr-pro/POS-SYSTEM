/* Проверка готовой iOS-сборки: файлы, мета, офлайн, safe-area */
const puppeteer = require('puppeteer');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'ios-build');
const PORT = 8123;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };

let passed = 0, failed = 0;
const ok = (n, c, e) => { if (c) { passed++; console.log('  ✓ ' + n + (e ? ' — ' + e : '')); } else { failed++; console.log('  ✗ ' + n + (e ? ' — ' + e : '')); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

(async () => {
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1');
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  try {
    console.log('\n=== Готовая iOS-сборка (ios-build) ===');
    const files = fs.readdirSync(ROOT);
    ['index.html', 'manifest.json', 'sw.js', 'styles.css', 'icons/apple-touch-icon.png', '_headers'].forEach((f) => {
      ok('файл ' + f, fs.existsSync(path.join(ROOT, f)));
    });
    ok('всего файлов в сборке', files.length >= 20, String(files.length));
    const zip = fs.existsSync('/home/user/POS-Kontrol-3.4.12-iOS.zip');
    ok('архив для загрузки собран', zip);

    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle2' });
    await sleep(700);
    const info = await page.evaluate(() => ({
      version: (typeof APP_CONFIG !== 'undefined') ? APP_CONFIG.version : null,
      login: !!document.querySelector('.auth-card, .auth-panel, form'),
      icon: (document.querySelector('link[rel="apple-touch-icon"]') || {}).getAttribute ? document.querySelector('link[rel="apple-touch-icon"]').getAttribute('href') : ''
    }));
    ok('версия 3.4.12', info.version === '3.4.12', String(info.version));
    ok('экран входа открылся', info.login === true);
    ok('иконка iOS подключена', /apple-touch-icon/.test(info.icon), info.icon);

    const sw = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) return { ok: false };
      await navigator.serviceWorker.ready;
      const names = await caches.keys();
      let n = 0;
      for (const name of names) n += (await (await caches.open(name)).keys()).length;
      return { ok: true, names, n };
    });
    ok('service worker активен', sw.ok === true);
    ok('офлайн-кеш заполнен', sw.n >= 20, sw.n + ' файлов');

    await page.setOfflineMode(true);
    await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
    await sleep(1400);
    const off = await page.evaluate(() => !!document.querySelector('.auth-card, .auth-panel, form'));
    ok('без интернета приложение открывается', off === true);
    await page.setOfflineMode(false);
    ok('нет JS-ошибок', errors.length === 0, errors.slice(0, 2).join(' | ') || 'чисто');
  } catch (e) {
    failed++;
    console.log('  ✗ исключение: ' + e.message);
  } finally {
    await browser.close();
    server.close();
    console.log('\n=== Итог: ' + passed + ' успешно, ' + failed + ' с ошибками ===');
    process.exit(failed ? 1 : 0);
  }
})();
