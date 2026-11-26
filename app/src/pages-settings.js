/* ============================================================
   POS Контроль — настройки профиля, данные, о системе
   ============================================================ */
(function () {
  'use strict';
  var PAGES = window.PAGES = window.PAGES || {};

  function storageInfo() {
    var json = JSON.stringify(DB);
    var bytes = new Blob([json]).size;
    var quota = 5 * 1024 * 1024;
    return {
      bytes: bytes,
      label: bytes >= 1024 * 1024 ? (bytes / (1024 * 1024)).toFixed(2) + ' МБ' : (bytes / 1024).toFixed(0) + ' КБ',
      percent: Math.min(100, Math.round((bytes / quota) * 100)),
      photos: DB.products.filter(function (p) { return p.photo; }).length + DB.sales.filter(function (s) { return s.receipt; }).length
    };
  }


  function serverCardHtml(user) {
    var api = window.POS_API;
    if (!api) return '';
    var st = api.syncStatus();
    var cfg = api.serverConfig();
    var head = '<h3>' + icon('cloud', 17) + ' Сервер и синхронизация</h3>' +
      '<p class="desc">Общая база на Cloudflare: одни и те же продажи, товары и склад на всех устройствах</p>';

    if (!st.configured) {
      return '<div class="card settings-section" id="serverCard">' + head +
        '<div class="field"><label for="srvUrl">Адрес сервера</label>' +
          '<input class="input" id="srvUrl" placeholder="https://pos-kontrol.ваш-аккаунт.workers.dev" value="' + esc(cfg.url || '') + '" spellcheck="false">' +
          '<div class="hint">Адрес выдаётся после публикации Worker на Cloudflare — инструкция в файле docs/CLOUDFLARE.md</div></div>' +
        '<div class="form-grid">' +
          '<div class="field"><label for="srvUser">Логин на сервере</label>' +
            '<input class="input" id="srvUser" value="' + esc(user.username) + '" autocomplete="username"></div>' +
          '<div class="field"><label for="srvPass">Пароль</label>' +
            '<div class="pw-wrap"><input class="input" id="srvPass" type="password" autocomplete="current-password">' +
            '<button type="button" class="pw-toggle" data-pw-toggle="srvPass" aria-label="Показать пароль">' + icon('eye', 18) + '</button></div></div>' +
        '</div>' +
        '<div class="flex gap-8 wrap">' +
          '<button type="button" class="btn btn-secondary" id="srvTest">' + icon('cloud', 16) + ' Проверить связь</button>' +
          '<button type="button" class="btn btn-primary" id="srvLogin">' + icon('sync', 16) + ' Войти на сервер</button>' +
          '<button type="button" class="btn btn-ghost" id="srvRegister">Создать аккаунт на сервере</button>' +
        '</div>' +
        '<div class="form-note info" id="srvStatus" style="margin-top:4px">' + icon('info', 15) +
          '<span>Первый зарегистрированный на сервере получает роль <b>Администратор</b>, второй — <b>Разработчик</b>, остальные — <b>Продавцы</b>.</span></div>' +
      '</div>';
    }

    var lastSync = st.lastSyncAt ? fmtDate(st.lastSyncAt) + ', ' + fmtTime(st.lastSyncAt) : 'ещё не выполнялась';
    var roleMismatch = cfg.user && cfg.user.role !== user.role
      ? '<div class="form-note warn">' + icon('alert', 15) + '<span>Роль на сервере: <b>' + roleLabel(cfg.user.role) + '</b>, на устройстве: <b>' + roleLabel(user.role) + '</b>. Войдите на сервер заново, чтобы применить роль.</span></div>'
      : '';

    return '<div class="card settings-section" id="serverCard">' + head +
      '<div class="about-list">' +
        '<div class="about-row"><span class="k">Сервер</span><span class="v truncate">' + esc(st.url) + '</span></div>' +
        '<div class="about-row"><span class="k">Аккаунт</span><span class="v">' + esc((cfg.user && cfg.user.fullName) || user.fullName) + ' · ' + roleLabel((cfg.user && cfg.user.role) || user.role) + '</span></div>' +
        '<div class="about-row"><span class="k">Последняя синхронизация</span><span class="v">' + lastSync + '</span></div>' +
        '<div class="about-row"><span class="k">В очереди</span><span class="v">' + (st.pending ? st.pending + ' ' + plural(st.pending, 'запись', 'записи', 'записей') : 'нет изменений') + '</span></div>' +
        '<div class="about-row"><span class="k">Связь</span><span class="v">' + (st.online ? '<span class="badge success">' + icon('check', 12) + ' онлайн</span>' : '<span class="badge warn">офлайн</span>') + '</span></div>' +
      '</div>' +
      roleMismatch +
      (st.error ? '<div class="form-note warn">' + icon('alert', 15) + '<span>' + esc(st.error) + '</span></div>' : '') +
      '<label class="check" style="margin-top:4px"><input type="checkbox" id="srvAuto"' + (st.autoSync ? ' checked' : '') + '><span>Синхронизировать автоматически</span></label>' +
      '<div class="flex gap-8 wrap">' +
        '<button type="button" class="btn btn-primary" id="srvSync">' + icon('sync', 16) + ' Синхронизировать</button>' +
        '<button type="button" class="btn btn-secondary" id="srvTest">' + icon('cloud', 16) + ' Проверить связь</button>' +
        '<button type="button" class="btn btn-ghost" id="srvOff">Отключить</button>' +
      '</div>' +
      '<div class="hint" id="srvStatus"></div>' +
    '</div>';
  }

  function bindServerCard(root, ctx) {
    var api = window.POS_API;
    if (!api) return;
    var statusBox = root.querySelector('#srvStatus');
    function note(html, cls) {
      if (!statusBox) return;
      statusBox.className = 'hint';
      statusBox.innerHTML = html;
      statusBox.style.color = cls === 'error' ? 'var(--danger)' : (cls === 'success' ? 'var(--success-600)' : '');
    }
    function readUrl() {
      var input = root.querySelector('#srvUrl');
      return input ? input.value.trim() : api.serverConfig().url;
    }

    var test = root.querySelector('#srvTest');
    if (test) test.addEventListener('click', async function () {
      var btn = this;
      var url = readUrl();
      if (!url) { note('Укажите адрес сервера', 'error'); return; }
      setButtonBusy(btn, true, 'Проверяем…');
      try {
        var info = await api.testServer(url);
        note('Сервер доступен · версия ' + (info.version || '—') + ' · пользователей: ' + (info.users === null || info.users === undefined ? '—' : info.users), 'success');
      } catch (err) {
        note(err.message, 'error');
      }
      setButtonBusy(btn, false);
    });

    async function connect(mode, btn) {
      var url = readUrl();
      var loginInput = root.querySelector('#srvUser');
      var passInput = root.querySelector('#srvPass');
      var username = loginInput ? loginInput.value.trim() : '';
      var password = passInput ? passInput.value : '';
      if (!url) { note('Укажите адрес сервера', 'error'); return; }
      if (!username) { note('Укажите логин', 'error'); return; }
      if (password.length < 6) { note('Пароль — минимум 6 символов', 'error'); return; }
      var clean = url.replace(/\/+$/, '');
      var old = api.serverConfig();
      setButtonBusy(btn, true, mode === 'login' ? 'Входим…' : 'Создаём…');
      try {
        api.saveServerConfig({ url: clean });
        if (mode === 'login') {
          await api.serverLogin(username, password);
          toast('Сервер подключён, вход выполнен', 'success');
        } else {
          await api.serverRegister({ fullName: ctx.user.fullName, username: username, password: password });
          toast('Аккаунт создан на сервере', 'success');
        }
        setTimeout(function () { location.reload(); }, 500);
      } catch (err) {
        api.saveServerConfig({ url: old.url || clean });
        setButtonBusy(btn, false);
        note(err.message, 'error');
      }
    }

    var loginBtn = root.querySelector('#srvLogin');
    if (loginBtn) loginBtn.addEventListener('click', function () { connect('login', this); });
    var regBtn = root.querySelector('#srvRegister');
    if (regBtn) regBtn.addEventListener('click', function () { connect('register', this); });

    var syncBtn = root.querySelector('#srvSync');
    if (syncBtn) syncBtn.addEventListener('click', async function () {
      var btn = this;
      setButtonBusy(btn, true, 'Синхронизируем…');
      var res = await api.syncNow({ silent: true });
      setButtonBusy(btn, false);
      if (res && res.error) { toast(res.error, 'error', 4600); ctx.rerender(); return; }
      if (res && res.skipped) { toast(res.offline ? 'Нет интернета — изменения отправим позже' : 'Сервер не подключён', 'warn'); return; }
      toast('Готово: отправлено ' + (res.pushed || 0) + ', получено ' + (res.pulled || 0), 'success');
      ctx.rerender();
    });

    var auto = root.querySelector('#srvAuto');
    if (auto) auto.addEventListener('change', function () {
      api.saveServerConfig({ autoSync: this.checked });
      toast(this.checked ? 'Автосинхронизация включена' : 'Автосинхронизация выключена', 'info');
    });

    var off = root.querySelector('#srvOff');
    if (off) off.addEventListener('click', async function () {
      var ok = await confirmDialog({
        title: 'Отключить сервер?',
        message: 'Данные останутся на этом устройстве. Синхронизация прекратится, войти снова можно в любой момент.',
        confirmText: 'Отключить',
        danger: true
      });
      if (!ok) return;
      api.serverLogout();
      api.saveServerConfig({ url: '', user: null, lastSync: 0 });
      toast('Сервер отключён', 'info');
      ctx.rerender();
    });
  }


  function legacyCardHtml(user) {
    var data = window.POS_IMPORT_DATA;
    if (!data) return '';
    var imported = (DB.settings.importedRanges || []).length > 0;
    var historyCount = (data.history || []).reduce(function (sum, h) { return sum + h.count; }, 0);
    var historyRevenue = (data.history || []).reduce(function (sum, h) { return sum + h.revenue; }, 0);
    var importedSales = DB.sales.filter(function (s) { return s.imported; }).length;

    return '<div class="card settings-section" id="legacyCard">' +
      '<h3>' + icon('upload', 17) + ' Перенос из старой системы</h3>' +
      '<p class="desc">Товары и история продаж за октябрь из прежней кассы</p>' +
      (imported
        ? '<span class="badge success">' + icon('check', 12) + ' Перенесено: ' + DB.products.filter(function (p) { return p.imported; }).length + ' товаров, ' + importedSales + ' продаж</span>'
        : '<div class="about-list">' +
            '<div class="about-row"><span class="k">Товары</span><span class="v">' + data.products.length + ' позиций</span></div>' +
            '<div class="about-row"><span class="k">История продаж</span><span class="v">' + historyCount + ' чеков на ' + fmtMoney(historyRevenue) + '</span></div>' +
            '<div class="about-row"><span class="k">Период</span><span class="v">1 — 18 октября 2026</span></div>' +
          '</div>') +
      '<div class="flex gap-8 wrap">' +
        (imported
          ? '<button type="button" class="btn btn-secondary" id="legacyAgain">' + icon('refresh', 16) + ' Проверить перенос</button>'
          : '<button type="button" class="btn btn-primary" id="legacyImport">' + icon('download', 16) + ' Внести в базу</button>') +
        '<button type="button" class="btn btn-ghost" id="legacyCsv">' + icon('package', 16) + ' Товары из CSV</button>' +
        '<input type="file" id="legacyFile" accept=".csv,text/csv,text/plain" hidden>' +
        '<button type="button" class="btn btn-ghost" id="legacyManual">Другой период</button>' +
      '</div>' +
      '<div class="hint" id="legacyNote">' +
        (imported
          ? 'Данные уже в базе. Итоги за период и за 18 октября совпадают со старой системой.'
          : 'Добавится 71 товар и 692 чека за 1–18 октября: выручка, наличные, Kaspi QR и смешанные оплаты совпадут с прежней кассой. Текущие данные не удаляются.') +
      '</div>' +
      '<div class="form-note info">' + icon('info', 15) +
        '<span>В старых данных были только итоги, поэтому чеки создаются без состава: выручка, средний чек и отчёты по оплатам сходятся, а топ товаров будет строиться по новым продажам.</span>' +
      '</div>' +
    '</div>';
  }

  /* ---------- история продаж за прошлые дни ---------- */
  function historyCardHtml(user) {
    var sum = historyImportSummary();
    var stubs = historyStubSummary();
    return '<div class="card settings-section" id="historyCard">' +
      '<h3>' + icon('history', 17) + ' История продаж до внедрения</h3>' +
      '<p class="desc">Выручка прошлых дней — сводно на общей панели, без склада и без разбивки по точкам</p>' +
      (sum.days
        ? '<div class="kpi-inline" style="grid-template-columns:1fr 1fr;margin-bottom:10px">' +
            '<div class="kpi-mini"><div class="l">Дней внесено</div><div class="v">' + sum.days + '</div></div>' +
            '<div class="kpi-mini"><div class="l">Выручка</div><div class="v">' + fmtMoney(sum.revenue) + '</div></div>' +
          '</div>' +
          '<span class="badge success">' + icon('check', 12) + ' ' + fmtDate(parseDayKey(sum.from)) + ' — ' + fmtDate(parseDayKey(sum.to)) +
            ' · ' + fmtNumber(sum.receipts) + ' чеков</span>' +
          (stubs.count
            ? '<div style="margin-top:10px"><span class="badge warn">' + icon('alert', 12) + ' Заглушек без состава: ' + fmtNumber(stubs.count) + ' на ' + fmtMoney(stubs.revenue) + '</span></div>'
            : '')
        : '<span class="badge neutral">Пока не внесено</span>') +
      '<div class="flex gap-8 wrap" style="margin-top:10px">' +
        '<button type="button" class="btn ' + (sum.days ? 'btn-secondary' : 'btn-primary') + '" id="historyAdd">' +
          icon('upload', 16) + ' Внести цифры за прошлые дни</button>' +
        (stubs.count ? '<button type="button" class="btn btn-danger" id="historyClearStubs">' + icon('trash', 16) + ' Убрать заглушки (' + fmtNumber(stubs.count) + ')</button>' : '') +
        (sum.days ? '<button type="button" class="btn btn-ghost" id="historyClear">' + icon('trash', 16) + ' Очистить всю историю</button>' : '') +
      '</div>' +
      '<div class="hint">Можно вставить <b>список транзакций</b> из старой системы (время — продавец, точка, оплата, товары, сумма) — сохранятся продавцы, точки и состав. Либо сводку: <b>01.10.2026 125000 80000 45000 34</b>.</div>' +
      '<div class="form-note info">' + icon('info', 15) +
        '<span>Такие записи не списывают товары и не меняют склад: они показывают выручку, чеки, продавцов и точки за прошлые дни в панели и аналитике. Помечены как «история», их можно заменить или очистить одной кнопкой.</span>' +
      '</div>' +
    '</div>';
  }

  function openHistoryModal(ctx) {
    var user = ctx.user;
    var parsed = null;
    openModal({
      title: 'История продаж за прошлые дни',
      subtitle: 'Вставьте цифры из старой системы — по строке на день',
      size: 'lg',
      body:
        '<div class="form-note info" style="margin-bottom:12px">' + icon('info', 15) +
          '<span>Можно вставить <b>список транзакций</b> из старой системы (со временем, продавцом, точкой и товарами) или <b>сводку по дням</b>: дата → выручка → наличные → Kaspi QR → число чеков.</span>' +
        '</div>' +
        '<div class="field"><label for="histText">Транзакции или цифры по дням</label>' +
          '<textarea class="input" id="histText" rows="11" placeholder="13:27 — Арина Турланова&#10;Услуга/Точка: Аквагрим. Керуен&#10;Оплата: Каспи QR&#10;Товары: Аквагрим 1500 × 1 шт&#10;Сумма: 1 500.00 ₸&#10;&#10;— или сводка: —&#10;01.10.2026 19300 11700 7600 11" style="font-family:ui-monospace,monospace;font-size:12.5px"></textarea>' +
        '</div>' +
        '<div class="form-grid">' +
          '<div class="field"><label for="histDate">Дата, если её нет в тексте</label>' +
            '<input class="input" type="date" id="histDate" value="' + dayKey(new Date()) + '" max="' + dayKey(new Date()) + '">' +
            '<div class="hint">Для списка транзакций без даты</div></div>' +
          '<div class="field"><label for="histAvg">Средний чек, ' + APP_CONFIG.currency + '</label>' +
            '<input class="input" id="histAvg" inputmode="numeric" value="3000">' +
            '<div class="hint">Нужен, если в сводке не указано число чеков</div></div>' +
        '</div>' +
        '<label class="check" style="margin-bottom:4px"><input type="checkbox" id="histReplace" checked><span>Заменить уже внесённые дни</span></label>' +
        '<div id="histPreview"></div>',
      footer:
        '<button type="button" class="btn btn-secondary" data-cancel>Отмена</button>' +
        '<button type="button" class="btn btn-primary" id="histGo">' + icon('check', 16) + ' Внести историю</button>',
      onMount: function (el, close) {
        var textEl = el.querySelector('#histText');
        var avgEl = el.querySelector('#histAvg');
        var dateEl = el.querySelector('#histDate');
        var previewEl = el.querySelector('#histPreview');
        var goBtn = el.querySelector('#histGo');

        function renderPreview() {
          var text = textEl.value.trim();
          if (!text) { parsed = null; previewEl.innerHTML = ''; goBtn.disabled = false; return; }

          if (looksLikeTransactions(text)) {
            var tx = parseTransactionsText(text, { date: dateEl.value || dayKey(new Date()) });
            parsed = { mode: 'transactions', list: tx.transactions, errors: tx.errors, revenue: tx.revenue, receipts: tx.receipts };
            var txRows = tx.transactions.map(function (t) {
              var itemsText = (t.items || []).map(function (i) { return i.name + ' ×' + i.qty; }).join(', ');
              return '<tr>' +
                '<td><span class="cell-main nowrap">' + fmtTime(t.at) + '</span></td>' +
                '<td><span class="small">' + esc(t.seller) + '</span></td>' +
                '<td><span class="small">' + esc(t.pointName || '—') + (t.pointId ? '' : ' <span class="badge warn">не найдена</span>') + '</span></td>' +
                '<td><span class="small">' + esc(itemsText || '—') + '</span></td>' +
                '<td>' + badge(paymentLabel(t.payment), paymentBadgeClass(t.payment)) + '</td>' +
                '<td class="text-right"><span class="cell-main money">' + fmtMoney(t.total) + '</span></td>' +
                '</tr>';
            }).join('');
            previewEl.innerHTML =
              '<div class="kpi-inline" style="margin:6px 0 12px">' +
                '<div class="kpi-mini"><div class="l">Транзакций</div><div class="v">' + tx.transactions.length + '</div></div>' +
                '<div class="kpi-mini"><div class="l">Выручка</div><div class="v">' + fmtMoney(tx.revenue) + '</div></div>' +
                '<div class="kpi-mini"><div class="l">Дата</div><div class="v" style="font-size:15px">' + fmtDate(parseDayKey(dateEl.value) || new Date()) + '</div></div>' +
              '</div>' +
              (tx.transactions.length
                ? '<div class="table-wrap" style="max-height:260px;overflow:auto"><table class="tbl"><thead><tr>' +
                    '<th>Время</th><th>Продавец</th><th>Точка</th><th>Товары</th><th>Оплата</th><th class="text-right">Сумма</th></tr></thead><tbody>' +
                    txRows + '</tbody></table></div>'
                : '<div class="tbl-empty">Не нашёл транзакций — проверьте формат</div>') +
              ((tx.errors || []).length
                ? '<div class="form-note warn" style="margin-top:10px">' + icon('alert', 15) + '<span>' + esc(tx.errors.slice(0, 6).join(' · ')) + '</span></div>'
                : '');
            goBtn.disabled = !tx.transactions.length;
            return;
          }

          parsed = { mode: 'days' };
          parsed = Object.assign(parsed, parseHistoryText(text, { avgCheck: parseAmount(avgEl.value) || 3000 }));
          var days = parsed.days || [];
          var rows = days.map(function (d) {
            return '<tr>' +
              '<td><span class="cell-main nowrap">' + fmtDate(d.date) + '</span></td>' +
              '<td class="text-right"><span class="cell-main money">' + fmtMoney(d.revenue) + '</span></td>' +
              '<td class="text-right"><span class="small">' + fmtMoney(d.cash) + '</span></td>' +
              '<td class="text-right"><span class="small">' + fmtMoney(d.qr) + '</span></td>' +
              '<td class="text-right"><span class="small">' + fmtNumber(d.count) + '</span></td>' +
              '</tr>';
          }).join('');
          previewEl.innerHTML =
            '<div class="kpi-inline" style="margin:6px 0 12px">' +
              '<div class="kpi-mini"><div class="l">Дней</div><div class="v">' + days.length + '</div></div>' +
              '<div class="kpi-mini"><div class="l">Выручка</div><div class="v">' + fmtMoney(parsed.revenue) + '</div></div>' +
              '<div class="kpi-mini"><div class="l">Чеков</div><div class="v">' + fmtNumber(parsed.receipts) + '</div></div>' +
            '</div>' +
            (days.length
              ? '<div class="table-wrap" style="max-height:240px;overflow:auto"><table class="tbl"><thead><tr>' +
                  '<th>Дата</th><th class="text-right">Выручка</th><th class="text-right">Наличные</th>' +
                  '<th class="text-right">Kaspi QR</th><th class="text-right">Чеков</th></tr></thead><tbody>' + rows + '</tbody></table></div>'
              : '<div class="tbl-empty">Не нашёл ни одной строки с датой и суммой</div>') +
            ((parsed.errors || []).length
              ? '<div class="form-note warn" style="margin-top:10px">' + icon('alert', 15) + '<span>' + esc(parsed.errors.slice(0, 6).join(' · ')) + '</span></div>'
              : '');
          goBtn.disabled = !days.length;
        }

        textEl.addEventListener('input', renderPreview);
        avgEl.addEventListener('change', renderPreview);
        dateEl.addEventListener('change', renderPreview);
        el.querySelector('[data-cancel]').addEventListener('click', close);
        goBtn.addEventListener('click', function () {
          if (!parsed) { toast('Нет данных для внесения', 'error'); return; }
          var replace = el.querySelector('#histReplace').checked;

          if (parsed.mode === 'transactions') {
            if (!parsed.list.length) { toast('Нет транзакций для внесения', 'error'); return; }
            var txRes = importTransactions(parsed.list, { actor: user, replace: replace });
            if (txRes.error) { toast(txRes.error, 'error'); return; }
            close();
            toast('Внесено ' + txRes.created + ' транзакций на ' + fmtMoney(txRes.revenue), 'success', 4600);
            ctx.rerender();
            return;
          }

          if (!parsed.days || !parsed.days.length) { toast('Нет строк для внесения', 'error'); return; }
          var res = importHistoryDays(parsed.days, { actor: user, replace: replace });
          if (res.error) { toast(res.error, 'error'); return; }
          close();
          toast('Внесено ' + res.created + ' записей на ' + fmtMoney(res.revenue) + ' за ' + parsed.days.length + ' дн.', 'success', 4600);
          ctx.rerender();
        });
      }
    });
  }

  function bindHistoryCard(root, ctx) {
    var addBtn = root.querySelector('#historyAdd');
    if (addBtn) addBtn.addEventListener('click', function () { openHistoryModal(ctx); });
    var stubsBtn = root.querySelector('#historyClearStubs');
    if (stubsBtn) stubsBtn.addEventListener('click', function () {
      var stubs = historyStubSummary();
      confirmDialog({
        title: 'Убрать заглушки?',
        message: 'Будут удалены только сводные записи без состава: ' + fmtNumber(stubs.count) + ' шт на ' + fmtMoney(stubs.revenue) + '. ' +
          'Обычные продажи и записи из списка транзакций останутся, склад не изменится.',
        confirmText: 'Убрать',
        danger: true
      }).then(function (ok) {
        if (!ok) return;
        var res = clearHistoryStubs(ctx.user);
        if (res.error) { toast(res.error, 'error'); return; }
        toast('Заглушки убраны: ' + fmtNumber(res.removed) + ' на ' + fmtMoney(res.revenue), 'success', 4200);
        ctx.rerender();
      });
    });
    var clearBtn = root.querySelector('#historyClear');
    if (clearBtn) clearBtn.addEventListener('click', function () {
      confirmDialog({
        title: 'Очистить всю историю?',
        message: 'Все записи, внесённые как история до внедрения (и сводные, и из списка транзакций), будут удалены. Обычные продажи и склад останутся.',
        confirmText: 'Очистить',
        danger: true
      }).then(function (ok) {
        if (!ok) return;
        var res = clearHistoryImports(ctx.user);
        if (res.error) { toast(res.error, 'error'); return; }
        toast('Удалено записей: ' + res.removed, 'success');
        ctx.rerender();
      });
    });
  }

  /* ---------- корректировка показателей (только разработчик) ---------- */
  function devAdjustCardHtml(user) {
    if (user.role !== 'dev') return '';
    var lastDay = '2026-10-21';
    var key = lastDay;
    var sum = dayEditSummary(key);
    function field(id, label, value, hint) {
      return '<div class="field"><label for="' + id + '">' + label + '</label>' +
        '<input class="input" id="' + id + '" inputmode="numeric" value="' + (value == null ? '' : value) + '">' +
        (hint ? '<div class="hint">' + hint + '</div>' : '') + '</div>';
    }
    var a = sum && sum.adjustment ? sum.adjustment : {};
    return '<div class="card settings-section" id="devAdjustCard">' +
      '<h3>' + icon('sliders', 17) + ' Корректировка показателей <span class="badge badge-dev">Разработчик</span></h3>' +
      '<p class="desc">Только дни до 22.10.2026. Заполненные поля заменяют фактические значения в панели и аналитике.</p>' +
      '<div class="form-grid">' +
        '<div class="field"><label for="devAdjDate">Дата</label>' +
          '<input class="input" type="date" id="devAdjDate" max="' + lastDay + '" value="' + key + '">' +
          '<div class="hint">До 22 октября 2026</div></div>' +
        '<div class="field"><label>&nbsp;</label><div id="devAdjStatus" style="padding-top:9px"></div></div>' +
      '</div>' +
      '<div id="devAdjBody">' +
        '<div class="form-grid" style="margin-top:12px">' +
          field('devAdjRevenue', 'Выручка, ₸', a.revenue != null ? a.revenue : '', sum ? 'сейчас: ' + fmtMoney(sum.revenue) : '') +
          field('devAdjExpenses', 'Расходы, ₸', a.expenses != null ? a.expenses : '', sum ? 'сейчас: ' + fmtMoney(sum.expenses) : '') +
          field('devAdjProfit', 'Прибыль, ₸', a.profit != null ? a.profit : '', sum ? 'сейчас: ' + fmtMoney(sum.profit) : '') +
          field('devAdjAvg', 'Средний чек, ₸', a.avgCheck != null ? a.avgCheck : '', sum ? 'сейчас: ' + fmtMoney(sum.avgCheck) : '') +
          field('devAdjCash', 'Наличные, ₸', a.cash != null ? a.cash : '', sum ? 'сейчас: ' + fmtMoney(sum.cash) : '') +
          field('devAdjQr', 'Kaspi QR, ₸', a.qr != null ? a.qr : '', sum ? 'сейчас: ' + fmtMoney(sum.qr) : '') +
          field('devAdjMixed', 'Смешанные, ₸', a.mixed != null ? a.mixed : '', sum ? 'сейчас: ' + fmtMoney(sum.mixed) : '') +
        '</div>' +
      '</div>' +
      '<div class="flex gap-8 wrap" style="margin-top:12px">' +
        '<button type="button" class="btn btn-primary" id="devAdjSave">' + icon('check', 16) + ' Сохранить корректировку</button>' +
        '<button type="button" class="btn btn-secondary" id="devAdjClear">' + icon('refresh', 16) + ' Сбросить</button>' +
        '<button type="button" class="btn btn-danger-soft" id="devAdjDelStubs">' + icon('trash', 15) + ' Удалить заглушки дня</button>' +
        '<button type="button" class="btn btn-danger-soft" id="devAdjDelHistory">' + icon('trash', 15) + ' Удалить историю дня</button>' +
        '<button type="button" class="btn btn-danger btn-sm" id="devAdjDelAll">' + icon('alert', 15) + ' Удалить все продажи дня</button>' +
      '</div>' +
      '<div class="form-note info" style="margin-top:10px">' + icon('info', 15) +
        '<span>Удаление продаж не меняет склад — это прошлые данные. Дни с 22.10.2026 не редактируются.</span></div>' +
    '</div>';
  }

  function bindDevAdjustCard(root, ctx) {
    var card = root.querySelector('#devAdjustCard');
    if (!card) return;
    var user = ctx.user;
    var dateEl = card.querySelector('#devAdjDate');
    var statusEl = card.querySelector('#devAdjStatus');
    var fields = {
      revenue: card.querySelector('#devAdjRevenue'),
      expenses: card.querySelector('#devAdjExpenses'),
      profit: card.querySelector('#devAdjProfit'),
      avgCheck: card.querySelector('#devAdjAvg'),
      cash: card.querySelector('#devAdjCash'),
      qr: card.querySelector('#devAdjQr'),
      mixed: card.querySelector('#devAdjMixed')
    };

    function paint(key, keepValues) {
      var sum = dayEditSummary(key);
      if (!sum) { statusEl.innerHTML = '<span class="badge danger">Некорректная дата</span>'; return; }
      var a = sum.adjustment || {};
      Object.keys(fields).forEach(function (f) {
        if (!fields[f]) return;
        if (!keepValues) fields[f].value = a[f] != null ? a[f] : '';
        fields[f].placeholder = sum[f] != null ? Math.round(sum[f]) : '0';
      });
      statusEl.innerHTML =
        '<span class="badge ' + (sum.adjustment ? 'warn' : 'neutral') + '">' +
          (sum.adjustment ? 'Корректировка есть' : 'Корректировки нет') + '</span> ' +
        '<span class="small muted">' + fmtNumber(sum.sales) + ' записей' +
          (sum.history ? ' · история ' + fmtNumber(sum.history) : '') +
          (sum.stubs ? ' · заглушек ' + fmtNumber(sum.stubs) : '') +
          ' · ' + fmtNumber(sum.count) + ' чеков</span>';
    }

    function currentKey() { return dateEl.value || dayKey(new Date()); }
    paint(currentKey(), false);

    dateEl.addEventListener('change', function () {
      var key = currentKey();
      if (!canAdjustDay(key)) {
        toast('Можно править только дни до 22.10.2026', 'error');
        dateEl.value = '2026-10-21';
        key = '2026-10-21';
      }
      paint(key, false);
    });

    card.querySelector('#devAdjSave').addEventListener('click', function () {
      var key = currentKey();
      var patch = {};
      Object.keys(fields).forEach(function (f) {
        if (fields[f] && String(fields[f].value).trim() !== '') patch[f] = parseAmount(fields[f].value);
      });
      var res = setDayAdjustment(user, key, patch, { replace: true });
      if (res.error) { toast(res.error, 'error'); return; }
      toast(res.adjustment ? 'Показатели за ' + fmtDate(parseDayKey(key)) + ' сохранены' : 'Корректировка снята', 'success', 4000);
      paint(key, false);
      ctx.rerender();
    });

    card.querySelector('#devAdjClear').addEventListener('click', function () {
      var key = currentKey();
      var res = resetDayAdjustment(user, key);
      if (res.error) { toast(res.error, 'error'); return; }
      if (!res.removed) { toast('За этот день корректировки нет', 'info'); return; }
      toast('Корректировка снята — значения снова фактические', 'success', 4000);
      ctx.rerender();
    });

    function removeSales(opts, title, msg) {
      confirmDialog({ title: title, message: msg, confirmText: 'Удалить', danger: true }).then(function (okay) {
        if (!okay) return;
        var res = deleteDaySales(user, currentKey(), opts);
        if (res.error) { toast(res.error, 'error'); return; }
        toast(res.removed ? 'Удалено ' + fmtNumber(res.removed) + ' записей на ' + fmtMoney(res.revenue) : 'Нечего удалять', res.removed ? 'success' : 'info', 4200);
        ctx.rerender();
      });
    }

    card.querySelector('#devAdjDelStubs').addEventListener('click', function () {
      var sum = dayEditSummary(currentKey());
      removeSales({ onlyStubs: true }, 'Удалить заглушки дня?',
        'За ' + fmtDate(parseDayKey(currentKey())) + ' будет удалено сводных записей: <b>' + fmtNumber(sum.stubs) + '</b>. Транзакции и обычные продажи останутся.');
    });

    card.querySelector('#devAdjDelHistory').addEventListener('click', function () {
      var sum = dayEditSummary(currentKey());
      removeSales({ onlyHistory: true }, 'Удалить историю дня?',
        'За ' + fmtDate(parseDayKey(currentKey())) + ' будет удалено записей истории (транзакции и заглушки): <b>' + fmtNumber(sum.history) + '</b>. Обычные продажи останутся.');
    });

    card.querySelector('#devAdjDelAll').addEventListener('click', function () {
      var sum = dayEditSummary(currentKey());
      removeSales({}, 'Удалить все продажи дня?',
        'За ' + fmtDate(parseDayKey(currentKey())) + ' будут удалены <b>все</b> продажи: ' + fmtNumber(sum.sales) + ' записей на ' + fmtMoney(sum.revenue) + '. Склад не изменится. Действие необратимо.');
    });
  }

  function stockCardHtml(user) {
    var data = window.POS_IMPORT_DATA;
    if (!data || !Array.isArray(data.stock) || !data.stock.length) return '';
    var sum = legacyStockSummary();
    var applied = DB.settings.legacyStockApplied || null;
    var rows = DB.stock.length;
    var pointNames = data.stock.map(function (b) { return b.point; });

    return '<div class="card settings-section" id="stockCard">' +
      '<h3>' + icon('layers', 17) + ' Остатки склада из старой системы</h3>' +
      '<p class="desc">Отчёт по складу на 19.10.2026 — по каждой точке отдельно</p>' +
      (applied
        ? '<span class="badge success">' + icon('check', 12) + ' Перенесено ' + fmtDate(applied) + ': ' + sum.points + ' точек, ' + fmtNumber(sum.qty) + ' шт</span>'
        : '<div class="about-list">' +
            '<div class="about-row"><span class="k">Точки продаж</span><span class="v">' + sum.points + '</span></div>' +
            '<div class="about-row"><span class="k">Позиций остатков</span><span class="v">' + sum.positions + '</span></div>' +
            '<div class="about-row"><span class="k">Всего единиц</span><span class="v">' + fmtNumber(sum.qty) + ' шт</span></div>' +
            '<div class="about-row"><span class="k">Дата отчёта</span><span class="v">' + (data.stockDate ? fmtDate(parseDateInput(data.stockDate, Date.now())) : '—') + '</span></div>' +
          '</div>') +
      '<div class="legacy-points">' + pointNames.map(function (n) { return '<span class="badge neutral">' + esc(n) + '</span>'; }).join('') + '</div>' +
      '<div class="flex gap-8 wrap" style="margin-top:12px">' +
        (applied
          ? '<button type="button" class="btn btn-secondary" id="stockReapply">' + icon('refresh', 16) + ' Проверить остатки</button>'
          : '<button type="button" class="btn btn-primary" id="stockApply">' + icon('download', 16) + ' Внести остатки</button>') +
        '<button type="button" class="btn btn-ghost" id="stockFixNames">' + icon('edit', 16) + ' Привести названия точек</button>' +
      '</div>' +
      '<div class="hint" id="stockNote">' +
        (applied
          ? 'Поставлено ' + rows + ' строк остатков. Продажи уже списывают товар с этих точек.'
          : 'Остатки встанут в точки ' + pointNames.join(', ') + ' — если такие точки уже есть, они получат данные, новые не создаются.') +
      '</div>' +
      '<div class="form-note info">' + icon('info', 15) +
        '<span>Остатки переносятся на дату отчёта: продажи с этого момента уменьшают количество, поставки — увеличивают.</span>' +
      '</div>' +
    '</div>';
  }

  function bindStockCard(root, ctx) {
    var data = window.POS_IMPORT_DATA;
    if (!data || !Array.isArray(data.stock) || !data.stock.length) return;
    var note = root.querySelector('#stockNote');
    function say(text, color) {
      if (!note) return;
      note.textContent = text;
      note.style.color = color || '';
    }

    var applyBtn = root.querySelector('#stockApply');
    if (applyBtn) applyBtn.addEventListener('click', async function () {
      var btn = this;
      var sum = legacyStockSummary();
      var ok = await confirmDialog({
        title: 'Внести остатки склада?',
        message: 'Остатки встанут в точки <b>' + data.stock.map(function (b) { return esc(b.point); }).join(', ') + '</b>: <b>' + sum.positions + ' строк</b> на <b>' + fmtNumber(sum.qty) + ' шт</b>.<br><br>Если такие точки уже есть в приложении — данные добавятся в них, новые точки не создаются. Товары появятся в кассе только тех точек, где они продаются.',
        confirmText: 'Внести остатки'
      });
      if (!ok) return;
      setButtonBusy(btn, true, 'Переносим…');
      try {
        var res = applyLegacyStock({ actor: ctx.user });
        var msg = 'Готово: точек +' + res.pointsCreated + ', строк остатков +' + res.rows + ', единиц ' + fmtNumber(res.qty);
        if (res.skipped) msg += ', пропущено уже существующих: ' + res.skipped;
        toast(msg, 'success', 6000);
        setTimeout(function () { ctx.rerender(); }, 400);
      } catch (err) {
        setButtonBusy(btn, false);
        say(err.message, 'var(--danger)');
        toast(err.message, 'error', 5200);
      }
    });

    var fixNames = root.querySelector('#stockFixNames');
    if (fixNames) fixNames.addEventListener('click', function () {
      var changed = migrateLegacyPointNames();
      toast(changed ? 'Названия точек обновлены: ' + changed : 'Названия уже совпадают с отчётами', changed ? 'success' : 'info', 4200);
      if (changed) setTimeout(function () { ctx.rerender(); }, 350);
    });

    var reapply = root.querySelector('#stockReapply');
    if (reapply) reapply.addEventListener('click', function () {
      var res = applyLegacyStock({ actor: ctx.user });
      var text = res.rows
        ? 'Добавлено новых строк: ' + res.rows + ' (' + fmtNumber(res.qty) + ' шт)'
        : 'Всё уже перенесено: ' + DB.stock.length + ' строк остатков, дублей нет';
      say(text, res.rows ? 'var(--success-600)' : '');
      toast(text, res.rows ? 'success' : 'info', 5200);
      if (res.rows) setTimeout(function () { ctx.rerender(); }, 400);
    });
  }

  function bindLegacyCard(root, ctx) {
    if (!window.POS_IMPORT_DATA) return;
    var note = root.querySelector('#legacyNote');
    function say(text, color) {
      if (!note) return;
      note.textContent = text;
      note.style.color = color || '';
    }

    var importBtn = root.querySelector('#legacyImport');
    if (importBtn) importBtn.addEventListener('click', async function () {
      var btn = this;
      var data = window.POS_IMPORT_DATA;
      var ok = await confirmDialog({
        title: 'Внести данные из старой системы?',
        message: 'В базу добавятся <b>' + data.products.length + ' товаров</b> и <b>' + data.totalSales + ' продаж</b> за 1–18 октября 2026 на сумму <b>' + fmtMoney(data.totalRevenue) + '</b>.<br><br>Существующие данные не удаляются. Позже эти записи можно удалить вручную.',
        confirmText: 'Внести данные'
      });
      if (!ok) return;
      setButtonBusy(btn, true, 'Переносим…');
      try {
        var res = applyLegacyStarter({ actor: ctx.user });
        toast('Готово: товаров +' + res.products.created + ', продаж +' + res.sales.created, 'success', 5200);
        setTimeout(function () { ctx.rerender(); }, 300);
      } catch (err) {
        setButtonBusy(btn, false);
        say(err.message, 'var(--danger)');
        toast(err.message, 'error', 5200);
      }
    });

    var again = root.querySelector('#legacyAgain');
    if (again) again.addEventListener('click', function () {
      var sales = DB.sales.filter(function (s) { return s.imported; });
      var revenue = sales.reduce(function (sum, s) { return sum + (s.total || 0); }, 0);
      var products = DB.products.filter(function (p) { return p.imported; }).length;
      say('В базе: ' + products + ' ' + plural(products, 'товар', 'товара', 'товаров') + ', ' +
        sales.length + ' ' + plural(sales.length, 'продажа', 'продажи', 'продаж') + ' на ' + fmtMoney(revenue), 'var(--success-600)');
    });

    var csvBtn = root.querySelector('#legacyCsv');
    var fileInput = root.querySelector('#legacyFile');
    if (csvBtn && fileInput) {
      csvBtn.addEventListener('click', function () { fileInput.click(); });
      fileInput.addEventListener('change', function () {
        var file = fileInput.files && fileInput.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function () {
          try {
            var rows = parseProductsCsv(reader.result);
            if (!rows.length) throw new Error('В файле не найдено ни одного товара');
            var res = importProducts(rows, {});
            toast('Товары: добавлено ' + res.created + ', пропущено ' + res.skipped + ', категорий +' + res.categories, 'success', 5200);
            setTimeout(function () { ctx.rerender(); }, 300);
          } catch (err) {
            toast(err.message, 'error', 5000);
          }
          fileInput.value = '';
        };
        reader.onerror = function () { toast('Не удалось прочитать файл', 'error'); };
        reader.readAsText(file, 'utf-8');
      });
    }

    var manual = root.querySelector('#legacyManual');
    if (manual) manual.addEventListener('click', function () {
      var defaultFrom = dayKey(Date.now() - 30 * 86400000);
      var defaultTo = dayKey(Date.now());
      openModal({
        title: 'История продаж за период',
        subtitle: 'Итоги из старой кассы: суммы должны сходиться',
        size: 'md',
        body: '<div class="form-grid">' +
            '<div class="field"><label for="impFrom">С</label><input class="input" id="impFrom" type="date" value="' + defaultFrom + '"></div>' +
            '<div class="field"><label for="impTo">По</label><input class="input" id="impTo" type="date" value="' + defaultTo + '"></div>' +
            '<div class="field"><label for="impCount">Количество продаж</label><input class="input" id="impCount" inputmode="numeric" placeholder="692"></div>' +
            '<div class="field"><label for="impRevenue">Выручка, ₸</label><input class="input" id="impRevenue" inputmode="numeric" placeholder="1405350"></div>' +
            '<div class="field"><label for="impCash">Наличные, ₸</label><input class="input" id="impCash" inputmode="numeric" placeholder="426400"></div>' +
            '<div class="field"><label for="impQr">Kaspi QR, ₸</label><input class="input" id="impQr" inputmode="numeric" placeholder="978950"></div>' +
            '<div class="field"><label for="impMixedCash">Из смешанных: наличными</label><input class="input" id="impMixedCash" inputmode="numeric" placeholder="30150"></div>' +
            '<div class="field"><label for="impMixedQr">Из смешанных: Kaspi</label><input class="input" id="impMixedQr" inputmode="numeric" placeholder="16950"></div>' +
            (DB.points.length > 1
              ? '<div class="field full"><label for="impPoint">Точка продаж</label><select class="select" id="impPoint">' +
                  DB.points.map(function (p) { return '<option value="' + p.id + '">' + esc(p.name) + '</option>'; }).join('') +
                '</select></div>'
              : '') +
          '</div>' +
          '<div class="form-note info">' + icon('info', 15) + '<span>Наличные + Kaspi QR должны равняться выручке. Смешанные — часть этих сумм.</span></div>',
        footer: '<button type="button" class="btn btn-secondary" data-cancel>Отмена</button>' +
                '<button type="button" class="btn btn-primary" data-save>Добавить</button>',
        onMount: function (el, close) {
          el.querySelector('[data-cancel]').addEventListener('click', close);
          el.querySelector('[data-save]').addEventListener('click', function () {
            var btn = this;
            try {
              var pointSel = el.querySelector('#impPoint');
              var res = importSalesHistory({
                from: el.querySelector('#impFrom').value,
                to: el.querySelector('#impTo').value,
                count: parseAmount(el.querySelector('#impCount').value),
                revenue: parseAmount(el.querySelector('#impRevenue').value),
                cashTotal: parseAmount(el.querySelector('#impCash').value),
                qrTotal: parseAmount(el.querySelector('#impQr').value),
                mixedCash: parseAmount(el.querySelector('#impMixedCash').value),
                mixedQr: parseAmount(el.querySelector('#impMixedQr').value),
                pointId: pointSel ? pointSel.value : undefined,
                actor: ctx.user
              });
              close();
              toast('Добавлено ' + res.created + ' продаж на ' + fmtMoney(res.revenue), 'success', 5000);
              setTimeout(function () { ctx.rerender(); }, 300);
            } catch (err) {
              toast(err.message, 'error', 5200);
              setButtonBusy(btn, false);
            }
          });
        }
      });
    });
  }


  /* ============================================================
     Продавец: только свой аккаунт и статус связи с сервером
     ============================================================ */
  function renderSellerSettings(root, ctx) {
    var user = ctx.user;
    var api = window.POS_API;
    var st = api && api.isServerConfigured() ? api.syncStatus() : null;
    var lastSync = st && st.lastSyncAt ? fmtDate(st.lastSyncAt) + ', ' + fmtTime(st.lastSyncAt) : 'ещё не было';

    root.innerHTML =
      '<div class="page">' +
        '<div class="page-head">' +
          '<div><h1>Профиль</h1><div class="sub">Аккаунт и связь с сервером</div></div>' +
          '<div class="page-actions"><button type="button" class="btn btn-secondary" id="logoutBtn">' + icon('logout', 16) + ' Выйти</button></div>' +
        '</div>' +

        '<div class="card profile-banner">' +
          avatarHtml(user.fullName, 'avatar-lg') +
          '<div class="grow" style="min-width:0">' +
            '<div class="nm">' + esc(user.fullName) + '</div>' +
            '<div class="rl">@' + esc(user.username) + ' · <span class="badge ' + roleBadgeClass(user.role) + '">' + roleLabel(user.role) + '</span>' +
              (userPointIds(user).length ? ' · ' + esc(userPointsLabel(user)) : ' · <span style="color:var(--warning)">точка не назначена</span>') + '</div>' +
          '</div>' +
        '</div>' +

        '<div class="card settings-section section-gap">' +
          '<h3>' + icon('cloud', 17) + ' Сервер</h3>' +
          '<div class="about-list">' +
            '<div class="about-row"><span class="k">Подключение</span><span class="v">' +
              (st ? '<span class="badge success">подключён</span>' : '<span class="badge neutral">не подключён</span>') + '</span></div>' +
            (st
              ? '<div class="about-row"><span class="k">Связь</span><span class="v">' +
                  (st.online ? '<span class="badge success">онлайн</span>' : '<span class="badge warn">офлайн</span>') + '</span></div>' +
                '<div class="about-row"><span class="k">Последняя синхронизация</span><span class="v">' + lastSync + '</span></div>' +
                (st.error ? '<div class="about-row"><span class="k">Ошибка</span><span class="v" style="color:var(--danger)">' + esc(st.error) + '</span></div>' : '')
              : '<div class="about-row"><span class="k">Данные</span><span class="v">хранятся на устройстве</span></div>') +
          '</div>' +
          (st
            ? '<button type="button" class="btn btn-secondary" id="srvCheck" style="align-self:flex-start">' + icon('cloud', 16) + ' Проверить связь</button>' +
              '<div class="hint" id="srvCheckResult"></div>'
            : '<div class="hint">Адрес сервера настраивает администратор. Пока данные хранятся только на этом устройстве.</div>') +
        '</div>' +

        '<div class="card settings-section">' +
          '<h3>Смена пароля</h3>' +
          '<div class="field"><label for="curPass">Текущий пароль</label>' +
            '<div class="pw-wrap"><input class="input" id="curPass" type="password" autocomplete="current-password">' +
            '<button type="button" class="pw-toggle" data-pw-toggle="curPass">' + icon('eye', 18) + '</button></div></div>' +
          '<div class="form-grid">' +
            '<div class="field"><label for="newPass">Новый пароль</label>' +
              '<div class="pw-wrap"><input class="input" id="newPass" type="password" autocomplete="new-password">' +
              '<button type="button" class="pw-toggle" data-pw-toggle="newPass">' + icon('eye', 18) + '</button></div></div>' +
            '<div class="field"><label for="newPass2">Повтор пароля</label>' +
              '<div class="pw-wrap"><input class="input" id="newPass2" type="password" autocomplete="new-password">' +
              '<button type="button" class="pw-toggle" data-pw-toggle="newPass2">' + icon('eye', 18) + '</button></div></div>' +
          '</div>' +
          '<button type="button" class="btn btn-primary" id="savePassword" style="align-self:flex-start">' + icon('lock', 16) + ' Обновить пароль</button>' +
        '</div>' +
      '</div>';

    bindPasswordToggle(root);
    root.querySelector('#logoutBtn').addEventListener('click', function () { ctx.logout(); });

    var checkBtn = root.querySelector('#srvCheck');
    if (checkBtn) {
      checkBtn.addEventListener('click', async function () {
        var btn = this;
        var box = root.querySelector('#srvCheckResult');
        setButtonBusy(btn, true, 'Проверяем…');
        try {
          var info = await window.POS_API.testServer();
          if (box) box.textContent = 'Сервер на связи · версия ' + (info.version || '—');
        } catch (err) {
          if (box) box.textContent = err.message || 'Нет связи с сервером';
        }
        setButtonBusy(btn, false);
      });
    }

    root.querySelector('#savePassword').addEventListener('click', async function () {
      var btn = this;
      var current = root.querySelector('#curPass').value;
      var next = root.querySelector('#newPass').value;
      var repeat = root.querySelector('#newPass2').value;
      if (!current) { toast('Введите текущий пароль', 'error'); return; }
      if (next.length < 6) { toast('Новый пароль — минимум 6 символов', 'error'); return; }
      if (next !== repeat) { toast('Пароли не совпадают', 'error'); return; }
      setButtonBusy(btn, true, 'Проверяем…');
      var currentHash = await hashPassword(current);
      if (currentHash !== user.pass) {
        setButtonBusy(btn, false);
        toast('Текущий пароль указан неверно', 'error');
        return;
      }
      if (window.POS_API && window.POS_API.isServerConfigured()) {
        try {
          await window.POS_API.changeServerPassword(current, next);
        } catch (err) {
          setButtonBusy(btn, false);
          toast(err.message || 'Сервер не принял пароль', 'error', 4600);
          return;
        }
      }
      user.pass = await hashPassword(next);
      user.updatedAt = Date.now();
      saveDB();
      setButtonBusy(btn, false);
      root.querySelector('#curPass').value = '';
      root.querySelector('#newPass').value = '';
      root.querySelector('#newPass2').value = '';
      toast('Пароль обновлён', 'success');
    });
  }

  PAGES.settings = {
    render: function (root, ctx) {
      var user = ctx.user;
      if (user.role === 'seller') { renderSellerSettings(root, ctx); return; }
      var isAdmin = user.role === 'admin';
      var info = storageInfo();
      var s = DB.settings;

      root.innerHTML =
        '<div class="page">' +
          '<div class="page-head">' +
            '<div><h1>Настройки</h1><div class="sub">Профиль, безопасность и данные приложения</div></div>' +
            '<div class="page-actions"><button type="button" class="btn btn-secondary" id="logoutBtn">' + icon('logout', 16) + ' Выйти из аккаунта</button></div>' +
          '</div>' +

          '<div class="card profile-banner">' +
            avatarHtml(user.fullName, 'avatar-lg') +
            '<div class="grow" style="min-width:0">' +
              '<div class="nm">' + esc(user.fullName) + '</div>' +
              '<div class="rl">@' + esc(user.username) + ' · <span class="badge ' + roleBadgeClass(user.role) + '">' + roleLabel(user.role) + '</span>' +
                (userPointIds(user).length ? ' · ' + esc(userPointsLabel(user)) : ' · <span style="color:var(--warning)">точка не назначена</span>') + '</div>' +
            '</div>' +
            '<div class="flex gap-8 wrap">' +
              '<span class="badge neutral">' + icon('calendar', 12) + ' с ' + fmtDate(user.createdAt || Date.now()) + '</span>' +
              '<span class="badge success">' + icon('checkCircle', 12) + ' Аккаунт активен</span>' +
            '</div>' +
          '</div>' +

          '<div class="settings-grid section-gap">' +
            '<div style="display:flex;flex-direction:column;gap:16px;min-width:0">' +
              '<div class="card settings-section">' +
                '<h3>Оформление</h3>' +
                '<p class="desc">Тема применяется сразу и запоминается на этом устройстве</p>' +
                '<div class="theme-seg" id="themeSeg">' +
                  '<button type="button" class="theme-option" data-theme-option="light" data-preview="light">' +
                    '<span class="preview"><span class="side"></span><span class="bars"><i></i><i></i><i></i><i></i></span></span>' +
                    'Светлая</button>' +
                  '<button type="button" class="theme-option" data-theme-option="dark" data-preview="dark">' +
                    '<span class="preview"><span class="side"></span><span class="bars"><i></i><i></i><i></i><i></i></span></span>' +
                    'Тёмная</button>' +
                  '<button type="button" class="theme-option" data-theme-option="system" data-preview="system">' +
                    '<span class="preview"><span class="side"></span><span class="bars"><i></i><i></i><i></i><i></i></span><span class="half-dark"><i></i><i></i><i></i><i></i></span></span>' +
                    'Системная</button>' +
                '</div>' +
                '<div class="hint" id="themeHint"></div>' +
              '</div>' +

              '<div class="card settings-section">' +
                '<h3>Профиль</h3>' +
                '<div class="form-grid">' +
                  '<div class="field full"><label for="setName">Полное имя</label>' +
                    '<input class="input" id="setName" value="' + esc(user.fullName) + '" maxlength="60"></div>' +
                  '<div class="field full"><label for="setLogin">Имя пользователя</label>' +
                    '<input class="input" id="setLogin" value="' + esc(user.username) + '" maxlength="32">' +
                    '<div class="hint">Используется для входа в систему</div></div>' +
                '</div>' +
                '<button type="button" class="btn btn-primary" id="saveProfile" style="align-self:flex-start">' + icon('check', 16) + ' Сохранить профиль</button>' +
              '</div>' +

              '<div class="card settings-section">' +
                '<h3>Смена пароля</h3>' +
                '<p class="desc">Пароль хранится в виде хеша и не отображается в открытом виде</p>' +
                '<div class="field"><label for="curPass">Текущий пароль</label>' +
                  '<div class="pw-wrap"><input class="input" id="curPass" type="password" autocomplete="current-password">' +
                  '<button type="button" class="pw-toggle" data-pw-toggle="curPass">' + icon('eye', 18) + '</button></div></div>' +
                '<div class="form-grid">' +
                  '<div class="field"><label for="newPass">Новый пароль</label>' +
                    '<div class="pw-wrap"><input class="input" id="newPass" type="password" autocomplete="new-password">' +
                    '<button type="button" class="pw-toggle" data-pw-toggle="newPass">' + icon('eye', 18) + '</button></div></div>' +
                  '<div class="field"><label for="newPass2">Повтор пароля</label>' +
                    '<div class="pw-wrap"><input class="input" id="newPass2" type="password" autocomplete="new-password">' +
                    '<button type="button" class="pw-toggle" data-pw-toggle="newPass2">' + icon('eye', 18) + '</button></div></div>' +
                '</div>' +
                '<button type="button" class="btn btn-primary" id="savePassword" style="align-self:flex-start">' + icon('lock', 16) + ' Обновить пароль</button>' +
              '</div>' +

              '<div class="card settings-section">' +
                '<h3>Контакты и компания</h3>' +
                '<p class="desc">Отображаются в разделе «Помощь → Контакты разработчика»</p>' +
                (isAdmin
                  ? '<div class="form-grid">' +
                      '<div class="field full"><label for="setCompany">Название бизнеса</label>' +
                        '<input class="input" id="setCompany" value="' + esc(s.companyName || '') + '" placeholder="Например, Coffee Point"></div>' +
                      '<div class="field"><label for="setPhone">Телефон</label>' +
                        '<input class="input" id="setPhone" value="' + esc(s.supportPhone || '') + '" placeholder="+7 700 000 00 00"></div>' +
                      '<div class="field"><label for="setEmail">Email</label>' +
                        '<input class="input" id="setEmail" type="email" value="' + esc(s.supportEmail || '') + '" placeholder="support@example.com"></div>' +
                      '<div class="field full"><label for="setTelegram">Telegram</label>' +
                        '<input class="input" id="setTelegram" value="' + esc(s.supportTelegram || '') + '" placeholder="username без @"></div>' +
                    '</div>' +
                    '<button type="button" class="btn btn-primary" id="saveContacts" style="align-self:flex-start">' + icon('check', 16) + ' Сохранить контакты</button>'
                  : '<div class="form-note info">' + icon('info', 15) + '<span>Контакты заполняет администратор. Текущие значения видны в разделе «Помощь».</span></div>' +
                    '<div class="about-list">' +
                      '<div class="about-row"><span class="k">Компания</span><span class="v">' + esc(s.companyName || '—') + '</span></div>' +
                      '<div class="about-row"><span class="k">Телефон</span><span class="v">' + esc(s.supportPhone || '—') + '</span></div>' +
                      '<div class="about-row"><span class="k">Email</span><span class="v">' + esc(s.supportEmail || '—') + '</span></div>' +
                      '<div class="about-row"><span class="k">Telegram</span><span class="v">' + esc(s.supportTelegram || '—') + '</span></div>' +
                    '</div>') +
              '</div>' +
            '</div>' +

            '<div style="display:flex;flex-direction:column;gap:16px;min-width:0">' +
              serverCardHtml(user) +
              devAdjustCardHtml(user) +
              historyCardHtml(user) +
              legacyCardHtml(user) +
              stockCardHtml(user) +
              '<div class="card settings-section">' +
                '<h3>Данные и резервные копии</h3>' +
                '<p class="desc">Вся база хранится локально на этом устройстве</p>' +
                '<div class="kpi-inline" style="grid-template-columns:1fr 1fr">' +
                  '<div class="kpi-mini"><div class="l">Размер базы</div><div class="v">' + info.label + '</div></div>' +
                  '<div class="kpi-mini"><div class="l">Изображений</div><div class="v">' + info.photos + '</div></div>' +
                '</div>' +
                '<div class="bar-track" style="height:8px"><div class="bar-fill" style="width:' + Math.max(2, info.percent) + '%"></div></div>' +
                '<div class="tiny muted">Использовано примерно ' + info.percent + '% доступного хранилища браузера (≈5 МБ).</div>' +
                '<div class="divider" style="margin:6px 0"></div>' +
                '<div class="flex gap-8 wrap">' +
                  '<button type="button" class="btn btn-primary" id="backupDownload">' + icon('download', 16) + ' Скачать копию (JSON)</button>' +
                  '<button type="button" class="btn btn-secondary" id="backupUpload">' + icon('upload', 16) + ' Восстановить</button>' +
                  '<input type="file" id="backupFile" accept=".json,application/json" hidden>' +
                '</div>' +
                '<div class="form-note info">' + icon('shield', 15) + '<span>Резервная копия включает пользователей, продажи, склад, время и фотографии. Храните файл в безопасном месте — в нём есть хеши паролей.</span></div>' +
              '</div>' +

              '<div class="card settings-section">' +
                '<h3>О системе</h3>' +
                '<div class="about-list">' +
                  '<div class="about-row"><span class="k">Приложение</span><span class="v">' + APP_CONFIG.name + '</span></div>' +
                  '<div class="about-row"><span class="k">Версия</span><span class="v">' + APP_CONFIG.version + '</span></div>' +
                  '<div class="about-row"><span class="k">Режим данных</span><span class="v">локальный, офлайн-first</span></div>' +
                  '<div class="about-row"><span class="k">Синхронизация</span><span class="v">' +
                    (window.POS_API && window.POS_API.isServerConfigured()
                      ? '<span style="color:var(--success-600)">Cloudflare · включена</span>'
                      : '<span style="color:var(--warning)">не подключена</span>') + '</span></div>' +
                  '<div class="about-row"><span class="k">Экспорт</span><span class="v">Excel (.xlsx), JSON</span></div>' +
                '</div>' +
                '<a class="btn btn-secondary" href="#/help" style="align-self:flex-start" id="goHelp">' + icon('book', 16) + ' Открыть руководство</a>' +
              '</div>' +

              '<div class="danger-zone">' +
                '<h4>' + icon('alert', 15) + ' Опасная зона</h4>' +
                '<p>Полный сброс удалит всех пользователей, товары, продажи, склад и историю времени на этом устройстве. Перед сбросом скачайте резервную копию.</p>' +
                '<button type="button" class="btn btn-danger btn-sm" id="resetAll">' + icon('trash', 15) + ' Сбросить все данные</button>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>';

      bindPasswordToggle(root);
      bindServerCard(root, ctx);
      bindLegacyCard(root, ctx);
      bindHistoryCard(root, ctx);
      bindDevAdjustCard(root, ctx);
      bindStockCard(root, ctx);
      root.querySelector('#logoutBtn').addEventListener('click', function () { ctx.logout(); });

      /* тема */
      function paintThemeOptions() {
        var pref = themePreference();
        root.querySelectorAll('[data-theme-option]').forEach(function (btn) {
          btn.classList.toggle('active', btn.getAttribute('data-theme-option') === pref);
        });
        var hint = root.querySelector('#themeHint');
        if (hint) {
          hint.textContent = pref === 'system'
            ? 'Сейчас используется ' + (resolvedTheme() === 'dark' ? 'тёмная' : 'светлая') + ' тема — как в системе. Переключится автоматически при смене темы телефона.'
            : 'Выбрана ' + (pref === 'dark' ? 'тёмная' : 'светлая') + ' тема принудительно.';
        }
      }
      root.querySelectorAll('[data-theme-option]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          setThemePreference(btn.getAttribute('data-theme-option'));
          paintThemeOptions();
          var toggle = document.getElementById('themeToggle');
          if (toggle) toggle.innerHTML = icon(resolvedTheme() === 'dark' ? 'sun' : 'moon', 17);
          toast('Тема: ' + (themePreference() === 'system' ? 'как в системе' : (resolvedTheme() === 'dark' ? 'тёмная' : 'светлая')), 'success');
        });
      });
      paintThemeOptions();

      /* профиль */
      root.querySelector('#saveProfile').addEventListener('click', async function () {
        var saveBtn = this;
        var name = root.querySelector('#setName').value.trim();
        var login = root.querySelector('#setLogin').value.trim();
        if (!name) { toast('Имя не может быть пустым', 'error'); return; }
        if (!/^[A-Za-zА-Яа-яЁё0-9_\-\.]{2,32}$/.test(login)) { toast('Логин: 2–32 символа (буквы, цифры, _ - .)', 'error'); return; }
        var dup = DB.users.some(function (u) { return u.username.toLowerCase() === login.toLowerCase() && u.id !== user.id; });
        if (dup) { toast('Это имя пользователя уже занято', 'error'); return; }

        var api = window.POS_API;
        var patch = { fullName: name, username: login };
        if (api && api.isServerConfigured()) {
          setButtonBusy(saveBtn, true, 'Сохраняем…');
          try {
            var res = await api.updateServerUser({
              userId: user.id, fullName: name, username: login, role: user.role,
              pointIds: userPointIds(user), pointId: user.pointId, workStart: user.workStart, workEnd: user.workEnd
            });
            if (res && res.user) patch.updatedAt = res.user.updatedAt;
          } catch (err) {
            setButtonBusy(saveBtn, false);
            toast(err.message || 'Не удалось сохранить на сервере', 'error', 4600);
            return;
          }
          setButtonBusy(saveBtn, false);
        }
        updateUser(user.id, patch);
        toast('Профиль сохранён', 'success');
        ctx.rerender();
      });

      /* пароль */
      root.querySelector('#savePassword').addEventListener('click', async function () {
        var btn = this;
        var current = root.querySelector('#curPass').value;
        var next = root.querySelector('#newPass').value;
        var repeat = root.querySelector('#newPass2').value;
        if (!current) { toast('Введите текущий пароль', 'error'); return; }
        if (next.length < 6) { toast('Новый пароль — минимум 6 символов', 'error'); return; }
        if (next !== repeat) { toast('Пароли не совпадают', 'error'); return; }
        setButtonBusy(btn, true, 'Проверяем…');
        var currentHash = await hashPassword(current);
        if (currentHash !== user.pass) {
          setButtonBusy(btn, false);
          toast('Текущий пароль указан неверно', 'error');
          return;
        }
        if (window.POS_API && window.POS_API.isServerConfigured()) {
          try {
            await window.POS_API.changeServerPassword(current, next);
          } catch (err) {
            setButtonBusy(btn, false);
            toast(err.message || 'Сервер не принял пароль', 'error', 4600);
            return;
          }
        }
        user.pass = await hashPassword(next);
        user.updatedAt = Date.now();
        saveDB();
        setButtonBusy(btn, false);
        root.querySelector('#curPass').value = '';
        root.querySelector('#newPass').value = '';
        root.querySelector('#newPass2').value = '';
        toast('Пароль обновлён', 'success');
      });

      /* контакты */
      var saveContacts = root.querySelector('#saveContacts');
      if (saveContacts) {
        saveContacts.addEventListener('click', function () {
          DB.settings.companyName = root.querySelector('#setCompany').value.trim();
          DB.settings.supportPhone = root.querySelector('#setPhone').value.trim();
          DB.settings.supportEmail = root.querySelector('#setEmail').value.trim();
          DB.settings.supportTelegram = root.querySelector('#setTelegram').value.trim().replace(/^@/, '');
          DB.settings.updatedAt = Date.now();
          saveDB();
          toast('Контакты сохранены', 'success');
          ctx.rerender();
        });
      }

      /* резервные копии */
      root.querySelector('#backupDownload').addEventListener('click', function () {
        var stamp = fmtDate(Date.now()).replace(/\./g, '-') + '_' + fmtTime(Date.now()).replace(':', '-');
        PosXlsx.downloadJson('pos_backup_' + stamp + '.json', exportBackup());
        toast('Резервная копия скачана', 'success');
      });
      var fileInput = root.querySelector('#backupFile');
      root.querySelector('#backupUpload').addEventListener('click', function () { fileInput.click(); });
      fileInput.addEventListener('change', function () {
        var file = fileInput.files && fileInput.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = async function () {
          try {
            var payload = JSON.parse(reader.result);
            var ok = await confirmDialog({
              title: 'Восстановить из копии?',
              message: 'Текущие данные будут <b>заменены</b> содержимым файла «' + esc(file.name) + '». Рекомендуется сначала скачать текущую копию.',
              confirmText: 'Восстановить',
              danger: true
            });
            if (!ok) { fileInput.value = ''; return; }
            importBackup(payload);
            toast('База восстановлена', 'success');
            setTimeout(function () { location.reload(); }, 600);
          } catch (err) {
            toast(err.message || 'Не удалось прочитать файл', 'error', 5000);
          }
          fileInput.value = '';
        };
        reader.onerror = function () { toast('Не удалось прочитать файл', 'error'); };
        reader.readAsText(file);
      });

      /* сброс */
      root.querySelector('#resetAll').addEventListener('click', async function () {
        var ok = await confirmDialog({
          title: 'Сбросить все данные?',
          message: 'Будут удалены <b>все</b> пользователи, товары, точки, продажи, склад и записи времени. Это действие нельзя отменить.<br><br>Рекомендуем сначала скачать резервную копию.',
          confirmText: 'Удалить всё',
          danger: true
        });
        if (!ok) return;
        resetDB();
        if (typeof window.resetCashState === 'function') window.resetCashState();
        toast('Все данные удалены. Создайте первый аккаунт.', 'info', 4600);
        ctx.navigate('login');
      });

      var goHelp = root.querySelector('#goHelp');
      if (goHelp) goHelp.addEventListener('click', function (e) { e.preventDefault(); ctx.navigate('help'); });
    }
  };
})();
