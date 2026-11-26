/**
 * Серверная фильтрация данных для продавца (Cloudflare Worker).
 * Проверяет, что на устройство продавца не уходят чужие точки и админские данные.
 */
const fs = require('fs');
const path = require('path');

let okCount = 0, failCount = 0;
function ok(name, cond, extra) {
  if (cond) { okCount++; console.log('  ✓', name, extra ? '— ' + extra : ''); }
  else { failCount++; console.log('  ✗', name, extra ? '— ' + extra : ''); }
}

(async () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'worker.js'), 'utf8');
  const modPath = path.join(require('os').tmpdir(), 'pos-worker-scope-' + process.pid + '.mjs');
  fs.writeFileSync(modPath, src + '\nexport { scopeRecordsForActor };\n');
  const mod = await import('file://' + modPath);
  const scope = mod.scopeRecordsForActor;

  const seller = { id: 'u-seller', role: 'seller', pointIds: ['p1'], pointId: 'p1' };
  const admin = { id: 'u-admin', role: 'admin' };
  const pick = (actor, collection, list) => scope(actor, collection, list).map(x => x.id);

  const recs = [
    { id: 'p1' }, { id: 'p2' }
  ];

  ok('продавец не получает пользователей', pick(seller, 'users', [{ id: 'u1' }, { id: 'u2' }]).length === 0);
  ok('категории и настройки доступны', pick(seller, 'categories', recs).length === 2 && pick(seller, 'settings', recs).length === 2);
  ok('точки — только своя', pick(seller, 'points', recs).join(',') === 'p1', pick(seller, 'points', recs).join(','));

  const products = [
    { id: 'prod-p1', pointIds: ['p1'] },
    { id: 'prod-p2', pointIds: ['p2'] },
    { id: 'prod-global', pointIds: [] },
    { id: 'prod-both', pointIds: ['p1', 'p2'] }
  ];
  const sellerProducts = pick(seller, 'products', products);
  ok('товары — своей точки и общие', sellerProducts.join(',') === 'prod-p1,prod-global,prod-both', sellerProducts.join(','));

  const ops = [{ id: 'op-p1', pointId: 'p1' }, { id: 'op-p2', pointId: 'p2' }];
  ['sales', 'expenses', 'stock', 'supplies', 'saleChanges'].forEach(function (c) {
    ok(c + ' — только своей точки', pick(seller, c, ops).join(',') === 'op-p1', pick(seller, c, ops).join(','));
  });

  const time = [{ id: 't-own', userId: 'u-seller' }, { id: 't-other', userId: 'u-other' }];
  ok('время — только своё', pick(seller, 'time', time).join(',') === 't-own');

  ok('продавец без точек не получает операций', pick({ id: 'x', role: 'seller', pointIds: [] }, 'sales', ops).length === 0);

  ok('администратор получает всё', scope(admin, 'sales', ops).length === 2 && scope(admin, 'users', [{ id: 'u1' }]).length === 1);
  ok('неизвестная коллекция не отдаётся продавцу', scope(seller, 'audit', recs).length === 0);

  fs.unlinkSync(modPath);
  console.log('\n=== Итог: ' + okCount + ' успешно, ' + failCount + ' с ошибками ===');
  if (failCount) process.exit(1);
})();
