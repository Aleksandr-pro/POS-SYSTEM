const puppeteer = require('puppeteer');
(async () => {
  const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox','--disable-dev-shm-usage'] });
  const p = await b.newPage();
  await p.goto('http://127.0.0.1:8099/index.html', { waitUntil: 'networkidle0' });
  const out = await p.evaluate(async () => {
    const now = Date.now();
    const admin = await createUser({ fullName: 'A', username: 'dbg1', password: 'dbg12345' }, { autoRole: true });
    setSession(admin.id);
    DB.points.push({ id: uid(), name: 'Керуен', createdAt: now, updatedAt: now });
    saveDB();
    const txt = '13:27 — Арина Турланова\nУслуга/Точка: Аквагримм. Керуен\nОплата: Каспи QR\nТовары: Аквагримм 1500 × 1 шт\nСумма: 1 500.00 ₸';
    const parsed = parseTransactionsText(txt, { date: dayKey(Date.now() - 86400000) });
    const res = importTransactions(parsed.transactions, { actor: admin, replace: true });
    return { n: parsed.transactions.length, errors: parsed.errors, res: res, sales: DB.sales.length, day: dayKey(Date.now() - 86400000) };
  });
  console.log(JSON.stringify(out));
  await b.close();
})();
