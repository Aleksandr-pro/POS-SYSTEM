/* ============================================================
   POS Контроль — облако: вход через сервер и синхронизация
   Работает офлайн-first: локальные данные остаются основными,
   изменения уходят на Cloudflare при появлении сети.
   ============================================================ */
(function () {
  'use strict';

  var CONFIG_KEY = 'poskontrol_server';
  var SYNC_COLLECTIONS = ['users', 'points', 'categories', 'products', 'stock', 'supplies', 'sales', 'saleChanges', 'expenses', 'time', 'stockChecks', 'settings'];
  var memoryConfig = null;
  var syncTimer = null;
  var syncInFlight = false;
  var lastError = null;
  var autoTimer = null;

  function storageGet(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function storageSet(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* ignore */ }
  }

  /* ---------- конфигурация ---------- */

  function serverConfig() {
    var raw = storageGet(CONFIG_KEY);
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') return normalizeConfig(parsed);
      } catch (e) { /* ignore */ }
    }
    return normalizeConfig(memoryConfig || {});
  }

  function normalizeConfig(cfg) {
    return {
      url: cfg.url ? String(cfg.url).replace(/\/+$/, '') : '',
      token: cfg.token || '',
      user: cfg.user || null,
      lastSync: Number(cfg.lastSync) || 0,
      autoSync: cfg.autoSync !== false,
      connectedAt: Number(cfg.connectedAt) || 0,
      deviceId: cfg.deviceId || (function () {
        var id = 'dev-' + Math.random().toString(36).slice(2, 10);
        return id;
      })()
    };
  }

  function saveServerConfig(patch) {
    var next = Object.assign(serverConfig(), patch || {});
    memoryConfig = next;
    storageSet(CONFIG_KEY, JSON.stringify(next));
    return next;
  }

  function isServerConfigured() {
    var cfg = serverConfig();
    return !!(cfg.url && cfg.token);
  }

  function isOnline() {
    return typeof navigator === 'undefined' || navigator.onLine !== false;
  }

  function serverUrl() {
    return serverConfig().url;
  }

  /* ---------- HTTP ---------- */

  async function apiRequest(path, options) {
    options = options || {};
    var cfg = serverConfig();
    var base = options.baseUrl || cfg.url;
    if (!base) throw new Error('Адрес сервера не указан');
    var url = base.replace(/\/+$/, '') + path;

    var headers = { 'Content-Type': 'application/json' };
    var token = options.token !== undefined ? options.token : cfg.token;
    if (token && options.auth !== false) headers.Authorization = 'Bearer ' + token;

    var controller = null;
    var timer = null;
    if (typeof AbortController !== 'undefined') {
      controller = new AbortController();
      timer = setTimeout(function () { controller.abort(); }, options.timeout || 20000);
    }

    var response;
    try {
      response = await fetch(url, {
        method: options.method || 'GET',
        headers: headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller ? controller.signal : undefined,
        cache: 'no-store'
      });
    } catch (err) {
      if (timer) clearTimeout(timer);
      var message = err && err.name === 'AbortError'
        ? 'Сервер не ответил вовремя. Проверьте интернет и адрес сервера'
        : 'Нет связи с сервером. Проверьте интернет и адрес';
      throw new Error(message);
    }
    if (timer) clearTimeout(timer);

    var text = await response.text();
    var data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { data = { raw: text }; }

    if (!response.ok) {
      var msg = (data && (data.error || data.message)) || ('Ошибка сервера (' + response.status + ')');
      var error = new Error(msg);
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data;
  }

  async function testServer(url) {
    var clean = String(url || serverConfig().url || '').trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(clean)) throw new Error('Адрес должен начинаться с https:// (или http:// для локальной сети)');
    var data = await apiRequest('/api/health', { baseUrl: clean, auth: false, timeout: 15000 });
    if (!data || !data.ok) throw new Error('По адресу отвечает не POS-сервер');
    return data;
  }

  /* ---------- метки синхронизации ---------- */

  function ensureSyncState() {
    if (!DB._sync) DB._sync = {};
    if (!DB._sync.versions) DB._sync.versions = {};
    if (!DB._sync.deleted) DB._sync.deleted = {};
    return DB._sync;
  }

  function collectionData(collection) {
    if (collection === 'settings') {
      return [Object.assign({ id: 'app' }, DB.settings)];
    }
    return Array.isArray(DB[collection]) ? DB[collection] : [];
  }

  function markVersions(collection, records) {
    var state = ensureSyncState();
    if (!state.versions[collection]) state.versions[collection] = {};
    records.forEach(function (record) {
      if (record && record.id) state.versions[collection][record.id] = record.updatedAt || record.createdAt || 0;
    });
  }

  function markDeleted(collection, id) {
    if (!id) return;
    var state = ensureSyncState();
    if (!state.deleted[collection]) state.deleted[collection] = [];
    var exists = state.deleted[collection].some(function (x) { return x.id === id; });
    if (!exists) state.deleted[collection].push({ id: id, at: Date.now() });
    saveDB();
  }

  function collectChanges() {
    var state = ensureSyncState();
    var changes = {};
    SYNC_COLLECTIONS.forEach(function (collection) {
      var known = state.versions[collection] || {};
      var dirty = collectionData(collection).filter(function (record) {
        if (!record || !record.id) return false;
        var stamp = record.updatedAt || record.createdAt || 0;
        return stamp > (known[record.id] || 0);
      });
      if (dirty.length) changes[collection] = dirty;
    });
    return changes;
  }

  function collectDeletions() {
    var state = ensureSyncState();
    var deletions = {};
    Object.keys(state.deleted).forEach(function (collection) {
      var list = (state.deleted[collection] || []).slice(0, 500).map(function (x) { return x.id; });
      if (list.length) deletions[collection] = list;
    });
    return deletions;
  }

  function pendingDetails() {
    var changes = collectChanges();
    var deletions = collectDeletions();
    var out = {};
    Object.keys(changes).forEach(function (c) { out[c] = changes[c].length; });
    Object.keys(deletions).forEach(function (c) { out['удаления:' + c] = deletions[c].length; });
    return out;
  }

  function pendingCount() {
    var changes = collectChanges();
    var deletions = collectDeletions();
    var count = 0;
    Object.keys(changes).forEach(function (c) { count += changes[c].length; });
    Object.keys(deletions).forEach(function (c) { count += deletions[c].length; });
    return count;
  }

  /**
   * Ограничение размера запроса: бесплатный тариф Workers даёт 10 мс CPU,
   * поэтому большой пакет (например, продажи с фото чеков) отправляем частями.
   * Самые тяжёлые записи откладываются на следующий проход.
   */
  function trimChanges(changes, deletions, limit) {
    var payloadSize = JSON.stringify({ changes: changes, deletions: deletions }).length;
    if (payloadSize <= limit) return false;
    var trimmed = false;

    while (payloadSize > limit) {
      var bestCol = null, bestIndex = -1, bestLen = 0;
      Object.keys(changes).forEach(function (col) {
        var list = changes[col];
        for (var i = 0; i < list.length; i++) {
          var len = JSON.stringify(list[i]).length;
          if (len > bestLen) { bestLen = len; bestCol = col; bestIndex = i; }
        }
      });
      if (!bestCol || bestLen < 4000 || changes[bestCol].length <= 1) break;
      changes[bestCol].splice(bestIndex, 1);
      if (!changes[bestCol].length) delete changes[bestCol];
      trimmed = true;
      payloadSize = JSON.stringify({ changes: changes, deletions: deletions }).length;
    }
    return trimmed;
  }

  /* ---------- слияние данных с сервером ---------- */

  function mergeCollections(changes, deletions) {
    var state = ensureSyncState();
    var applied = 0;

    Object.keys(changes || {}).forEach(function (collection) {
      if (SYNC_COLLECTIONS.indexOf(collection) === -1) return;

      if (collection === 'settings') {
        var incomingSettings = (changes[collection] || [])[0];
        if (!incomingSettings) return;
        var localStamp = DB.settings.updatedAt || 0;
        if ((incomingSettings.updatedAt || 0) >= localStamp) {
          var copy = Object.assign({}, incomingSettings);
          delete copy.id;
          DB.settings = Object.assign({}, DB.settings, copy);
          applied++;
        }
        if (!state.versions.settings) state.versions.settings = {};
        state.versions.settings.app = incomingSettings.updatedAt || 0;
        return;
      }

      if (!Array.isArray(DB[collection])) DB[collection] = [];
      var localById = {};
      DB[collection].forEach(function (row, index) {
        if (row && row.id) localById[row.id] = { row: row, index: index };
      });

      (changes[collection] || []).forEach(function (incoming) {
        if (!incoming || !incoming.id) return;
        var stamp = incoming.updatedAt || incoming.createdAt || 0;
        var existing = localById[incoming.id];

        if (!existing) {
          var fresh = Object.assign({}, incoming);
          if (collection === 'users' && !fresh.pass) fresh.pass = null;
          DB[collection].push(fresh);
          applied++;
        } else {
          var localStamp = existing.row.updatedAt || existing.row.createdAt || 0;
          if (stamp > localStamp) {
            var merged = Object.assign({}, existing.row, incoming);
            if (collection === 'users' && existing.row.pass) merged.pass = existing.row.pass;
            DB[collection][existing.index] = merged;
            applied++;
          }
        }
        if (!state.versions[collection]) state.versions[collection] = {};
        state.versions[collection][incoming.id] = Math.max(state.versions[collection][incoming.id] || 0, stamp);
      });
    });

    Object.keys(deletions || {}).forEach(function (collection) {
      if (SYNC_COLLECTIONS.indexOf(collection) === -1) return;
      var ids = deletions[collection] || [];
      if (!ids.length) return;

      if (collection === 'settings') return;

      DB[collection] = (DB[collection] || []).filter(function (row) {
        return ids.indexOf(row.id) === -1;
      });
      applied += ids.length;
      if (DB.session && collection === 'users' && ids.indexOf(DB.session.userId) !== -1) {
        DB.session = null;
      }
    });

    if (applied) saveDB();
    return applied;
  }

  function pruneDeletions(sent) {
    var state = ensureSyncState();
    Object.keys(sent || {}).forEach(function (collection) {
      var ids = sent[collection] || [];
      if (!state.deleted[collection]) return;
      state.deleted[collection] = state.deleted[collection].filter(function (item) {
        return ids.indexOf(item.id) === -1;
      });
      if (!state.deleted[collection].length) delete state.deleted[collection];
    });
  }

  /* ---------- синхронизация ---------- */

  async function syncNow(options) {
    options = options || {};
    if (!isServerConfigured()) {
      if (!options.silent) toast('Сначала подключите сервер в настройках', 'warn');
      return { skipped: true };
    }
    if (!isOnline()) {
      lastError = 'Нет интернета';
      if (!options.silent) toast('Нет интернета — данные сохранятся и отправятся позже', 'warn');
      return { skipped: true, offline: true };
    }
    if (syncInFlight) {
      // уже идёт синхронизация — дожидаемся её и повторяем запрос
      if (options.queued) return { skipped: true, busy: true };
      return new Promise(function (resolve) {
        var tries = 0;
        var wait = setInterval(function () {
          tries++;
          if (!syncInFlight) {
            clearInterval(wait);
            syncNow(Object.assign({}, options, { queued: true, silent: options.silent })).then(resolve);
          } else if (tries > 50) {
            clearInterval(wait);
            resolve({ skipped: true, busy: true });
          }
        }, 100);
      });
    }

    syncInFlight = true;
    try {
      ensureSyncState();
      var cfg = serverConfig();
      var changes = collectChanges();
      var deletions = collectDeletions();
      var trimmed = trimChanges(changes, deletions, 500000);

      var payload = {
        since: cfg.lastSync || 0,
        changes: changes,
        deletions: deletions,
        deviceId: cfg.deviceId
      };

      var result = await apiRequest('/api/sync', { method: 'POST', body: payload });

      // сервер принял — фиксируем версии
      Object.keys(result.accepted || {}).forEach(function (collection) {
        var acceptedIds = result.accepted[collection] || [];
        if (collection === 'settings') return;
        var acceptedRecords = (changes[collection] || []).filter(function (r) {
          return acceptedIds.indexOf(r.id) !== -1;
        });
        markVersions(collection, acceptedRecords);
      });
      pruneDeletions(deletions);

      // отклонённые сервером записи (нет прав) не повторяем каждый раз
      var denied = 0;
      Object.keys(result.rejected || {}).forEach(function (collection) {
        var ids = result.rejected[collection] || [];
        if (!ids.length) return;
        denied += ids.length;
        var rejectedRecords = (changes[collection] || []).filter(function (r) {
          return ids.indexOf(r.id) !== -1;
        });
        markVersions(collection, rejectedRecords);
      });

      var applied = mergeCollections(result.changes, result.deletions);

      saveServerConfig({
        lastSync: result.cursor || Date.now(),
        user: result.user || cfg.user
      });
      ensureSyncState().lastSyncAt = Date.now();
      lastError = null;
      saveDB();

      var summary = {
        pushed: result.written || 0,
        pulled: applied,
        rejected: result.rejected || {},
        denied: denied,
        hasMore: !!result.hasMore
      };

      if (!options.silent) {
        if (denied) toast('Сервер отклонил ' + denied + ' ' + (denied === 1 ? 'запись' : 'записей') + ': недостаточно прав', 'warn', 5200);
        else if (summary.pushed || summary.pulled) toast('Синхронизировано: отправлено ' + summary.pushed + ', получено ' + summary.pulled, 'success');
        else toast('Данные актуальны', 'info');
      }
      window.dispatchEvent(new CustomEvent('pos:sync', { detail: summary }));

      if (result.hasMore) setTimeout(function () { syncNow({ silent: true }); }, 400);
      if (trimmed) setTimeout(function () { syncNow({ silent: true }); }, 1200);
      return summary;
    } catch (err) {
      lastError = err.message;
      if (err.status === 401) {
        saveServerConfig({ token: '' });
        lastError = 'Сессия сервера истекла — войдите заново';
      }
      window.dispatchEvent(new CustomEvent('pos:sync-error', { detail: { message: lastError } }));
      if (!options.silent) toast(lastError, 'error', 4600);
      return { error: lastError };
    } finally {
      syncInFlight = false;
    }
  }

  function scheduleSync(delay) {
    if (!isServerConfigured() || !serverConfig().autoSync) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(function () { syncNow({ silent: true }); }, delay || 2500);
  }

  function startAutoSync() {
    if (autoTimer) clearInterval(autoTimer);
    autoTimer = setInterval(function () {
      if (document.visibilityState === 'visible' && isServerConfigured() && isOnline()) {
        syncNow({ silent: true });
      }
    }, 60000);

    window.addEventListener('online', function () {
      if (isServerConfigured()) {
        toast('Интернет появился — синхронизируем данные', 'info');
        syncNow({ silent: true });
      }
    });
    window.addEventListener('offline', function () {
      if (isServerConfigured()) toast('Нет интернета — работаем офлайн', 'warn');
    });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && isServerConfigured()) syncNow({ silent: true });
    });
  }

  /* ---------- вход и регистрация через сервер ---------- */

  async function localUserFromServer(serverUser, password) {
    var local = DB.users.find(function (u) { return u.id === serverUser.id; }) ||
      findUserByUsername(serverUser.username);
    var localPass = password ? await hashPassword(password) : null;

    if (local) {
      local.fullName = serverUser.fullName || local.fullName;
      local.username = serverUser.username || local.username;
      local.role = serverUser.role || local.role;
      if (serverUser.pointIds !== undefined) local.pointIds = serverUser.pointIds || [];
      local.pointId = serverUser.pointId !== undefined ? serverUser.pointId : local.pointId;
      if ((!local.pointIds || !local.pointIds.length) && local.pointId) local.pointIds = [local.pointId];
      local.workStart = serverUser.workStart !== undefined ? serverUser.workStart : local.workStart;
      local.workEnd = serverUser.workEnd !== undefined ? serverUser.workEnd : local.workEnd;
      local.id = serverUser.id;
      local.updatedAt = serverUser.updatedAt || Date.now();
      if (localPass) local.pass = localPass;
      return local;
    }

    var created = {
      id: serverUser.id,
      fullName: serverUser.fullName,
      username: serverUser.username,
      pass: localPass,
      role: serverUser.role || 'seller',
      pointIds: Array.isArray(serverUser.pointIds) ? serverUser.pointIds : (serverUser.pointId ? [serverUser.pointId] : []),
      pointId: serverUser.pointId || null,
      workStart: serverUser.workStart || '',
      workEnd: serverUser.workEnd || '',
      createdAt: serverUser.createdAt || Date.now(),
      updatedAt: serverUser.updatedAt || Date.now()
    };
    DB.users.push(created);
    return created;
  }

  async function serverLogin(username, password) {
    var result = await apiRequest('/api/login', {
      method: 'POST',
      auth: false,
      body: { username: username, password: password }
    });
    saveServerConfig({
      token: result.token,
      user: result.user,
      connectedAt: Date.now()
    });

    var local = await localUserFromServer(result.user, password);
    setSession(local.id);
    markVersions('users', [local]);
    saveDB();

    await syncNow({ silent: true });
    return local;
  }

  async function serverRegister(data) {
    var result = await apiRequest('/api/register', {
      method: 'POST',
      auth: false,
      body: { fullName: data.fullName, username: data.username, password: data.password }
    });
    saveServerConfig({
      token: result.token,
      user: result.user,
      connectedAt: Date.now()
    });

    var local = await localUserFromServer(result.user, data.password);
    setSession(local.id);
    markVersions('users', [local]);
    saveDB();

    await syncNow({ silent: true });
    return local;
  }

  function serverLogout() {
    saveServerConfig({ token: '', user: null });
  }

  async function changeServerPassword(currentPassword, newPassword) {
    if (!isServerConfigured()) return { skipped: true };
    return apiRequest('/api/password', {
      method: 'POST',
      body: { currentPassword: currentPassword, newPassword: newPassword }
    });
  }

  async function createServerUser(data) {
    if (!isServerConfigured()) return { skipped: true };
    return apiRequest('/api/users', {
      method: 'POST',
      body: {
        fullName: data.fullName,
        username: data.username,
        password: data.password,
        role: data.role || 'seller',
        pointIds: Array.isArray(data.pointIds) ? data.pointIds : (data.pointId ? [data.pointId] : []),
        pointId: data.pointId || null,
        workStart: data.workStart || '',
        workEnd: data.workEnd || ''
      }
    });
  }

  async function updateServerUser(data) {
    if (!isServerConfigured()) return { skipped: true };
    return apiRequest('/api/users/update', {
      method: 'POST',
      body: {
        userId: data.userId,
        fullName: data.fullName,
        username: data.username,
        role: data.role,
        pointIds: Array.isArray(data.pointIds) ? data.pointIds : (data.pointId ? [data.pointId] : []),
        pointId: data.pointId || null,
        workStart: data.workStart || '',
        workEnd: data.workEnd || '',
        password: data.password || ''
      }
    });
  }

  async function resetUserPassword(userId, newPassword) {
    if (!isServerConfigured()) return { skipped: true };
    return apiRequest('/api/users/password', {
      method: 'POST',
      body: { userId: userId, newPassword: newPassword }
    });
  }

  function syncStatus() {
    var cfg = serverConfig();
    return {
      configured: !!(cfg.url && cfg.token),
      url: cfg.url,
      hasToken: !!cfg.token,
      lastSync: cfg.lastSync || 0,
      lastSyncAt: (DB._sync && DB._sync.lastSyncAt) || 0,
      pending: isServerConfigured() ? pendingCount() : 0,
      online: isOnline(),
      autoSync: cfg.autoSync !== false,
      error: lastError
    };
  }

  /* ---------- глобальные хуки ---------- */

  window.POS_API = {
    serverConfig: serverConfig,
    saveServerConfig: saveServerConfig,
    isServerConfigured: isServerConfigured,
    serverUrl: serverUrl,
    testServer: testServer,
    apiRequest: apiRequest,
    syncNow: syncNow,
    scheduleSync: scheduleSync,
    startAutoSync: startAutoSync,
    syncStatus: syncStatus,
    pendingCount: pendingCount,
    pendingDetails: pendingDetails,
    markVersions: markVersions,
    markDeleted: markDeleted,
    mergeCollections: mergeCollections,
    serverLogin: serverLogin,
    serverRegister: serverRegister,
    serverLogout: serverLogout,
    changeServerPassword: changeServerPassword,
    resetUserPassword: resetUserPassword,
    createServerUser: createServerUser,
    updateServerUser: updateServerUser,
    isOnline: isOnline
  };

  // автосинхронизация после любых изменений данных
  var originalSaveDB = window.saveDB;
  window.saveDB = function () {
    var result = originalSaveDB.apply(this, arguments);
    if (isServerConfigured() && serverConfig().autoSync) scheduleSync(2500);
    return result;
  };

  window.addEventListener('pos:storage-error', function () { /* уже обрабатывается в ui.js */ });
})();
