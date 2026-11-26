/* Проверка: компьютерная версия интерфейса */
const puppeteer = require('puppeteer');
const { installDayClock } = require('./helpers/clock');

const BASE = process.env.BASE || 'http://127.0.0.1:8099';
let passed = 0, failed = 0;
const ok = (n, c, e) => { if (c) { passed++; console.log('  ✓ ' + n + (e ? ' — ' + e : '')); } else { failed++; console.log('  ✗ ' + n + (e ? ' — ' + e : '')); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function seed(page) {
  await page.evaluate(async () => {
    const now = Date.now();
    const admin = await createUser({ fullName: 'Владелец Сети', username: 'desk1', password: 'desk1234' }, { autoRole: true });
    setSession(admin.id);
    if (!DB.points.length) {
      ['Керуен', 'Sky', 'My Kids'].forEach((n) => DB.points.push({ id: uid(), name: n, address: 'Актобе', createdAt: now, updatedAt: now }));
    }
    for (let i = 0; i < 6; i++) {
      DB.products.push({ id: uid(), name: 'Товар ' + i, price: 1000 + i * 100, cost: 500, categoryId: null, photo: null, pointIds: [], createdAt: now, updatedAt: now });
    }
    saveDB();
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
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  try {
    console.log('\n=== Компьютерная версия ===');
    await page.setViewport({ width: 1600, height: 1000 });
    await page.goto(BASE + '/index.html', { waitUntil: 'networkidle0' });
    await sleep(400);
    await seed(page);

    const desk = await page.evaluate(() => {
      const sb = document.querySelector('.sidebar');
      const main = document.querySelector('.main');
      const search = document.querySelector('#globalSearch');
      const collapse = document.querySelector('#sideCollapse');
      const fab = document.querySelector('.fab, .fab-inline');
      const head = document.querySelector('.page-head') || document.querySelector('.greet');
      return {
        sidebarVisible: sb && sb.getBoundingClientRect().width > 200,
        mainLeft: main ? Math.round(main.getBoundingClientRect().left) : -1,
        search: search ? getComputedStyle(search).display : 'none',
        collapse: collapse ? getComputedStyle(collapse).display : 'none',
        fabInline: fab ? fab.classList.contains('fab-inline') : false,
        fabInHead: fab && head ? head.contains(fab) : false,
        bottomnav: getComputedStyle(document.querySelector('.bottomnav')).display,
        pageMax: (function () { const p = document.querySelector('.page'); return p ? Math.round(p.getBoundingClientRect().width) : 0; })()
      };
    });
    ok('сайдбар развёрнут', desk.sidebarVisible === true);
    ok('контент сдвинут под меню', desk.mainLeft >= 260, String(desk.mainLeft));
    ok('поиск в шапке виден', desk.search !== 'none', desk.search);
    ok('кнопка сворачивания видна', desk.collapse !== 'none', desk.collapse);
    ok('экспорт переехал в шапку страницы', desk.fabInline && desk.fabInHead, 'inline=' + desk.fabInline + ' в шапке=' + desk.fabInHead);
    ok('нижнее меню скрыто', desk.bottomnav === 'none', desk.bottomnav);
    ok('страница заполняет ширину', desk.pageMax >= 1300, String(desk.pageMax));

    // сворачивание
    await page.evaluate(() => document.querySelector('#sideCollapse').click());
    await sleep(400);
    const collapsed = await page.evaluate(() => ({
      cls: document.body.classList.contains('side-collapsed'),
      sideW: Math.round(document.querySelector('.sidebar').getBoundingClientRect().width),
      mainLeft: Math.round(document.querySelector('.main').getBoundingClientRect().left),
      labelsHidden: getComputedStyle(document.querySelector('.side-item > span')).display === 'none',
      pageMax: Math.round(document.querySelector('.page').getBoundingClientRect().width)
    }));
    ok('сайдбар свернулся до иконок', collapsed.cls && collapsed.sideW < 90, collapsed.sideW + 'px');
    ok('контент занял место', collapsed.mainLeft < 90 && collapsed.pageMax > desk.pageMax, collapsed.pageMax + 'px');
    ok('подписи скрыты', collapsed.labelsHidden === true);

    // состояние сохраняется после перезагрузки
    await page.reload({ waitUntil: 'networkidle0' });
    await sleep(900);
    const persisted = await page.evaluate(() => document.body.classList.contains('side-collapsed'));
    ok('свёрнутость запомнилась', persisted === true);
    await page.evaluate(() => { if (document.body.classList.contains('side-collapsed')) document.querySelector('#sideCollapse').click(); });
    await sleep(300);

    // Ctrl+K
    await page.keyboard.down('Control'); await page.keyboard.press('KeyK'); await page.keyboard.up('Control');
    await sleep(500);
    const palette = await page.evaluate(() => ({
      open: !!document.querySelector('.cmdk-overlay'),
      groups: Array.from(document.querySelectorAll('.cmdk-group')).map((x) => x.textContent.trim()),
      items: document.querySelectorAll('.cmdk-item').length,
      subVisible: (function () { const s = document.querySelector('.cmdk-item .sub'); return s ? s.getBoundingClientRect().height > 8 : false; })()
    }));
    ok('Ctrl+K открывает поиск', palette.open === true);
    ok('есть разделы, товары, точки', palette.groups.join(',').indexOf('РАЗДЕЛЫ') !== -1 || palette.groups.join(',').indexOf('Разделы') !== -1, palette.groups.join(' / '));
    ok('подпись под названием видна', palette.subVisible === true);

    await page.type('#cmdkInput', 'склад');
    await sleep(350);
    const filtered = await page.evaluate(() => Array.from(document.querySelectorAll('.cmdk-item .nm')).map((x) => x.textContent.trim()));
    ok('поиск фильтрует', filtered.indexOf('Склад') !== -1, filtered.slice(0, 4).join(', '));

    await page.keyboard.press('Enter');
    await sleep(900);
    ok('Enter открывает раздел', await page.evaluate(() => location.hash === '#/stock'), await page.evaluate(() => location.hash));

    // Ctrl+B сворачивает
    await page.keyboard.down('Control'); await page.keyboard.press('KeyB'); await page.keyboard.up('Control');
    await sleep(300);
    ok('Ctrl+B сворачивает меню', await page.evaluate(() => document.body.classList.contains('side-collapsed')));
    await page.keyboard.down('Control'); await page.keyboard.press('KeyB'); await page.keyboard.up('Control');
    await sleep(300);

    // Alt+1..9
    await page.keyboard.down('Alt'); await page.keyboard.press('Digit3'); await page.keyboard.up('Alt');
    await sleep(700);
    ok('Alt+3 ведёт в «Товары»', await page.evaluate(() => location.hash === '#/products'), await page.evaluate(() => location.hash));

    // таблицы со «залипающей» шапкой
    await page.evaluate(() => location.hash = '#/stock');
    await sleep(1100);
    const sticky = await page.evaluate(() => {
      const th = document.querySelector('.tbl thead th');
      return th ? getComputedStyle(th).position : 'none';
    });
    ok('шапка таблицы закреплена', sticky === 'sticky', sticky);

    // мобильная версия не сломалась
    await page.setViewport({ width: 390, height: 844, isMobile: true });
    await sleep(700);
    await page.evaluate(() => location.hash = '#/dashboard');
    await sleep(1200);
    const mobile = await page.evaluate(() => ({
      side: getComputedStyle(document.querySelector('.sidebar')).transform,
      bottom: getComputedStyle(document.querySelector('.bottomnav')).display,
      search: getComputedStyle(document.querySelector('#globalSearch')).display,
      fabInline: (function () { const f = document.querySelector('.fab'); return f ? f.classList.contains('fab-inline') : null; })(),
      fabFixed: (function () { const f = document.querySelector('.fab'); return f ? getComputedStyle(f).position : 'none'; })()
    }));
    ok('на телефоне меню выехало за экран', /matrix/.test(mobile.side), mobile.side);
    ok('на телефоне нижнее меню вернулось', mobile.bottom === 'flex', mobile.bottom);
    ok('на телефоне поиска в шапке нет', mobile.search === 'none', mobile.search);
    ok('на телефоне экспорт снова круглая кнопка', mobile.fabInline === false && mobile.fabFixed === 'fixed', mobile.fabInline + ' / ' + mobile.fabFixed);
    await page.evaluate(() => document.querySelector('#menuBtn').click());
    await sleep(500);
    ok('на телефоне боковое меню открывается', await page.evaluate(() => document.querySelector('.sidebar').classList.contains('open')));
    ok('нет JS-ошибок', errors.length === 0, errors.slice(0, 3).join(' | ') || 'чисто');
  } catch (e) {
    failed++;
    console.log('  ✗ исключение: ' + e.message);
  } finally {
    await browser.close();
    console.log('\n=== Итог: ' + passed + ' успешно, ' + failed + ' с ошибками ===');
    process.exit(failed ? 1 : 0);
  }
})();
