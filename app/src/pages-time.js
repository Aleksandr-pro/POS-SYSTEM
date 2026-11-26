/* ============================================================
   POS Контроль — учёт рабочего времени и геолокация
   ============================================================ */
(function () {
  'use strict';
  var PAGES = window.PAGES = window.PAGES || {};
  var state = { date: dayKey(new Date()), pointId: 'all' };
  var clockTimer = null;

  function stopClock() {
    if (clockTimer) { clearInterval(clockTimer); clockTimer = null; }
  }

  async function markArrival(user, ctx, btn) {
    var existing = timeEntryFor(user.id);
    setButtonBusy(btn, true, 'Определяем геопозицию…');
    var geo = null;
    try {
      geo = await getGeoPosition();
    } catch (err) {
      setButtonBusy(btn, false);
      var ok = await confirmDialog({
        title: 'Геолокация недоступна',
        message: err.message + '<br><br>Можно отметить приход <b>без геометки</b> — время сохранится.',
        confirmText: 'Отметить без гео',
        cancelText: 'Отмена'
      });
      if (!ok) return;
      setButtonBusy(btn, true, 'Отмечаем…');
    }
    var entry = timeEntryFor(user.id);
    if (!entry) {
      entry = {
        id: uid(),
        userId: user.id,
        date: dayKey(new Date()),
        arriveAt: Date.now(),
        arriveGeo: geo,
        leaveAt: null,
        leaveGeo: null,
        updatedAt: Date.now()
      };
      DB.time.push(entry);
    } else {
      entry.arriveAt = Date.now();
      entry.arriveGeo = geo;
      entry.leaveAt = null;
      entry.leaveGeo = null;
      entry.updatedAt = Date.now();
    }
    saveDB();
    setButtonBusy(btn, false);
    toast('Приход отмечен в ' + fmtTime(entry.arriveAt) + (geo ? ' · геометка сохранена' : ' · без геометки'), 'success', 4200);
    ctx.rerender();
  }

  async function markLeave(user, ctx, btn) {
    var entry = timeEntryFor(user.id);
    if (!entry || !entry.arriveAt) { toast('Сначала отметьте приход', 'error'); return; }
    setButtonBusy(btn, true, 'Определяем геопозицию…');
    var geo = null;
    try {
      geo = await getGeoPosition();
    } catch (err) {
      setButtonBusy(btn, false);
      var ok = await confirmDialog({
        title: 'Геолокация недоступна',
        message: err.message + '<br><br>Отметить уход <b>без геометки</b>?',
        confirmText: 'Отметить без гео',
        cancelText: 'Отмена'
      });
      if (!ok) return;
      setButtonBusy(btn, true, 'Отмечаем…');
    }
    entry.leaveAt = Date.now();
    entry.leaveGeo = geo;
    entry.updatedAt = Date.now();
    saveDB();
    setButtonBusy(btn, false);
    toast('Уход отмечен. Отработано: ' + fmtDuration(entry.leaveAt - entry.arriveAt), 'success', 4600);
    ctx.rerender();
  }

  // доступно кассе: приход и уход отмечаются не только на странице «Время»,
  // но и из кассы (у продавца нет пункта меню «Время»)
  window.posMarkArrival = markArrival;
  window.posMarkLeave = markLeave;

  function statusInfo(entry, forDate) {
    if (!entry || !entry.arriveAt) {
      return { label: 'Не отмечен', cls: 'badge-neutral', dot: '', key: 'none' };
    }
    if (!entry.leaveAt) {
      var isToday = forDate === dayKey(new Date());
      return isToday
        ? { label: 'На работе', cls: 'badge-success', dot: 'status-dot', key: 'working' }
        : { label: 'Смена не закрыта', cls: 'badge-warn', dot: '', key: 'open' };
    }
    if (entry.autoClosed) {
      return { label: 'Смена закрыта в 02:00', cls: 'badge-warn', dot: '', key: 'auto' };
    }
    return { label: 'Смена завершена', cls: 'badge-neutral', dot: '', key: 'done' };
  }

  function geoInline(geo) {
    if (!geo || !isFinite(geo.lat)) return '<span class="tiny muted">без геометки</span>';
    return '<a class="geo-link" href="' + geoLink(geo) + '" target="_blank" rel="noopener" title="Открыть на карте">' +
      icon('pin', 12) + ' геометка' + (geo.acc ? ' ±' + geo.acc + ' м' : '') + '</a>';
  }

  /** Отметка за день, которую показываем админу: «не сходятся» важнее */
  function worstStockCheck(userId, key) {
    var list = stockChecksForDay(key).filter(function (c) { return c.userId === userId; })
      .sort(function (a, b) { return b.at - a.at; });
    var bad = list.filter(function (c) { return c.result === 'mismatch'; })[0];
    return bad || list[0] || null;
  }

  function openStockCheckDetail(check) {
    if (!check) return;
    openModal({
      title: 'Сверка склада',
      subtitle: (check.userName || '') + ' · ' + esc(pointName(check.pointId, 'Точка удалена')),
      size: 'sm',
      body:
        '<div class="check-result">' +
          (check.result === 'match'
            ? '<div class="check-result-icon ok">' + icon('check', 26) + '</div><div class="check-result-text">Данные сходятся</div>'
            : '<div class="check-result-icon warn">' + icon('alert', 26) + '</div><div class="check-result-text">Данные не сходятся</div>') +
          '<div class="muted small">' + fmtDateTime(check.at) + '</div>' +
        '</div>',
      footer: '<button type="button" class="btn btn-secondary" data-close>Закрыть</button>',
      onMount: function (el, close) { el.querySelector('[data-close]').addEventListener('click', close); }
    });
  }

  PAGES.time = {
    cleanup: stopClock,
    render: function (root, ctx) {
      stopClock();
      var user = ctx.user;
      var isSeller = user.role === 'seller';
      var today = dayKey(new Date());

      if (isSeller) {
        var entry = timeEntryFor(user.id);
        var status = statusInfo(entry, today);
        var worked = entry && entry.arriveAt ? (entry.leaveAt ? entry.leaveAt - entry.arriveAt : Date.now() - entry.arriveAt) : 0;

        var historyDays = [];
        for (var i = 0; i < 7; i++) {
          var d = addDays(new Date(), -i);
          var e = timeEntryFor(user.id, dayKey(d));
          historyDays.push({ date: d, entry: e });
        }
        var weekTotal = historyDays.reduce(function (sum, h) {
          return sum + (h.entry && h.entry.arriveAt ? (h.entry.leaveAt || Date.now()) - h.entry.arriveAt : 0);
        }, 0);
        var completedDays = historyDays.filter(function (h) { return h.entry && h.entry.leaveAt; }).length;

        root.innerHTML =
          '<div class="page">' +
            '<div class="page-head">' +
              '<div><h1>Рабочее время</h1><div class="sub">' + fmtDateHuman(Date.now()) + ' · ' + esc(userPointIds(user).length ? userPointsLabel(user) : 'Точка не назначена') + '</div></div>' +
              '<div class="page-actions"><button class="btn btn-secondary" id="checkGeo">' + icon('pin', 16) + ' Проверить геолокацию</button></div>' +
            '</div>' +

            '<div class="time-hero">' +
              '<div class="lbl">Текущее время</div>' +
              '<div class="clock" id="liveClock">' + fmtTime(Date.now()) + '</div>' +
              '<div class="status"><span class="' + (status.key === 'working' ? 'status-dot' : 'status-dot off') + '"></span>' + status.label +
                (entry && entry.arriveAt ? ' · с ' + fmtTime(entry.arriveAt) : '') +
                (worked ? ' · ' + fmtDuration(worked) : '') +
              '</div>' +
              '<div class="time-actions">' +
                '<button type="button" class="time-btn arrive" id="arriveBtn"' + (entry && entry.arriveAt ? ' disabled' : '') + '>' + icon('arrive', 20) + ' Прибытие</button>' +
                '<button type="button" class="time-btn leave" id="leaveBtn"' + (!entry || !entry.arriveAt || entry.leaveAt ? ' disabled' : '') + '>' + icon('leave', 20) + ' Уход</button>' +
              '</div>' +
              '<div class="time-geo">' +
                (entry && entry.arriveGeo
                  ? icon('pin', 14) + ' Приход: <a href="' + geoLink(entry.arriveGeo) + '" target="_blank" rel="noopener" class="ok">' + entry.arriveGeo.lat.toFixed(5) + ', ' + entry.arriveGeo.lng.toFixed(5) + '</a> ±' + (entry.arriveGeo.acc || 0) + ' м'
                  : icon('info', 14) + ' При отметке фиксируется геолокация — разрешите доступ в настройках браузера.') +
                (entry && entry.leaveGeo ? ' · Уход: ' + entry.leaveGeo.lat.toFixed(5) + ', ' + entry.leaveGeo.lng.toFixed(5) : '') +
              '</div>' +
            '</div>' +

            '<div class="grid-2 section-gap" style="grid-template-columns:1fr 1.25fr">' +
              '<div class="card">' +
                '<div class="card-head"><h3>Смена сегодня</h3>' + badge(status.label, status.cls, true) + '</div>' +
                '<div class="card-body">' +
                  '<div class="kpi-inline" style="grid-template-columns:1fr 1fr">' +
                    '<div class="kpi-mini"><div class="l">Приход</div><div class="v">' + (entry && entry.arriveAt ? fmtTime(entry.arriveAt) : '—') + '</div></div>' +
                    '<div class="kpi-mini"><div class="l">Уход</div><div class="v">' + (entry && entry.leaveAt ? fmtTime(entry.leaveAt) : '—') + '</div></div>' +
                  '</div>' +
                  '<div class="kpi-mini" style="margin-top:10px"><div class="l">Отработано</div><div class="v">' + (worked ? fmtDuration(worked) : '—') + '</div></div>' +
                  '<div class="divider"></div>' +
                  '<div class="small muted" style="line-height:1.6">За 7 дней: <b style="color:var(--ink)">' + fmtDuration(weekTotal) + '</b> · закрытых смен: <b style="color:var(--ink)">' + completedDays + '</b></div>' +
                '</div>' +
              '</div>' +
              '<div class="card" style="min-width:0">' +
                '<div class="card-head"><h3>История за 7 дней</h3><span class="muted tiny">' + esc(user.fullName) + '</span></div>' +
                '<div class="time-day">' +
                  historyDays.map(function (h) {
                    var hs = statusInfo(h.entry, dayKey(h.date));
                    var dur = h.entry && h.entry.arriveAt ? ((h.entry.leaveAt || Date.now()) - h.entry.arriveAt) : 0;
                    return '<div class="time-day-row" style="grid-template-columns:1fr auto auto">' +
                      '<div><div class="semibold" style="font-size:13px">' + (h === historyDays[0] ? 'Сегодня, ' : '') + fmtDateShort(h.date) + '</div>' +
                        '<div class="tiny muted">' + WEEKDAYS_RU[h.date.getDay()] + '</div></div>' +
                      '<div class="io"><b>' + (h.entry && h.entry.arriveAt ? fmtTime(h.entry.arriveAt) : '—') + '</b> → <b>' + (h.entry && h.entry.leaveAt ? fmtTime(h.entry.leaveAt) : '—') + '</b></div>' +
                      '<div class="dur">' + (dur ? fmtDuration(dur) : '—') + '</div>' +
                    '</div>';
                  }).join('') +
                '</div>' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<button type="button" class="fab" id="timeExport">' + icon('download', 17) + ' Экспорт<span class="kbd">XLSX</span></button>';

        root.querySelector('#arriveBtn').addEventListener('click', function () { markArrival(user, ctx, this); });
        root.querySelector('#leaveBtn').addEventListener('click', function () { markLeave(user, ctx, this); });
        root.querySelector('#checkGeo').addEventListener('click', async function () {
          var btn = this;
          setButtonBusy(btn, true, 'Проверяем…');
          try {
            var geo = await getGeoPosition();
            toast('Геолокация доступна: ' + geo.lat.toFixed(5) + ', ' + geo.lng.toFixed(5) + ' (±' + geo.acc + ' м)', 'success', 4600);
          } catch (err) { toast(err.message, 'error', 5200); }
          setButtonBusy(btn, false);
        });

        var clockEl = root.querySelector('#liveClock');
        clockTimer = setInterval(function () {
          if (!document.body.contains(clockEl)) { stopClock(); return; }
          clockEl.textContent = fmtTime(Date.now());
        }, 1000);

        root.querySelector('#timeExport').addEventListener('click', function () {
          var rows = [['Дата', 'Приход', 'Геометка прихода', 'Уход', 'Геометка ухода', 'Отработано']];
          historyDays.slice().reverse().forEach(function (h) {
            var e = h.entry;
            rows.push([
              fmtDate(h.date),
              e && e.arriveAt ? fmtTime(e.arriveAt) : '—',
              e && e.arriveGeo ? e.arriveGeo.lat + ', ' + e.arriveGeo.lng : '—',
              e && e.leaveAt ? fmtTime(e.leaveAt) : '—',
              e && e.leaveGeo ? e.leaveGeo.lat + ', ' + e.leaveGeo.lng : '—',
              e && e.arriveAt ? fmtDuration((e.leaveAt || Date.now()) - e.arriveAt) : '—'
            ]);
          });
          PosXlsx.downloadXlsx('vremya_' + dayKey(Date.now()) + '.xlsx', [{ name: 'Моё время', rows: rows }]);
          toast('Табель выгружен', 'success');
        });
        return;
      }

      /* ---------- администратор / разработчик ---------- */
      var points = DB.points;
      if (state.pointId !== 'all' && !getPoint(state.pointId)) state.pointId = 'all';
      var entries = DB.time.filter(function (t) { return t.date === state.date; });
      var filteredUsers = DB.users.filter(function (u) {
        if (state.pointId === 'all') return true;
        return userPointIds(u).indexOf(state.pointId) !== -1;
      }).sort(function (a, b) {
        var order = { seller: 0, dev: 1, admin: 2 };
        return (order[a.role] - order[b.role]) || (a.fullName || '').localeCompare(b.fullName || '', 'ru');
      });

      var isToday = state.date === today;
      var working = entries.filter(function (t) { return t.arriveAt && !t.leaveAt && isToday; }).length;
      var arrived = entries.filter(function (t) { return t.arriveAt; }).length;
      var completed = entries.filter(function (t) { return t.arriveAt && t.leaveAt; });
      var avg = completed.length ? completed.reduce(function (s, t) { return s + (t.leaveAt - t.arriveAt); }, 0) / completed.length : 0;
      var maxDuration = completed.reduce(function (m, t) { return Math.max(m, t.leaveAt - t.arriveAt); }, 0);

      root.innerHTML =
        '<div class="page">' +
          '<div class="page-head">' +
            '<div><h1>Рабочее время</h1><div class="sub">Табель сотрудников · ' + (isToday ? 'сегодня' : fmtDateHuman(new Date(state.date + 'T12:00:00').getTime())) + '</div></div>' +
            '<div class="page-actions">' +
              '<input type="date" class="input" id="teamDate" max="' + today + '" value="' + state.date + '" style="width:auto;height:40px">' +
              (points.length > 1
                ? '<select class="select" id="teamPoint" style="width:auto;height:40px;min-width:150px"><option value="all">Все точки</option>' +
                    points.map(function (p) { return '<option value="' + p.id + '"' + (state.pointId === p.id ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }).join('') +
                  '</select>'
                : '') +
            '</div>' +
          '</div>' +

          '<div class="grid-4">' +
            '<div class="card stat-card"><div class="stat-top"><div class="stat-icon green">' + icon('arrive', 20) + '</div></div>' +
              '<div><div class="stat-label">' + (isToday ? 'На работе сейчас' : 'Открытые смены') + '</div><div class="stat-value">' + working + '</div></div>' +
              '<div class="stat-foot">' + (isToday ? 'сотрудников в смене' : 'без отметки ухода') + '</div></div>' +
            '<div class="card stat-card"><div class="stat-top"><div class="stat-icon indigo">' + icon('users', 20) + '</div></div>' +
              '<div><div class="stat-label">Пришли за день</div><div class="stat-value">' + arrived + '</div></div>' +
              '<div class="stat-foot">из ' + filteredUsers.length + ' сотрудников</div></div>' +
            '<div class="card stat-card"><div class="stat-top"><div class="stat-icon blue">' + icon('clock', 20) + '</div></div>' +
              '<div><div class="stat-label">Среднее время</div><div class="stat-value" style="font-size:21px">' + (avg ? fmtDuration(avg) : '—') + '</div></div>' +
              '<div class="stat-foot">по закрытым сменам</div></div>' +
            '<div class="card stat-card"><div class="stat-top"><div class="stat-icon amber">' + icon('history', 20) + '</div></div>' +
              '<div><div class="stat-label">Максимальная смена</div><div class="stat-value" style="font-size:21px">' + (maxDuration ? fmtDuration(maxDuration) : '—') + '</div></div>' +
              '<div class="stat-foot">лучший результат дня</div></div>' +
          '</div>' +

          '<div class="card section-gap" style="min-width:0">' +
            '<div class="card-head"><div><h3>Табель за ' + (isToday ? 'сегодня' : fmtDate(state.date + 'T12:00:00')) + '</h3>' +
              '<div class="sub">Геометки прихода и ухода сохраняются автоматически</div></div>' +
              '<button type="button" class="btn btn-sm btn-secondary" id="timeRefresh">' + icon('refresh', 14) + ' Обновить</button></div>' +
            '<div class="card-body" style="padding-top:10px">' +
              '<div class="table-wrap"><table class="tbl"><thead><tr>' +
                '<th>Сотрудник</th><th>Точка</th><th>Приход</th><th>Уход</th><th>Длительность</th><th>Сверка склада</th><th>Статус</th>' +
              '</tr></thead><tbody>' +
                (filteredUsers.length
                  ? filteredUsers.map(function (u) {
                      var t = entries.find(function (x) { return x.userId === u.id; });
                      var st = statusInfo(t, state.date);
                      var dur = t && t.arriveAt ? ((t.leaveAt || Date.now()) - t.arriveAt) : 0;
                      var chk = worstStockCheck(u.id, state.date);
                      var chkHtml = chk
                        ? '<button type="button" class="btn btn-sm ' + (chk.result === 'match' ? 'btn-secondary' : 'btn-danger-soft') + '" data-check-view="' + chk.id + '">' +
                            (chk.result === 'match' ? '✓ Сходятся' : '⚠ Не сходятся') + '</button>'
                        : '<span class="muted small">—</span>';
                      return '<tr>' +
                        '<td><div class="user-cell">' + avatarHtml(u.fullName, 'avatar-sm') +
                          '<div style="min-width:0"><div class="nm truncate">' + esc(u.fullName) + '</div><div class="un">' + roleLabel(u.role) + '</div></div></div></td>' +
                        '<td><span class="small">' + (userPointIds(u).length ? userPointIds(u).map(function (id) { return esc(pointName(id, 'Удалена')); }).join(' · ') : '<span class="muted">—</span>') + '</span></td>' +
                        '<td><div class="cell-main">' + (t && t.arriveAt ? fmtTime(t.arriveAt) : '—') + '</div><div class="cell-sub">' + (t && t.arriveAt ? geoInline(t.arriveGeo) : '') + '</div></td>' +
                        '<td><div class="cell-main">' + (t && t.leaveAt ? fmtTime(t.leaveAt) : '—') + '</div><div class="cell-sub">' + (t && t.leaveAt
                          ? (t.autoClosed ? '<span class="tiny muted">закрыто автоматически</span>' : geoInline(t.leaveGeo))
                          : '') + '</div></td>' +
                        '<td>' + (dur ? '<span class="badge badge-admin">' + fmtDuration(dur) + '</span>' : '<span class="muted">—</span>') + '</td>' +
                        '<td>' + chkHtml + '</td>' +
                        '<td>' + badge(st.label, st.cls, !!st.dot) + '</td>' +
                      '</tr>';
                    }).join('')
                  : '<tr><td colspan="7" class="tbl-empty">Нет сотрудников по выбранному фильтру</td></tr>') +
              '</tbody></table></div>' +
              '<div class="form-note info" style="margin-top:14px">' + icon('pin', 15) +
                '<span>Геометки отображаются у сотрудников, разрешивших доступ к геолокации. Нажмите «геометка», чтобы открыть точку на карте. Если уход не отмечен, смена закрывается автоматически в 02:00.</span></div>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<button type="button" class="fab" id="timeTeamExport">' + icon('download', 17) + ' Экспорт<span class="kbd">XLSX</span></button>';

      root.querySelectorAll('[data-check-view]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var chk = stockChecksList().find(function (c) { return c.id === btn.getAttribute('data-check-view'); });
          if (chk) openStockCheckDetail(chk);
        });
      });

      var dateInput = root.querySelector('#teamDate');
      dateInput.addEventListener('change', function () {
        state.date = dateInput.value || today;
        ctx.rerender();
      });
      var pointSelect = root.querySelector('#teamPoint');
      if (pointSelect) pointSelect.addEventListener('change', function () { state.pointId = pointSelect.value; ctx.rerender(); });
      root.querySelector('#timeRefresh').addEventListener('click', function () { ctx.rerender(); });

      root.querySelector('#timeTeamExport').addEventListener('click', function () {
        var rows = [['Дата', 'Сотрудник', 'Роль', 'Точка', 'Приход', 'Широта', 'Долгота', 'Уход', 'Широта', 'Долгота', 'Отработано', 'Сверка склада', 'Статус']];
        var from = startOfDay(addDays(Date.now(), -29));
        DB.time.filter(function (t) { return t.arriveAt >= from; }).sort(function (a, b) { return (b.arriveAt || 0) - (a.arriveAt || 0); }).forEach(function (t) {
          var u = getUser(t.userId);
          if (state.pointId !== 'all' && (!u || userPointIds(u).indexOf(state.pointId) === -1)) return;
          var st = statusInfo(t, t.date);
          rows.push([
            fmtDate(t.arriveAt), u ? u.fullName : 'Удалённый пользователь', u ? roleLabel(u.role) : '',
            u && userPointIds(u).length ? userPointIds(u).map(function (id) { return pointName(id); }).join(', ') : '—',
            fmtTime(t.arriveAt), t.arriveGeo ? t.arriveGeo.lat : '', t.arriveGeo ? t.arriveGeo.lng : '',
            t.leaveAt ? fmtTime(t.leaveAt) : '', t.leaveGeo ? t.leaveGeo.lat : '', t.leaveGeo ? t.leaveGeo.lng : '',
            t.leaveAt ? fmtDuration(t.leaveAt - t.arriveAt) : '—',
            (function () {
              var chk = worstStockCheck(t.userId, t.date);
              return chk ? (chk.result === 'match' ? 'Данные сходятся' : 'Данные не сходятся') : 'нет сверки';
            })(),
            st.label
          ]);
        });
        var summary = [['Показатель', 'Значение'], ['Дата', fmtDate(state.date)], ['Пришли', arrived], ['Закрыли смену', completed.length], ['Среднее время', avg ? fmtDuration(avg) : '—']];
        PosXlsx.downloadXlsx('tabel_' + dayKey(Date.now()) + '.xlsx', [
          { name: 'Сводка', rows: summary },
          { name: 'Табель 30 дней', rows: rows }
        ]);
        toast('Табель выгружен в Excel', 'success');
      });
    }
  };
})();
