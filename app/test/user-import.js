/* ============================================================
   Проверки: импорт сотрудников из CSV (перенос из старой системы)
   1) разбор файла: шапка, разделители, кавычки, BOM, ошибки
   2) создание учётных записей, пароли из файла, роли, повторный импорт
   3) вход под импортированным сотрудником
   4) интерфейс: кнопка, форма, предпросмотр, результат
   ============================================================ */
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const { installDayClock } = require('./helpers/clock');

const BASE = process.env.BASE || 'http://127.0.0.1:8099';
const SHOTS = path.join(__dirname, '..', 'screenshots');
const CSV_PATH = process.env.USERS_CSV || path.join('/home/user/uploads', 'пользователи (1).csv');

let passed = 0, failed = 0;
function ok(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name + (extra ? ' — ' + extra : '')); }
  else { failed++; console.log('  ✗ ' + name + (extra ? ' — ' + extra : '')); }
}
const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

(async function () {
  const realCsv = fs.readFileSync(CSV_PATH, 'utf8');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const page = await browser.newPage();
  await installDayClock(page);
  await page.setViewport({ width: 1440, height: 980 });
  const errors = [];
  page.on('pageerror', function (e) { errors.push(e.message); });
  page.on('console', function (m) { if (m.type() === 'error') errors.push(m.text()); });

  try {
    console.log('\n=== Импорт сотрудников из CSV ===');
    await page.goto(BASE + '/index.html', { waitUntil: 'networkidle0' });
    await sleep(400);

    // ---------- 1. Разбор файла ----------
    const parsed = await page.evaluate((text) => {
      const res = parseUsersCsv(text);
      return {
        rows: res.rows.length,
        errors: res.errors,
        first: res.rows[0],
        last: res.rows[res.rows.length - 1],
        roles: Array.from(new Set(res.rows.map((r) => r.role)))
      };
    }, realCsv);
    ok('в файле найдено 33 сотрудника', parsed.rows === 33, 'строк: ' + parsed.rows);
    ok('ошибок разбора нет', parsed.errors.length === 0, parsed.errors.join(' | ') || 'чисто');
    ok('первая строка разобрана верно', parsed.first.username.length > 0 && parsed.first.fullName.length > 0 && parsed.first.password === parsed.first.username,
      parsed.first.fullName + ' / @' + parsed.first.username);
    ok('последняя строка разобрана верно', parsed.last.username.length > 0 && parsed.last.fullName.length > 0, 'строк в файле: ' + parsed.rows);
    ok('все роли — продавцы', parsed.roles.length === 1 && parsed.roles[0] === 'seller', parsed.roles.join(','));

    const formats = await page.evaluate(() => {
      const semi = parseUsersCsv('Имя;Логин;Роль;Пароль\nИван;ivan_1;seller;ivan123');
      const noHead = parseUsersCsv('Пётр,petr,admin,petr2026');
      const quoted = parseUsersCsv('"Ахметов, Азамат",azamat_dev,dev,azamat123');
      const bom = parseUsersCsv('\uFEFFИмя,Имя пользователя,Роль,Пароль\r\nАнна,anna1,seller,anna123');
      const bad = parseUsersCsv('Имя,Логин,Роль,Пароль\nБез логина,,seller,пароль123\nПустой пароль,@user2,seller,');
      const roles = parseUsersCsv('Имя,Логин,Роль,Пароль\nA,admin1,Администратор,pass123\nB,sell1,Продавец,pass123\nC,dev1,Разработчик,pass123');
      return {
        semi: semi.rows[0],
        noHead: noHead.rows[0],
        quoted: quoted.rows[0],
        bom: bom.rows[0],
        badCount: bad.rows.length,
        badErrors: bad.errors.length,
        roleList: roles.rows.map((r) => r.role)
      };
    });
    ok('разделитель «;» поддерживается', formats.semi && formats.semi.username === 'ivan_1' && formats.semi.password === 'ivan123');
    ok('файл без шапки тоже читается', formats.noHead && formats.noHead.role === 'admin' && formats.noHead.fullName === 'Пётр');
    ok('кавычки с запятой внутри имени', formats.quoted && formats.quoted.fullName === 'Ахметов, Азамат' && formats.quoted.role === 'dev', formats.quoted && formats.quoted.fullName);
    ok('BOM в начале файла не мешает', formats.bom && formats.bom.username === 'anna1');
    ok('некорректные строки отсеиваются', formats.badCount === 0 && formats.badErrors === 2, 'ошибок: ' + formats.badErrors);
    ok('роли на русском понимаются', formats.roleList.join(',') === 'admin,seller,dev', formats.roleList.join(','));

    // ---------- 2. Импорт ----------
    const seed = await page.evaluate(async () => {
      const admin = await createUser({ fullName: 'Владелец Сети', username: 'impadmin', password: 'impadmin1' }, { autoRole: true });
      setSession(admin.id);
      const now = Date.now();
      ['Керуен', 'Sky', 'My Kids', 'Dalida Plaza', 'Elegant Park'].forEach((name) => {
        DB.points.push({ id: uid(), name: name, address: '', createdAt: now, updatedAt: now });
      });
      saveDB();
      return { adminId: admin.id };
    });
    ok('данные подготовлены: владелец и 5 точек', !!seed.adminId, 'ok');

    const imported = await page.evaluate(async (text, adminId) => {
      const parsed = parseUsersCsv(text);
      const actor = getUser(adminId);
      const res = await importUsers(parsed.rows, actor);
      return {
        created: res.created.length,
        skipped: res.skipped.length,
        errors: res.errors,
        total: DB.users.length,
        sample: DB.users.filter((u) => u.username === 'alina')[0] ? {
          name: DB.users.filter((u) => u.username === 'alina')[0].fullName,
          role: DB.users.filter((u) => u.username === 'alina')[0].role,
          pass: DB.users.filter((u) => u.username === 'alina')[0].pass,
          points: userPointIds(DB.users.filter((u) => u.username === 'alina')[0]).length
        } : null,
        shortPassUser: (DB.users.filter((u) => u.username === 'alina')[0] || {}).pass ? 'есть' : 'нет'
      };
    }, realCsv, seed.adminId);
    ok('создано 33 сотрудника', imported.created === 33, 'создано: ' + imported.created);
    ok('ошибок нет', imported.errors.length === 0, imported.errors.join(' | ') || 'чисто');
    ok('в базе 34 пользователя вместе с владельцем', imported.total === 34, String(imported.total));
    ok('короткий пароль (5 символов) принят', imported.sample && imported.sample.pass && imported.sample.pass.indexOf('sha:') === 0, imported.shortPassUser);
    ok('точки не назначены — их раздаёт админ', imported.sample && imported.sample.points === 0);
    ok('роль продавца сохранена', imported.sample && imported.sample.role === 'seller');

    const relogin = await page.evaluate(async () => {
      logoutUser();
      try {
        const u = await loginUser('alina', 'alina');
        return { ok: true, name: u.fullName, role: u.role };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    });
    ok('вход импортированным логином работает', relogin.ok === true, relogin.ok ? relogin.name : relogin.error);
    ok('роль после входа — продавец', relogin.role === 'seller');

    const again = await page.evaluate(async (text, adminId) => {
      setSession(adminId);
      const parsed = parseUsersCsv(text);
      const res = await importUsers(parsed.rows, getUser(adminId));
      return { created: res.created.length, skipped: res.skipped.length, total: DB.users.length, reason: res.skipped[0] };
    }, realCsv, seed.adminId);
    ok('повторный импорт ничего не дублирует', again.created === 0 && again.total === 34, 'создано ' + again.created + ', всего ' + again.total);
    ok('дубли помечены как «уже есть»', again.skipped === 33 && again.reason && /уже есть/.test(again.reason.reason), String(again.skipped));

    const guard = await page.evaluate(async (text) => {
      const seller = DB.users.filter((u) => u.username === 'alina')[0];
      const res = await importUsers(parseUsersCsv(text).rows, seller);
      return { error: res.error, created: res.created ? res.created.length : null };
    }, realCsv);
    ok('продавец не может импортировать', /администратору/i.test(guard.error || '') && guard.created === null, guard.error);

    // ---------- 3. Интерфейс ----------
    await page.evaluate((id) => { setSession(id); location.hash = '#/points'; }, seed.adminId);
    await sleep(1100);
    const btn = await page.evaluate(() => {
      const tab = document.querySelector('[data-tab="users"]');
      if (tab) tab.click();
      return true;
    });
    await sleep(700);
    const uiState = await page.evaluate(() => ({
      tab: !!document.querySelector('[data-tab="users"]'),
      importBtn: !!document.querySelector('#importUsers'),
      rows: document.querySelectorAll('tbody tr').length
    }));
    ok('вкладка «Пользователи» открыта', btn && uiState.tab === true);
    ok('есть кнопка «Импорт из CSV»', uiState.importBtn === true);
    ok('все сотрудники видны в таблице', uiState.rows === 34, 'строк: ' + uiState.rows);
    await page.screenshot({ path: SHOTS + '/108-users-import-list.png' });

    await page.evaluate(() => document.querySelector('#importUsers').click());
    await sleep(500);
    const modalOpen = await page.evaluate(() => ({
      open: !!document.querySelector('.modal-overlay'),
      file: !!document.querySelector('#impFile'),
      text: !!document.querySelector('#impText'),
      go: !!document.querySelector('#impGo')
    }));
    ok('форма импорта открылась', modalOpen.open && modalOpen.file && modalOpen.text && modalOpen.go);

    await page.evaluate((text) => {
      const area = document.querySelector('#impText');
      area.value = text;
      area.dispatchEvent(new Event('input', { bubbles: true }));
    }, realCsv);
    await sleep(500);
    const preview = await page.evaluate(() => ({
      kpi: Array.from(document.querySelectorAll('#impPreview .kpi-mini .v')).map((x) => x.textContent.trim()),
      skipBadges: Array.from(document.querySelectorAll('#impPreview .badge.warn')).length,
      rowCount: document.querySelectorAll('#impPreview tbody tr').length
    }));
    ok('предпросмотр показывает 33 строки', preview.rowCount === 33, 'строк: ' + preview.rowCount);
    ok('все 33 помечены как «пропуск» (уже в базе)', preview.skipBadges === 33, 'меток: ' + preview.skipBadges);
    await page.screenshot({ path: SHOTS + '/109-users-import-preview.png' });

    await page.evaluate(() => document.querySelector('#impGo').click());
    await sleep(1600);
    const done = await page.evaluate(() => {
      const modal = document.querySelector('.modal-overlay');
      return {
        title: (document.querySelector('.modal-overlay h2') || {}).textContent,
        text: modal ? modal.textContent.replace(/\s+/g, ' ').slice(0, 220) : ''
      };
    });
    ok('показан отчёт «Импорт завершён»', done.title === 'Импорт завершён', done.title);
    ok('в отчёте есть строка «Создано»', /Создано: 0/.test(done.text), done.text.slice(0, 110));
    await page.screenshot({ path: SHOTS + '/110-users-import-done.png' });

    ok('нет JS-ошибок', errors.length === 0, errors.slice(0, 3).join(' | ') || 'чисто');
  } catch (e) {
    failed++;
    console.log('  ✗ исключение: ' + (e && e.message));
    console.log(e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n') : '');
  } finally {
    await browser.close();
    console.log('\n=== Итог: ' + passed + ' успешно, ' + failed + ' с ошибками ===');
    process.exit(failed ? 1 : 0);
  }
})();
