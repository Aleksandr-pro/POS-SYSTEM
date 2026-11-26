/* ============================================================
   POS Контроль — помощь: интерактивное руководство
   ============================================================ */
(function () {
  'use strict';
  var PAGES = window.PAGES = window.PAGES || {};

  function navGroup(title, items) {
    return '<div class="grp">' + title + '</div>' + items.map(function (it) {
      return '<a href="#" data-target="' + it[0] + '">' + icon(it[1], 15) + ' ' + it[2] + '</a>';
    }).join('');
  }

  function contactTile(iconName, title, desc, href) {
    var content = '<div class="ic">' + icon(iconName, 18) + '</div><div class="t">' + esc(title) + '</div><div class="d">' + esc(desc) + '</div>';
    return href
      ? '<a class="contact-tile" href="' + href + '" target="_blank" rel="noopener">' + content + '</a>'
      : '<div class="contact-tile" style="opacity:.7">' + content + '</div>';
  }

  PAGES.help = {
    render: function (root, ctx) {
      var user = ctx.user;
      var s = DB.settings;
      var role = user.role;
      var canAdmin = role === 'admin';

      var homePage = canAccess(user, 'dashboard') ? 'dashboard' : 'cash';
      var hour = new Date().getHours();
      var greetWord = hour < 5 ? 'Доброй ночи' : hour < 12 ? 'Доброе утро' : hour < 18 ? 'Добрый день' : 'Добрый вечер';

      var rolesHtml = [
        { key: 'admin', icon: 'shield', title: 'Администратор', items: ['Полный доступ ко всем разделам', 'Товары и категории', 'Точки продаж и пользователи', 'Касса, продажи и расходы', 'Склад и остатки', 'Аналитика и отчёты', 'Ручные продажи задним числом', 'Учёт времени и экспорт'] },
        { key: 'dev', icon: 'code', title: 'Разработчик', items: ['Аналитика и отчёты', 'Управление товарами', 'Точки продаж и пользователи', 'Склад и остатки', 'Просмотр времени работы', 'Ручные продажи за любую дату', 'Экспорт данных', 'Без доступа к кассе'] },
        { key: 'seller', icon: 'briefcase', title: 'Продавец', items: ['Касса только на своей точке', 'Оформление продаж и чеков', 'Остатки и склад своей точки', 'Свои точки продаж без чужих данных', 'Статус подключения к серверу', 'Только текущий день', 'Профиль и смена пароля'] }
      ];

      root.innerHTML =
        '<div class="page">' +
          '<div class="page-head">' +
            '<div><h1>Помощь и документация</h1><div class="sub">Интерактивное руководство по работе с POS-системой · версия ' + APP_CONFIG.version + '</div></div>' +
            '<div class="page-actions">' +
              '<button type="button" class="btn btn-secondary" id="helpSettings">' + icon('sliders', 16) + ' Настройки</button>' +
              '<button type="button" class="btn btn-primary" id="helpGo">' + icon('grid', 16) + ' Перейти к панели</button>' +
            '</div>' +
          '</div>' +

          '<div class="help-hero">' +
            '<span class="badge">' + icon('sparkles', 13) + ' Версия ' + APP_CONFIG.version + '</span>' +
            '<h2>' + greetWord + ', ' + esc((user.fullName || '').split(' ')[0]) + '!</h2>' +
            '<p>Вы вошли как <b>' + roleLabel(role) + '</b>. Здесь собраны инструкции по всем разделам: от первой продажи до аналитики и экспорта в Excel. Данные сохраняются на устройстве и позже будут синхронизироваться через облачный сервер.</p>' +
            '<div class="time-actions" style="margin-top:18px">' +
              '<button type="button" class="btn btn-lg" style="background:#fff;color:#4338ca" id="helpStart">' + icon('sparkles', 18) + ' Начать работу</button>' +
              '<button type="button" class="btn btn-lg" style="background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.3);color:#fff" id="helpContact">' + icon('mail', 18) + ' Контакты разработчика</button>' +
            '</div>' +
          '</div>' +

          '<div class="help-layout section-gap">' +
            '<nav class="help-nav card card-pad" style="padding:10px">' +
              navGroup('Начало', [
                ['start', 'sparkles', 'Быстрый старт'],
                ['login', 'user', 'Вход и регистрация'],
                ['roles', 'shield', 'Роли пользователей']
              ]) +
              navGroup('Работа', [
                ['cash', 'cash', 'Касса и продажи'],
                ['expenses', 'wallet', 'Расходы'],
                ['dashboard', 'grid', 'Панель и статистика'],
                ['products', 'package', 'Товары'],
                ['stock', 'layers', 'Склад'],
                ['points', 'pin', 'Точки продаж'],
                ['time', 'clock', 'Рабочее время']
              ]) +
              navGroup('Данные', [
                ['export', 'download', 'Экспорт в Excel'],
                ['tips', 'checkCircle', 'Полезные советы'],
                ['sync', 'globe', 'Синхронизация']
              ]) +
              navGroup('Поддержка', [
                ['contacts', 'mail', 'Контакты'],
                ['other', 'briefcase', 'Другие продукты'],
                ['about', 'info', 'О системе']
              ]) +
            '</nav>' +

            '<div style="display:flex;flex-direction:column;gap:16px;min-width:0">' +

              /* Быстрый старт */
              '<section class="card help-card help-section" id="sec-start">' +
                '<h3><span class="ic">' + icon('sparkles', 17) + '</span> Быстрый старт</h3>' +
                '<p>Пять шагов, чтобы начать принимать продажи. Первый пользователь автоматически становится администратором.</p>' +
                '<div class="steps">' +
                  '<div class="step"><div class="t"><b>Создайте точку продаж.</b> Укажите название, адрес и координаты — точка связывает кассу, склад и сотрудников.</div></div>' +
                  '<div class="step"><div class="t"><b>Добавьте товары.</b> Название, категория, цена и фото. Выберите точки, где товар продаётся.</div></div>' +
                  '<div class="step"><div class="t"><b>Заполните склад.</b> На каждой точке укажите количество — остатки списываются автоматически при продаже.</div></div>' +
                  '<div class="step"><div class="t"><b>Создайте продавцов.</b> Назначьте роль и точку продаж, выдайте логин и пароль.</div></div>' +
                  '<div class="step"><div class="t"><b>Работайте.</b> Продавец оформляет продажи и отмечает время, администратор следит за выручкой и прибылью.</div></div>' +
                '</div>' +
                '<div class="callout success">' + icon('checkCircle', 16) + '<span><b>Данные хранятся локально.</b> Регулярно делайте резервную копию в разделе «Настройки → Резервная копия».</span></div>' +
              '</section>' +

              /* Вход и регистрация */
              '<section class="card help-card help-section" id="sec-login">' +
                '<h3><span class="ic">' + icon('user', 17) + '</span> Вход и регистрация</h3>' +
                '<h4>Вход в систему</h4>' +
                '<div class="steps">' +
                  '<div class="step"><div class="t">Введите имя пользователя и пароль.</div></div>' +
                  '<div class="step"><div class="t">Нажмите «Войти» или клавишу Enter. Курсор автоматически ставится в поле логина.</div></div>' +
                  '<div class="step"><div class="t">Пароль можно показать кнопкой с иконкой глаза.</div></div>' +
                '</div>' +
                '<div class="callout warn">' + icon('alert', 16) + '<span>Если появляется ошибка «Неверное имя пользователя или пароль» — проверьте раскладку и регистр. Ошибка отображается красной плашкой над формой.</span></div>' +
                '<h4>Регистрация</h4>' +
                '<ul class="help-list">' +
                  '<li><span class="b">•</span><span><b>Полное имя</b> — любые символы.</span></li>' +
                  '<li><span class="b">•</span><span><b>Имя пользователя</b> — кириллица, латиница, цифры, «_», «-», «.». Уникальность проверяется в реальном времени: зелёная галочка — свободно, красный крестик — занято.</span></li>' +
                  '<li><span class="b">•</span><span><b>Пароль</b> — минимум 6 символов, подтверждение должно совпадать.</span></li>' +
                  '<li><span class="b">•</span><span>Обязательно примите <b>условия использования</b>.</span></li>' +
                '</ul>' +
                '<div class="kpi-inline">' +
                  '<div class="kpi-mini"><div class="l">1-й пользователь</div><div class="v" style="font-size:14px">Администратор</div></div>' +
                  '<div class="kpi-mini"><div class="l">2-й пользователь</div><div class="v" style="font-size:14px">Разработчик</div></div>' +
                  '<div class="kpi-mini"><div class="l">Остальные</div><div class="v" style="font-size:14px">Продавцы</div></div>' +
                '</div>' +
              '</section>' +

              /* Роли */
              '<section class="card help-card help-section" id="sec-roles">' +
                '<h3><span class="ic">' + icon('shield', 17) + '</span> Роли пользователей</h3>' +
                '<p>Доступы различаются по ролям. Ваша текущая роль — <b>' + roleLabel(role) + '</b>.</p>' +
                '<div class="role-grid">' + rolesHtml.map(function (r) {
                  return '<div class="role-tile' + (r.key === role ? ' role-tile-current' : '') + '">' +
                    '<div class="top">' + icon(r.icon, 17) + ' ' + r.title + (r.key === role ? ' <span class="badge badge-admin">вы</span>' : '') + '</div>' +
                    '<ul>' + r.items.map(function (it) { return '<li>' + esc(it) + '</li>'; }).join('') + '</ul>' +
                  '</div>';
                }).join('') + '</div>' +
              '</section>' +

              /* Касса */
              '<section class="card help-card help-section" id="sec-cash">' +
                '<h3><span class="ic">' + icon('cash', 17) + '</span> Касса — оформление продаж</h3>' +
                '<div class="steps">' +
                  '<div class="step"><div class="t"><b>Добавьте товары в корзину.</b> Выберите товар из каталога, задайте количество кнопками «+» и «−». Можно добавить несколько разных товаров.</div></div>' +
                  '<div class="step"><div class="t"><b>Выберите способ оплаты</b> — наличные, Kaspi QR или смешанный.</div></div>' +
                  '<div class="step"><div class="t"><b>Для QR и смешанной оплаты загрузите фото чека</b> — без него продажа не оформится. При смешанной оплате укажите сумму наличными, остаток рассчитается автоматически.</div></div>' +
                  '<div class="step"><div class="t"><b>Нажмите «Оформить продажу».</b> Товары спишутся со склада, а транзакция появится в статистике.</div></div>' +
                '</div>' +
                '<div class="callout warn">' + icon('alert', 16) + '<span><b>Продавцам</b> доступно ведение кассы только в текущий день. Чеки автоматически удаляются через 7 дней, статистика сохраняется.</span></div>' +
              '</section>' +

              /* Расходы */
              '<section class="card help-card help-section" id="sec-expenses">' +
                '<h3><span class="ic">' + icon('wallet', 17) + '</span> Касса — добавление расходов</h3>' +
                '<div class="steps">' +
                  '<div class="step"><div class="t">Нажмите <b>«Расход»</b> или <b>«Добавить»</b> в блоке расходов.</div></div>' +
                  '<div class="step"><div class="t">Укажите стоимость и причину (закупка, расходники, транспорт и т.д.).</div></div>' +
                  '<div class="step"><div class="t">Расход сразу уменьшит прибыль в панели и аналитике.</div></div>' +
                '</div>' +
                '<div class="callout info">' + icon('info', 16) + '<span>Детальные данные о расходах удаляются через 7 дней, но сумма и статистика сохраняются.</span></div>' +
              '</section>' +

              /* Панель */
              '<section class="card help-card help-section" id="sec-dashboard">' +
                '<h3><span class="ic">' + icon('grid', 17) + '</span> Панель — статистика и аналитика</h3>' +
                '<h4>Доступные периоды</h4>' +
                '<ul class="help-list">' +
                  '<li><span class="b">•</span><span><b>Сегодня</b> — текущий день.</span></li>' +
                  '<li><span class="b">•</span><span><b>Неделя</b> — последние 7 дней.</span></li>' +
                  '<li><span class="b">•</span><span><b>Месяц</b> — последние 30 дней.</span></li>' +
                '</ul>' +
                '<h4>Метрики</h4>' +
                '<ul class="help-list">' +
                  '<li><span class="b">•</span><span><b>Выручка</b> — сумма всех продаж.</span></li>' +
                  '<li><span class="b">•</span><span><b>Расходы</b> — сумма всех расходов.</span></li>' +
                  '<li><span class="b">•</span><span><b>Прибыль</b> — выручка минус расходы.</span></li>' +
                  '<li><span class="b">•</span><span><b>Средний чек</b> и количество проданных товаров.</span></li>' +
                '</ul>' +
                '<h4>Последние транзакции</h4>' +
                '<ul class="help-list">' +
                  '<li><span class="b">•</span><span>Кто совершил продажу, дата и время, состав и итоговая сумма.</span></li>' +
                  '<li><span class="b">•</span><span>Просмотр чека (для QR и смешанной оплаты).</span></li>' +
                  '<li><span class="b">•</span><span>Удаление транзакции администратором — остатки автоматически восстановятся.</span></li>' +
                '</ul>' +
              '</section>' +

              /* Товары */
              '<section class="card help-card help-section" id="sec-products">' +
                '<h3><span class="ic">' + icon('package', 17) + '</span> Товары — каталог</h3>' +
                '<div class="steps">' +
                  '<div class="step"><div class="t">Нажмите <b>«Добавить товар»</b> и заполните название, категорию, цену и фото.</div></div>' +
                  '<div class="step"><div class="t">Отметьте точки продаж. Если ничего не выбрано — товар доступен на всех точках.</div></div>' +
                  '<div class="step"><div class="t">Редактируйте и удаляйте товары в любой момент. Удаление убирает остатки, но не историю продаж.</div></div>' +
                  '<div class="step"><div class="t">Кнопка <b>«Категории»</b> позволяет добавлять и удалять категории. Категорию с товарами удалить нельзя.</div></div>' +
                '</div>' +
                '<div class="callout info">' + icon('download', 16) + '<span>Экспорт каталога в Excel — плавающая кнопка <b>«Экспорт»</b> в правом нижнем углу.</span></div>' +
              '</section>' +

              /* Склад */
              '<section class="card help-card help-section" id="sec-stock">' +
                '<h3><span class="ic">' + icon('layers', 17) + '</span> Склад — остатки</h3>' +
                '<ul class="help-list">' +
                  '<li><span class="b">•</span><span>Остатки ведутся отдельно по каждой точке продаж.</span></li>' +
                  '<li><span class="b">•</span><span>Добавляйте и изменяйте количество кнопками «+», «−» или через карточку товара.</span></li>' +
                  '<li><span class="b">•</span><span>Все изменения попадают в <b>историю</b> с датой, сотрудником и комментарием.</span></li>' +
                  '<li><span class="b">•</span><span>При продаже остаток списывается автоматически, при удалении продажи — восстанавливается.</span></li>' +
                  '<li><span class="b">•</span><span>Товары, удалённые из каталога, автоматически исчезают со склада.</span></li>' +
                '</ul>' +
                '<div class="callout info">' + icon('info', 16) + '<span>Позиции с остатком 5 и меньше подсвечиваются как заканчивающиеся, с нулём — как отсутствующие.</span></div>' +
              '</section>' +

              /* Точки */
              '<section class="card help-card help-section" id="sec-points">' +
                '<h3><span class="ic">' + icon('pin', 17) + '</span> Точки продаж и пользователи</h3>' +
                '<h4>Точка продаж</h4>' +
                '<ul class="help-list">' +
                  '<li><span class="b">•</span><span>Название, адрес и геолокация (координаты можно определить автоматически).</span></li>' +
                  '<li><span class="b">•</span><span>Вкладка «Склад» показывает остатки по выбранной точке.</span></li>' +
                '</ul>' +
                '<h4>Пользователи</h4>' +
                '<ul class="help-list">' +
                  '<li><span class="b">•</span><span>Добавляйте сотрудников, назначайте роль, точку продаж и график работы.</span></li>' +
                  '<li><span class="b">•</span><span>Пароль можно сбросить в карточке пользователя.</span></li>' +
                  '<li><span class="b">•</span><span>При удалении пользователя транзакции сохраняются. Последнего администратора удалить нельзя.</span></li>' +
                '</ul>' +
              '</section>' +

              /* Время */
              '<section class="card help-card help-section" id="sec-time">' +
                '<h3><span class="ic">' + icon('clock', 17) + '</span> Учёт рабочего времени</h3>' +
                '<h4>Как отмечается</h4>' +
                '<ul class="help-list">' +
                  '<li><span class="b">•</span><span><b>«Прибытие»</b> — зелёная кнопка для отметки прихода.</span></li>' +
                  '<li><span class="b">•</span><span><b>«Уход»</b> — красная кнопка для отметки ухода; система покажет отработанное время.</span></li>' +
                  '<li><span class="b">•</span><span>Отметки делает администратор или разработчик — у продавца доступны только касса, склад и профиль.</span></li>' +
                '</ul>' +
                '<h4>Для администраторов</h4>' +
                '<ul class="help-list">' +
                  '<li><span class="b">•</span><span>Табель всех сотрудников на выбранную дату: приход, уход, длительность и статус.</span></li>' +
                  '<li><span class="b">•</span><span>Ссылки на геометки открывают точку на карте.</span></li>' +
                  '<li><span class="b">•</span><span>Экспорт табеля за 30 дней в Excel.</span></li>' +
                '</ul>' +
                '<div class="callout warn">' + icon('alert', 16) + '<span><b>Важно:</b> разрешите доступ к геолокации в настройках браузера. Если доступ запрещён, приход можно отметить без геометки — время сохранится.</span></div>' +
              '</section>' +

              /* Экспорт */
              '<section class="card help-card help-section" id="sec-export">' +
                '<h3><span class="ic">' + icon('download', 17) + '</span> Экспорт в Excel</h3>' +
                '<p>В каждом разделе есть плавающая кнопка экспорта в правом нижнем углу. Формируется настоящий файл <b>.xlsx</b> с несколькими листами и автофильтрами.</p>' +
                '<ul class="help-list">' +
                  '<li><span class="b">•</span><span><b>Панель</b> — транзакции, расходы, товары, сотрудники, сводка.</span></li>' +
                  '<li><span class="b">•</span><span><b>Касса</b> — продажи и расходы за день.</span></li>' +
                  '<li><span class="b">•</span><span><b>Товары</b> — каталог и категории.</span></li>' +
                  '<li><span class="b">•</span><span><b>Склад</b> — остатки и история изменений.</span></li>' +
                  '<li><span class="b">•</span><span><b>Точки продаж</b> — точки, пользователи и склад.</span></li>' +
                  '<li><span class="b">•</span><span><b>Время</b> — табель с геометками.</span></li>' +
                  '<li><span class="b">•</span><span><b>Аналитика</b> — полный отчёт: сводка, продажи, товары, точки, сотрудники, расходы.</span></li>' +
                '</ul>' +
                '<div class="callout info">' + icon('info', 16) + '<span>Файлы открываются в Excel, Google Таблицах, Numbers и LibreOffice. Экспорт работает офлайн.</span></div>' +
              '</section>' +

              /* Советы */
              '<section class="card help-card help-section" id="sec-tips">' +
                '<h3><span class="ic">' + icon('checkCircle', 17) + '</span> Полезные советы</h3>' +
                '<div class="role-grid" style="grid-template-columns:1fr 1fr">' +
                  '<div class="role-tile"><div class="top">' + icon('download', 16) + ' Экспорт данных</div><div class="tiny muted">Кнопка «Экспорт» в правом нижнем углу каждого раздела сохраняет данные в Excel.</div></div>' +
                  '<div class="role-tile"><div class="top">' + icon('history', 16) + ' Автоочистка</div><div class="tiny muted">Чеки и детальные данные расходов удаляются через 7 дней, статистика остаётся.</div></div>' +
                  '<div class="role-tile"><div class="top">' + icon('pin', 16) + ' Геолокация</div><div class="tiny muted">Разрешите доступ к геопозиции — приход и уход будут с геометками.</div></div>' +
                  '<div class="role-tile"><div class="top">' + icon('camera', 16) + ' Изображения</div><div class="tiny muted">Фото товаров и чеков сжимаются автоматически, чтобы экономить место.</div></div>' +
                  '<div class="role-tile"><div class="top">' + icon('lock', 16) + ' Пароли</div><div class="tiny muted">Пароли хранятся в виде хеша. Сброс пароля — в карточке пользователя.</div></div>' +
                  '<div class="role-tile"><div class="top">' + icon('database', 16) + ' Резервные копии</div><div class="tiny muted">Скачивайте JSON-копию базы в настройках — это защита от потери данных.</div></div>' +
                '</div>' +
              '</section>' +

              /* Синхронизация */
              '<section class="card help-card help-section" id="sec-sync">' +
                '<h3><span class="ic">' + icon('globe', 17) + '</span> Синхронизация и облако</h3>' +
                '<p>Текущая версия <b>' + APP_CONFIG.version + '</b> работает полностью офлайн: данные хранятся в localStorage устройства. Это значит, что касса работает без интернета.</p>' +
                '<h4>Следующий этап — облачный сервер</h4>' +
                '<div class="steps">' +
                  '<div class="step"><div class="t"><b>API на Cloudflare Workers.</b> Серверные методы для пользователей, продаж, склада и времени.</div></div>' +
                  '<div class="step"><div class="t"><b>База Cloudflare D1.</b> Общие данные для нескольких устройств и точек.</div></div>' +
                  '<div class="step"><div class="t"><b>Авторизация на сервере.</b> Роли и пароли проверяются в облаке, а не на устройстве.</div></div>' +
                  '<div class="step"><div class="t"><b>Офлайн-очередь.</b> Продажи записываются локально и отправляются при появлении интернета.</div></div>' +
                '</div>' +
                '<div class="callout info">' + icon('database', 16) + '<span>Уже сейчас можно скачать резервную копию JSON в настройках — она пригодится для переноса данных на сервер.</span></div>' +
              '</section>' +

              /* Контакты */
              '<section class="card help-card help-section" id="sec-contacts">' +
                '<h3><span class="ic">' + icon('mail', 17) + '</span> Контакты разработчика</h3>' +
                '<p>Свяжитесь для поддержки, доработок или обсуждения нового проекта.</p>' +
                '<div class="contacts-grid">' +
                  contactTile('phone', 'Телефон', s.supportPhone || 'не указан', s.supportPhone ? 'tel:' + s.supportPhone.replace(/[^\d+]/g, '') : '') +
                  contactTile('mail', 'Email', s.supportEmail || 'не указан', s.supportEmail ? 'mailto:' + s.supportEmail : '') +
                  contactTile('telegram', 'Telegram', s.supportTelegram ? '@' + s.supportTelegram : 'не указан', s.supportTelegram ? 'https://t.me/' + s.supportTelegram.replace('@', '') : '') +
                '</div>' +
                (canAdmin
                  ? '<button type="button" class="btn btn-secondary btn-sm" id="helpEditContacts" style="align-self:flex-start">' + icon('edit', 15) + ' Изменить контакты</button>'
                  : '') +
              '</section>' +

              /* Другие продукты */
              '<section class="card help-card help-section" id="sec-other">' +
                '<h3><span class="ic">' + icon('briefcase', 17) + '</span> Другие продукты</h3>' +
                '<p>Наши решения для автоматизации бизнеса. Подробности — у разработчика.</p>' +
                '<div class="role-grid">' +
                  '<div class="role-tile"><div class="top">' + icon('layers', 16) + ' Складской учёт</div><div class="tiny muted">Приход, списание, инвентаризация и остатки по складам.</div><span class="badge warn">в разработке</span></div>' +
                  '<div class="role-tile"><div class="top">' + icon('users', 16) + ' CRM для клиентов</div><div class="tiny muted">База клиентов, бонусы и история покупок.</div><span class="badge warn">в разработке</span></div>' +
                  '<div class="role-tile"><div class="top">' + icon('chart', 16) + ' Финансовый отчёт</div><div class="tiny muted">Сводные отчёты по сети точек и экспорт для бухгалтерии.</div><span class="badge warn">в разработке</span></div>' +
                '</div>' +
              '</section>' +

              /* О системе */
              '<section class="card help-card help-section" id="sec-about">' +
                '<h3><span class="ic">' + icon('info', 17) + '</span> О системе</h3>' +
                '<div class="about-list">' +
                  '<div class="about-row"><span class="k">Приложение</span><span class="v">' + APP_CONFIG.name + '</span></div>' +
                  '<div class="about-row"><span class="k">Версия</span><span class="v">' + APP_CONFIG.version + '</span></div>' +
                  '<div class="about-row"><span class="k">Роль</span><span class="v">' + roleLabel(role) + '</span></div>' +
                  '<div class="about-row"><span class="k">Пользователей</span><span class="v">' + DB.users.length + '</span></div>' +
                  '<div class="about-row"><span class="k">Точек продаж</span><span class="v">' + DB.points.length + '</span></div>' +
                  '<div class="about-row"><span class="k">Товаров</span><span class="v">' + DB.products.length + '</span></div>' +
                  '<div class="about-row"><span class="k">Продаж в базе</span><span class="v">' + DB.sales.length + '</span></div>' +
                  '<div class="about-row"><span class="k">Хранилище</span><span class="v">локальное, офлайн</span></div>' +
                '</div>' +
              '</section>' +

            '</div>' +
          '</div>' +
        '</div>';

      // навигация по разделам
      root.querySelectorAll('[data-target]').forEach(function (link) {
        link.addEventListener('click', function (e) {
          e.preventDefault();
          var section = root.querySelector('#sec-' + link.getAttribute('data-target'));
          if (section) {
            var y = section.getBoundingClientRect().top + window.scrollY - 78;
            window.scrollTo({ top: y, behavior: 'smooth' });
          }
        });
      });
      root.querySelector('#helpGo').addEventListener('click', function () { ctx.navigate(homePage); });
      root.querySelector('#helpSettings').addEventListener('click', function () { ctx.navigate('settings'); });
      root.querySelector('#helpStart').addEventListener('click', function () {
        var section = root.querySelector('#sec-start');
        if (section) window.scrollTo({ top: section.getBoundingClientRect().top + window.scrollY - 78, behavior: 'smooth' });
      });
      root.querySelector('#helpContact').addEventListener('click', function () {
        var section = root.querySelector('#sec-contacts');
        if (section) window.scrollTo({ top: section.getBoundingClientRect().top + window.scrollY - 78, behavior: 'smooth' });
      });
      var editContacts = root.querySelector('#helpEditContacts');
      if (editContacts) editContacts.addEventListener('click', function () { ctx.navigate('settings'); });
    }
  };
})();
