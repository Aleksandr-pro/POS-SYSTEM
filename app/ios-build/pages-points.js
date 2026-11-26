/* ============================================================
   POS Контроль — точки продаж, пользователи, склад точки
   ============================================================ */
(function () {
  'use strict';
  var PAGES = window.PAGES = window.PAGES || {};
  var state = { tab: 'points', stockPointId: null };

  function pointStats(pointId) {
    var users = DB.users.filter(function (u) { return userPointIds(u).indexOf(pointId) !== -1; }).length;
    var products = productsForPoint(pointId).length;
    var rows = DB.stock.filter(function (r) { return r.pointId === pointId; });
    return { users: users, products: products, units: rows.reduce(function (s, r) { return s + r.qty; }, 0), positions: rows.length };
  }

  function openPointModal(ctx, point) {
    var editing = !!point;
    openModal({
      title: editing ? 'Редактировать точку' : 'Новая точка продаж',
      subtitle: editing ? '' : 'Точка продаж нужна для кассы, склада и учёта времени',
      body:
        '<div class="form-grid">' +
          '<div class="field full"><label for="ptName">Название точки *</label>' +
            '<input class="input" id="ptName" placeholder="Например, Точка №1 — Центральная" maxlength="60" value="' + esc(point ? point.name : '') + '" autofocus></div>' +
          '<div class="field full"><label for="ptAddress">Адрес</label>' +
            '<input class="input" id="ptAddress" placeholder="Город, улица, дом" maxlength="120" value="' + esc(point && point.address ? point.address : '') + '"></div>' +
          '<div class="field"><label for="ptLat">Широта</label>' +
            '<input class="input" id="ptLat" inputmode="decimal" placeholder="50.283900" value="' + (point && point.lat ? point.lat : '') + '"></div>' +
          '<div class="field"><label for="ptLng">Долгота</label>' +
            '<input class="input" id="ptLng" inputmode="decimal" placeholder="57.166000" value="' + (point && point.lng ? point.lng : '') + '"></div>' +
          '<div class="full"><button type="button" class="btn btn-secondary btn-sm" id="ptGeoBtn">' + icon('pin', 15) + ' Определить моё местоположение</button>' +
            '<div class="hint" id="ptGeoHint" style="margin-top:6px">Координаты используются для геометок при учёте времени.</div></div>' +
        '</div>',
      footer:
        '<button type="button" class="btn btn-secondary" id="ptCancel">Отмена</button>' +
        '<button type="button" class="btn btn-primary" id="ptSave">' + (editing ? 'Сохранить' : 'Создать точку') + '</button>',
      onMount: function (el, close) {
        el.querySelector('#ptCancel').addEventListener('click', close);
        el.querySelector('#ptGeoBtn').addEventListener('click', async function () {
          var btn = this;
          setButtonBusy(btn, true, 'Определяем…');
          try {
            var geo = await getGeoPosition();
            el.querySelector('#ptLat').value = geo.lat;
            el.querySelector('#ptLng').value = geo.lng;
            el.querySelector('#ptGeoHint').textContent = 'Координаты определены (точность ±' + geo.acc + ' м)';
            toast('Координаты заполнены', 'success');
          } catch (err) {
            toast(err.message, 'error');
          }
          setButtonBusy(btn, false);
        });
        el.querySelector('#ptSave').addEventListener('click', function () {
          var name = el.querySelector('#ptName').value.trim();
          var address = el.querySelector('#ptAddress').value.trim();
          var lat = parseFloat(el.querySelector('#ptLat').value);
          var lng = parseFloat(el.querySelector('#ptLng').value);
          if (!name) { toast('Введите название точки', 'error'); el.querySelector('#ptName').focus(); return; }
          if (DB.points.some(function (p) { return p.name.toLowerCase() === name.toLowerCase() && (!editing || p.id !== point.id); })) {
            toast('Точка с таким названием уже есть', 'warn');
            return;
          }
          var payload = {
            name: name,
            address: address,
            lat: isFinite(lat) ? lat : null,
            lng: isFinite(lng) ? lng : null,
            updatedAt: Date.now()
          };
          if (editing) {
            Object.assign(point, payload);
          } else {
            DB.points.push(Object.assign({ id: uid(), createdAt: Date.now() }, payload));
          }
          saveDB();
          close();
          toast(editing ? 'Точка обновлена' : 'Точка «' + name + '» создана', 'success');
          ctx.rerender();
        });
      }
    });
  }

  function openUserModal(ctx, user, editingUser) {
    var editing = !!editingUser;
    var roleOptions = user.role === 'admin' ? ['seller', 'dev', 'admin'] : ['seller', 'dev'];
    if (editing && editingUser.role === 'admin' && user.role !== 'admin') roleOptions = ['admin'];
    var points = DB.points;

    openModal({
      title: editing ? 'Редактировать пользователя' : 'Новый пользователь',
      subtitle: editing ? '@' + editingUser.username : 'Сотрудник сможет войти по логину и паролю',
      size: 'lg',
      body:
        '<div class="form-grid">' +
          '<div class="field"><label for="usName">Полное имя *</label>' +
            '<input class="input" id="usName" placeholder="Имя и фамилия" maxlength="60" value="' + esc(editing ? editingUser.fullName : '') + '" autofocus></div>' +
          '<div class="field"><label for="usLogin">Имя пользователя *</label>' +
            '<input class="input" id="usLogin" placeholder="login" maxlength="32" value="' + esc(editing ? editingUser.username : '') + '"></div>' +
          '<div class="field"><label for="usPass">' + (editing ? 'Новый пароль' : 'Пароль *') + '</label>' +
            '<input class="input" id="usPass" type="text" placeholder="' + (editing ? 'Оставьте пустым, чтобы не менять' : 'Минимум 6 символов') + '"></div>' +
          '<div class="field"><label for="usRole">Роль</label>' +
            '<select class="select" id="usRole">' +
              roleOptions.map(function (r) {
                return '<option value="' + r + '"' + (editing && editingUser.role === r ? ' selected' : (!editing && r === 'seller' ? ' selected' : '')) + '>' + roleLabel(r) + '</option>';
              }).join('') +
            '</select></div>' +
          '<div class="field full"><label>Точки продаж</label>' +
            (points.length
              ? '<div class="point-checks" id="usPoints">' +
                  points.map(function (p) {
                    var checked = editing
                      ? userPointIds(editingUser).indexOf(p.id) !== -1
                      : (points.length === 1);
                    return '<label class="check"><input type="checkbox" value="' + p.id + '"' + (checked ? ' checked' : '') + '><span>' + esc(p.name) + '</span></label>';
                  }).join('') +
                '</div>' +
                '<div class="hint">Можно отметить несколько точек — сотрудник сам переключается между ними в кассе и отчётах. Первая отмеченная считается основной.</div>'
              : '<div class="form-note warn">' + icon('alert', 15) + '<span>Сначала создайте хотя бы одну точку продаж.</span></div>') +
          '</div>' +
          '<div class="field"><label>График работы</label>' +
            '<div class="flex gap-8">' +
              '<input class="input" id="usStart" type="time" value="' + esc(editing && editingUser.workStart ? editingUser.workStart : '') + '" title="Начало">' +
              '<span class="muted">—</span>' +
              '<input class="input" id="usEnd" type="time" value="' + esc(editing && editingUser.workEnd ? editingUser.workEnd : '') + '" title="Конец">' +
            '</div></div>' +
        '</div>' +
        '<div class="form-note info" style="margin-top:14px">' + icon('info', 15) +
          '<span>Продавцу обязательно назначьте точку продаж — без неё касса недоступна. Настройку графика можно оставить пустой.</span></div>',
      footer:
        '<button type="button" class="btn btn-secondary" id="usCancel">Отмена</button>' +
        '<button type="button" class="btn btn-primary" id="usSave">' + (editing ? 'Сохранить' : 'Создать пользователя') + '</button>',
      onMount: function (el, close) {
        el.querySelector('#usCancel').addEventListener('click', close);
        el.querySelector('#usSave').addEventListener('click', async function () {
          var fullName = el.querySelector('#usName').value.trim();
          var username = el.querySelector('#usLogin').value.trim();
          var password = el.querySelector('#usPass').value;
          var role = el.querySelector('#usRole').value;
          var pointChecks = el.querySelectorAll('#usPoints input[type=checkbox]');
          var pointIds = [];
          Array.prototype.forEach.call(pointChecks, function (box) { if (box.checked) pointIds.push(box.value); });
          var pointId = pointIds[0] || null;
          var workStart = el.querySelector('#usStart').value;
          var workEnd = el.querySelector('#usEnd').value;
          var saveBtn = this;

          if (!fullName) { toast('Укажите полное имя', 'error'); return; }
          if (!/^[A-Za-zА-Яа-яЁё0-9_\-\.]{2,32}$/.test(username)) { toast('Имя пользователя: 2–32 символа (буквы, цифры, _ - .)', 'error'); return; }
          var duplicate = DB.users.some(function (u) {
            return u.username.toLowerCase() === username.toLowerCase() && (!editing || u.id !== editingUser.id);
          });
          if (duplicate) { toast('Это имя пользователя уже занято', 'error'); return; }
          if (!editing && password.length < 6) { toast('Пароль — минимум 6 символов', 'error'); return; }
          if (password && password.length < 6) { toast('Новый пароль — минимум 6 символов', 'error'); return; }

          setButtonBusy(saveBtn, true, 'Сохраняем…');
          try {
            var api = window.POS_API;
            var server = api && api.isServerConfigured();

            if (editing) {
              var patch = { fullName: fullName, username: username, role: role, pointIds: pointIds, pointId: pointId, workStart: workStart, workEnd: workEnd };
              if (password) patch.pass = await hashPassword(password);
              if (editingUser.role === 'admin' && role !== 'admin') {
                var admins = DB.users.filter(function (u) { return u.role === 'admin'; });
                if (admins.length <= 1) throw new Error('Нельзя понизить роль последнего администратора');
              }
              if (server) {
                var res = await api.updateServerUser({
                  userId: editingUser.id, fullName: fullName, username: username, role: role,
                  pointIds: pointIds, pointId: pointId, workStart: workStart, workEnd: workEnd, password: password || ''
                });
                if (res && res.user) patch.updatedAt = res.user.updatedAt;
              }
              updateUser(editingUser.id, patch);
            } else {
              var created = await createUser({ fullName: fullName, username: username, password: password, role: role, pointIds: pointIds, pointId: pointId, workStart: workStart, workEnd: workEnd });
              if (server) {
                try {
                  var createdRes = await api.createServerUser({
                    fullName: fullName, username: username, password: password, role: role,
                    pointIds: pointIds, pointId: pointId, workStart: workStart, workEnd: workEnd
                  });
                  if (createdRes && createdRes.user) {
                    // серверный id становится основным — учётка входа живёт на сервере
                    var idx = DB.users.findIndex(function (u) { return u.id === created.id; });
                    if (idx !== -1) {
                      DB.users[idx].id = createdRes.user.id;
                      DB.users[idx].updatedAt = createdRes.user.updatedAt;
                      api.markVersions('users', [DB.users[idx]]);
                      saveDB();
                    }
                  }
                } catch (err) {
                  DB.users = DB.users.filter(function (u) { return u.id !== created.id; });
                  saveDB();
                  throw new Error('Сервер: ' + err.message);
                }
              }
            }
            close();
            toast(editing ? 'Пользователь обновлён' : 'Пользователь создан', 'success');
            ctx.rerender();
          } catch (err) {
            toast(err.message, 'error');
            setButtonBusy(saveBtn, false);
          }
        });
      }
    });
  }

  /* ---------- импорт сотрудников из CSV ---------- */
  function openUserImportModal(ctx, actor) {
    var parsed = null;
    var fileText = '';

    openModal({
      title: 'Импорт сотрудников',
      subtitle: 'Список из старой системы: имя, логин, роль, пароль',
      size: 'lg',
      body:
        '<div class="form-note info" style="margin-bottom:14px">' + icon('info', 15) +
          '<span>Файл CSV с колонками <b>Имя</b>, <b>Имя пользователя</b>, <b>Роль</b>, <b>Пароль</b>. Роли: seller / admin / dev. Сотрудник войдёт по своему паролю; точки продаж назначаются потом в этом же разделе.</span>' +
        '</div>' +
        '<div class="field">' +
          '<label>Файл CSV</label>' +
          '<input class="input" type="file" id="impFile" accept=".csv,text/csv,text/plain">' +
        '</div>' +
        '<div class="field"><label for="impText">…или вставьте строки сюда</label>' +
          '<textarea class="input" id="impText" rows="7" placeholder="Иванова,ivanova_1,seller,ivanova_123&#10;Петрова,petrova,seller,petrova_123" style="font-family:ui-monospace,monospace;font-size:12.5px"></textarea>' +
        '</div>' +
        '<div id="impPreview"></div>',
      footer:
        '<button type="button" class="btn btn-secondary" data-cancel>Отмена</button>' +
        '<button type="button" class="btn btn-primary" id="impGo">' + icon('upload', 16) + ' Импортировать</button>',
      onMount: function (el, close) {
        var fileEl = el.querySelector('#impFile');
        var textEl = el.querySelector('#impText');
        var previewEl = el.querySelector('#impPreview');
        var goBtn = el.querySelector('#impGo');

        function currentText() {
          return String(textEl.value || '').trim() || fileText;
        }

        function renderPreview() {
          var text = currentText();
          if (!text) { parsed = null; previewEl.innerHTML = ''; return; }
          parsed = parseUsersCsv(text);
          var rows = parsed.rows || [];
          var existing = rows.filter(function (r) { return findUserByUsername(r.username); }).length;
          previewEl.innerHTML =
            '<div class="kpi-inline" style="margin:6px 0 12px">' +
              '<div class="kpi-mini"><div class="l">Строк в файле</div><div class="v">' + rows.length + '</div></div>' +
              '<div class="kpi-mini"><div class="l">Уже есть в системе</div><div class="v">' + existing + '</div></div>' +
              '<div class="kpi-mini"><div class="l">Ошибок</div><div class="v">' + (parsed.errors || []).length + '</div></div>' +
            '</div>' +
            (rows.length
              ? '<div class="table-wrap" style="max-height:260px;overflow:auto"><table class="tbl"><thead><tr>' +
                  '<th>Имя</th><th>Логин</th><th>Роль</th><th>Пароль</th><th></th></tr></thead><tbody>' +
                  rows.slice(0, 60).map(function (r) {
                    var dup = findUserByUsername(r.username);
                    return '<tr>' +
                      '<td><span class="cell-main">' + esc(r.fullName) + '</span></td>' +
                      '<td><span class="cell-main">@' + esc(r.username) + '</span></td>' +
                      '<td>' + badge(roleLabel(r.role), roleBadgeClass(r.role)) + '</td>' +
                      '<td><span class="muted small">' + esc(r.password) + '</span></td>' +
                      '<td>' + (dup ? '<span class="badge warn">пропуск</span>' : '<span class="badge success">новый</span>') + '</td>' +
                    '</tr>';
                  }).join('') + '</tbody></table></div>'
              : '<div class="tbl-empty">Не нашёл ни одной строки с сотрудниками</div>') +
            ((parsed.errors || []).length
              ? '<div class="form-note warn" style="margin-top:10px">' + icon('alert', 15) + '<span>' + esc(parsed.errors.slice(0, 6).join(' · ')) + '</span></div>'
              : '');
        }

        fileEl.addEventListener('change', function () {
          var file = fileEl.files && fileEl.files[0];
          if (!file) return;
          var reader = new FileReader();
          reader.onload = function () {
            fileText = String(reader.result || '');
            textEl.value = '';
            renderPreview();
          };
          reader.readAsText(file, 'utf-8');
        });
        textEl.addEventListener('input', function () { fileText = ''; renderPreview(); });

        el.querySelector('[data-cancel]').addEventListener('click', close);
        goBtn.addEventListener('click', async function () {
          if (!currentText()) { toast('Выберите файл или вставьте список', 'error'); return; }
          if (!parsed) renderPreview();
          if (!parsed || !parsed.rows.length) { toast('В файле нет сотрудников', 'error'); return; }

          setButtonBusy(goBtn, true, 'Импортируем…');
          try {
            var result = await importUsers(parsed.rows, actor);
            if (result.error) throw new Error(result.error);

            // учётные записи входа должны жить на сервере — создаём их там же
            var api = window.POS_API;
            var server = api && api.isServerConfigured && api.isServerConfigured();
            var serverFailed = [];
            var serverOk = 0;

            if (server) {
              for (var i = 0; i < result.created.length; i++) {
                var item = result.created[i];
                try {
                  var res = await api.createServerUser({
                    fullName: item.user.fullName,
                    username: item.user.username,
                    password: item.password,
                    role: item.user.role,
                    pointIds: []
                  });
                  if (res && res.user) {
                    var idx = DB.users.findIndex(function (u) { return u.id === item.user.id; });
                    if (idx !== -1) {
                      DB.users[idx].id = res.user.id;
                      DB.users[idx].updatedAt = res.user.updatedAt;
                      api.markVersions('users', [DB.users[idx]]);
                    }
                    serverOk++;
                  }
                } catch (err) {
                  serverFailed.push('@' + item.user.username + ': ' + err.message);
                }
              }
              saveDB();
            }

            close();
            ctx.rerender();

            var lines = [];
            lines.push('<b>Создано: ' + result.created.length + '</b>' + (server ? ' (на сервере — ' + serverOk + ')' : ''));
            if (result.skipped.length) lines.push('Пропущено: ' + result.skipped.length + ' — ' + esc(result.skipped.slice(0, 8).map(function (x) { return '@' + x.username + ' (' + x.reason + ')'; }).join(', ')));
            if (result.errors.length) lines.push('Ошибки: ' + esc(result.errors.slice(0, 6).join(' · ')));
            if (serverFailed.length) lines.push('Не созданы на сервере: ' + esc(serverFailed.slice(0, 6).join(' · ')));
            if (!server) lines.push('Сервер не подключён — учётные записи созданы только на этом устройстве.');

            openModal({
              title: 'Импорт завершён',
              size: 'sm',
              body: '<div style="font-size:13.5px;line-height:1.6;display:flex;flex-direction:column;gap:8px">' +
                lines.map(function (l) { return '<div>' + l + '</div>'; }).join('') +
                '<div class="form-note info" style="margin-top:6px">' + icon('info', 15) +
                  '<span>Теперь откройте карточку сотрудника и отметьте его точки продаж — без этого касса продавцу недоступна.</span></div>' +
                '</div>',
              footer: '<button type="button" class="btn btn-primary" data-ok>Понятно</button>',
              onMount: function (m, closeM) { m.querySelector('[data-ok]').addEventListener('click', closeM); }
            });
          } catch (err) {
            toast(err.message, 'error', 4600);
            setButtonBusy(goBtn, false, 'Импортировать');
          }
        });
      }
    });
  }

  PAGES.points = {
    render: function (root, ctx) {
      var actor = ctx.user;
      if (state.stockPointId && !getPoint(state.stockPointId)) state.stockPointId = null;
      if (!state.stockPointId && DB.points.length) state.stockPointId = DB.points[0].id;

      root.innerHTML =
        '<div class="page">' +
          '<div class="page-head">' +
            '<div><h1>Точки продаж</h1><div class="sub">' + DB.points.length + ' ' + plural(DB.points.length, 'точка', 'точки', 'точек') + ' · ' + DB.users.length + ' ' + plural(DB.users.length, 'пользователь', 'пользователя', 'пользователей') + '</div></div>' +
            '<div class="page-actions">' +
              (state.tab === 'users'
                ? '<button type="button" class="btn btn-primary" id="addUser">' + icon('plus', 17) + ' Добавить пользователя</button>'
                : '<button type="button" class="btn btn-primary" id="addPoint">' + icon('plus', 17) + ' Новая точка</button>') +
            '</div>' +
          '</div>' +
          '<div class="card" style="padding:4px 16px 0"><div class="tabs" id="pointsTabs">' +
            '<button type="button" data-tab="points" class="' + (state.tab === 'points' ? 'active' : '') + '">' + icon('pin', 16) + ' Точки <span class="count">' + DB.points.length + '</span></button>' +
            '<button type="button" data-tab="users" class="' + (state.tab === 'users' ? 'active' : '') + '">' + icon('users', 16) + ' Пользователи <span class="count">' + DB.users.length + '</span></button>' +
            '<button type="button" data-tab="stock" class="' + (state.tab === 'stock' ? 'active' : '') + '">' + icon('layers', 16) + ' Склад</button>' +
          '</div></div>' +
          '<div class="section-gap" id="pointsTabContent"></div>' +
        '</div>' +
        '<button type="button" class="fab" id="pointsExport">' + icon('download', 17) + ' Экспорт<span class="kbd">XLSX</span></button>';

      var content = root.querySelector('#pointsTabContent');

      root.querySelectorAll('[data-tab]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          state.tab = btn.getAttribute('data-tab');
          ctx.rerender();
        });
      });

      /* ---------- Точки ---------- */
      function renderPointsTab() {
        if (!DB.points.length) {
          content.innerHTML = '<div class="card">' + emptyState('pin', 'Точек продаж пока нет', 'Создайте первую точку — к ней будут привязаны касса, склад и сотрудники.',
            '<button class="btn btn-primary" id="emptyAddPoint">' + icon('plus', 16) + ' Создать точку</button>') + '</div>';
          content.querySelector('#emptyAddPoint').addEventListener('click', function () { openPointModal(ctx, null); });
          return;
        }
        content.innerHTML = '<div class="points-grid">' + DB.points.map(function (p) {
          var s = pointStats(p.id);
          return '<div class="card point-card card-hover">' +
            '<div class="head">' +
              '<div class="pin">' + icon('pin', 19) + '</div>' +
              '<div style="min-width:0;flex:1"><div class="nm truncate">' + esc(p.name) + '</div>' +
                '<div class="addr">' + icon('map', 13) + esc(p.address || 'Адрес не указан') + '</div></div>' +
            '</div>' +
            '<div class="meta">' +
              '<span>' + icon('users', 13) + ' <b>' + s.users + '</b> сотр.</span>' +
              '<span>' + icon('package', 13) + ' <b>' + s.products + '</b> тов.</span>' +
              '<span>' + icon('layers', 13) + ' <b>' + fmtNumber(s.units) + '</b> ед.</span>' +
            '</div>' +
            (p.lat && p.lng
              ? '<a class="geo-link" href="' + geoLink(p) + '" target="_blank" rel="noopener">' + icon('external', 13) + ' ' + Number(p.lat).toFixed(5) + ', ' + Number(p.lng).toFixed(5) + '</a>'
              : '<span class="tiny muted">Геолокация не задана</span>') +
            '<div class="foot">' +
              '<button type="button" class="btn btn-sm btn-ghost" data-stock="' + p.id + '">' + icon('layers', 15) + ' Склад</button>' +
              '<div class="flex gap-4">' +
                '<button type="button" class="icon-btn" data-edit-point="' + p.id + '" title="Редактировать">' + icon('edit', 16) + '</button>' +
                '<button type="button" class="icon-btn danger" data-del-point="' + p.id + '" title="Удалить">' + icon('trash', 16) + '</button>' +
              '</div>' +
            '</div>' +
          '</div>';
        }).join('') + '</div>';

        content.querySelectorAll('[data-edit-point]').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var p = getPoint(btn.getAttribute('data-edit-point'));
            if (p) openPointModal(ctx, p);
          });
        });
        content.querySelectorAll('[data-del-point]').forEach(function (btn) {
          btn.addEventListener('click', async function () {
            var p = getPoint(btn.getAttribute('data-del-point'));
            if (!p) return;
            var stats = pointStats(p.id);
            var ok = await confirmDialog({
              title: 'Удалить точку продаж?',
              message: '«' + esc(p.name) + '» будет удалена. Остатки склада (' + stats.units + ' ед.) удалятся, сотрудники останутся без точки. История продаж сохранится.<br><br><b>Пользователей на точке:</b> ' + stats.users,
              confirmText: 'Удалить точку',
              danger: true
            });
            if (!ok) return;
            deletePoint(p.id);
            toast('Точка удалена');
            ctx.rerender();
          });
        });
        content.querySelectorAll('[data-stock]').forEach(function (btn) {
          btn.addEventListener('click', function () {
            state.stockPointId = btn.getAttribute('data-stock');
            state.tab = 'stock';
            ctx.rerender();
          });
        });
      }

      /* ---------- Пользователи ---------- */
      function renderUsersTab() {
        var rows = DB.users.slice().sort(function (a, b) {
          var order = { admin: 0, dev: 1, seller: 2 };
          return (order[a.role] - order[b.role]) || (a.fullName || '').localeCompare(b.fullName || '', 'ru');
        });
        content.innerHTML = '<div class="card" style="min-width:0">' +
          '<div class="card-head"><div><h3>Пользователи системы</h3><div class="sub">Роли, доступы и график работы</div></div>' +
            '<div class="flex gap-8 wrap">' +
              '<button type="button" class="btn btn-sm btn-secondary" id="importUsers">' + icon('upload', 14) + ' Импорт из CSV</button>' +
              '<button type="button" class="btn btn-sm btn-secondary" id="addUser2">' + icon('plus', 14) + ' Добавить</button>' +
            '</div></div>' +
          '<div class="card-body" style="padding-top:10px">' +
            '<div class="table-wrap"><table class="tbl"><thead><tr>' +
              '<th>Сотрудник</th><th>Роль</th><th>Точка</th><th class="hide-sm">График</th><th class="hide-sm">Создан</th><th></th>' +
            '</tr></thead><tbody>' + rows.map(function (u) {
              var canManage = actor.role === 'admin' || u.role !== 'admin';
              return '<tr>' +
                '<td><div class="user-cell">' + avatarHtml(u.fullName) +
                  '<div style="min-width:0"><div class="nm truncate">' + esc(u.fullName) + (u.id === actor.id ? ' <span class="badge neutral">вы</span>' : '') + '</div>' +
                  '<div class="un">@' + esc(u.username) + '</div></div></div></td>' +
                '<td>' + badge(roleLabel(u.role), roleBadgeClass(u.role)) + '</td>' +
                '<td>' + (userPointIds(u).length
                  ? '<span class="small">' + userPointIds(u).map(function (id) { return esc(pointName(id, 'Точка удалена')); }).join(' · ') + '</span>'
                  : '<span class="badge warn">не назначена</span>') + '</td>' +
                '<td class="hide-sm"><span class="small muted">' + (u.workStart || u.workEnd ? (u.workStart || '—') + ' — ' + (u.workEnd || '—') : 'не задан') + '</span></td>' +
                '<td class="hide-sm"><span class="small muted">' + fmtDate(u.createdAt || Date.now()) + '</span></td>' +
                '<td><div class="actions">' +
                  (canManage
                    ? '<button class="icon-btn" data-edit-user="' + u.id + '" title="Редактировать">' + icon('edit', 16) + '</button>' +
                      (u.id !== actor.id ? '<button class="icon-btn danger" data-del-user="' + u.id + '" title="Удалить">' + icon('trash', 16) + '</button>' : '')
                    : '<span class="tiny muted">только админ</span>') +
                '</div></td>' +
              '</tr>';
            }).join('') + '</tbody></table></div>' +
            '<div class="form-note info" style="margin-top:14px">' + icon('shield', 15) +
              '<span>При удалении пользователя его транзакции сохраняются. Пароль можно сбросить в карточке пользователя.</span></div>' +
          '</div></div>';

        var addBtn = content.querySelector('#addUser2');
        if (addBtn) addBtn.addEventListener('click', function () { openUserModal(ctx, actor, null); });
        var importBtn = content.querySelector('#importUsers');
        if (importBtn) importBtn.addEventListener('click', function () { openUserImportModal(ctx, actor); });

        content.querySelectorAll('[data-edit-user]').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var u = getUser(btn.getAttribute('data-edit-user'));
            if (!u) return;
            if (actor.role !== 'admin' && u.role === 'admin') { toast('Только администратор может изменять администратора', 'warn'); return; }
            openUserModal(ctx, actor, u);
          });
        });
        content.querySelectorAll('[data-del-user]').forEach(function (btn) {
          btn.addEventListener('click', async function () {
            var u = getUser(btn.getAttribute('data-del-user'));
            if (!u) return;
            if (actor.role !== 'admin' && u.role === 'admin') { toast('Только администратор может удалить администратора', 'warn'); return; }
            var ok = await confirmDialog({
              title: 'Удалить пользователя?',
              message: '<b>' + esc(u.fullName) + '</b> (@' + esc(u.username) + ') потеряет доступ к системе. Транзакции и записи времени сохранятся.',
              confirmText: 'Удалить',
              danger: true
            });
            if (!ok) return;
            try {
              deleteUser(u.id);
              toast('Пользователь удалён');
              ctx.rerender();
            } catch (err) {
              toast(err.message, 'error');
            }
          });
        });
      }

      /* ---------- Склад ---------- */
      function renderStockTab() {
        content.innerHTML = '<div id="pointsStock"></div>';
        window.renderStockTable(content.querySelector('#pointsStock'), {
          user: actor,
          pointId: state.stockPointId,
          ctx: ctx,
          showPointSelect: true,
          onChange: function () { /* внутреннее обновление */ }
        });
      }

      var addPoint = root.querySelector('#addPoint');
      if (addPoint) addPoint.addEventListener('click', function () { openPointModal(ctx, null); });
      var addUser = root.querySelector('#addUser');
      if (addUser) addUser.addEventListener('click', function () { openUserModal(ctx, actor, null); });

      if (state.tab === 'users') renderUsersTab();
      else if (state.tab === 'stock') renderStockTab();
      else renderPointsTab();

      /* ---------- экспорт ---------- */
      root.querySelector('#pointsExport').addEventListener('click', function () {
        var pointRows = [['Точка', 'Адрес', 'Широта', 'Долгота', 'Сотрудников', 'Товаров', 'Единиц на складе']];
        DB.points.forEach(function (p) {
          var s = pointStats(p.id);
          pointRows.push([p.name, p.address || '', p.lat || '', p.lng || '', s.users, s.products, s.units]);
        });
        var userRows = [['Имя', 'Логин', 'Роль', 'Точка', 'Начало смены', 'Конец смены', 'Дата создания']];
        DB.users.forEach(function (u) {
          userRows.push([u.fullName, u.username, roleLabel(u.role), userPointIds(u).map(function (id) { return pointName(id); }).join(', ') || '—', u.workStart || '', u.workEnd || '', fmtDate(u.createdAt || Date.now())]);
        });
        var stockRows = [['Точка', 'Товар', 'Категория', 'Остаток, шт', 'Обновлено']];
        DB.stock.forEach(function (r) {
          var p = getProduct(r.productId);
          if (!p) return;
          stockRows.push([pointName(r.pointId), p.name, categoryName(p.categoryId), r.qty, fmtDateTime(r.updatedAt)]);
        });
        PosXlsx.downloadXlsx('tochki_' + dayKey(Date.now()) + '.xlsx', [
          { name: 'Точки', rows: pointRows },
          { name: 'Пользователи', rows: userRows },
          { name: 'Склад', rows: stockRows }
        ]);
        toast('Данные выгружены в Excel', 'success');
      });
    }
  };
})();
