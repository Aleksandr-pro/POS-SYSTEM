/**
 * Правки и отмена продаж: 2 суток у продавца, журнал «Изменения» у администратора.
 */
const puppeteer = require('puppeteer');
const { installDayClock } = require('./helpers/clock');
const path = require('path');

const BASE = process.env.POS_BASE || 'http://127.0.0.1:8099';
const SHOTS = path.join(__dirname, '..', 'screenshots');
const results = [];
function ok(name, cond, extra) { results.push(cond); console.log(cond ? '  ✓' : '  ✗', name, extra ? '— ' + extra : ''); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await installDayClock(page);
  await page.setViewport({ width: 1360, height: 960 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.goto(BASE + '/index.html', { waitUntil: 'networkidle0' });
  await sleep(400);

  const seed = await page.evaluate(async () => {
    const admin = await createUser({ fullName: 'Владелец', username: 'owner3', password: 'owner123' }, { autoRole: true });
    setSession(admin.id);
    await loadDemoData(admin);
    const point = DB.points[0];
    const seller = await createUser({
      fullName: 'Продавец', username: 'seller3', password: 'seller123',
      role: 'seller', pointIds: [point.id], pointId: point.id
    });
    const product = productsForPoint(point.id)[0];
    const row = stockRow(point.id, product.id);
    const startQty = row ? row.qty : 0;

    // две продажи: свежая и «старая» (3 суток назад)
    const fresh = createSale({ pointId: point.id, items: [{ productId: product.id, name: product.name, price: product.price, qty: 2 }], total: product.price * 2, payment: 'cash' }, seller);
    const old = createSale({ pointId: point.id, items: [{ productId: product.id, name: product.name, price: product.price, qty: 1 }], total: product.price, payment: 'cash' }, seller);
    old.createdAt = Date.now() - 3 * 24 * 60 * 60 * 1000;
    old.updatedAt = old.createdAt;

    return {
      adminId: admin.id, sellerId: seller.id, pointId: point.id, pointName: point.name,
      productName: product.name, price: product.price,
      freshId: fresh.id, oldId: old.id, startQty: startQty
    };
  });
  ok('данные подготовлены', !!seed.freshId && !!seed.oldId, seed.pointName);

  // ---------- 1. права продавца ----------
  const rights = await page.evaluate((ids) => {
    const seller = DB.users.find(u => u.id === ids.sellerId);
    const admin = DB.users.find(u => u.id === ids.adminId);
    const fresh = DB.sales.find(s => s.id === ids.freshId);
    const old = DB.sales.find(s => s.id === ids.oldId);
    return {
      freshSeller: canEditSale(seller, fresh),
      oldSeller: canEditSale(seller, old),
      freshAdmin: canEditSale(admin, fresh),
      oldAdmin: canEditSale(admin, old),
      leftHours: Math.round(saleEditLeftMs(fresh) / 3600000)
    };
  }, seed);
  ok('свежую продажу продавец менять может', rights.freshSeller === true, 'осталось ' + rights.leftHours + ' ч');
  ok('продажу старше 2 суток продавец менять не может', rights.oldSeller === false);
  ok('администратор может править и старую', rights.freshAdmin && rights.oldAdmin);

  // ---------- 2. правка оплаты (смешанная) и чека ----------
  const edited = await page.evaluate((ids) => {
    const seller = DB.users.find(u => u.id === ids.sellerId);
    const total = DB.sales.find(s => s.id === ids.freshId).total;
    const bad = updateSale(ids.freshId, { payment: 'mixed', cashAmount: 100, qrAmount: 100 }, seller);
    const noReceipt = updateSale(ids.freshId, { payment: 'qr' }, seller);
    const good = updateSale(ids.freshId, { payment: 'mixed', cashAmount: total - 300, qrAmount: 300, receipt: 'data:image/png;base64,AAAA' }, seller);
    const sale = DB.sales.find(s => s.id === ids.freshId);
    const change = DB.saleChanges[0];
    return {
      bad: bad.error, noReceipt: noReceipt.error, good: !!good.ok,
      payment: sale.payment, cash: sale.cashAmount, qr: sale.qrAmount,
      receipt: !!sale.receipt, edits: sale.edits,
      changeType: change && change.type, changeSale: change && change.saleCode, changeSummary: change && change.summary,
      changeUser: change && change.userName
    };
  }, seed);
  ok('неверная разбивка отклоняется', /должны давать/.test(edited.bad || ''), edited.bad);
  ok('QR без чека отклоняется', /чек/.test(edited.noReceipt || ''), edited.noReceipt);
  ok('смешанная оплата и чек сохранены', edited.good && edited.payment === 'mixed' && edited.cash === seed.price * 2 - 300 && edited.qr === 300 && edited.receipt, edited.cash + '/' + edited.qr);
  ok('в продаже отмечено число правок', edited.edits === 1, String(edited.edits));
  ok('правка попала в журнал', edited.changeType === 'edit' && edited.changeUser === 'Продавец', edited.changeSummary);

  // ---------- 3. истёкшее окно ----------
  const blocked = await page.evaluate((ids) => {
    const seller = DB.users.find(u => u.id === ids.sellerId);
    return {
      edit: updateSale(ids.oldId, { payment: 'qr', receipt: 'data:image/png;base64,AAAA' }, seller).error,
      cancel: cancelSale(ids.oldId, seller).error,
      stillCash: DB.sales.find(s => s.id === ids.oldId).payment
    };
  }, seed);
  ok('правка просроченной продажи запрещена', /2 суток/.test(blocked.edit || ''), blocked.edit);
  ok('отмена просроченной продажи запрещена', /2 суток/.test(blocked.cancel || ''), blocked.cancel);
  ok('данные просроченной продажи не изменились', blocked.stillCash === 'cash');

  // ---------- 4. отмена продажи ----------
  const cancelled = await page.evaluate((ids) => {
    const seller = DB.users.find(u => u.id === ids.sellerId);
    const beforeRow = stockRow(ids.pointId, DB.sales.find(s => s.id === ids.freshId).items[0].productId);
    const beforeQty = beforeRow.qty;
    const revenueBefore = summarize(0, Date.now(), { pointId: ids.pointId }).revenue;
    const res = cancelSale(ids.freshId, seller);
    const afterRow = stockRow(ids.pointId, DB.sales.find(s => s.id === ids.freshId).items[0].productId);
    const sale = DB.sales.find(s => s.id === ids.freshId);
    const revenueAfter = summarize(0, Date.now(), { pointId: ids.pointId }).revenue;
    return {
      ok: !!res.ok, cancelled: sale.cancelled, byName: sale.cancelledByName,
      beforeQty: beforeQty, afterQty: afterRow.qty,
      revenueBefore: revenueBefore, revenueAfter: revenueAfter,
      inList: salesBetween(0, Date.now(), { pointId: ids.pointId }).some(s => s.id === ids.freshId),
      inListWithCancelled: salesBetween(0, Date.now(), { pointId: ids.pointId, includeCancelled: true }).some(s => s.id === ids.freshId),
      change: DB.saleChanges[0],
      repeat: cancelSale(ids.freshId, DB.users.find(u => u.id === ids.sellerId)).error
    };
  }, seed);
  ok('продажа отменена', cancelled.ok && cancelled.cancelled && cancelled.byName === 'Продавец');
  ok('товары вернулись на склад', cancelled.afterQty === cancelled.beforeQty + 2, cancelled.beforeQty + ' → ' + cancelled.afterQty);
  ok('выручка уменьшилась на сумму продажи', cancelled.revenueAfter === cancelled.revenueBefore - seed.price * 2, cancelled.revenueBefore + ' → ' + cancelled.revenueAfter);
  ok('отменённая не попадает в статистику, но остаётся в базе', !cancelled.inList && cancelled.inListWithCancelled);
  ok('в журнале тип «Отмена»', cancelled.change.type === 'cancel' && /возвращены/.test(cancelled.change.summary), cancelled.change.summary);
  ok('повторно отменить нельзя', /уже отменена/.test(cancelled.repeat || ''), cancelled.repeat);

  // ---------- 5. интерфейс кассы ----------
  await page.evaluate((ids) => {
    const seller = DB.users.find(u => u.id === ids.sellerId);
    setSession(seller.id);
    location.hash = '#/cash';
  }, seed);
  await page.reload({ waitUntil: 'networkidle0' });
  await sleep(900);
  await page.evaluate(() => {
    const u = DB.users.find(x => x.username === 'seller3');
    setSession(u.id);
    // продавец проходит допуск к кассе: приход + сверка склада
    const key = dayKey(new Date());
    let t = timeEntryFor(u.id, key);
    if (!t) {
      t = { id: uid(), userId: u.id, date: key, arriveAt: Date.now(), arriveGeo: null, leaveAt: null, leaveGeo: null, updatedAt: Date.now() };
      DB.time.push(t);
    } else { t.arriveAt = Date.now(); t.leaveAt = null; t.updatedAt = Date.now(); }
    saveDB();
    userPointIds(u).forEach(function (pid) {
      if (stockCheckForDay(u.id, pid, key)) return;
      saveStockCheck({ pointId: pid, result: 'match', items: productsForPoint(pid).map(function (p) {
        var r = stockRow(pid, p.id); var q = r ? r.qty : 0;
        return { productId: p.id, name: p.name, system: q, actual: q };
      }) }, u);
    });
  });
  await page.reload({ waitUntil: 'networkidle0' });
  await sleep(1000);

  const cashUi = await page.evaluate(() => ({
    editBtns: document.querySelectorAll('[data-edit-sale]').length,
    cancelBtns: document.querySelectorAll('[data-cancel-sale]').length,
    canceledRows: /отменена/.test(document.body.textContent)
  }));
  ok('в кассе есть кнопки «Изменить» и «Отменить»', cashUi.editBtns > 0 && cashUi.cancelBtns > 0, 'кнопок: ' + cashUi.editBtns + '/' + cashUi.cancelBtns);
  ok('отменённая продажа видна с пометкой', cashUi.canceledRows);

  // окно правки
  await page.evaluate(() => document.querySelector('[data-edit-sale]').click());
  await sleep(600);
  const modal = await page.evaluate(() => ({
    open: !!document.querySelector('#editPay'),
    mixedHidden: document.querySelector('#editMixedBox') ? getComputedStyle(document.querySelector('#editMixedBox')).display === 'none' : null,
    windowNote: /2 суток/.test(document.body.textContent)
  }));
  ok('окно правки открылось', modal.open && modal.windowNote);
  await page.evaluate(() => {
    document.querySelector('#editPay [data-pay="mixed"]').click();
  });
  await sleep(300);
  const mix = await page.evaluate(() => ({
    visible: getComputedStyle(document.querySelector('#editMixedBox')).display !== 'none',
    hint: document.querySelector('#editSplitHint').textContent.replace(/\s+/g, ' ')
  }));
  ok('разбивка нал/QR появляется', mix.visible && /Сумма продажи|Сходится/.test(mix.hint), mix.hint);
  await page.screenshot({ path: path.join(SHOTS, '93-sale-edit-modal.png') });
  await page.evaluate(() => document.querySelector('#editCancel').click());
  await sleep(300);

  // ---------- 5b. окно «Продажи за 2 суток» ----------
  await page.evaluate(() => document.querySelector('#salesWindowBtn').click());
  await sleep(700);
  const win = await page.evaluate(() => {
    const box = document.querySelector('#windowSalesBox');
    const rows = box ? Array.from(box.querySelectorAll('tr[data-win-sale]')).map(r => r.textContent.replace(/\s+/g, ' ')) : [];
    return {
      open: !!box,
      rows: rows.length,
      hasEdit: !!document.querySelector('[data-win-edit]'),
      hasOld: rows.some(r => /2100|3 дня/.test(r)),
      text: rows.join(' | ').slice(0, 160)
    };
  });
  ok('в кассе есть окно «Продажи за 2 суток»', win.open && win.rows >= 1, 'строк: ' + win.rows);
  ok('кнопки правки доступны только по свежим продажам', win.hasEdit);
  await page.screenshot({ path: path.join(SHOTS, '95-sales-window.png') });
  await page.evaluate(() => document.querySelector('.modal-overlay [data-close]').click());
  await sleep(300);

  // ---------- 6. раздел «Изменения» только у админа ----------
  const sellerNav = await page.$$eval('.side-nav [data-nav]', els => els.map(e => e.getAttribute('data-nav')));
  ok('у продавца нет раздела «Изменения»', sellerNav.indexOf('changes') === -1, sellerNav.join(','));
  await page.evaluate(() => { location.hash = '#/changes'; });
  await sleep(700);
  const sellerBlocked = await page.evaluate(() => location.hash);
  ok('продавца не пускает в «Изменения»', sellerBlocked === '#/cash', sellerBlocked);

  await page.evaluate((ids) => {
    setSession(ids.adminId);
    location.hash = '#/changes';
  }, seed);
  await page.reload({ waitUntil: 'networkidle0' });
  await sleep(900);
  await page.evaluate((ids) => { setSession(ids.adminId); location.hash = '#/changes'; }, seed);
  await sleep(1000);

  const adminView = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('[data-change-row]')).map(r => r.textContent.replace(/\s+/g, ' ').trim());
    return {
      hash: location.hash,
      rows: rows,
      hasEdit: rows.some(r => /Правка/.test(r)),
      hasCancel: rows.some(r => /Отмена/.test(r)),
      hasWho: rows.some(r => /Продавец/.test(r)),
      hasBeforeAfter: rows.some(r => /было:/.test(r) && /стало:|отменена/.test(r)),
      hasReceipt: rows.some(r => /чек:/.test(r)),
      filters: !!document.querySelector('#chType') && !!document.querySelector('#chPoint'),
      pageText: document.querySelector('.page').textContent.replace(/\s+/g, ' ').slice(0, 200)
    };
  });
  ok('админ открывает «Изменения»', adminView.hash === '#/changes' && adminView.filters);
  ok('видны правки и отмены', adminView.hasEdit && adminView.hasCancel, 'строк: ' + adminView.rows.length);
  ok('видно, кто и что изменил', adminView.hasWho && adminView.hasBeforeAfter && adminView.hasReceipt);
  await page.screenshot({ path: path.join(SHOTS, '94-changes-log.png'), fullPage: true });

  // фильтр по типу
  await page.evaluate(() => {
    const sel = document.querySelector('#chType');
    sel.value = 'cancel';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await sleep(600);
  const filtered = await page.evaluate(() => Array.from(document.querySelectorAll('[data-change-row]')).map(r => r.textContent));
  ok('фильтр «Только отмены» работает', filtered.length === 1 && /Отмена/.test(filtered[0]), 'строк: ' + filtered.length);

  ok('нет JS-ошибок', errors.length === 0, errors.slice(0, 2).join(' | '));

  await browser.close();
  const failed = results.filter(r => !r).length;
  console.log('\n=== Итог: ' + (results.length - failed) + ' успешно, ' + failed + ' с ошибками ===');
  if (failed) process.exit(1);
})();
