const puppeteer = require('puppeteer');
const { installDayClock } = require('./test/helpers/clock');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const p = await b.newPage();
  await installDayClock(p);
  await p.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1');
  await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await p.goto('http://127.0.0.1:8099/index.html', { waitUntil: 'networkidle2' });
  await sleep(500);
  await p.evaluate(async () => {
    const a = await createUser({ fullName: 'Владелец', username: 'iosg1', password: 'iosg1234' }, { autoRole: true });
    setSession(a.id); location.hash = '#/dashboard';
  });
  await sleep(1500);
  await p.evaluate(() => { const h = document.querySelector('.ios-install'); if (h) h.remove(); });
  await p.screenshot({ path: 'screenshots/119-ios-bar.png' });
  await p.evaluate(() => document.querySelector('#iosGetBtn').click());
  await sleep(700);
  await p.screenshot({ path: 'screenshots/120-ios-guide.png' });
  await b.close();
})();
