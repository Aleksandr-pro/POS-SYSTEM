/* ============================================================
   Проверки: администратор правит любую цифру в таблице склада
   (Остаток вчера / Поставка сегодня / Продано / Конец дня),
   и все следующие цифры считаются от новых данных
   ============================================================ */
const puppeteer = require('puppeteer');
const path = require('path');

const BASE = process.env.BASE || 'http://127.0.0.1:8099';
const SHOTS = path.join(__dirname, '..', 'screenshots');

let passed = 0, failed = 0;
function ok(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name + (extra ? ' — ' + extra : '')); }
  else { failed++; console.log('  ✗ ' + name + (extra ? ' — ' + extra : '')); }
}
const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

/* ввод нового числа в ячейку колонки field */
async function editCell(page, field, value) {
  const opened = await page.evaluate(function (f) {
    const cells = Array.from(document.querySelectorAll('[data-day-edit="' + f + '"]'));
    if (!cells.length) return false;
    cells[0].click();
    return !!cells[0].querySelector('input');
  }, field);
  if (!opened) return false;
  await page.evaluate(function (v) {
    const input = document.querySelector('#dayReportTable input.qty-inline');
    input.value = String(v);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  }, value);
  await sleep(700);
  return true;
}

async function readRow(page, seed) {
  return page.evaluate(function (s) {
    const row = stockRow(s.pointId, s.productId);
    const rep = stockPeriodReport(s.pointId, dayKey(new Date()), dayKey(new Date()));
    const r = rep.rows.find(function (x) { return x.productId === s.productId; });
    return {
      qty: row ? row.qty : 0,
      yesterday: r.yesterday, supply: r.supply, adjust: r.adjust, sold: r.sold, end: r.end,
      hasAdjust: rep.hasAdjust,
      lastNote: row && row.history[0] ? row.history[0].note : null,
      lastKind: row && row.history[0] ? row.history[0].kind : null,
      lastBy: row && row.history[0] ? row.history[0].by : null,
      ths: Array.from(document.querySelectorAll('#dayReportTable thead th')).map(function (t) { return t.textContent.trim(); }),
      cells: document.querySelectorAll('[data-day-edit]').length,
      rows: document.querySelectorAll('#dayReportTable tbody tr[data-day-row]').length
    };
  }, seed);
}

