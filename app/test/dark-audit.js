const puppeteer = require('puppeteer');
const path = require('path');

function parse(c) {
  const m = c.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);
  if (!m) return null;
  return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
}
function lum({ r, g, b }) {
  const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrast(a, b) {
  const l1 = lum(a), l2 = lum(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto('http://127.0.0.1:8099/index.html', { waitUntil: 'networkidle0' });
  await page.evaluate(async () => {
    localStorage.clear();
    const u = await createUser({ fullName: 'Юлия Иванова', username: 'yulia', password: 'secret123' }, { autoRole: true });
    setSession(u.id); await loadDemoData(u); setThemePreference('dark');
  });
  await page.reload({ waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 700));

  const routes = ['dashboard','cash','products','stock','points','time','analytics','help','settings'];
  let problems = [];
  for (const r of routes) {
    await page.evaluate(x => { location.hash = '#/' + x; }, r);
    await new Promise(res => setTimeout(res, 750));
    const found = await page.evaluate(() => {
      function bgOf(el) {
        let node = el;
        while (node && node !== document.documentElement) {
          const c = getComputedStyle(node).backgroundColor;
          if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') return c;
          node = node.parentElement;
        }
        return getComputedStyle(document.body).backgroundColor;
      }
      const out = [];
      const nodes = document.querySelectorAll('button, .btn, .chip, .badge, .side-item, .bn-item, td, th, .stat-value, .price, .nm, .kpi-mini .v, label, .field-label, .tabs button, .pay-tabs button, .segmented button, .time-day-row .dur, .role-tile .top, .contact-tile .t, .theme-option, .empty h4, .modal-head h2, .cart-total .val, .stock-qty');
      nodes.forEach(el => {
        if (!el.offsetParent && getComputedStyle(el).position !== 'fixed') return;
        const st = getComputedStyle(el);
        if (st.visibility === 'hidden' || +st.opacity < 0.2) return;
        const rect = el.getBoundingClientRect();
        if (rect.width < 6 || rect.height < 6) return;
        const fg = st.color, bg = bgOf(el);
        const f = { color: fg, bg, cls: (el.className && el.className.baseVal === undefined ? el.className : el.tagName) || el.tagName, text: (el.textContent || '').trim().slice(0, 34) };
        out.push(f);
      });
      return out;
    });
    found.forEach(item => {
      const fgc = parse(item.color), bgc = parse(item.bg);
      if (!fgc || !bgc || bgc.a < 0.5) return;
      const ratio = contrast(fgc, bgc);
      if (ratio < 1.8) problems.push({ route: r, ratio: +ratio.toFixed(2), ...item });
    });
  }
  const unique = [];
  const seen = new Set();
  problems.forEach(p => { const k = p.cls + p.color + p.bg; if (!seen.has(k)) { seen.add(k); unique.push(p); } });
  console.log('низкий контраст в тёмной теме:', unique.length);
  unique.slice(0, 25).forEach(p => console.log(`  [${p.route}] ${p.ratio}  ${p.cls}  fg=${p.color} bg=${p.bg}  «${p.text}»`));
  await browser.close();
})();
