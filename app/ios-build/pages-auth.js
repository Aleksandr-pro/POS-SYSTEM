/* ============================================================
   POS Контроль — страницы входа и регистрации
   ============================================================ */
(function () {
  'use strict';

  var PAGES = window.PAGES = window.PAGES || {};

  function authBrand() {
    return '<div class="auth-brand">' +
      '<div class="logo">' + icon('logo', 24) + '</div>' +
      '<div><div class="nm">POS Контроль</div><div class="tg">Система управления продажами</div></div>' +
      '</div>';
  }

  function artSide() {
    return '<aside class="auth-art">' +
      authBrand() +
      '<div class="auth-hero">' +
        '<h1>Каждый тенге<br>под <em>контролем</em></h1>' +
        '<p>Продажи, остатки, расходы и рабочее время продавцов — в одном приложении. Данные сохраняются на устройстве и готовы к подключению облачной синхронизации.</p>' +
        '<div class="auth-feats">' +
          '<div class="auth-feat"><div class="ic">' + icon('cash', 18) + '</div><div><b>Быстрая касса</b><span>Наличные, Kaspi QR и смешанная оплата с чеками</span></div></div>' +
          '<div class="auth-feat"><div class="ic">' + icon('chart', 18) + '</div><div><b>Живая аналитика</b><span>Выручка, расходы и прибыль по точкам за 1 клик</span></div></div>' +
          '<div class="auth-feat"><div class="ic">' + icon('clock', 18) + '</div><div><b>Учёт времени и склада</b><span>Геометки прихода/ухода и остатки по точкам</span></div></div>' +
        '</div>' +
      '</div>' +
      '<div class="auth-art-foot">' +
        '<span>Версия ' + APP_CONFIG.version + '</span>' +
        '<span>Работает офлайн</span>' +
        '<span>Экспорт в Excel</span>' +
      '</div>' +
      '</aside>';
  }


  function serverStripHtml() {
    var api = window.POS_API;
    if (!api) return '';
    var cfg = api.serverConfig();
    var connected = api.isServerConfigured();
    var hasUrl = !!cfg.url;
    return '<div class="auth-server">' +
      '<span class="badge ' + (connected ? 'success' : 'neutral') + '">' + icon('cloud', 13) + ' ' +
        (connected ? 'Облако подключено' : (hasUrl ? 'Сервер указан' : 'Локальный режим')) + '</span>' +
      '<span class="tiny muted truncate" style="flex:1;min-width:0">' +
        esc(hasUrl ? cfg.url.replace(/^https?:\/\//, '') : 'данные хранятся на этом устройстве') + '</span>' +
      '<button type="button" class="link-btn" id="srvStripBtn">' + (hasUrl ? 'Изменить' : 'Подключить сервер') + '</button>' +
    '</div>';
  }

  function bindServerStrip(root, ctx, onChanged) {
    var api = window.POS_API;
    if (!api) return;
    var btn = root.querySelector('#srvStripBtn');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var cfg = api.serverConfig();
      openModal({
        title: 'Сервер синхронизации',
        body: '<div style="display:flex;flex-direction:column;gap:12px">' +
          '<div class="field"><label for="mSrvUrl">Адрес сервера</label>' +
            '<input class="input" id="mSrvUrl" placeholder="https://pos-kontrol.ваш-аккаунт.workers.dev" value="' + esc(cfg.url || '') + '" spellcheck="false"></div>' +
          '<div class="hint" id="mSrvNote">Вставьте адрес Worker, опубликованного на Cloudflare. Без сервера приложение работает офлайн на этом устройстве.</div>' +
          '<div class="flex gap-8 wrap">' +
            '<button type="button" class="btn btn-secondary btn-sm" id="mSrvTest">Проверить связь</button>' +
            '<button type="button" class="btn btn-ghost btn-sm" id="mSrvClear">Отключить</button>' +
          '</div>' +
        '</div>',
        footer: '<button type="button" class="btn btn-secondary" data-cancel>Отмена</button>' +
                '<button type="button" class="btn btn-primary" data-save>Сохранить</button>',
        onMount: function (el, close) {
          function note(html, color) {
            var n = el.querySelector('#mSrvNote');
            n.innerHTML = html;
            n.style.color = color || '';
          }
          var input = el.querySelector('#mSrvUrl');
          el.querySelector('#mSrvTest').addEventListener('click', async function () {
            var b = this;
            var url = input.value.trim();
            if (!url) { note('Укажите адрес сервера', 'var(--danger)'); return; }
            setButtonBusy(b, true, 'Проверяем…');
            try {
              var info = await api.testServer(url);
              note('Сервер доступен · пользователей: ' + (info.users === undefined ? '—' : info.users), 'var(--success-600)');
            } catch (err) {
              note(err.message, 'var(--danger)');
            }
            setButtonBusy(b, false);
          });
          el.querySelector('#mSrvClear').addEventListener('click', function () {
            api.serverLogout();
            api.saveServerConfig({ url: '', user: null, lastSync: 0 });
            close();
            toast('Сервер отключён — локальный режим', 'info');
            if (onChanged) onChanged();
          });
          el.querySelector('[data-cancel]').addEventListener('click', close);
          el.querySelector('[data-save]').addEventListener('click', function () {
            var url = input.value.trim().replace(/\/+$/, '');
            if (url && !/^https?:\/\//i.test(url)) { note('Адрес должен начинаться с https://', 'var(--danger)'); return; }
            var current = api.serverConfig();
            if (current.url !== url) {
              api.saveServerConfig({ url: url, token: '', user: null, lastSync: 0 });
            } else {
              api.saveServerConfig({ url: url });
            }
            close();
            toast(url ? 'Сервер сохранён — теперь войдите в аккаунт' : 'Сервер не указан', url ? 'success' : 'info');
            if (onChanged) onChanged();
          });
        }
      });
    });
  }

  function roleHintAfterRegister() {
    var count = DB.users.length;
    if (count === 0) {
      return { role: 'Администратор', text: 'Вы первый пользователь — получите <b>полный доступ</b> ко всем разделам системы.', cls: 'badge-admin' };
    }
    if (count === 1) {
      return { role: 'Разработчик', text: 'В системе уже есть администратор — вам будет назначена роль <b>Разработчик</b> (доступ без кассы).', cls: 'badge-dev' };
    }
    return { role: 'Продавец', text: 'В системе уже есть администратор и разработчик — вам будет назначена роль <b>Продавец</b>. Точку продаж назначит администратор.', cls: 'badge-seller' };
  }

  PAGES.login = {
    render: function (root, ctx) {
      var hint = roleHintAfterRegister();
      root.innerHTML =
        '<div class="auth">' +
          artSide() +
          '<main class="auth-panel">' +
            '<button type="button" class="theme-toggle auth-theme-toggle" id="authTheme" title="Сменить тему" aria-label="Сменить тему">' +
              icon(resolvedTheme() === 'dark' ? 'sun' : 'moon', 17) +
            '</button>' +
            '<div class="auth-card">' +
              '<div class="brand-mobile">' +
                '<div class="logo-mark">' + icon('logo', 21) + '</div>' +
                '<div><div class="nm">POS Контроль</div><div class="tg">Версия ' + APP_CONFIG.version + '</div></div>' +
              '</div>' +
              '<h2>С возвращением 👋</h2>' +
              '<p class="sub">Войдите, чтобы продолжить работу с кассой и отчётами</p>' +
              '<div id="authError" class="auth-error hide" role="alert">' + icon('alert', 16) + '<span></span></div>' +
              '<form class="auth-form" id="loginForm" novalidate>' +
                '<div class="field">' +
                  '<label for="loginUser">Имя пользователя</label>' +
                  '<div class="input-icon">' + icon('user', 17) +
                    '<input class="input" id="loginUser" name="username" type="text" autocomplete="username" placeholder="Например, yulia" autofocus>' +
                  '</div>' +
                '</div>' +
                '<div class="field">' +
                  '<label for="loginPass">Пароль</label>' +
                  '<div class="pw-wrap">' +
                    '<input class="input" id="loginPass" name="password" type="password" autocomplete="current-password" placeholder="Введите пароль">' +
                    '<button type="button" class="pw-toggle" data-pw-toggle="loginPass" aria-label="Показать пароль">' + icon('eye', 18) + '</button>' +
                  '</div>' +
                '</div>' +
                '<button type="submit" class="btn btn-primary btn-lg btn-block" id="loginBtn">Войти ' + icon('chevronRight', 17) + '</button>' +
              '</form>' +
              (DB.users.length === 0
                ? '<div class="form-note info" style="margin-top:16px">' + icon('sparkles', 16) +
                    '<span><b>Первый запуск?</b> Зарегистрируйте аккаунт — он получит роль администратора и полный доступ.</span></div>'
                : '<div class="form-note info" style="margin-top:16px">' + icon('info', 16) +
                    '<span>Нет аккаунта? Обратитесь к администратору или <b>зарегистрируйтесь</b> — новый пользователь получит роль продавца.</span></div>') +
              '<div class="auth-switch">Нет аккаунта? <button type="button" id="goRegister">Зарегистрироваться</button></div>' +
              serverStripHtml() +
              '<div class="auth-foot">POS Контроль v' + APP_CONFIG.version + ' · Офлайн-режим и облако</div>' +
              (!STORAGE_AVAILABLE
                ? '<div class="form-note warn" style="margin-top:12px">' + icon('alert', 15) + '<span><b>Режим предпросмотра:</b> браузер запрещает локальное хранилище, данные не сохранятся после перезагрузки. Откройте приложение по прямой ссылке или в APK.</span></div>'
                : '') +
            '</div>' +
          '</main>' +
        '</div>';

      bindPasswordToggle(root);

      var authThemeBtn = root.querySelector('#authTheme');
      if (authThemeBtn) authThemeBtn.addEventListener('click', function () {
        var theme = toggleTheme();
        authThemeBtn.innerHTML = icon(theme === 'dark' ? 'sun' : 'moon', 17);
      });

      var form = root.querySelector('#loginForm');
      var errorBox = root.querySelector('#authError');
      var btn = root.querySelector('#loginBtn');

      function showError(message) {
        errorBox.classList.remove('hide');
        errorBox.querySelector('span').textContent = message;
      }

      bindServerStrip(root, ctx, function () { ctx.rerender(); });
      root.querySelector('#goRegister').addEventListener('click', function () { ctx.navigate('register'); });

      form.addEventListener('submit', async function (e) {
        e.preventDefault();
        errorBox.classList.add('hide');
        var username = form.username.value;
        var password = form.password.value;
        if (!username.trim() || !password) {
          showError('Введите имя пользователя и пароль');
          return;
        }
        setButtonBusy(btn, true, 'Входим…');
        var api = window.POS_API;
        var serverUrl = api ? api.serverConfig().url : '';

        if (serverUrl) {
          try {
            var serverUser = await api.serverLogin(username, password);
            toast('Добро пожаловать, ' + serverUser.fullName.split(' ')[0] + '!', 'success');
            ctx.navigate(canAccess(serverUser, 'dashboard') ? 'dashboard' : 'cash');
            return;
          } catch (serverErr) {
            var networkDown = !serverErr.status;
            try {
              var localUser = await loginUser(username, password);
              toast(networkDown ? 'Сервер недоступен — вход выполнен по локальным данным' : 'Вход выполнен по локальным данным', 'info', 4200);
              ctx.navigate(canAccess(localUser, 'dashboard') ? 'dashboard' : 'cash');
              return;
            } catch (localErr) {
              showError(serverErr.message || localErr.message);
              setButtonBusy(btn, false);
              form.password.select();
              return;
            }
          }
        }

        try {
          var user = await loginUser(username, password);
          toast('Добро пожаловать, ' + user.fullName.split(' ')[0] + '!', 'success');
          ctx.navigate(canAccess(user, 'dashboard') ? 'dashboard' : 'cash');
        } catch (err) {
          showError(err.message);
          setButtonBusy(btn, false);
          form.password.select();
        }
      });

      root.querySelectorAll('input').forEach(function (input) {
        input.addEventListener('input', function () { errorBox.classList.add('hide'); });
      });
    }
  };

  PAGES.register = {
    render: function (root, ctx) {
      var hint = roleHintAfterRegister();
      root.innerHTML =
        '<div class="auth">' +
          artSide() +
          '<main class="auth-panel">' +
            '<button type="button" class="theme-toggle auth-theme-toggle" id="authTheme" title="Сменить тему" aria-label="Сменить тему">' +
              icon(resolvedTheme() === 'dark' ? 'sun' : 'moon', 17) +
            '</button>' +
            '<div class="auth-card">' +
              '<div class="brand-mobile">' +
                '<div class="logo-mark">' + icon('logo', 21) + '</div>' +
                '<div><div class="nm">POS Контроль</div><div class="tg">Версия ' + APP_CONFIG.version + '</div></div>' +
              '</div>' +
              '<h2>Создать аккаунт</h2>' +
              '<p class="sub">Заполните данные — роль назначится автоматически</p>' +
              '<div class="auth-role-note" style="margin-top:16px">' +
                '<span class="ic">' + icon('shield', 17) + '</span>' +
                '<div style="font-size:12.5px;line-height:1.5"><b>Ваша роль: ' + hint.role + '</b><br><span class="muted">' + hint.text.replace(/<b>|<\/b>/g, '') + '</span></div>' +
              '</div>' +
              '<div id="regError" class="auth-error hide" role="alert">' + icon('alert', 16) + '<span></span></div>' +
              '<form class="auth-form" id="regForm" novalidate>' +
                '<div class="field">' +
                  '<label for="regName">Полное имя</label>' +
                  '<input class="input" id="regName" name="fullName" type="text" autocomplete="name" placeholder="Например, Юлия Иванова" autofocus>' +
                  '<div class="field-error hide" data-error-for="fullName">' + icon('alert', 13) + '<span></span></div>' +
                '</div>' +
                '<div class="field">' +
                  '<label for="regUser">Имя пользователя</label>' +
                  '<div class="input-icon">' + icon('user', 17) +
                    '<input class="input" id="regUser" name="username" type="text" autocomplete="username" placeholder="yulia" style="padding-right:40px">' +
                    '<span id="userStatus" style="position:absolute;right:12px;top:50%;transform:translateY(-50%);display:none"></span>' +
                  '</div>' +
                  '<div class="hint">Кириллица, латиница, цифры, «_», «-», «.» — от 2 до 32 символов</div>' +
                  '<div class="field-error hide" data-error-for="username">' + icon('alert', 13) + '<span></span></div>' +
                '</div>' +
                '<div class="field">' +
                  '<label for="regPass">Пароль</label>' +
                  '<div class="pw-wrap">' +
                    '<input class="input" id="regPass" name="password" type="password" autocomplete="new-password" placeholder="Минимум 6 символов">' +
                    '<button type="button" class="pw-toggle" data-pw-toggle="regPass" aria-label="Показать пароль">' + icon('eye', 18) + '</button>' +
                  '</div>' +
                  '<div class="hint" id="passHint">Минимум 6 символов</div>' +
                '</div>' +
                '<div class="field">' +
                  '<label for="regPass2">Подтверждение пароля</label>' +
                  '<div class="pw-wrap">' +
                    '<input class="input" id="regPass2" name="password2" type="password" autocomplete="new-password" placeholder="Повторите пароль">' +
                    '<button type="button" class="pw-toggle" data-pw-toggle="regPass2" aria-label="Показать пароль">' + icon('eye', 18) + '</button>' +
                  '</div>' +
                  '<div class="hint" id="matchHint"></div>' +
                  '<div class="field-error hide" data-error-for="password2">' + icon('alert', 13) + '<span></span></div>' +
                '</div>' +
                '<label class="check">' +
                  '<input type="checkbox" id="regTerms" name="terms">' +
                  '<span>Я принимаю <button type="button" class="link-btn" id="termsLink">условия использования</button> и политику обработки данных</span>' +
                '</label>' +
                '<button type="submit" class="btn btn-primary btn-lg btn-block" id="regBtn">Создать аккаунт ' + icon('chevronRight', 17) + '</button>' +
              '</form>' +
              '<div class="auth-switch">Уже есть аккаунт? <button type="button" id="goLogin">Войти</button></div>' +
              serverStripHtml() +
              '<div class="auth-foot">POS Контроль v' + APP_CONFIG.version + ' · Офлайн-режим и облако</div>' +
              (!STORAGE_AVAILABLE
                ? '<div class="form-note warn" style="margin-top:12px">' + icon('alert', 15) + '<span><b>Режим предпросмотра:</b> локальное хранилище недоступно, данные не сохранятся.</span></div>'
                : '') +
            '</div>' +
          '</main>' +
        '</div>';

      bindPasswordToggle(root);

      var authThemeBtn2 = root.querySelector('#authTheme');
      if (authThemeBtn2) authThemeBtn2.addEventListener('click', function () {
        var theme = toggleTheme();
        authThemeBtn2.innerHTML = icon(theme === 'dark' ? 'sun' : 'moon', 17);
      });

      var form = root.querySelector('#regForm');
      var errorBox = root.querySelector('#regError');
      var btn = root.querySelector('#regBtn');
      var userInput = root.querySelector('#regUser');
      var statusEl = root.querySelector('#userStatus');
      var passInput = root.querySelector('#regPass');
      var passHint = root.querySelector('#passHint');
      var pass2Input = root.querySelector('#regPass2');
      var matchHint = root.querySelector('#matchHint');
      var checkTimer = null;

      bindServerStrip(root, ctx, function () { ctx.rerender(); });
      root.querySelector('#goLogin').addEventListener('click', function () { ctx.navigate('login'); });

      root.querySelector('#termsLink').addEventListener('click', function () {
        openModal({
          title: 'Условия использования',
          body: '<div style="font-size:13px;line-height:1.65;color:var(--ink-2);display:flex;flex-direction:column;gap:10px">' +
            '<p>1. Приложение предназначено для внутреннего учёта продаж, расходов, остатков и рабочего времени сотрудников.</p>' +
            '<p>2. Пользователь обязуется не передавать свои учётные данные третьим лицам. Все действия под аккаунтом считаются совершёнными владельцем аккаунта.</p>' +
            '<p>3. Данные текущей версии хранятся локально на устройстве пользователя. Резервное копирование — ответственность владельца бизнеса.</p>' +
            '<p>4. Фотографии чеков и детальные данные расходов автоматически удаляются через 7 дней, статистика сохраняется.</p>' +
            '<p>5. Администратор вправе удалять пользователей и данные; транзакции при удалении пользователя сохраняются.</p>' +
            '</div>',
          footer: '<button type="button" class="btn btn-primary" data-ok>Понятно</button>',
          onMount: function (el, close) { el.querySelector('[data-ok]').addEventListener('click', close); }
        });
      });

      function showError(message) {
        errorBox.classList.remove('hide');
        errorBox.querySelector('span').textContent = message;
        errorBox.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
      function hideError() { errorBox.classList.add('hide'); }

      function fieldError(name, message) {
        var box = root.querySelector('[data-error-for="' + name + '"]');
        if (!box) return;
        if (!message) { box.classList.add('hide'); return; }
        box.classList.remove('hide');
        box.querySelector('span').textContent = message;
      }

      function validateUsername(value) {
        if (!value) return 'Укажите имя пользователя';
        if (!/^[A-Za-zА-Яа-яЁё0-9_\-\.]{2,32}$/.test(value)) return '2–32 символа: буквы, цифры, _ - .';
        if (findUserByUsername(value)) return 'Это имя уже занято';
        return '';
      }

      function refreshUserStatus() {
        var value = userInput.value.trim();
        if (!value) { statusEl.style.display = 'none'; fieldError('username', ''); return; }
        var err = validateUsername(value);
        statusEl.style.display = 'inline-flex';
        if (err) {
          statusEl.innerHTML = icon('x', 15);
          statusEl.style.color = 'var(--danger)';
          fieldError('username', err);
          userInput.classList.add('invalid');
        } else {
          statusEl.innerHTML = icon('check', 15);
          statusEl.style.color = 'var(--success)';
          fieldError('username', '');
          userInput.classList.remove('invalid');
        }
      }

      userInput.addEventListener('input', function () {
        hideError();
        clearTimeout(checkTimer);
        statusEl.style.display = 'none';
        fieldError('username', '');
        userInput.classList.remove('invalid');
        checkTimer = setTimeout(refreshUserStatus, 280);
      });

      passInput.addEventListener('input', function () {
        hideError();
        var value = passInput.value;
        if (!value) {
          passHint.textContent = 'Минимум 6 символов';
          passHint.style.color = '';
        } else if (value.length < 6) {
          passHint.textContent = 'Слишком короткий пароль — нужно ещё ' + (6 - value.length) + ' ' + plural(6 - value.length, 'символ', 'символа', 'символов');
          passHint.style.color = 'var(--muted)';
        } else {
          passHint.textContent = 'Пароль достаточно надёжный';
          passHint.style.color = 'var(--success)';
        }
        updateMatch();
      });

      function updateMatch() {
        if (!pass2Input.value) { matchHint.textContent = ''; fieldError('password2', ''); return; }
        if (pass2Input.value === passInput.value) {
          matchHint.textContent = '';
          fieldError('password2', '');
        } else {
          matchHint.textContent = '';
          fieldError('password2', 'Пароли не совпадают');
        }
      }
      pass2Input.addEventListener('input', function () { hideError(); updateMatch(); });
      root.querySelector('#regName').addEventListener('input', hideError);
      root.querySelector('#regTerms').addEventListener('change', hideError);

      form.addEventListener('submit', async function (e) {
        e.preventDefault();
        hideError();
        var fullName = form.fullName.value.trim();
        var username = form.username.value.trim();
        var password = form.password.value;
        var password2 = form.password2.value;
        var terms = form.terms.checked;

        if (!fullName) { fieldError('fullName', 'Укажите полное имя'); form.fullName.focus(); return; }
        fieldError('fullName', '');
        var userErr = validateUsername(username);
        if (userErr) { fieldError('username', userErr); userInput.focus(); return; }
        if (password.length < 6) {
          showError('Пароль должен содержать минимум 6 символов');
          passInput.focus();
          return;
        }
        if (password !== password2) {
          fieldError('password2', 'Пароли не совпадают');
          pass2Input.focus();
          return;
        }
        if (!terms) { showError('Необходимо принять условия использования'); return; }

        setButtonBusy(btn, true, 'Создаём аккаунт…');
        var api = window.POS_API;
        var serverUrl = api ? api.serverConfig().url : '';

        if (serverUrl) {
          try {
            var serverUser = await api.serverRegister({ fullName: fullName, username: username, password: password });
            toast('Аккаунт создан на сервере. Ваша роль: ' + roleLabel(serverUser.role), 'success', 4600);
            ctx.navigate(canAccess(serverUser, 'dashboard') ? 'dashboard' : 'cash');
            return;
          } catch (serverErr) {
            if (!serverErr.status) {
              // сервер недоступен — работаем локально
              try {
                var localOnly = await createUser({ fullName: fullName, username: username, password: password }, { autoRole: true });
                setSession(localOnly.id);
                toast('Сервер недоступен — аккаунт создан локально, данные отправятся позже', 'warn', 5200);
                ctx.navigate(canAccess(localOnly, 'dashboard') ? 'dashboard' : 'cash');
                return;
              } catch (localErr) {
                showError(localErr.message);
                setButtonBusy(btn, false);
                return;
              }
            }
            showError(serverErr.message);
            setButtonBusy(btn, false);
            return;
          }
        }

        try {
          var user = await createUser({ fullName: fullName, username: username, password: password }, { autoRole: true });
          setSession(user.id);
          toast('Аккаунт создан. Ваша роль: ' + roleLabel(user.role), 'success', 4200);
          ctx.navigate(canAccess(user, 'dashboard') ? 'dashboard' : 'cash');
        } catch (err) {
          showError(err.message);
          setButtonBusy(btn, false);
        }
      });
    }
  };
})();
