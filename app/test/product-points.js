/**
 * Товар без точки: новая позиция не попадает ни в кассу, ни на склад,
 * пока администратор не назначит точки. Старые товары мигрируют на все точки.
 */
const puppeteer = require('puppeteer');
const path = require('path');

const BASE = process.env.POS_BASE || 'http://127.0.0.1:8099';
const SHOTS = path.join(__dirname, '..', 'screenshots');
const results = [];
function ok(name, cond, extra) { results.push(cond); console.log(cond ? '  ✓' : '  ✗', name, extra ? '— ' + extra : ''); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 950 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.goto(BASE + '/index.html', { waitUntil: 'networkidle0' });
  await sleep(400);

  await page.evaluate(async () => {
    const admin = await createUser({ fullName: 'Владелец', username: 'owner2', password: 'owner123' }, { autoRole: true });
    setSession(admin.id);
    await loadDemoData(admin);
  });
  await page.reload({ waitUntil: 'networkidle0' });
  await sleep(700);

  // ---------- 1. Миграция старых товаров ----------
  const legacy = await page.evaluate(() => {
    const a = DB.points[0].id, b = DB.points[1].id;
    const old = { id: 'prod-legacy', name: 'Старый товар', price: 1000, categoryId: DB.categories[0].id, photo: null, createdAt: Date.now() - 9999 };
    DB.products.push(old);
    DB.settings.productsAssignedOnce = false;
    migrateUnassignedProducts();
    return {
      ids: old.pointIds.slice().sort(),
      expected: [a, b].sort(),
      flag: DB.settings.productsAssignedOnce
    };
  });
  ok('старый товар без точек перенесён на все точки', JSON.stringify(legacy.ids) === JSON.stringify(legacy.expected) && legacy.flag, legacy.ids.join(','));

  // ---------- 2. Новый товар без точки ----------
  await page.evaluate(() => { location.hash = '#/products'; });
  await sleep(800);
  await page.evaluate(() => document.querySelector('#addProduct').click());
  await sleep(500);
  await page.type('#prName', 'Тестовый без точки');
  await page.evaluate(() => {
    const price = document.querySelector('#prPrice');
    price.value = '1500'; price.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const checksDefault = await page.evaluate(() => Array.from(document.querySelectorAll('#prPoints input:checked')).length);
  ok('в новой карточке ни одна точка не отмечена', checksDefault === 0, 'отмечено: ' + checksDefault);

  await page.evaluate(() => document.querySelector('#prSave').click());
  await sleep(700);

  const created = await page.evaluate(() => {
    const p = DB.products.find(x => x.name === 'Тестовый без точки');
    return {
      exists: !!p,
      pointIds: p ? p.pointIds : null,
      visibleAnywhere: DB.points.some(pt => productsForPoint(pt.id).some(x => x.id === p.id)),
      cardBadge: (() => {
        const cards = Array.from(document.querySelectorAll('.prod-card'));
        const card = cards.find(c => /Тестовый без точки/.test(c.textContent));
        return card ? card.textContent.replace(/\s+/g, ' ').trim() : '';
      })(),
      warnBanner: /без точки/.test(document.body.textContent)
    };
  });
  ok('товар сохранён без точек', created.exists && created.pointIds.length === 0, JSON.stringify(created.pointIds));
  ok('товар не виден ни на одной точке', !created.visibleAnywhere);
  ok('в каталоге помечен «Не назначен»', /Не назначен/.test(created.cardBadge), created.cardBadge.slice(0, 70));
  ok('есть предупреждение про товары без точки', created.warnBanner);
  await page.screenshot({ path: path.join(SHOTS, '90-products-no-point.png'), fullPage: true });

  // ---------- 3. Касса не видит товар ----------
  const cash = await page.evaluate(() => {
    location.hash = '#/cash';
    return null;
  });
  await sleep(900);
  const inCash = await page.evaluate(() => {
    const p = DB.products.find(x => x.name === 'Тестовый без точки');
    return Array.from(document.querySelectorAll('#catalogGrid .product-card')).some(c => c.textContent.indexOf(p.name) !== -1);
  });
  ok('в кассе товара без точки нет', !inCash);

  // ---------- 4. Назначаем точку ----------
  await page.evaluate(() => { location.hash = '#/products'; });
  await sleep(800);
  await page.evaluate(() => {
    const a = DB.points[1].id;
    const card = Array.from(document.querySelectorAll('.prod-card')).find(c => /Тестовый без точки/.test(c.textContent));
    card.querySelector('[data-edit]').click();
    setTimeout(() => {
      const box = document.querySelector('#prPoints input[value="' + a + '"]');
      box.checked = true;
      box.dispatchEvent(new Event('change', { bubbles: true }));
    }, 350);
  });
  await sleep(900);
  await page.evaluate(() => document.querySelector('#prSave').click());
  await sleep(700);

  const assigned = await page.evaluate(() => {
    const p = DB.products.find(x => x.name === 'Тестовый без точки');
    return {
      pointIds: p.pointIds,
      onlySecond: p.pointIds.length === 1 && p.pointIds[0] === DB.points[1].id,
      onFirst: productsForPoint(DB.points[0].id).some(x => x.id === p.id),
      onSecond: productsForPoint(DB.points[1].id).some(x => x.id === p.id)
    };
  });
  ok('после назначения товар только на выбранной точке', assigned.onlySecond && !assigned.onFirst && assigned.onSecond, JSON.stringify(assigned.pointIds));

  // ---------- 5. Остальные товары не затронуты ----------
  const others = await page.evaluate(() => ({
    first: productsForPoint(DB.points[0].id).length,
    second: productsForPoint(DB.points[1].id).length
  }));
  ok('каталог остальных товаров сохранился', others.first > 0 && others.second > 0, JSON.stringify(others));

  ok('нет JS-ошибок', errors.length === 0, errors.slice(0, 2).join(' | '));

  await browser.close();
  const failed = results.filter(r => !r).length;
  console.log('\n=== Итог: ' + (results.length - failed) + ' успешно, ' + failed + ' с ошибками ===');
  if (failed) process.exit(1);
})();
