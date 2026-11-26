/* ============================================================
   POS Контроль — точка входа: роутер и каркас приложения
   ============================================================ */
(function () {
  'use strict';

  var NAV = {
    dashboard: { label: 'Панель', icon: 'grid' },
    cash: { label: 'Касса', icon: 'cash' },
    products: { label: 'Товары', icon: 'package' },
    stock: { label: 'Склад', icon: 'layers' },
    points: { label: 'Точки продаж', icon: 'pin' },
    time: { label: 'Время', icon: 'clock' },
    analytics: { label: 'Аналитика', icon: 'chart' },
    manual: { label: 'Ручные продажи', icon: 'edit' },
    changes: { label: 'Изменения', icon: 'history' },
    help: { label: 'Помощь', icon: 'book' },
    settings: { label: 'Настройки', icon: 'sliders' }
  };
  var WORK_ORDER = ['dashboard', 'cash', 'products', 'stock', 'points', 'time', 'analytics', 'manual', 'changes'];
  var activePage = null;
  var activeUser = null;

  function defaultPage(user) {
    return canAccess(user, 'dashboard') ? 'dashboard' : 'cash';
  }

  function navigate(page) {
    var target = '#/' + page;
    if (location.hash === target) route();
    else location.hash = target;
  }

  function doLogout() {
    logoutUser();
    if (typeof window.resetCashState === 'function') window.resetCashState();
    activePage = null;
    toast('Вы вышли из аккаунта', 'info');
    if (location.hash === '#/login') route();
    else location.hash = '#/login';
  }

  function pageCtx(user, page) {
    return {
      user: user,
      page: page,
      navigate: navigate,
      rerender: function () { renderPageOnly(); },
      logout: doLogout
    };
  }

  function navItemHtml(page, user) {
    var item = NAV[page];
    var label = (page === 'settings' && user.role === 'seller') ? 'Профиль' : item.label;
    var active = activePage === page;
    var tail = '';
    if (page === 'time' && user.role === 'seller' && !timeEntryFor(user.id)) {
      tail = '<span class="tail" title="Приход не отмечен">!</span>';
    }
    return '<button type="button" class="side-item' + (active ? ' active' : '') + '" data-nav="' + page + '" title="' + label + '">' +
      icon(item.icon, 18) + '<span>' + label + '</span>' + tail + '</button>';
  }

  function shellHtml(user, page) {
    var workItems = WORK_ORDER.filter(function (p) { return canAccess(user, p); }).map(function (p) { return navItemHtml(p, user); }).join('');
    var systemItems = ['help', 'settings'].filter(function (p) { return canAccess(user, p); }).map(function (p) { return navItemHtml(p, user); }).join('');

    var shortNav = WORK_ORDER.concat(['help', 'settings']).filter(function (p) { return canAccess(user, p); }).slice(0, 4);
    var bottomItems = shortNav.map(function (p) {
      var label = (p === 'settings' && user.role === 'seller') ? 'Профиль' : NAV[p].label;
      return '<button type="button" class="bn-item' + (activePage === p ? ' active' : '') + '" data-nav="' + p + '">' +
        icon(NAV[p].icon, 22) + '<span>' + label + '</span></button>';
    }).join('');

    var now = new Date();
    return '<div class="app">' +
      '<aside class="sidebar" id="sidebar">' +
        '<div class="sidebar-brand">' +
          '<div class="logo-mark">' + icon('logo', 22) + '</div>' +
          '<div><div class="nm">POS Контроль</div><div class="tg">v' + APP_CONFIG.version + ' · офлайн-режим</div></div>' +
          '<button type="button" class="sidebar-collapse" id="sideCollapse" title="Свернуть меню (Ctrl+B)">' + icon('chevronLeft', 16) + '</button>' +
        '</div>' +
        '<nav class="side-nav">' +
          '<div class="side-label">Работа</div>' + workItems +
          '<div class="side-label">Система</div>' + systemItems +
        '</nav>' +
        '<div class="side-foot">' +
          '<div class="side-user">' +
            avatarHtml(user.fullName, 'avatar-sm') +
            '<div style="min-width:0"><div class="nm truncate">' + esc(user.fullName) + '</div><div class="rl">' + roleLabel(user.role) + '</div></div>' +
            '<button type="button" class="icon-btn danger logout" id="sideLogout" title="Выйти">' + icon('logout', 16) + '</button>' +
          '</div>' +
        '</div>' +
      '</aside>' +
      '<div class="nav-overlay" id="navOverlay"></div>' +
      '<div class="main">' +
        '<header class="topbar">' +
          '<div class="topbar-left">' +
            '<button type="button" class="icon-btn menu-btn" id="menuBtn" aria-label="Меню">' + icon('menu', 20) + '</button>' +
            '<div><div class="topbar-title">' + NAV[page].label + '</div>' +
              '<div class="topbar-crumb">POS Контроль · ' + roleLabel(user.role) + '</div></div>' +
          '</div>' +
          '<div class="topbar-right">' +
            (isIOS() && !isStandalone()
              ? '<button type="button" class="ios-get" id="iosGetBtn" title="Установить на iPhone">' + icon('download', 15) + ' Установить</button>'
              : '') +
            '<button type="button" class="topbar-search" id="globalSearch" title="Поиск по системе (Ctrl+K)">' +
              icon('search', 16) + '<span>Поиск по системе</span><span class="kbd-hint">Ctrl K</span>' +
            '</button>' +
            topbarPointHtml(user) +
            cloudPillHtml() +
            '<button type="button" class="theme-toggle" id="themeToggle" title="Переключить тему" aria-label="Переключить тему">' +
              icon(resolvedTheme() === 'dark' ? 'sun' : 'moon', 17) +
            '</button>' +
            '<span class="topbar-date">' + icon('calendar', 14) + ' ' + fmtDateShort(now) + ', ' + WEEKDAYS_SHORT[now.getDay()] + '</span>' +
            '<button type="button" class="topbar-user" id="topbarUser" title="Настройки профиля">' +
              avatarHtml(user.fullName, 'avatar-sm') +
              '<div style="text-align:left"><div class="nm">' + esc((user.fullName || '').split(' ')[0]) + '</div><div class="rl">' + roleLabel(user.role) + '</div></div>' +
            '</button>' +
          '</div>' +
        '</header>' +
        ((isIOS() && !isStandalone())
          ? '<div class="ios-browser-bar" id="iosBar">' + icon('info', 15) +
              '<span>Вы в <b>Safari</b>. Чтобы приложение открывалось как обычное — <b>«Поделиться» → «На экран „Домой“»</b>.</span>' +
              '<button type="button" class="x" id="iosBarX" aria-label="Скрыть">' + icon('x', 14) + '</button></div>'
          : '') +
        '<div id="pageRoot"></div>' +
      '</div>' +
      '<nav class="bottomnav">' + bottomItems +
        '<button type="button" class="bn-item" id="moreBtn">' + icon('menu', 22) + '<span>Ещё</span></button>' +
      '</nav>' +
    '</div>';
  }

  function topbarPointHtml(user) {
    if (!user || user.role !== 'seller') return '';
    var points = userPoints(user);
    if (points.length < 2) return '';
    var active = activePointId(user);
    return '<select class="select point-switch" id="topbarPoint" title="Точка продаж">' +
      points.map(function (p) {
        return '<option value="' + p.id + '"' + (p.id === active ? ' selected' : '') + '>' + esc(p.name) + '</option>';
      }).join('') +
      '</select>';
  }

  function cloudPillHtml() {
    var api = window.POS_API;
    if (!api || !api.isServerConfigured()) return '';
    var st = api.syncStatus();
    var pending = st.pending || 0;
    var cls = pending ? 'pending' : (st.error ? 'error' : 'ok');
    var title = pending
      ? 'Не отправлено: ' + pending + ' — нажмите, чтобы синхронизировать'
      : (st.error ? st.error : 'Данные синхронизированы');
    return '<button type="button" class="sync-pill ' + cls + '" id="syncPill" title="' + esc(title) + '">' +
      icon(pending ? 'sync' : 'cloud', 16) +
      (pending ? '<span class="cnt">' + pending + '</span>' : '') +
      '</button>';
  }

  function refreshCloudPill() {
    var pill = document.getElementById('syncPill');
    if (!pill) return;
    var api = window.POS_API;
    if (!api || !api.isServerConfigured()) { pill.remove(); return; }
    var holder = document.createElement('div');
    holder.innerHTML = cloudPillHtml();
    var fresh = holder.firstChild;
    if (fresh) pill.replaceWith(fresh);
    bindCloudPill();

    var pointSwitch = document.getElementById('topbarPoint');
    if (pointSwitch) {
      pointSwitch.addEventListener('change', function () {
        if (!setActivePoint(user, pointSwitch.value)) return;
        toast('Точка продаж: ' + pointName(pointSwitch.value), 'info', 2600);
        if (activePage === 'cash' && typeof window.resetCashStatePoint === 'function') window.resetCashStatePoint();
        renderApp(activePage, user);
      });
    }
  }

  function bindCloudPill() {
    var pill = document.getElementById('syncPill');
    if (!pill) return;
    pill.addEventListener('click', function () {
      var api = window.POS_API;
      if (!api) return;
      var st = api.syncStatus();
      if (st.pending && st.online) {
        pill.classList.add('busy');
        api.syncNow({ silent: false }).then(function () {
          pill.classList.remove('busy');
          refreshCloudPill();
          renderPageOnly();
        });
      } else {
        navigate('settings');
      }
    });
  }

  /* ---------- компьютерный режим: свёрнутый сайдбар, поиск, горячие клавиши ---------- */

  function desktopMode() {
    return window.matchMedia('(min-width: 1021px)').matches;
  }

  function applySidebarState(collapsed) {
    document.body.classList.toggle('side-collapsed', !!collapsed && desktopMode());
    try { localStorage.setItem('poskontrol_sidebar', collapsed ? 'collapsed' : 'open'); } catch (e) {}
  }

  function restoreSidebarState() {
    var saved = 'open';
    try { saved = localStorage.getItem('poskontrol_sidebar') || 'open'; } catch (e) {}
    applySidebarState(saved === 'collapsed');
  }

  function toggleSidebarCollapse() {
    if (!desktopMode()) return;
    applySidebarState(!document.body.classList.contains('side-collapsed'));
  }

  /** На компьютере кнопка «Экспорт» переезжает в шапку страницы */
  function syncExportButton() {
    var root = document.getElementById('pageRoot');
    if (!root) return;
    var fab = root.querySelector('.fab, .fab-inline');
    if (!fab) return;
    if (desktopMode()) {
      var head = root.querySelector('.page-head');
      var host = head;
      if (!host) {
        var greet = root.querySelector('.greet');
        if (greet) host = greet;
      }
      if (!host) return;
      fab.classList.add('fab-inline');
      var actions = host.querySelector('.page-actions');
      if (!actions) {
        actions = document.createElement('div');
        actions.className = 'page-actions';
        if (host.classList.contains('greet')) {
          var row = host.querySelector('.period-row');
          if (row) row.appendChild(actions); else host.appendChild(actions);
        } else {
          host.appendChild(actions);
        }
      }
      if (fab.parentNode !== actions) actions.appendChild(fab);
    } else if (fab.classList.contains('fab-inline')) {
      fab.classList.remove('fab-inline');
      if (!root.querySelector('.fab')) root.appendChild(fab);
    }
  }

  /** Поиск по всей системе (Ctrl+K) */
  function openCommandPalette() {
    if (document.querySelector('.cmdk-overlay') || !activeUser) return;
    var user = activeUser;

    var items = [];
    WORK_ORDER.concat(['help', 'settings']).forEach(function (page) {
      if (!canAccess(user, page)) return;
      var label = (page === 'settings' && user.role === 'seller') ? 'Профиль' : NAV[page].label;
      items.push({ group: 'Разделы', name: label, sub: 'Открыть раздел', icon: NAV[page].icon, run: function () { navigate(page); } });
    });

    if (user.role === 'seller') {
      items.push({ group: 'Разделы', name: 'Новая продажа', sub: 'Касса', icon: 'cash', run: function () { navigate('cash'); } });
    } else {
      items.push({ group: 'Действия', name: 'Ручная продажа за прошлую дату', sub: 'Раздел «Ручные продажи»', icon: 'edit', run: function () { navigate('manual'); } });
      items.push({ group: 'Действия', name: 'Добавить расход', sub: 'Панель → расходы', icon: 'wallet', run: function () {
        navigate('dashboard');
        setTimeout(function () { if (typeof window.openExpenseModal === 'function') window.openExpenseModal(); }, 220);
      } });
    }

    (DB.products || []).slice(0, 400).forEach(function (p) {
      items.push({ group: 'Товары', name: p.name, sub: fmtMoney(p.price) + (p.variant ? ' · вариант' : ''), icon: 'package', run: function () { navigate('products'); } });
    });
    (DB.points || []).forEach(function (p) {
      items.push({ group: 'Точки', name: p.name, sub: p.address || 'Точка продаж', icon: 'pin', run: function () { navigate(user.role === 'seller' ? 'cash' : 'points'); } });
    });
    if (user.role === 'admin' || user.role === 'dev') {
      (DB.users || []).forEach(function (u) {
        items.push({ group: 'Сотрудники', name: u.fullName, sub: '@' + u.username + ' · ' + roleLabel(u.role), icon: 'user', run: function () { navigate('points'); } });
      });
    }

    var overlay = document.createElement('div');
    overlay.className = 'cmdk-overlay';
    overlay.innerHTML =
      '<div class="cmdk" role="dialog" aria-modal="true" aria-label="Поиск">' +
        '<div class="cmdk-input-row">' + icon('search', 19) +
          '<input class="cmdk-input" id="cmdkInput" placeholder="Раздел, товар, точка, сотрудник…" autocomplete="off" spellcheck="false">' +
          '<span class="cmdk-esc">Esc</span>' +
        '</div>' +
        '<div class="cmdk-list" id="cmdkList"></div>' +
        '<div class="cmdk-foot">' +
          '<span><span class="k">↑</span><span class="k">↓</span> выбор</span>' +
          '<span><span class="k">Enter</span> открыть</span>' +
          '<span style="margin-left:auto"><span class="k">Ctrl</span><span class="k">K</span></span>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);

    var input = overlay.querySelector('#cmdkInput');
    var listEl = overlay.querySelector('#cmdkList');
    var visible = [], activeIndex = 0;

    function normalize(t) { return String(t || '').toLowerCase().replace(/\s+/g, ' ').trim(); }

    function render() {
      var q = normalize(input.value);
      var matched = items.filter(function (it) {
        if (!q) return true;
        return normalize(it.name).indexOf(q) !== -1 || normalize(it.sub).indexOf(q) !== -1 || normalize(it.group).indexOf(q) !== -1;
      });
      var limit = q ? 40 : 22;
      visible = matched.slice(0, limit);
      if (activeIndex >= visible.length) activeIndex = Math.max(0, visible.length - 1);

      if (!visible.length) {
        listEl.innerHTML = '<div class="cmdk-empty">Ничего не найдено по запросу «' + esc(input.value) + '»</div>';
        return;
      }
      var html = '', group = '';
      visible.forEach(function (it, i) {
        if (it.group !== group) {
          group = it.group;
          html += '<div class="cmdk-group">' + esc(group) + '</div>';
        }
        html += '<button type="button" class="cmdk-item' + (i === activeIndex ? ' active' : '') + '" data-cmdk="' + i + '">' +
          '<span class="ic">' + icon(it.icon, 16) + '</span>' +
          '<span class="t"><span class="nm">' + esc(it.name) + '</span><span class="sub">' + esc(it.sub) + '</span></span>' +
          '<span class="hint">↵</span>' +
        '</button>';
      });
      listEl.innerHTML = html;
      var active = listEl.querySelector('.cmdk-item.active');
      if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest' });
    }

    function runIndex(i) {
      var it = visible[i];
      if (!it) return;
      close();
      setTimeout(function () { it.run(); }, 30);
    }

    function close() {
      overlay.remove();
      document.removeEventListener('keydown', onKey, true);
    }

    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); activeIndex = Math.min(visible.length - 1, activeIndex + 1); render(); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); activeIndex = Math.max(0, activeIndex - 1); render(); return; }
      if (e.key === 'Enter') { e.preventDefault(); runIndex(activeIndex); }
    }

    input.addEventListener('input', function () { activeIndex = 0; render(); });
    listEl.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-cmdk]');
      if (btn) runIndex(Number(btn.getAttribute('data-cmdk')));
    });
    overlay.addEventListener('mousedown', function (e) { if (e.target === overlay) close(); });
    document.addEventListener('keydown', onKey, true);

    render();
    setTimeout(function () { input.focus(); }, 40);
  }
  window.openCommandPalette = openCommandPalette;

  /* ---------- iPhone: подсказка «на экран Домой» ---------- */
  function isIOS() {
    var ua = navigator.userAgent || '';
    var iOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    return iOS && !window.MSStream;
  }

  function isStandalone() {
    return (window.navigator.standalone === true) ||
      (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  }

  function showIOSInstallHint() {
    if (!isIOS() || isStandalone()) return;
    try { if (localStorage.getItem('poskontrol_ios_hint') === 'off') return; } catch (e) {}
    if (document.querySelector('.ios-install')) return;

    var box = document.createElement('div');
    box.className = 'ios-install ios-only-hint';
    box.innerHTML =
      '<div class="ic">' + icon('download', 18) + '</div>' +
      '<div style="flex:1;min-width:0">' +
        '<div class="ttl">Установить на iPhone</div>' +
        '<div class="txt">В Safari нажмите <b>«Поделиться»</b> (квадрат со стрелкой вверх) → ' +
          '<b>«На экран „Домой“»</b>. Приложение откроется без адресной строки и будет работать без интернета.</div>' +
        '<button type="button" class="btn btn-secondary btn-sm go" id="iosHintGuide">Показать с картинками</button>' +
      '</div>' +
      '<button type="button" class="icon-btn cls" id="iosHintClose" aria-label="Закрыть">' + icon('x', 16) + '</button>';
    document.body.appendChild(box);

    box.querySelector('#iosHintGuide').addEventListener('click', function () {
      box.remove();
      openIOSGuide();
    });
    box.querySelector('#iosHintClose').addEventListener('click', function () {
      try { localStorage.setItem('poskontrol_ios_hint', 'off'); } catch (e) {}
      box.remove();
    });
    setTimeout(function () { if (box.parentNode) box.remove(); }, 22000);
  }

  /* ---------- обновления PWA ---------- */
  function watchServiceWorker() {
    if (!('serviceWorker' in navigator) || window.Capacitor) return;
    if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (window.__swReloaded) return;
      window.__swReloaded = true;
      toast('Обновление установлено — перезапустите приложение', 'info', 5000);
    });
    setInterval(function () {
      navigator.serviceWorker.getRegistration().then(function (reg) {
        if (reg) reg.update().catch(function () {});
      }).catch(function () {});
    }, 30 * 60 * 1000);
  }

  /* ---------- iPhone: страница-инструкция и рамка в браузере ---------- */
  function isAndroid() { return /Android/i.test(navigator.userAgent || ''); }

  function openIOSGuide() {
    var android = isAndroid();
    var steps = [
      { n: '1', t: 'Откройте эту ссылку в Safari', d: 'Именно Safari. Из Chrome, Telegram или WhatsApp добавление не работает — откройте ссылку ещё раз через Safari.' },
      { n: '2', t: 'Нажмите кнопку «Поделиться»', d: 'Квадрат со стрелкой вверх — внизу по центру экрана. На iPad — вверху справа.' },
      { n: '3', t: 'Выберите «На экран „Домой“»', d: 'Пролистайте список вниз. Если пункта нет — прокрутите ещё, он почти в самом низу.' },
      { n: '4', t: 'Нажмите «Добавить»', d: 'На рабочем столе появится иконка POS Контроль. Открывайте приложение только через неё.' }
    ];
    var body =
      '<div class="form-note info" style="margin-bottom:14px">' + icon('info', 15) +
        '<span>После добавления на экран «Домой» приложение открывается на весь экран, без адресной строки, и работает без интернета.</span>' +
      '</div>' +
      '<div class="ios-steps">' + steps.map(function (st) {
        return '<div class="ios-step"><span class="num">' + st.n + '</span><div><div class="t">' + st.t + '</div><div class="d">' + st.d + '</div></div></div>';
      }).join('') + '</div>' +
      (android
        ? '<div class="form-note warn" style="margin-top:12px">' + icon('alert', 15) +
            '<span>Вы открыли с Android или компьютера. Инструкция для iPhone — на телефоне Apple. На Android ставится APK-файл, на компьютере — .exe.</span></div>'
        : '') +
      '<div class="ios-address" style="margin-top:14px"><div class="lbl">Адрес приложения — скопируйте и пришлите сотрудникам</div>' +
        '<div class="row"><input class="input" id="iosAddr" readonly value="' + esc(location.origin + location.pathname) + '">' +
        '<button type="button" class="btn btn-secondary" id="iosCopy">' + icon('download', 15) + ' Копировать</button></div></div>';

    openModal({
      title: 'Установить на iPhone',
      subtitle: 'Четыре шага — один раз',
      size: 'md',
      body: body,
      footer: '<button type="button" class="btn btn-primary" data-close>Понятно</button>',
      onMount: function (el) {
        var btn = el.querySelector('#iosCopy');
        var field = el.querySelector('#iosAddr');
        if (btn) btn.addEventListener('click', function () {
          field.select();
          var done = false;
          try { done = document.execCommand('copy'); } catch (e) {}
          if (navigator.clipboard && !done) {
            navigator.clipboard.writeText(field.value).then(function () { toast('Ссылка скопирована', 'success'); }).catch(function () { toast('Выделите и скопируйте адрес вручную', 'info'); });
          } else {
            toast(done ? 'Ссылка скопирована' : 'Выделите и скопируйте адрес вручную', done ? 'success' : 'info');
          }
        });
      }
    });
  }
  window.openIOSGuide = openIOSGuide;

  function bindDesktopChrome(user) {
    restoreSidebarState();

    var collapseBtn = document.getElementById('sideCollapse');
    if (collapseBtn) collapseBtn.addEventListener('click', toggleSidebarCollapse);

    var searchBtn = document.getElementById('globalSearch');
    if (searchBtn) searchBtn.addEventListener('click', openCommandPalette);

    var iosGet = document.getElementById('iosGetBtn');
    if (iosGet) iosGet.addEventListener('click', openIOSGuide);

    var iosBarX = document.getElementById('iosBarX');
    if (iosBarX) iosBarX.addEventListener('click', function () {
      var bar = document.getElementById('iosBar');
      if (bar) bar.remove();
    });

    if (!window.__deskKeysBound) {
      window.__deskKeysBound = true;
      document.addEventListener('keydown', function (e) {
        var mod = e.ctrlKey || e.metaKey;
        if (mod && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); openCommandPalette(); return; }
        if (mod && (e.key === 'b' || e.key === 'B')) { e.preventDefault(); toggleSidebarCollapse(); return; }
        if (e.altKey && /^[1-9]$/.test(e.key)) {
          var pages = WORK_ORDER.concat(['help', 'settings']).filter(function (p) { return canAccess(activeUser, p); });
          var target = pages[Number(e.key) - 1];
          if (target) { e.preventDefault(); navigate(target); }
        }
      });
      var resizeTimer = null;
      window.addEventListener('resize', function () {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(function () {
          applySidebarState(document.body.classList.contains('side-collapsed'));
          syncExportButton();
        }, 160);
      });
    }

    syncExportButton();
    showIOSInstallHint();
  }

  function bindShell(user) {
    var sidebar = document.getElementById('sidebar');
    var overlay = document.getElementById('navOverlay');
    var body = document.body;

    function openSidebar() {
      sidebar.classList.add('open');
      overlay.classList.add('show');
      body.classList.add('no-scroll');
    }
    function closeSidebar() {
      sidebar.classList.remove('open');
      overlay.classList.remove('show');
      if (!document.querySelector('.modal-overlay')) body.classList.remove('no-scroll');
    }

    var menuBtn = document.getElementById('menuBtn');
    if (menuBtn) menuBtn.addEventListener('click', function () {
      if (sidebar.classList.contains('open')) closeSidebar(); else openSidebar();
    });
    var moreBtn = document.getElementById('moreBtn');
    if (moreBtn) moreBtn.addEventListener('click', openSidebar);
    overlay.addEventListener('click', closeSidebar);

    document.querySelectorAll('[data-nav]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        closeSidebar();
        navigate(btn.getAttribute('data-nav'));
      });
    });

    var logoutBtn = document.getElementById('sideLogout');
    if (logoutBtn) logoutBtn.addEventListener('click', function () {
      closeSidebar();
      confirmDialog({ title: 'Выйти из аккаунта?', message: 'Вы сможете войти снова по логину и паролю.', confirmText: 'Выйти' })
        .then(function (ok) { if (ok) doLogout(); });
    });

    var themeBtn = document.getElementById('themeToggle');
    if (themeBtn) {
      themeBtn.addEventListener('click', function () {
        var theme = toggleTheme();
        themeBtn.innerHTML = icon(theme === 'dark' ? 'sun' : 'moon', 17);
      });
    }

    bindCloudPill();

    var pointSwitch = document.getElementById('topbarPoint');
    if (pointSwitch) {
      pointSwitch.addEventListener('change', function () {
        if (!setActivePoint(user, pointSwitch.value)) return;
        toast('Точка продаж: ' + pointName(pointSwitch.value), 'info', 2600);
        if (activePage === 'cash' && typeof window.resetCashStatePoint === 'function') window.resetCashStatePoint();
        renderApp(activePage, user);
      });
    }

    bindDesktopChrome(user);

    var topbarUser = document.getElementById('topbarUser');
    if (topbarUser) topbarUser.addEventListener('click', function () { navigate('settings'); });
    var sideUser = document.getElementById('sideUser');
    if (sideUser) sideUser.addEventListener('click', function () { navigate('settings'); });
  }

  function renderPageOnly() {
    var pageRoot = document.getElementById('pageRoot');
    if (!pageRoot || !activeUser || !activePage) return;
    try {
      PAGES[activePage].render(pageRoot, pageCtx(activeUser, activePage));
      syncExportButton();
    } catch (err) {
      console.error('Ошибка раздела', err);
      pageRoot.innerHTML = '<div class="page"><div class="card">' +
        emptyState('alert', 'Не удалось открыть раздел', 'Произошла ошибка при отрисовке. Попробуйте обновить страницу или вернуться на панель.',
          '<button class="btn btn-primary" id="errHome">На панель</button><button class="btn btn-secondary" id="errReload">Обновить</button>') +
        '</div></div>';
      var home = pageRoot.querySelector('#errHome');
      if (home) home.addEventListener('click', function () { navigate(defaultPage(activeUser)); });
      var reload = pageRoot.querySelector('#errReload');
      if (reload) reload.addEventListener('click', function () { location.reload(); });
    }
  }

  function renderApp(page, user) {
    watchServiceWorker();
    activeUser = user;
    activePage = page;
    document.getElementById('app').innerHTML = shellHtml(user, page);
    bindShell(user);
    document.title = 'POS Контроль — ' + NAV[page].label;
    renderPageOnly();
  }

  function renderAuth(page) {
    activePage = null;
    activeUser = null;
    var appEl = document.getElementById('app');
    appEl.innerHTML = '';
    document.title = page === 'register' ? 'POS Контроль — Регистрация' : 'POS Контроль — Вход';
    var ctx = { navigate: navigate, rerender: function () { renderAuth(page); } };
    if (PAGES[page]) PAGES[page].render(appEl, ctx);
  }

  function route() {
    var raw = (location.hash || '').replace(/^#\/?/, '').split('?')[0];
    var user = currentUser();

    if (!user) {
      var authPage = raw === 'register' ? 'register' : 'login';
      if (location.hash !== '#/' + authPage) history.replaceState(null, '', '#/' + authPage);
      renderAuth(authPage);
      return;
    }

    if (!raw || raw === 'login' || raw === 'register') {
      var target = defaultPage(user);
      history.replaceState(null, '', '#/' + target);
      raw = target;
    }
    if (!PAGES[raw] || !canAccess(user, raw)) {
      var fallback = defaultPage(user);
      toast('Доступ к разделу «' + (NAV[raw] ? NAV[raw].label : raw) + '» ограничен для вашей роли', 'warn');
      history.replaceState(null, '', '#/' + fallback);
      raw = fallback;
    }

    if (activePage && PAGES[activePage] && typeof PAGES[activePage].cleanup === 'function') {
      try { PAGES[activePage].cleanup(); } catch (e) { /* ignore */ }
    }
    renderApp(raw, user);
    try { window.scrollTo(0, 0); } catch (e) { /* ignore */ }
  }

  window.addEventListener('hashchange', route);

  window.addEventListener('error', function (e) {
    if (e && e.message) console.error('[POS]', e.message);
  });
  window.addEventListener('unhandledrejection', function (e) {
    console.error('[POS] Необработанная ошибка', e.reason);
  });

  function boot() {
    initCore();
    applyTheme();
    if (window.POS_API) {
      window.POS_API.startAutoSync();
      window.addEventListener('pos:sync', function () {
        refreshCloudPill();
        // открытые формы не трогаем — обновляем только индикатор
        var page = document.getElementById('pageRoot');
        if (page && activePage === 'dashboard' && !document.querySelector('.modal-overlay')) {
          var focused = document.activeElement;
          var editing = focused && /^(INPUT|TEXTAREA|SELECT)$/.test(focused.tagName);
          if (!editing) renderPageOnly();
        }
      });
      window.addEventListener('pos:sync-error', function () { refreshCloudPill(); });
      setTimeout(function () { window.POS_API.syncNow({ silent: true }); }, 1200);
    }
    if (!location.hash) {
      var user = currentUser();
      history.replaceState(null, '', user ? '#/' + defaultPage(user) : '#/login');
    }

    // забытые смены: закрываем при запуске и далее раз в 20 секунд
    autoCloseOpenShifts();
    startShiftWatcher();

    route();
  }

  /**
   * Следит за границей 02:00:
   *  — закрывает смены, где забыли отметить уход;
   *  — завершает сессию продавца в 02:00.
   */
  function startShiftWatcher() {
    var lastTick = Date.now();
    setInterval(function () {
      var now = Date.now();
      var closed = autoCloseOpenShifts(now);
      var user = currentUser();

      if (closed.length && user) {
        var mine = closed.some(function (t) { return t.userId === user.id; });
        if (mine) toast('Смена закрыта автоматически в ' + fmtTime(shiftAutoCloseAt(closed[0].date)) + ': уход не был отмечен', 'info', 6000);
      }

      var boundary = nightBoundaryBetween(lastTick, now);
      lastTick = now;
      if (!boundary) return;

      // 02:00 — сессия продавца завершается
      if (user && user.role === 'seller') {
        logoutUser();
        if (typeof window.resetCashState === 'function') window.resetCashState();
        activePage = null;
        toast('Смена завершена автоматически в 02:00. Войдите снова перед началом работы', 'info', 7000);
        history.replaceState(null, '', '#/login');
        route();
      }
    }, 20000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
