const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 860 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto('file:///home/user/pos-app/dist/index.html', { waitUntil: 'load' });
  await new Promise(r => setTimeout(r, 800));
  console.log('login rendered:', !!await page.$('#loginForm'));
  await page.evaluate(async () => {
    const u = await createUser({ fullName: 'Файл Тест', username: 'filetest', password: '123456' }, { autoRole: true });
    setSession(u.id); await loadDemoData(u);
  });
  await new Promise(r => setTimeout(r, 400));
  await page.evaluate(() => { location.hash = '#/dashboard'; });
  await new Promise(r => setTimeout(r, 900));
  console.log('dashboard:', !!await page.$('#dashChart'));
  // экспорт из file://
  const client = await page.target().createCDPSession();
  const fs = require('fs');
  fs.rmSync('/tmp/dl2', { recursive: true, force: true });
  fs.mkdirSync('/tmp/dl2', { recursive: true });
  await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: '/tmp/dl2' });
  await page.click('#dashExport');
  await new Promise(r => setTimeout(r, 1500));
  console.log('xlsx from file://:', fs.readdirSync('/tmp/dl2'));
  console.log('errors:', errors.filter(e => !/manifest|favicon/i.test(e)));
  await browser.close();
})();