(async function () {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 960 });
  const errors = [];
  page.on('pageerror', function (e) { errors.push(e.message); });
  page.on('console', function (m) { if (m.type() === 'error') errors.push(m.text()); });

  try {
    console.log('\n=== Правка таблицы склада администратором ===');
    await page.goto(BASE + '/index.html', { waitUntil: 'networkidle0' });
    await sleep(400);

    const seed = await page.evaluate(async () => {
      const admin = await createUser({ fullName: 'Владелец Сети', username: 'stockedit', password: 'stock1234' }, { autoRole: true });
      setSession(admin.id);
      const now = Date.now();
      const cat = { id: uid(), name: 'Тестовая категория', createdAt: now, updatedAt: now };
      DB.categories.push(cat);
      const point = { id: uid(), name: 'Тестовая точка', address: 'Актобе', createdAt: now, updatedAt: now };
      DB.points.push(point);
      const product = {
        id: uid(), name: 'Тестовый товар', categoryId: cat.id, price: 1000,
        pointIds: [point.id], pointId: point.id, createdAt: now, updatedAt: now
      };
      DB.products.push(product);
      const extra = {
        id: uid(), name: 'Новый товар', categoryId: cat.id, price: 500,
        pointIds: [point.id], pointId: point.id, createdAt: now, updatedAt: now
      };
      DB.products.push(extra);
      saveDB();
      const y = now - 24 * 60 * 60 * 1000;
      setStockQty(point.id, product.id, 10, 'Перенос остатка', admin, y);
      return {
        pointId: point.id, pointName: point.name,
        productId: product.id, productName: product.name, price: product.price,
        extraId: extra.id, extraName: extra.name
      };
    });
    ok('данные подготовлены', !!seed.productId, seed.pointName + ' · ' + seed.productName);

    await page.evaluate(function () { location.hash = '#/stock'; });
    await sleep(800);
    await page.evaluate(function (pid) {
      const sel = document.querySelector('#stockPagePoint');
      if (sel && sel.value !== pid) { sel.value = pid; sel.dispatchEvent(new Event('change', { bubbles: true })); }
    }, seed.pointId);
    await sleep(800);

    // ---------- 1. Все четыре колонки редактируемые ----------
    const noEdit = await page.evaluate(function () {
      document.querySelector('#dayReportSearch').value = 'Тестовый товар';
      document.querySelector('#dayReportSearch').dispatchEvent(new Event('input', { bubbles: true }));
      const tr = Array.from(document.querySelectorAll('#dayReportTable tbody tr[data-day-row]'))
        .find(function (r) { return r.textContent.indexOf('Тестовый товар') !== -1; });
      return ['yesterday', 'supply', 'sold', 'end'].map(function (f) {
        const td = tr.querySelector('[data-day-edit="' + f + '"]');
        return { field: f, editable: !!td, cur: td ? td.getAttribute('data-cur') : null };
      });
    });
    ok('все четыре колонки доступны для правки',
      noEdit.every(function (x) { return x.editable; }) && noEdit.length === 4,
      noEdit.map(function (x) { return x.field + '=' + x.cur; }).join(', '));
    ok('стартовые цифры: вчера 10, поставка 0, продано 0, конец 10',
      noEdit[0].cur === '10' && noEdit[1].cur === '0' && noEdit[2].cur === '0' && noEdit[3].cur === '10');

    // ---------- 2. Конец дня ----------
    ok('правка «Конец дня» 10 → 14', await editCell(page, 'end', 14));
    let r1 = await readRow(page, seed);
    ok('остаток на складе 14', r1.qty === 14, String(r1.qty));
    ok('появился столбец «Корректировка», +4', r1.ths.indexOf('Корректировка') !== -1 && r1.adjust === 4, String(r1.adjust));
    ok('запись в истории: правка остатка', r1.lastNote === 'Правка остатка в таблице' && r1.lastKind === 'manual', r1.lastNote);

    // ---------- 3. Остаток вчера ----------
    ok('правка «Остаток вчера» 10 → 12', await editCell(page, 'yesterday', 12));
    let r2 = await readRow(page, seed);
    ok('«Остаток вчера» стал 12', r2.yesterday === 12, String(r2.yesterday));
    ok('склад вырос до 16', r2.qty === 16, String(r2.qty));
    ok('корректировка не изменилась (+4)', r2.adjust === 4, String(r2.adjust));
    ok('история: правка остатка на начало дня', r2.lastNote === 'Правка остатка на начало дня' && r2.lastKind === 'carry-manual', r2.lastNote);

    // ---------- 4. Поставка сегодня ----------
    ok('правка «Поставка сегодня» 0 → 5', await editCell(page, 'supply', 5));
    let r3 = await readRow(page, seed);
    ok('«Поставка сегодня» = 5', r3.supply === 5, String(r3.supply));
    ok('склад вырос до 21', r3.qty === 21, String(r3.qty));
    ok('«Конец дня» = 21', r3.end === 21, String(r3.end));
    ok('история: правка поставки', r3.lastNote === 'Правка поставки в отчёте' && r3.lastKind === 'supply-manual', r3.lastNote);

    // ---------- 5. Продано ----------
    ok('правка «Продано» 0 → 3', await editCell(page, 'sold', 3));
    let r4 = await readRow(page, seed);
    ok('«Продано» = 3', r4.sold === 3, String(r4.sold));
    ok('склад уменьшился до 18', r4.qty === 18, String(r4.qty));
    ok('«Конец дня» = 18', r4.end === 18, String(r4.end));
    ok('история: правка продаж', r4.lastNote === 'Правка продаж в отчёте' && r4.lastKind === 'sold-manual', r4.lastNote);
    ok('формула: вчера + поставка + корректировка − продано = конец',
      r4.yesterday + r4.supply + r4.adjust - r4.sold === r4.end,
      r4.yesterday + ' + ' + r4.supply + ' + ' + r4.adjust + ' − ' + r4.sold + ' = ' + r4.end);
    await page.screenshot({ path: SHOTS + '/97-stock-edit-report.png', fullPage: true });

    // ---------- 6. Касса и продажи от новых данных ----------
    await page.evaluate(function () { location.hash = '#/cash'; });
    await sleep(800);
    await page.evaluate(function (pid) {
      const sel = document.querySelector('#cashPoint');
      if (sel && sel.value !== pid) { sel.value = pid; sel.dispatchEvent(new Event('change', { bubbles: true })); }
    }, seed.pointId);
    await sleep(800);
    const cash = await page.evaluate(function (s) {
      const cards = Array.from(document.querySelectorAll('#catalogGrid .product-card'));
      const card = cards.find(function (c) { return c.textContent.indexOf(s.productName) !== -1; });
      return card ? (card.querySelector('.stock') || {}).textContent : null;
    }, seed);
    ok('касса видит новый остаток 18', !!cash && cash.trim() === '18 шт', cash);

    const sale = await page.evaluate(function (s) {
      const admin = currentUser();
      const before = stockRow(s.pointId, s.productId).qty;
      createSale({
        pointId: s.pointId,
        items: [{ productId: s.productId, name: s.productName, price: s.price, qty: 3 }],
        total: s.price * 3, payment: 'cash'
      }, admin);
      const after = stockRow(s.pointId, s.productId).qty;
      const rep = stockPeriodReport(s.pointId, dayKey(new Date()), dayKey(new Date()));
      const r = rep.rows.find(function (x) { return x.productId === s.productId; });
      return {
        before: before, after: after,
        end: r.end, sold: r.sold, adjust: r.adjust,
        formulaOk: r.yesterday + r.supply + r.adjust - r.sold === r.end
      };
    }, seed);
    ok('продажа 3 шт списалась с 18 → 15', sale.before === 18 && sale.after === 15, sale.before + ' → ' + sale.after);
    ok('отчёт учёл продажу: 3 ручных + 3 продажа = 6', sale.sold === 6 && sale.end === 15 && sale.formulaOk,
      'продано ' + sale.sold + ', конец ' + sale.end + ', корректировка ' + sale.adjust);

    // ---------- 7. Товар без учёта: сначала остаток вчера ----------
    await page.evaluate(function () { location.hash = '#/stock'; });
    await sleep(800);
    await page.evaluate(function (pid) {
      const sel = document.querySelector('#stockPagePoint');
      if (sel && sel.value !== pid) { sel.value = pid; sel.dispatchEvent(new Event('change', { bubbles: true })); }
    }, seed.pointId);
    await sleep(700);
    const newRow = await page.evaluate(function (s) {
      document.querySelector('#dayReportSearch').value = s.extraName;
      document.querySelector('#dayReportSearch').dispatchEvent(new Event('input', { bubbles: true }));
      const tr = Array.from(document.querySelectorAll('#dayReportTable tbody tr[data-day-row]'))
        .find(function (r) { return r.textContent.indexOf(s.extraName) !== -1; });
      const cells = tr ? ['yesterday', 'supply', 'sold', 'end'].map(function (f) { return !!(tr.querySelector('[data-day-edit="' + f + '"]')); }) : [];
      return cells;
    }, seed);
    ok('у неучтённого товара правится только «Остаток вчера»',
      JSON.stringify(newRow) === JSON.stringify([true, false, false, false]), JSON.stringify(newRow));

    // ---------- 8. Прошлая дата не правится ----------
    const past = await page.evaluate(function () {
      const inp = document.querySelector('#stockDayDate');
      inp.value = dayKey(addDays(new Date(), -3));
      inp.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    });
    await sleep(800);
    const pastCells = await page.evaluate(function () { return document.querySelectorAll('[data-day-edit]').length; });
    ok('в отчёте за прошлую дату правки недоступны', past && pastCells === 0, 'ячеек: ' + pastCells);

    // ---------- 9. Продавец не правит ----------
    await page.evaluate(function (s) {
      return (async function () {
        const seller = await createUser({
          fullName: 'Продавец Тест', username: 'sellerstock', password: 'seller123',
          role: 'seller', pointIds: [s.pointId], pointId: s.pointId
        });
        setSession(seller.id);
        location.hash = '#/stock';
      })();
    }, seed);
    await sleep(900);
    const sellerUi = await page.evaluate(function () { return document.querySelectorAll('[data-day-edit]').length; });
    ok('продавцу правка недоступна', sellerUi === 0, 'ячеек: ' + sellerUi);

    ok('нет JS-ошибок', errors.length === 0, errors.slice(0, 2).join(' | '));
  } catch (e) {
    failed++;
    console.log('  ✗ ИСКЛЮЧЕНИЕ: ' + e.message);
  }

  await browser.close();
  console.log('\n=== Итог: ' + passed + ' успешно, ' + failed + ' с ошибками ===');
  process.exit(failed ? 1 : 0);
})();
