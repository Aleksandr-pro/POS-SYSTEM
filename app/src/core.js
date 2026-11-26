/* ============================================================
   POS Контроль — ядро: данные, авторизация, статистика, утилиты
   ============================================================ */
var APP_CONFIG = {
  name: 'POS Контроль',
  version: '3.4.12',
  storageKey: 'poskontrol_db_v1',
  currency: '₸',
  receiptTtlDays: 7,
  expenseTtlDays: 7
};

var DB = null;
var LAST_SAVE_ERROR = 0;

/* Доступно ли постоянное хранилище (в sandbox-предпросмотре localStorage может быть запрещён) */
var STORAGE_AVAILABLE = (function () {
  try {
    var key = '__pos_probe__';
    window.localStorage.setItem(key, '1');
    window.localStorage.removeItem(key);
    return true;
  } catch (e) {
    return false;
  }
})();

/* ---------- Утилиты ---------- */
function uid() {
  if (window.crypto && crypto.randomUUID) {
    try { return crypto.randomUUID(); } catch (e) { /* ignore */ }
  }
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

function pad2(n) { return n < 10 ? '0' + n : '' + n; }

function startOfDay(d) {
  var x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}

function endOfDay(d) {
  var x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x.getTime();
}

function addDays(date, days) {
  var x = new Date(date);
  x.setDate(x.getDate() + days);
  return x;
}

function dayKey(input) {
  var d = new Date(input);
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

function fmtDate(input) {
  if (!input) return '—';
  var d = new Date(input);
  return pad2(d.getDate()) + '.' + pad2(d.getMonth() + 1) + '.' + d.getFullYear();
}

function fmtTime(input) {
  if (!input) return '—';
  var d = new Date(input);
  return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

function fmtDateTime(input) {
  if (!input) return '—';
  return fmtDate(input) + ', ' + fmtTime(input);
}

var MONTHS_RU = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
var MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
var WEEKDAYS_RU = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
var WEEKDAYS_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

function fmtDateHuman(input) {
  var d = new Date(input);
  return WEEKDAYS_RU[d.getDay()] + ', ' + d.getDate() + ' ' + MONTHS_RU[d.getMonth()] + ' ' + d.getFullYear();
}

function fmtDateShort(input) {
  var d = new Date(input);
  return d.getDate() + ' ' + MONTHS_SHORT[d.getMonth()];
}

function fmtMoney(n, withCurrency) {
  n = Number(n) || 0;
  var rounded = Math.round(n * 100) / 100;
  var opts = Number.isInteger(rounded)
    ? { maximumFractionDigits: 0 }
    : { minimumFractionDigits: 2, maximumFractionDigits: 2 };
  var s = rounded.toLocaleString('ru-RU', opts).replace(/\u00A0/g, ' ');
  return withCurrency === false ? s : s + ' ' + APP_CONFIG.currency;
}

function fmtCompact(n) {
  n = Number(n) || 0;
  var abs = Math.abs(n);
  if (abs >= 1000000) return (n / 1000000).toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + ' млн';
  if (abs >= 10000) return Math.round(n / 1000) + ' тыс';
  if (abs >= 1000) {
    var thousands = n / 1000;
    return thousands.toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + ' тыс';
  }
  return String(Math.round(n));
}

function fmtNumber(n) {
  return (Number(n) || 0).toLocaleString('ru-RU').replace(/\u00A0/g, ' ');
}

function parseAmount(value) {
  if (typeof value === 'number') return value;
  var s = String(value || '').replace(/[^\d.,-]/g, '').replace(/\s/g, '').replace(',', '.');
  var n = parseFloat(s);
  return isFinite(n) ? n : 0;
}

function plural(n, one, few, many) {
  var abs = Math.abs(n) % 100;
  var last = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (last > 1 && last < 5) return few;
  if (last === 1) return one;
  return many;
}

function esc(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function initials(name) {
  var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

var AVATAR_GRADIENTS = [
  'linear-gradient(135deg,#6366f1,#4338ca)',
  'linear-gradient(135deg,#0ea5e9,#0369a1)',
  'linear-gradient(135deg,#12b76a,#047857)',
  'linear-gradient(135deg,#f79009,#b45309)',
  'linear-gradient(135deg,#ee46bc,#a21caf)',
  'linear-gradient(135deg,#7a5af8,#4c1d95)',
  'linear-gradient(135deg,#f04438,#b42318)',
  'linear-gradient(135deg,#14b8a6,#0f766e)'
];

function hashCode(str) {
  var h = 0;
  str = String(str || '');
  for (var i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function avatarGradient(name) {
  return AVATAR_GRADIENTS[hashCode(name) % AVATAR_GRADIENTS.length];
}

function productHue(name) {
  return hashCode(name) % 360;
}

function productGradient(name) {
  var h = productHue(name);
  return 'linear-gradient(135deg, hsl(' + h + ' 68% 58%), hsl(' + ((h + 42) % 360) + ' 66% 42%))';
}

function shortId() {
  return Math.random().toString(36).slice(2, 7).toUpperCase();
}

/* ---------- Тема оформления ---------- */
var THEME_KEY = 'poskontrol_theme';

function systemPrefersDark() {
  try { return window.matchMedia('(prefers-color-scheme: dark)').matches; } catch (e) { return false; }
}

function themePreference() {
  var pref = (DB && DB.settings && DB.settings.theme) || 'system';
  if (['light', 'dark', 'system'].indexOf(pref) === -1) pref = 'system';
  return pref;
}

function resolvedTheme(pref) {
  pref = pref || themePreference();
  if (pref === 'dark') return 'dark';
  if (pref === 'light') return 'light';
  return systemPrefersDark() ? 'dark' : 'light';
}

function readThemeMirror() {
  try { return localStorage.getItem(THEME_KEY) || 'system'; } catch (e) { return 'system'; }
}

function writeThemeMirror(pref) {
  try { localStorage.setItem(THEME_KEY, pref); } catch (e) { /* ignore */ }
}

function applyTheme(pref, opts) {
  opts = opts || {};
  var preference = pref || themePreference();
  var theme = resolvedTheme(preference);
  document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.setAttribute('data-theme-pref', preference);
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#0a0e18' : '#4338ca');
  try {
    if (window.AndroidPos && typeof window.AndroidPos.setTheme === 'function') {
      window.AndroidPos.setTheme(theme);
    }
  } catch (e) { /* в браузере моста нет */ }
  if (!opts.silent) window.dispatchEvent(new CustomEvent('pos:theme', { detail: { theme: theme, pref: preference } }));
  return theme;
}

function setThemePreference(pref) {
  if (['light', 'dark', 'system'].indexOf(pref) === -1) pref = 'system';
  if (DB && DB.settings) {
    DB.settings.theme = pref;
    DB.settings.updatedAt = Date.now();
    saveDB();
  }
  writeThemeMirror(pref);
  return applyTheme(pref);
}

function toggleTheme() {
  var current = resolvedTheme();
  return setThemePreference(current === 'dark' ? 'light' : 'dark');
}

function initTheme() {
  var pref = (DB && DB.settings && DB.settings.theme) ? DB.settings.theme : readThemeMirror();
  if (['light', 'dark', 'system'].indexOf(pref) === -1) pref = 'system';
  applyTheme(pref, { silent: true });
  try {
    var media = window.matchMedia('(prefers-color-scheme: dark)');
    var onChange = function () {
      if (themePreference() === 'system') applyTheme('system');
    };
    if (media.addEventListener) media.addEventListener('change', onChange);
    else if (media.addListener) media.addListener(onChange);
  } catch (e) { /* ignore */ }
}

/* ---------- Роли ---------- */
function roleLabel(role) {
  if (role === 'admin') return 'Администратор';
  if (role === 'dev') return 'Разработчик';
  return 'Продавец';
}

function roleBadgeClass(role) {
  if (role === 'admin') return 'badge-admin';
  if (role === 'dev') return 'badge-dev';
  return 'badge-seller';
}

function paymentLabel(p) {
  if (p === 'qr') return 'Каспи QR';
  if (p === 'mixed') return 'Смешанный';
  return 'Наличные';
}

function paymentBadgeClass(p) {
  if (p === 'qr') return 'badge-qr';
  if (p === 'mixed') return 'badge-mixed';
  return 'badge-cash';
}

var PERMISSIONS = {
  admin: { dashboard: true, cash: true, products: true, stock: true, points: true, time: true, analytics: true, manual: true, changes: true, help: true, settings: true },
  dev: { dashboard: true, cash: false, products: true, stock: true, points: true, time: true, analytics: true, manual: true, changes: true, help: true, settings: true },
  seller: { dashboard: false, cash: true, products: false, stock: true, points: false, time: false, analytics: false, manual: false, changes: false, help: false, settings: true }
};

function canAccess(user, page) {
  if (!user) return false;
  return !!(PERMISSIONS[user.role] && PERMISSIONS[user.role][page]);
}

/* ---------- Хранилище ---------- */
function defaultDB() {
  return {
    version: 1,
    createdAt: Date.now(),
    users: [],
    points: [],
    categories: [
      { id: 'cat-drinks', name: 'Напитки' },
      { id: 'cat-bakery', name: 'Выпечка' },
      { id: 'cat-snacks', name: 'Снеки' },
      { id: 'cat-food', name: 'Готовая еда' },
      { id: 'cat-other', name: 'Прочее' }
    ],
    products: [],
    stock: [],
    supplies: [],
    sales: [],
    saleChanges: [],
    expenses: [],
    time: [],
    stockChecks: [],
    settings: {
      companyName: '',
      supportPhone: '',
      supportEmail: '',
      supportTelegram: '',
      demoLoaded: false,
      theme: 'system'
    },
    session: null
  };
}

function loadDB() {
  var raw = null;
  if (STORAGE_AVAILABLE) {
    try { raw = localStorage.getItem(APP_CONFIG.storageKey); } catch (e) { raw = null; }
  }
  if (!raw) {
    DB = defaultDB();
    saveDB();
    return;
  }
  try {
    var parsed = JSON.parse(raw);
    DB = normalizeDB(parsed);
  } catch (e) {
    console.error('Не удалось прочитать базу, создаю новую', e);
    DB = defaultDB();
    saveDB();
  }
}

function normalizeDB(data) {
  var base = defaultDB();
  if (!data || typeof data !== 'object') return base;
  ['users', 'points', 'categories', 'products', 'stock', 'supplies', 'sales', 'saleChanges', 'expenses', 'time', 'stockChecks'].forEach(function (key) {
    if (!Array.isArray(data[key])) data[key] = base[key];
  });
  if (!data.settings || typeof data.settings !== 'object') data.settings = base.settings;
  data.settings = Object.assign({}, base.settings, data.settings);
  if (data.session && (!data.session.userId || !data.users.some(function (u) { return u.id === data.session.userId; }))) {
    data.session = null;
  }
  data.version = 1;
  return data;
}

function saveDB() {
  if (!STORAGE_AVAILABLE) { LAST_SAVE_ERROR = 0; return; }
  try {
    localStorage.setItem(APP_CONFIG.storageKey, JSON.stringify(DB));
    LAST_SAVE_ERROR = 0;
  } catch (e) {
    console.error('Ошибка сохранения', e);
    var now = Date.now();
    if (now - LAST_SAVE_ERROR > 15000) {
      LAST_SAVE_ERROR = now;
      window.dispatchEvent(new CustomEvent('pos:storage-error', { detail: e }));
    }
  }
}

function resetDB() {
  if (STORAGE_AVAILABLE) {
    try { localStorage.removeItem(APP_CONFIG.storageKey); } catch (e) { /* ignore */ }
  }
  DB = defaultDB();
  saveDB();
}

function cleanupExpiredData() {
  var now = Date.now();
  var salesCutoff = now - APP_CONFIG.receiptTtlDays * 86400000;
  var expensesCutoff = now - APP_CONFIG.expenseTtlDays * 86400000;
  var changed = false;

  DB.sales.forEach(function (sale) {
    if (sale.createdAt < salesCutoff && sale.receipt) {
      sale.receipt = null;
      sale.receiptPruned = true;
      changed = true;
    }
  });
  DB.expenses.forEach(function (exp) {
    if (exp.createdAt < expensesCutoff && !exp.pruned) {
      exp.reason = 'Детали удалены (старше 7 дней)';
      exp.pruned = true;
      changed = true;
    }
  });
  DB.stock.forEach(function (row) {
    if (Array.isArray(row.history) && row.history.length > 150) {
      row.history = row.history.slice(0, 150);
      changed = true;
    }
  });
  if (changed) saveDB();
}

/* ---------- Сессия и пароли ---------- */
function currentUser() {
  if (!DB || !DB.session) return null;
  var user = DB.users.find(function (u) { return u.id === DB.session.userId; });
  if (!user) { DB.session = null; saveDB(); return null; }
  return user;
}

function setSession(userId) {
  DB.session = { userId: userId, at: Date.now() };
  saveDB();
}

function logoutUser() {
  DB.session = null;
  saveDB();
}

function fallbackHash(str) {
  var h1 = 0x811c9dc5, h2 = 0x1000193;
  for (var i = 0; i < str.length; i++) {
    var c = str.charCodeAt(i);
    h1 ^= c; h1 = (h1 * 0x01000193) >>> 0;
    h2 = ((h2 << 5) - h2 + c) | 0;
  }
  return (h1 >>> 0).toString(36) + '.' + (Math.abs(h2) >>> 0).toString(36);
}

async function hashPassword(password) {
  var data = 'poskontrol::' + password;
  try {
    if (window.crypto && crypto.subtle && window.isSecureContext !== false) {
      var digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
      var hex = Array.prototype.map.call(new Uint8Array(digest), function (b) {
        return b.toString(16).padStart(2, '0');
      }).join('');
      return 'sha:' + hex;
    }
  } catch (e) { /* fallback */ }
  return 'fb:' + fallbackHash(data);
}

function findUserByUsername(username) {
  var needle = String(username || '').trim().toLowerCase();
  return DB.users.find(function (u) { return String(u.username).toLowerCase() === needle; });
}

async function loginUser(username, password) {
  username = String(username || '').trim();
  if (!username || !password) throw new Error('Введите имя пользователя и пароль');
  var user = findUserByUsername(username);
  if (!user) throw new Error('Неверное имя пользователя или пароль');
  var hash = await hashPassword(password);
  if (hash !== user.pass) throw new Error('Неверное имя пользователя или пароль');
  setSession(user.id);
  return user;
}

async function createUser(data, options) {
  options = options || {};
  var fullName = String(data.fullName || '').trim();
  var username = String(data.username || '').trim();
  var password = String(data.password || '');
  if (!fullName) throw new Error('Укажите полное имя');
  if (!username) throw new Error('Укажите имя пользователя');
  if (!/^[A-Za-zА-Яа-яЁё0-9_\-\.]{2,32}$/.test(username)) throw new Error('Имя пользователя: 2–32 символа, буквы, цифры, _ - .');
  if (findUserByUsername(username)) throw new Error('Это имя пользователя уже занято');
  var minPass = options && options.minPassword ? options.minPassword : 6;
  if (password.length < minPass) throw new Error('Пароль должен содержать минимум ' + minPass + ' символов');
  if (options.checkLastAdmin) { /* not used for create */ }
  var role = data.role;
  if (options.autoRole) {
    role = DB.users.length === 0 ? 'admin' : (DB.users.length === 1 ? 'dev' : 'seller');
  }
  if (['admin', 'dev', 'seller'].indexOf(role) === -1) role = 'seller';
  var pointIds = normalizePointIds(data.pointIds, data.pointId);
  var user = {
    id: uid(),
    fullName: fullName,
    username: username,
    pass: await hashPassword(password),
    role: role,
    pointIds: pointIds,
    pointId: pointIds[0] || null,
    workStart: data.workStart || '',
    workEnd: data.workEnd || '',
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  if (data.demo) user.demo = true;
  DB.users.push(user);
  saveDB();
  return user;
}

/* ---------- Импорт сотрудников из CSV (перенос из старой системы) ---------- */

function csvSplitLine(line, delim) {
  var out = [], cur = '', quoted = false;
  for (var i = 0; i < line.length; i++) {
    var ch = line.charAt(i);
    if (quoted) {
      if (ch === '"') {
        if (line.charAt(i + 1) === '"') { cur += '"'; i++; }
        else quoted = false;
      } else cur += ch;
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === delim) {
      out.push(cur); cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map(function (x) { return String(x).trim(); });
}

function normalizeUserRole(value) {
  var v = String(value || '').trim().toLowerCase();
  if (/^(admin|админ|администратор|владелец)/.test(v)) return 'admin';
  if (/^(dev|разработчик|developer)/.test(v)) return 'dev';
  return 'seller';
}

/**
 * Разбор CSV со списком сотрудников.
 * Поддерживает шапку «Имя, Имя пользователя, Роль, Пароль», разделители , ; табуляцию.
 */
function parseUsersCsv(text) {
  var raw = String(text || '').replace(/^\uFEFF/, '');
  var lines = raw.split(/\r\n|\n|\r/).filter(function (l) { return String(l).trim() !== ''; });
  if (!lines.length) return { rows: [], errors: ['Файл пустой'] };

  var first = lines[0];
  var delim = ',';
  var counts = { ',': (first.match(/,/g) || []).length, ';': (first.match(/;/g) || []).length, '\t': (first.match(/\t/g) || []).length };
  if (counts[';'] > counts[','] && counts[';'] >= counts['\t']) delim = ';';
  else if (counts['\t'] > counts[','] && counts['\t'] > counts[';']) delim = '\t';

  var cells = csvSplitLine(first, delim);
  var head = cells.map(function (c) { return c.toLowerCase().replace(/\s+/g, ' '); });
  var hasHeader = head.some(function (h) { return /имя|логин|пароль|роль|username|password|role/.test(h); });
  var map = { name: 0, username: 1, role: 2, password: 3 };
  if (hasHeader) {
    // порядок важен: «пароль» содержит «роль», а «имя пользователя» — «имя»
    head.forEach(function (h, i) {
      if (/пароль|password|pass/.test(h)) map.password = i;
      else if (/пользовател|логин|login|user/.test(h)) map.username = i;
      else if (/роль|role/.test(h)) map.role = i;
      else if (/имя|фио|сотрудник|name/.test(h)) map.name = i;
    });
  }

  var rows = [], errors = [];
  var dataLines = hasHeader ? lines.slice(1) : lines;
  dataLines.forEach(function (line, idx) {
    var c = csvSplitLine(line, delim);
    var fullName = String(c[map.name] || '').trim();
    var username = String(c[map.username] || '').trim().replace(/^@/, '');
    var password = String(c[map.password] || '').trim();
    var role = normalizeUserRole(c[map.role]);
    var lineNo = idx + (hasHeader ? 2 : 1);
    if (!fullName && !username && !password) return;             // пустая строка
    if (!fullName) { errors.push('Строка ' + lineNo + ': не указано имя'); return; }
    if (!username) { errors.push('Строка ' + lineNo + ': не указано имя пользователя'); return; }
    if (!/^[A-Za-zА-Яа-яЁё0-9_\-\.]{2,32}$/.test(username)) {
      errors.push('Строка ' + lineNo + ': недопустимое имя пользователя «' + username + '»');
      return;
    }
    if (!password) { errors.push('Строка ' + lineNo + ': не указан пароль для @' + username); return; }
    rows.push({ fullName: fullName, username: username, role: role, password: password, line: lineNo });
  });
  return { rows: rows, errors: errors, delimiter: delim };
}

/**
 * Создаёт сотрудников из разобранного списка.
 * Пароли короче 6 символов разрешены — это реальные пароли из старой системы.
 */
async function importUsers(rows, actor, options) {
  options = options || {};
  if (!actor || (actor.role !== 'admin' && actor.role !== 'dev')) {
    return { error: 'Импорт сотрудников доступен администратору и разработчику' };
  }
  var created = [], skipped = [], errors = [];
  var seen = {};

  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var key = String(row.username).toLowerCase();
    if (seen[key]) { skipped.push({ username: row.username, reason: 'повтор в файле' }); continue; }
    seen[key] = true;
    if (findUserByUsername(row.username)) { skipped.push({ username: row.username, reason: 'уже есть в системе' }); continue; }
    try {
      var user = await createUser({
        fullName: row.fullName,
        username: row.username,
        password: row.password,
        role: row.role,
        pointIds: row.pointIds || []
      }, { minPassword: 5 });
      created.push({ user: user, password: row.password, row: row });
    } catch (err) {
      errors.push('@' + row.username + ': ' + err.message);
    }
  }
  if (created.length) saveDB();
  return { created: created, skipped: skipped, errors: errors };
}

function normalizePointIds(list, fallback) {
  var out = [];
  (Array.isArray(list) ? list : []).forEach(function (id) {
    if (id && DB.points.some(function (p) { return p.id === id; }) && out.indexOf(id) === -1) out.push(id);
  });
  if (!out.length && fallback && DB.points.some(function (p) { return p.id === fallback; })) out.push(fallback);
  return out;
}

function updateUser(userId, patch) {
  var user = DB.users.find(function (u) { return u.id === userId; });
  if (!user) throw new Error('Пользователь не найден');
  if (patch && (patch.pointIds || patch.pointId !== undefined)) {
    var nextIds = normalizePointIds(patch.pointIds, patch.pointId);
    patch = Object.assign({}, patch, { pointIds: nextIds, pointId: nextIds[0] || null });
  }
  Object.assign(user, patch);
  user.updatedAt = Date.now();
  saveDB();
  return user;
}

function deleteUser(userId) {
  var user = DB.users.find(function (u) { return u.id === userId; });
  if (!user) return;
  var admins = DB.users.filter(function (u) { return u.role === 'admin'; });
  if (user.role === 'admin' && admins.length <= 1) throw new Error('Нельзя удалить последнего администратора');
  DB.users = DB.users.filter(function (u) { return u.id !== userId; });
  DB.time = DB.time.filter(function (t) { return t.userId !== userId; });
  if (DB.session && DB.session.userId === userId) DB.session = null;
  if (window.POS_API) window.POS_API.markDeleted('users', userId);
  saveDB();
}

/* ---------- Изображения и геолокация ---------- */
function compressImage(file, maxDim, quality) {
  maxDim = maxDim || 640;
  quality = quality || 0.72;
  return new Promise(function (resolve, reject) {
    if (!file || !/^image\//.test(file.type)) {
      reject(new Error('Выберите файл изображения'));
      return;
    }
    var reader = new FileReader();
    reader.onerror = function () { reject(new Error('Не удалось прочитать файл')); };
    reader.onload = function () {
      var img = new Image();
      img.onerror = function () { reject(new Error('Не удалось открыть изображение')); };
      img.onload = function () {
        var scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        var w = Math.max(1, Math.round(img.width * scale));
        var h = Math.max(1, Math.round(img.height * scale));
        var canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        try {
          resolve(canvas.toDataURL('image/jpeg', quality));
        } catch (e) {
          reject(new Error('Не удалось обработать изображение'));
        }
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function getGeoPosition() {
  return new Promise(function (resolve, reject) {
    if (!navigator.geolocation) {
      reject(new Error('Геолокация не поддерживается устройством'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      function (pos) {
        resolve({
          lat: Number(pos.coords.latitude.toFixed(6)),
          lng: Number(pos.coords.longitude.toFixed(6)),
          acc: Math.round(pos.coords.accuracy || 0)
        });
      },
      function (err) {
        var msg = 'Не удалось определить геопозицию';
        if (err && err.code === 1) msg = 'Доступ к геолокации запрещён. Разрешите его в настройках браузера';
        else if (err && err.code === 2) msg = 'Позиция недоступна. Проверьте GPS/интернет';
        else if (err && err.code === 3) msg = 'Превышено время ожидания геолокации';
        reject(new Error(msg));
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 }
    );
  });
}

function geoLink(geo) {
  if (!geo || !isFinite(geo.lat) || !isFinite(geo.lng)) return '';
  return 'https://maps.google.com/?q=' + geo.lat + ',' + geo.lng;
}

/* ---------- Доступ к справочникам ---------- */
function getUser(userId) { return DB.users.find(function (u) { return u.id === userId; }) || null; }
function userName(userId) { var u = getUser(userId); return u ? u.fullName : 'Удалённый пользователь'; }
function getPoint(pointId) { return DB.points.find(function (p) { return p.id === pointId; }) || null; }
function pointName(pointId, fallback) {
  var p = getPoint(pointId);
  return p ? p.name : (fallback || 'Точка удалена');
}
function getProduct(productId) { return DB.products.find(function (p) { return p.id === productId; }) || null; }
function categoryName(categoryId) {
  var c = DB.categories.find(function (x) { return x.id === categoryId; });
  return c ? c.name : 'Без категории';
}
function productsForPoint(pointId) {
  // товар виден только на тех точках, куда его явно назначили.
  // новый товар без точек не появляется ни в кассе, ни на складе.
  return DB.products.filter(function (p) {
    return Array.isArray(p.pointIds) && p.pointIds.indexOf(pointId) !== -1;
  });
}

function unassignedProducts() {
  return DB.products.filter(function (p) {
    return !Array.isArray(p.pointIds) || !p.pointIds.length;
  });
}

/**
 * Товары, созданные до 3.2.0, не имели привязки к точкам и показывались везде.
 * Один раз переносим их на все существующие точки, чтобы каталог не опустел.
 */
function migrateUnassignedProducts() {
  if (DB.settings.productsAssignedOnce) return false;
  var allPoints = DB.points.map(function (p) { return p.id; });
  var changed = false;
  DB.products.forEach(function (p) {
    if (!Array.isArray(p.pointIds) || !p.pointIds.length) {
      p.pointIds = allPoints.slice();
      p.updatedAt = p.updatedAt || Date.now();
      changed = true;
    }
  });
  DB.settings.productsAssignedOnce = true;
  if (changed) saveDB();
  return changed;
}

function defaultPointId() {
  if (!DB.points.length) return null;
  var withStock = DB.points.filter(function (p) {
    return DB.stock.some(function (r) { return r.pointId === p.id && r.qty > 0; });
  });
  if (withStock.length) return withStock[0].id;
  var withProducts = DB.points.filter(function (p) { return productsForPoint(p.id).length > 0; });
  if (withProducts.length) return withProducts[0].id;
  return DB.points[0].id;
}

function stockRow(pointId, productId) {
  return DB.stock.find(function (r) { return r.pointId === pointId && r.productId === productId; }) || null;
}

function setStockQty(pointId, productId, qty, note, actor, at) {
  qty = Math.max(0, Math.round(Number(qty) || 0));
  var stamp = Number(at) || Date.now();
  var row = stockRow(pointId, productId);
  if (!row) {
    row = {
      id: uid(),
      pointId: pointId,
      productId: productId,
      qty: 0,
      updatedAt: stamp,
      history: []
    };
    DB.stock.push(row);
  }
  var delta = qty - row.qty;
  row.qty = qty;
  row.updatedAt = stamp;
  row.history = row.history || [];
  row.history.unshift({
    at: stamp,
    delta: delta,
    qtyAfter: qty,
    note: note || (delta >= 0 ? 'Пополнение' : 'Списание'),
    kind: 'manual',
    by: actor ? actor.fullName : 'Система'
  });
  if (row.history.length > 150) row.history = row.history.slice(0, 150);
  saveDB();
  return row;
}

/* Движение остатка с типом: так фиксируются правки, сделанные прямо в отчёте склада */
function stockMove(pointId, productId, delta, note, kind, actor, at, qtyAfterOverride) {
  delta = Math.round(Number(delta) || 0);
  if (!delta) return null;
  var row = stockRow(pointId, productId);
  if (!row) {
    row = { id: uid(), pointId: pointId, productId: productId, qty: 0, updatedAt: Date.now(), history: [] };
    DB.stock.push(row);
  }
  var applied = delta;
  var next = row.qty + delta;
  if (next < 0) { applied = -row.qty; next = 0; }
  if (!applied) return row;
  row.qty = next;
  row.updatedAt = Date.now();
  row.history = row.history || [];
  row.history.unshift({
    at: Number(at) || Date.now(),
    delta: applied,
    // для правки «остатка вчера» в истории остаётся цифра на начало дня,
    // хотя на складе уже другие движения
    qtyAfter: qtyAfterOverride === undefined ? next : Math.round(Number(qtyAfterOverride) || 0),
    note: note,
    kind: kind || 'manual',
    by: actor ? actor.fullName : 'Система'
  });
  if (row.history.length > 150) row.history = row.history.slice(0, 150);
  saveDB();
  return row;
}

/**
 * Правка чисел в отчёте склада за сегодня (только администратор).
 * field: yesterday | supply | sold | end
 * Любая правка меняет и реальный остаток точки — следующие цифры считаются уже от него.
 */
function editStockReportCell(pointId, productId, field, value, dayKeyStr, actor) {
  var product = getProduct(productId);
  if (!product) return { error: 'Товар не найден' };
  var key = dayKeyStr || dayKey(new Date());
  if (key !== dayKey(new Date())) return { error: 'Править можно только отчёт за сегодня' };
  var rep = stockPeriodReport(pointId, key, key);
  var r = null;
  rep.rows.forEach(function (x) { if (x.productId === productId) r = x; });
  if (!r) return { error: 'Товар не назначен на эту точку' };

  var raw = String(value === undefined || value === null ? '' : value).replace(',', '.').replace(/\s/g, '');
  var next = Math.round(Number(raw));
  if (raw === '' || !isFinite(next) || next < 0) return { error: 'Укажите корректное количество' };

  var dayStart = startOfDay(parseDayKey(key));

  if (field === 'yesterday') {
    var base = r.yesterday === null ? 0 : r.yesterday;
    var dCarry = next - base;
    if (!dCarry) return { ok: true, changed: false };
    stockMove(pointId, productId, dCarry, 'Правка остатка на начало дня', 'carry-manual', actor, dayStart - 1, next);
    return { ok: true, changed: true, field: field, value: next };
  }

  if (r.yesterday === null) return { error: 'Сначала укажите остаток на начало дня' };

  if (field === 'supply') {
    var dSupply = next - r.supply;
    if (!dSupply) return { ok: true, changed: false };
    stockMove(pointId, productId, dSupply, 'Правка поставки в отчёте', 'supply-manual', actor);
    return { ok: true, changed: true, field: field, value: next };
  }
  if (field === 'sold') {
    var dSold = next - r.sold;
    if (!dSold) return { ok: true, changed: false };
    var rowSold = stockRow(pointId, productId);
    if (dSold > 0 && (!rowSold || rowSold.qty < dSold)) {
      return { error: 'На складе только ' + (rowSold ? rowSold.qty : 0) + ' шт' };
    }
    stockMove(pointId, productId, -dSold, 'Правка продаж в отчёте', 'sold-manual', actor);
    return { ok: true, changed: true, field: field, value: next };
  }
  if (field === 'end') {
    var cur = r.end === null ? 0 : r.end;
    var dEnd = next - cur;
    if (!dEnd) return { ok: true, changed: false };
    stockMove(pointId, productId, dEnd, 'Правка остатка в таблице', 'manual', actor);
    return { ok: true, changed: true, field: field, value: next };
  }
  return { error: 'Неизвестное поле' };
}

/* ---------- Касса продавца: ночное окно и допуск после сверки склада ---------- */
var CASH_NIGHT_FROM_HOUR = 2;   // касса закрыта с 02:00
var CASH_NIGHT_TO_HOUR = 6;     // и до 06:00

function cashNightWindow(now) {
  var d = now ? new Date(now) : new Date();
  var h = d.getHours();
  var from = new Date(d); from.setHours(CASH_NIGHT_FROM_HOUR, 0, 0, 0);
  var to = new Date(d); to.setHours(CASH_NIGHT_TO_HOUR, 0, 0, 0);
  var blocked = h >= CASH_NIGHT_FROM_HOUR && h < CASH_NIGHT_TO_HOUR;
  return {
    blocked: blocked,
    from: from.getTime(),
    to: to.getTime(),
    until: blocked ? to.getTime() : null,
    label: (CASH_NIGHT_FROM_HOUR < 10 ? '0' : '') + CASH_NIGHT_FROM_HOUR + ':00–' +
           (CASH_NIGHT_TO_HOUR < 10 ? '0' : '') + CASH_NIGHT_TO_HOUR + ':00'
  };
}

function stockChecksList() {
  if (!Array.isArray(DB.stockChecks)) DB.stockChecks = [];
  return DB.stockChecks;
}

function stockChecksForDay(key) {
  key = key || dayKey(new Date());
  return stockChecksList().filter(function (c) { return c.date === key; });
}

/** Последняя сверка склада сотрудника на точке за день */
function stockCheckForDay(userId, pointId, key) {
  var list = stockChecksForDay(key).filter(function (c) {
    return c.userId === userId && (!pointId || c.pointId === pointId);
  }).sort(function (a, b) { return b.at - a.at; });
  return list[0] || null;
}

function lastStockCheckForUser(userId, key) {
  var list = stockChecksForDay(key).filter(function (c) { return c.userId === userId; })
    .sort(function (a, b) { return b.at - a.at; });
  return list[0] || null;
}

/** Сверка склада: продавец просто отмечает, сходятся данные или нет. Без ввода цифр. */
function saveStockCheck(data, actor) {
  if (!actor) return { error: 'Нет пользователя' };
  var pointId = data.pointId;
  if (!pointId) return { error: 'Не выбрана точка' };
  var result = data.result === 'mismatch' ? 'mismatch' : 'match';
  var at = Date.now();
  var key = dayKey(new Date(at));

  var entry = {
    id: uid(),
    at: at,
    date: key,
    userId: actor.id,
    userName: actor.fullName,
    pointId: pointId,
    pointName: pointName(pointId, 'Точка удалена'),
    result: result,
    updatedAt: at
  };
  stockChecksList().unshift(entry);
  if (DB.stockChecks.length > 4000) DB.stockChecks = DB.stockChecks.slice(0, 4000);
  saveDB();
  return { ok: true, check: entry };
}

/**
 * Допуск продавца к кассе:
 *   ночь 02:00–06:00 → приход → сверка склада → касса
 */
function cashAccessGate(user, pointId, now) {
  if (!user) return { allowed: false, reason: 'auth' };
  if (user.role !== 'seller') return { allowed: true, reason: 'staff' };
  var night = cashNightWindow(now);
  if (night.blocked) return { allowed: false, reason: 'night', night: night };
  var key = dayKey(now ? new Date(now) : new Date());
  var entry = timeEntryFor(user.id, key);
  if (!entry || !entry.arriveAt) return { allowed: false, reason: 'arrival', night: night };
  var check = stockCheckForDay(user.id, pointId, key);
  if (!check) return { allowed: false, reason: 'check', entry: entry, night: night };
  return { allowed: true, reason: 'ok', entry: entry, check: check, night: night };
}

/* ---------- Поставки на склад ---------- */
function addSupply(data, actor) {
  var pointId = data.pointId;
  var code = 'П' + shortId();
  var merged = {};
  (data.items || []).forEach(function (it) {
    var qty = Math.round(Number(it.qty) || 0);
    if (!it.productId || qty <= 0) return;
    var key = it.productId;
    if (!merged[key]) merged[key] = { productId: it.productId, qty: 0, cost: Math.max(0, Math.round(Number(it.cost) || 0)) };
    merged[key].qty += qty;
    if (Number(it.cost) > 0) merged[key].cost = Math.round(Number(it.cost));
  });
  var items = Object.keys(merged).map(function (k) {
    var it = merged[k];
    var product = getProduct(it.productId);
    return {
      productId: it.productId,
      name: product ? product.name : 'Товар удалён',
      qty: it.qty,
      cost: it.cost || 0,
      sum: (it.cost || 0) * it.qty
    };
  });
  if (!items.length) return null;

  var supply = {
    id: uid(),
    code: code,
    pointId: pointId,
    pointName: pointName(pointId),
    items: items,
    totalQty: items.reduce(function (n, it) { return n + it.qty; }, 0),
    userId: actor ? actor.id : null,
    userName: actor ? actor.fullName : 'Система',
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  items.forEach(function (item) {
    var row = stockRow(pointId, item.productId);
    if (!row) {
      row = { id: uid(), pointId: pointId, productId: item.productId, qty: 0, updatedAt: Date.now(), history: [] };
      DB.stock.push(row);
    }
    row.qty = Math.max(0, row.qty + item.qty);
    row.updatedAt = Date.now();
    row.history = row.history || [];
    row.history.unshift({
      at: Date.now(),
      delta: item.qty,
      qtyAfter: row.qty,
      note: 'Поставка ' + code,
      by: supply.userName,
      supplyId: supply.id
    });
    if (row.history.length > 150) row.history = row.history.slice(0, 150);
  });

  DB.supplies.push(supply);
  saveDB();
  return supply;
}

function deleteSupply(supplyId, actor) {
  var supply = DB.supplies.find(function (x) { return x.id === supplyId; });
  if (!supply) return false;
  supply.items.forEach(function (item) {
    var row = stockRow(supply.pointId, item.productId);
    if (!row) return;
    var take = Math.min(row.qty, item.qty);
    row.qty = Math.max(0, row.qty - item.qty);
    row.updatedAt = Date.now();
    row.history = row.history || [];
    row.history.unshift({
      at: Date.now(),
      delta: -take,
      qtyAfter: row.qty,
      note: 'Отмена поставки ' + supply.code,
      by: actor ? actor.fullName : 'Система'
    });
    if (row.history.length > 150) row.history = row.history.slice(0, 150);
  });
  DB.supplies = DB.supplies.filter(function (x) { return x.id !== supplyId; });
  if (window.POS_API) window.POS_API.markDeleted('supplies', supplyId);
  saveDB();
  return true;
}

/* ---------- Отчёт по складу за день (как в старой системе) ---------- */
/* Ручная правка остатка (админ меняет цифру в таблице, а не поставка/продажа) */
function isManualStockEntry(h) {
  if (!h) return false;
  if (h.kind === 'manual') return true;
  if (h.kind === 'carry-manual' || h.kind === 'supply-manual' || h.kind === 'sold-manual') return false;
  if (h.supplyId || h.saleId) return false;
  var note = String(h.note || '');
  if (/^(Поставка|Продажа|Отмена продажи|Отмена поставки)/.test(note)) return false;
  return true;
}

function stockPeriodReport(pointId, fromKeyStr, toKeyStr) {
  var fromDate = parseDayKey(fromKeyStr) || new Date();
  var toDate = parseDayKey(toKeyStr || fromKeyStr) || fromDate;
  if (toDate < fromDate) { var tmp = fromDate; fromDate = toDate; toDate = tmp; }
  var dayStart = startOfDay(fromDate);
  var dayEnd = endOfDay(toDate);
  var toToday = dayKey(toDate) === dayKey(new Date());

  var soldMap = {}, supplyMap = {}, manualSoldMap = {};
  salesBetween(dayStart, dayEnd, { pointId: pointId }).forEach(function (s) {
    (s.items || []).forEach(function (it) {
      if (!it.productId) return;
      soldMap[it.productId] = (soldMap[it.productId] || 0) + (it.qty || 0);
      // ручные продажи задним числом показываем в «Продано», но остаток они не двигают
      if (s.manual && !s.stockDeducted) {
        manualSoldMap[it.productId] = (manualSoldMap[it.productId] || 0) + (it.qty || 0);
      }
    });
  });
  suppliesBetween(dayStart, dayEnd, { pointId: pointId }).forEach(function (sp) {
    (sp.items || []).forEach(function (it) {
      if (!it.productId) return;
      supplyMap[it.productId] = (supplyMap[it.productId] || 0) + (it.qty || 0);
    });
  });

  var rows = productsForPoint(pointId).map(function (product) {
    var row = stockRow(pointId, product.id);
    var rawHist = row && row.history ? row.history : [];
    var hist = rawHist.slice().sort(function (a, b) { return a.at - b.at; });
    var tracked = !!row;
    var yesterday = null;

    if (tracked) {
      // последняя запись до начала периода (при равном времени берём самую свежую)
      var beforeEntry = null;
      rawHist.forEach(function (h) {
        if (h.at >= dayStart) return;
        if (!beforeEntry || h.at > beforeEntry.at) beforeEntry = h;
      });
      if (beforeEntry) {
        yesterday = beforeEntry.qtyAfter;
      } else if (hist.length) {
        // учёт начался позже начала дня: 0, если это было в этот день, иначе данных нет
        yesterday = hist[0].at <= dayEnd ? 0 : null;
      } else {
        yesterday = row.updatedAt <= dayEnd ? row.qty : null;
      }
    }

    // ручные правки колонок «Поставка» и «Продано» из отчёта
    var manualSupply = 0, manualSold = 0;
    hist.forEach(function (h) {
      if (h.at < dayStart || h.at > dayEnd) return;
      if (h.kind === 'supply-manual') manualSupply += (h.delta || 0);
      else if (h.kind === 'sold-manual') manualSold += -(h.delta || 0);
    });

    var supply = (supplyMap[product.id] || 0) + manualSupply;
    var sold = (soldMap[product.id] || 0) + manualSold;
    var manualOnlySold = manualSoldMap[product.id] || 0;
    var adjust = 0, endOfDayQty = null;

    if (tracked && yesterday !== null) {
      if (toToday) {
        // отчёт заканчивается сегодня → конец периода = реальный остаток на складе,
        // а правки админа (и любые ручные движения) видны как корректировка
        endOfDayQty = row.qty;
        adjust = endOfDayQty - yesterday - supply + sold;
      } else {
        hist.forEach(function (h) {
          if (h.at < dayStart || h.at > dayEnd) return;
          if (h.kind === 'supply-manual' || h.kind === 'sold-manual') return;
          if (isManualStockEntry(h)) adjust += (h.delta || 0);
        });
        // ручная продажа задним числом видна в «Продано», но склад не двигает:
        // та же величина возвращается корректировкой, чтобы последующие дни не менялись
        adjust += manualOnlySold;
        endOfDayQty = Math.max(0, yesterday + supply + adjust - sold);
      }
    }

    var startOfDayQty = yesterday === null ? null : yesterday + supply;

    return {
      productId: product.id,
      name: product.name,
      category: categoryName(product.categoryId),
      price: product.price,
      tracked: tracked,
      yesterday: yesterday,
      supply: supply,
      adjust: adjust,
      start: startOfDayQty,
      sold: sold,
      manualSold: manualOnlySold,
      end: endOfDayQty
    };
  });

  var totals = { yesterday: 0, supply: 0, adjust: 0, start: 0, sold: 0, manualSold: 0, end: 0, tracked: 0 };
  var hasAdjust = false;
  rows.forEach(function (r) {
    if (r.adjust) hasAdjust = true;
    totals.manualSold += r.manualSold;
    if (r.yesterday === null) return;
    totals.tracked++;
    totals.yesterday += r.yesterday;
    totals.supply += r.supply;
    totals.adjust += r.adjust;
    totals.start += r.start || 0;
    totals.sold += r.sold;
    totals.end += r.end || 0;
  });

  var days = Math.round((startOfDay(toDate) - startOfDay(fromDate)) / 86400000) + 1;
  return {
    from: dayKey(fromDate),
    to: dayKey(toDate),
    date: dayKey(fromDate),
    days: days,
    single: dayKey(fromDate) === dayKey(toDate),
    pointId: pointId,
    hasAdjust: hasAdjust,
    manualSold: totals.manualSold,
    rows: rows,
    totals: totals
  };
}

function stockDayReport(pointId, dateKeyStr) {
  return stockPeriodReport(pointId, dateKeyStr, dateKeyStr);
}

function suppliesBetween(from, to, opts) {
  opts = opts || {};
  return DB.supplies.filter(function (s) {
    if (s.createdAt < from || s.createdAt > to) return false;
    if (opts.pointId && s.pointId !== opts.pointId) return false;
    return true;
  });
}

function supplyTotals(list) {
  var res = { count: list.length, qty: 0, positions: 0 };
  list.forEach(function (s) {
    res.qty += s.totalQty || 0;
    res.positions += (s.items || []).length;
  });
  return res;
}

function topSuppliedProducts(list, limit) {
  var map = {};
  list.forEach(function (s) {
    (s.items || []).forEach(function (it) {
      var key = it.productId || it.name;
      if (!map[key]) map[key] = { productId: it.productId, name: it.name, qty: 0, cost: 0 };
      map[key].qty += it.qty || 0;
      map[key].cost += it.sum || 0;
    });
  });
  return Object.keys(map).map(function (k) { return map[k]; })
    .sort(function (a, b) { return b.qty - a.qty; })
    .slice(0, limit || 10);
}

function deleteProduct(productId) {
  DB.products = DB.products.filter(function (p) { return p.id !== productId; });
  var removedStock = DB.stock.filter(function (r) { return r.productId === productId; });
  DB.stock = DB.stock.filter(function (r) { return r.productId !== productId; });
  if (window.POS_API) {
    window.POS_API.markDeleted('products', productId);
    removedStock.forEach(function (row) { window.POS_API.markDeleted('stock', row.id); });
  }
  saveDB();
}

function deletePoint(pointId) {
  DB.points = DB.points.filter(function (p) { return p.id !== pointId; });
  var removedStock = DB.stock.filter(function (r) { return r.pointId === pointId; });
  DB.stock = DB.stock.filter(function (r) { return r.pointId !== pointId; });
  DB.users.forEach(function (u) {
    var had = (Array.isArray(u.pointIds) && u.pointIds.indexOf(pointId) !== -1) || u.pointId === pointId;
    if (!had) return;
    if (Array.isArray(u.pointIds)) u.pointIds = u.pointIds.filter(function (id) { return id !== pointId; });
    if (u.pointId === pointId || (Array.isArray(u.pointIds) && u.pointIds.indexOf(u.pointId) === -1)) {
      u.pointId = (Array.isArray(u.pointIds) && u.pointIds[0]) || null;
    }
    u.updatedAt = Date.now();
  });
  if (DB.session && DB.session.pointId === pointId) DB.session.pointId = null;
  if (window.POS_API) {
    window.POS_API.markDeleted('points', pointId);
    removedStock.forEach(function (row) { window.POS_API.markDeleted('stock', row.id); });
  }
  saveDB();
}

/* ---------- Продажи ---------- */
function createSale(data, actor) {
  var sale = {
    id: uid(),
    code: shortId(),
    userId: actor.id,
    userName: actor.fullName,
    pointId: data.pointId,
    pointName: pointName(data.pointId),
    items: data.items.map(function (it) {
      return { productId: it.productId, name: it.name, price: it.price, qty: it.qty };
    }),
    total: data.total,
    payment: data.payment,
    cashAmount: data.cashAmount || 0,
    qrAmount: data.qrAmount || 0,
    receipt: data.receipt || null,
    userId: actor.id,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  DB.sales.push(sale);

  // списываем остатки там, где учёт ведётся
  sale.items.forEach(function (item) {
    var row = stockRow(sale.pointId, item.productId);
    if (row) {
      row.qty = Math.max(0, row.qty - item.qty);
      row.updatedAt = Date.now();
      row.history = row.history || [];
      row.history.unshift({
        at: Date.now(),
        delta: -item.qty,
        qtyAfter: row.qty,
        note: 'Продажа #' + sale.code,
        by: actor.fullName
      });
      if (row.history.length > 150) row.history = row.history.slice(0, 150);
    }
  });

  saveDB();
  return sale;
}

/* ---------- Ручные продажи задним числом (владелец и разработчик) ---------- */

function canManageManualSales(user) {
  return !!user && (user.role === 'admin' || user.role === 'dev');
}

/** 'YYYY-MM-DD' + 'HH:MM' → timestamp (локальное время), либо null */
function parseSaleMoment(dateStr, timeStr) {
  var dparts = String(dateStr || '').split('-');
  if (dparts.length !== 3) return null;
  var y = parseInt(dparts[0], 10);
  var mo = parseInt(dparts[1], 10) - 1;
  var d = parseInt(dparts[2], 10);
  if (!isFinite(y) || !isFinite(mo) || !isFinite(d)) return null;
  var tparts = String(timeStr || '00:00').split(':');
  var hh = parseInt(tparts[0], 10);
  var mm = parseInt(tparts[1], 10);
  if (!isFinite(hh)) hh = 0;
  if (!isFinite(mm)) mm = 0;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  var date = new Date(y, mo, d, hh, mm, 0, 0);
  if (isNaN(date.getTime())) return null;
  if (date.getFullYear() !== y || date.getMonth() !== mo || date.getDate() !== d) return null; // 31 февраля и т.п.
  return date.getTime();
}

/**
 * Списание товара в прошлом: вставляем движение в историю склада на нужный момент
 * и сдвигаем остатки всех последующих движений, чтобы отчёты за прошлые дни сходились.
 */
function stockDeductAt(pointId, productId, qty, at, sale, actor) {
  var row = stockRow(pointId, productId);
  var amount = Math.abs(qty || 0);
  if (!row || !amount) return false;
  var hist = Array.isArray(row.history) ? row.history : (row.history = []);
  var delta = -amount;

  // сколько было на складе непосредственно перед моментом at
  var after = 0;
  hist.forEach(function (h) { if ((h.at || 0) >= at) after += (h.delta || 0); });
  var beforeQty = (row.qty || 0) - after;
  var qtyAfter = Math.max(0, beforeQty - amount);

  hist.forEach(function (h) {
    if ((h.at || 0) >= at) h.qtyAfter = Math.max(0, (h.qtyAfter || 0) + delta);
  });
  hist.push({
    at: at,
    delta: delta,
    qtyAfter: qtyAfter,
    note: 'Продажа #' + sale.code + ' (внесена вручную)',
    by: actor ? actor.fullName : '',
    saleId: sale.id
  });
  hist.sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
  if (hist.length > 150) hist = hist.slice(0, 150);
  row.history = hist;
  row.qty = Math.max(0, (row.qty || 0) - amount);
  row.updatedAt = Date.now();
  return true;
}

/** Возврат склада при удалении ручной продажи */
function stockRestoreManualSale(sale) {
  (sale.items || []).forEach(function (item) {
    var row = stockRow(sale.pointId, item.productId);
    if (!row || !Array.isArray(row.history)) return;
    var entry = null;
    row.history.forEach(function (h) { if (h.saleId === sale.id) entry = h; });
    if (!entry) return;
    var amount = Math.abs(item.qty || 0);
    var at = entry.at || sale.createdAt;
    row.history = row.history.filter(function (h) { return h !== entry; });
    row.history.forEach(function (h) {
      if ((h.at || 0) >= at) h.qtyAfter = Math.max(0, (h.qtyAfter || 0) + amount);
    });
    row.qty = Math.max(0, (row.qty || 0) + amount);
    row.updatedAt = Date.now();
  });
}

/**
 * Ручная продажа за любую прошедшую дату.
 * data: { pointId, at, items:[{productId,name,price,qty}], payment, cashAmount, qrAmount,
 *         sellerId, note, deductStock }
 */
function createManualSale(data, actor) {
  if (!canManageManualSales(actor)) return { error: 'Нет прав на добавление продаж' };
  data = data || {};
  if (!getPoint(data.pointId)) return { error: 'Выберите точку продаж' };

  var at = Number(data.at) || 0;
  if (!at) return { error: 'Укажите дату и время продажи' };
  if (at > Date.now() + 60000) return { error: 'Дата продажи не может быть в будущем' };

  var items = (data.items || []).map(function (it) {
    var product = getProduct(it.productId);
    return {
      productId: it.productId,
      name: it.name || (product ? product.name : 'Товар'),
      price: Math.max(0, Math.round(Number(it.price) || 0)),
      qty: Math.max(0, Math.round(Number(it.qty) || 0))
    };
  }).filter(function (it) { return it.productId && it.qty > 0; });
  if (!items.length) return { error: 'Добавьте хотя бы один товар' };

  var total = items.reduce(function (s, it) { return s + it.price * it.qty; }, 0);
  if (!(total > 0)) return { error: 'Сумма продажи должна быть больше нуля' };

  var payment = data.payment === 'qr' ? 'qr' : (data.payment === 'mixed' ? 'mixed' : 'cash');
  var cashAmount = 0, qrAmount = 0;
  if (payment === 'cash') cashAmount = total;
  else if (payment === 'qr') qrAmount = total;
  else {
    cashAmount = Math.max(0, Math.round(Number(data.cashAmount) || 0));
    qrAmount = Math.max(0, Math.round(Number(data.qrAmount) || 0));
    if (cashAmount + qrAmount !== total) {
      return { error: 'Наличные + Kaspi QR должны равняться сумме ' + fmtMoney(total) };
    }
  }

  // остатки двигает только продажа за сегодня: прошлые даты идут в отчёт склада,
  // но не меняют текущий склад и отчёты за последующие дни
  var isToday = at >= startOfDay(new Date());
  var deductStock = !!data.deductStock && isToday;

  var seller = data.sellerId ? getUser(data.sellerId) : null;
  if (seller && seller.role !== 'seller' && seller.role !== 'admin' && seller.role !== 'dev') seller = null;

  var sale = {
    id: uid(),
    code: shortId(),
    userId: seller ? seller.id : actor.id,
    userName: seller ? seller.fullName : actor.fullName,
    pointId: data.pointId,
    pointName: pointName(data.pointId),
    items: items,
    total: total,
    payment: payment,
    cashAmount: cashAmount,
    qrAmount: qrAmount,
    receipt: null,
    createdAt: at,
    updatedAt: Date.now(),
    manual: true,
    manualById: actor.id,
    manualBy: actor.fullName,
    manualNote: String(data.note || '').trim() || null,
    stockDeducted: deductStock
  };

  DB.sales.push(sale);

  if (sale.stockDeducted) {
    sale.items.forEach(function (item) {
      stockDeductAt(sale.pointId, item.productId, item.qty, at, sale, actor);
    });
  }
  // за прошлые даты склад не трогаем: продажа останется в отчёте за свою дату

  saveDB();
  return { sale: sale, total: total };
}

function deleteManualSale(saleId, actor) {
  if (!canManageManualSales(actor)) return { error: 'Нет прав на удаление продаж' };
  var sale = DB.sales.find(function (s) { return s.id === saleId; });
  if (!sale) return { error: 'Продажа не найдена' };
  if (!sale.manual) return { error: 'Это обычная продажа — удаляйте её на панели' };
  if (sale.stockDeducted) stockRestoreManualSale(sale);
  DB.sales = DB.sales.filter(function (s) { return s.id !== saleId; });
  if (window.POS_API && window.POS_API.markDeleted) window.POS_API.markDeleted('sales', saleId);
  saveDB();
  return { ok: true, sale: sale };
}

function manualSales() {
  return DB.sales.filter(function (s) { return s.manual; });
}

/* ---------- Правки и отмена продаж (2 суток) ---------- */

var SALE_EDIT_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;   // 2 суток с момента продажи

function saleEditDeadline(sale) {
  return (sale ? (sale.createdAt || 0) : 0) + SALE_EDIT_WINDOW_MS;
}

function saleEditLeftMs(sale) {
  return Math.max(0, saleEditDeadline(sale) - Date.now());
}

function canEditSale(user, sale) {
  if (!user || !sale) return false;
  if (sale.cancelled) return false;
  if (user.role === 'admin') return true;                 // владелец — без ограничения по времени
  if (user.role !== 'seller') return false;
  var allowed = userPointIds(user);
  if (allowed.indexOf(sale.pointId) === -1) return false;  // только своя точка
  return saleEditLeftMs(sale) > 0;                         // ровно 2 суток
}

function ensureSaleChanges() {
  if (!Array.isArray(DB.saleChanges)) DB.saleChanges = [];
  return DB.saleChanges;
}

function logSaleChange(entry) {
  ensureSaleChanges();
  var rec = Object.assign({
    id: uid(),
    at: Date.now(),
    createdAt: Date.now(),
    updatedAt: Date.now()
  }, entry);
  DB.saleChanges.unshift(rec);
  if (DB.saleChanges.length > 2000) DB.saleChanges = DB.saleChanges.slice(0, 2000);
  return rec;
}

function saleSnapshot(sale) {
  return {
    payment: sale.payment || 'cash',
    cashAmount: sale.cashAmount || 0,
    qrAmount: sale.qrAmount || 0,
    total: sale.total || 0,
    hasReceipt: !!sale.receipt,
    receipt: sale.receipt || null
  };
}

function describePaymentChange(before, after) {
  var parts = [];
  if (before.payment !== after.payment) {
    parts.push('способ оплаты: ' + paymentLabel(before.payment) + ' → ' + paymentLabel(after.payment));
  }
  if (before.payment === 'mixed' || after.payment === 'mixed') {
    if (before.cashAmount !== after.cashAmount || before.qrAmount !== after.qrAmount) {
      parts.push('наличные/QR: ' + before.cashAmount + '/' + before.qrAmount + ' → ' + after.cashAmount + '/' + after.qrAmount);
    }
  }
  if (before.hasReceipt !== after.hasReceipt) {
    parts.push(before.hasReceipt ? (after.hasReceipt ? 'чек заменён' : 'чек удалён') : 'чек добавлен');
  } else if (before.hasReceipt && after.hasReceipt && before.receipt !== after.receipt) {
    parts.push('чек заменён');
  }
  return parts.join('; ');
}

/**
 * Правка продажи: способ оплаты, разбивка нал/QR, чек.
 * Продавец — только на своей точке и только 2 суток.
 */
function updateSale(saleId, patch, actor) {
  var sale = DB.sales.find(function (x) { return x.id === saleId; });
  if (!sale) return { error: 'Продажа не найдена' };
  if (sale.cancelled) return { error: 'Продажа уже отменена' };
  if (!canEditSale(actor, sale)) {
    return { error: actor && actor.role === 'seller' ? 'Истекло время правки (2 суток)' : 'Нет прав на правку продажи' };
  }

  var before = saleSnapshot(sale);
  var payment = patch.payment || sale.payment;
  var total = Number(patch.total !== undefined ? patch.total : sale.total) || 0;
  var cashAmount = 0, qrAmount = 0;

  if (payment === 'cash') {
    cashAmount = total; qrAmount = 0;
  } else if (payment === 'qr') {
    cashAmount = 0; qrAmount = total;
  } else {
    cashAmount = Math.round(Number(patch.cashAmount) || 0);
    qrAmount = Math.round(Number(patch.qrAmount) || 0);
    if (cashAmount + qrAmount !== total) {
      return { error: 'Суммы наличных и QR должны давать ' + total + ' ₸' };
    }
  }

  var receipt = patch.receipt !== undefined ? patch.receipt : (sale.receipt || null);
  if ((payment === 'qr' || payment === 'mixed') && !receipt) {
    return { error: 'Для оплаты Kaspi QR нужен чек' };
  }

  sale.payment = payment;
  sale.cashAmount = cashAmount;
  sale.qrAmount = qrAmount;
  sale.total = total;
  sale.receipt = receipt || null;
  sale.updatedAt = Date.now();
  sale.editedAt = Date.now();
  sale.editedByName = actor ? actor.fullName : '';
  sale.edits = (sale.edits || 0) + 1;

  var after = saleSnapshot(sale);
  var summary = describePaymentChange(before, after);
  var change = logSaleChange({
    type: 'edit',
    saleId: sale.id,
    saleCode: sale.code,
    saleAt: sale.createdAt,
    pointId: sale.pointId,
    pointName: sale.pointName || pointName(sale.pointId),
    userId: actor ? actor.id : null,
    userName: actor ? actor.fullName : 'Система',
    items: (sale.items || []).map(function (it) { return { name: it.name, qty: it.qty, price: it.price }; }),
    before: before,
    after: after,
    summary: summary || 'изменения сохранены'
  });
  saveDB();
  return { ok: true, sale: sale, change: change };
}

/**
 * Отмена продажи: запись не удаляется, остатки возвращаются на склад.
 */
function cancelSale(saleId, actor) {
  var sale = DB.sales.find(function (x) { return x.id === saleId; });
  if (!sale) return { error: 'Продажа не найдена' };
  if (sale.cancelled) return { error: 'Продажа уже отменена' };
  if (!canEditSale(actor, sale)) {
    return { error: actor && actor.role === 'seller' ? 'Истекло время отмены (2 суток)' : 'Нет прав на отмену продажи' };
  }

  var restored = [];
  // ручная продажа задним числом склад не двигала — возвращать нечего
  var manualNoStock = sale.manual && !sale.stockDeducted;
  (sale.items || []).forEach(function (item) {
    if (manualNoStock) return;
    var row = stockRow(sale.pointId, item.productId);
    if (!row) return;
    row.qty += item.qty;
    row.updatedAt = Date.now();
    row.history = row.history || [];
    row.history.unshift({
      at: Date.now(),
      delta: item.qty,
      qtyAfter: row.qty,
      note: 'Отмена продажи #' + (sale.code || ''),
      by: actor ? actor.fullName : 'Система',
      saleId: sale.id
    });
    if (row.history.length > 150) row.history = row.history.slice(0, 150);
    restored.push({ name: item.name, qty: item.qty });
  });

  sale.cancelled = true;
  sale.cancelledAt = Date.now();
  sale.cancelledById = actor ? actor.id : null;
  sale.cancelledByName = actor ? actor.fullName : 'Система';
  sale.updatedAt = Date.now();

  var change = logSaleChange({
    type: 'cancel',
    saleId: sale.id,
    saleCode: sale.code,
    saleAt: sale.createdAt,
    pointId: sale.pointId,
    pointName: sale.pointName || pointName(sale.pointId),
    userId: actor ? actor.id : null,
    userName: actor ? actor.fullName : 'Система',
    items: (sale.items || []).map(function (it) { return { name: it.name, qty: it.qty, price: it.price }; }),
    before: saleSnapshot(sale),
    after: null,
    restored: restored,
    summary: 'продажа отменена, товары возвращены на склад'
  });
  saveDB();
  return { ok: true, sale: sale, change: change };
}

function deleteSale(saleId, restoreStock, actor) {
  var sale = DB.sales.find(function (s) { return s.id === saleId; });
  if (!sale) return;
  if (restoreStock) {
    sale.items.forEach(function (item) {
      var row = stockRow(sale.pointId, item.productId);
      if (row) {
        row.qty += item.qty;
        row.updatedAt = Date.now();
        row.history = row.history || [];
        row.history.unshift({
          at: Date.now(),
          delta: item.qty,
          qtyAfter: row.qty,
          note: 'Отмена продажи #' + (sale.code || ''),
          by: actor ? actor.fullName : 'Система'
        });
      }
    });
  }
  DB.sales = DB.sales.filter(function (s) { return s.id !== saleId; });
  if (window.POS_API) window.POS_API.markDeleted('sales', saleId);
  saveDB();
}

function addExpense(amount, reason, pointId, actor) {
  var exp = {
    id: uid(),
    userId: actor.id,
    userName: actor.fullName,
    pointId: pointId || null,
    pointName: pointId ? pointName(pointId) : '',
    amount: Math.round(Number(amount) || 0),
    reason: String(reason || '').trim(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    pruned: false
  };
  DB.expenses.push(exp);
  saveDB();
  return exp;
}

function deleteExpense(id) {
  DB.expenses = DB.expenses.filter(function (e) { return e.id !== id; });
  if (window.POS_API) window.POS_API.markDeleted('expenses', id);
  saveDB();
}

/* ---------- Время ---------- */
var SHIFT_AUTO_CLOSE_HOUR = 2; // в 02:00 незакрытая смена завершается автоматически

/** Момент автозакрытия для смены: 02:00 следующего дня после даты прихода */
function shiftAutoCloseAt(dateKeyStr) {
  var d = parseDayKey(dateKeyStr) || startOfDay(new Date());
  var next = new Date(d.getTime());
  next.setDate(next.getDate() + 1);
  next.setHours(SHIFT_AUTO_CLOSE_HOUR, 0, 0, 0);
  return next.getTime();
}

/**
 * Закрывает забытые смены: если приход был, а уход не отметили,
 * смена автоматически завершается в 02:00 следующего дня.
 */
function autoCloseOpenShifts(now) {
  var ts = Number(now) || Date.now();
  var closed = [];
  DB.time.forEach(function (t) {
    if (!t || !t.arriveAt || t.leaveAt) return;
    var closeAt = shiftAutoCloseAt(t.date);
    if (isNaN(closeAt) || closeAt > ts) return;
    // если приход уже после момента автозакрытия — смена ещё идёт
    if (t.arriveAt >= closeAt) return;
    t.leaveAt = closeAt;
    t.leaveGeo = null;
    t.autoClosed = true;
    t.updatedAt = ts;
    closed.push(t);
    if (window.POS_API && window.POS_API.markDirty) window.POS_API.markDirty('time', t.id);
  });
  if (closed.length) saveDB();
  return closed;
}

/** Пересечение текущего момента с границей 02:00 — для авто-выхода из сессии */
function nightBoundaryBetween(fromTs, toTs) {
  var from = Number(fromTs) || 0;
  var to = Number(toTs) || Date.now();
  if (to <= from) return null;
  var cursor = new Date(from);
  for (var i = 0; i < 3; i++) {
    var b = new Date(cursor.getTime());
    b.setHours(SHIFT_AUTO_CLOSE_HOUR, 0, 0, 0);
    if (b.getTime() <= from) b.setDate(b.getDate() + 1);
    if (b.getTime() > from && b.getTime() <= to) return b.getTime();
    cursor.setDate(cursor.getDate() + 1);
  }
  return null;
}

function timeEntryFor(userId, key) {
  key = key || dayKey(new Date());
  return DB.time.find(function (t) { return t.userId === userId && t.date === key; }) || null;
}

function fmtDuration(ms) {
  if (!ms || ms < 0) return '—';
  var totalMin = Math.round(ms / 60000);
  var h = Math.floor(totalMin / 60);
  var m = totalMin % 60;
  if (h === 0) return m + ' мин';
  return h + ' ч ' + (m < 10 ? '0' + m : m) + ' мин';
}

/* ---------- Периоды и статистика ---------- */
var MONTHS_NOM = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
var MONTHS_NOM_PREP = ['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне', 'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре'];

function parseDayKey(key) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ''));
  if (!m) return null;
  var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return isNaN(d.getTime()) ? null : d;
}

function parseMonthKey(key) {
  var m = /^(\d{4})-(\d{2})$/.exec(String(key || ''));
  if (!m) return null;
  var month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return { year: Number(m[1]), month: month };
}

function todayKey() { return dayKey(new Date()); }

function defaultPeriodSel() {
  var now = new Date();
  return {
    period: 'today',
    date: dayKey(now),
    month: now.getFullYear() + '-' + pad2(now.getMonth() + 1),
    from: dayKey(new Date(now.getFullYear(), now.getMonth(), 1)),
    to: dayKey(now)
  };
}

function normalizePeriodSel(sel) {
  var base = defaultPeriodSel();
  if (!sel) return base;
  var out = {
    period: ['today', 'week', 'month', 'period'].indexOf(sel.period) !== -1 ? sel.period : 'today',
    date: parseDayKey(sel.date) ? sel.date : base.date,
    month: parseMonthKey(sel.month) ? sel.month : base.month,
    from: parseDayKey(sel.from) ? sel.from : base.from,
    to: parseDayKey(sel.to) ? sel.to : base.to
  };
  if (parseDayKey(out.from) > parseDayKey(out.to)) {
    var tmp = out.from; out.from = out.to; out.to = tmp;
  }
  return out;
}

function fmtRangeHuman(from, to) {
  var a = new Date(from), b = new Date(to);
  var sameYear = a.getFullYear() === b.getFullYear();
  if (dayKey(a) === dayKey(b)) {
    return a.getDate() + ' ' + MONTHS_RU[a.getMonth()] + (sameYear ? ' ' + a.getFullYear() : '');
  }
  if (sameYear && a.getMonth() === b.getMonth()) {
    return a.getDate() + '–' + b.getDate() + ' ' + MONTHS_RU[b.getMonth()] + ' ' + b.getFullYear();
  }
  if (sameYear) {
    return a.getDate() + ' ' + MONTHS_RU[a.getMonth()] + ' — ' + b.getDate() + ' ' + MONTHS_RU[b.getMonth()] + ' ' + b.getFullYear();
  }
  return fmtDate(from) + ' — ' + fmtDate(to);
}

function resolveRange(sel) {
  var s = normalizePeriodSel(sel);
  var now = Date.now();
  var today = startOfDay(new Date());
  var res = { period: s.period, selection: s };
  var from, to, prevFrom, prevTo;
  if (s.period === 'today') {
    var d = parseDayKey(s.date) || new Date();
    from = startOfDay(d); to = endOfDay(d);
    prevFrom = startOfDay(addDays(d, -1)); prevTo = endOfDay(addDays(d, -1));
  } else if (s.period === 'week') {
    var wEnd = parseDayKey(s.date) || new Date();
    if (startOfDay(wEnd) > today) wEnd = new Date();
    to = endOfDay(wEnd); from = startOfDay(addDays(wEnd, -6));
    var prevEnd = addDays(wEnd, -7);
    prevFrom = startOfDay(addDays(prevEnd, -6)); prevTo = endOfDay(prevEnd);
  } else if (s.period === 'month') {
    var mk = parseMonthKey(s.month) || { year: new Date().getFullYear(), month: new Date().getMonth() + 1 };
    var first = new Date(mk.year, mk.month - 1, 1);
    var last = new Date(mk.year, mk.month, 0);
    from = startOfDay(first);
    to = endOfDay(last);
    prevFrom = startOfDay(new Date(mk.year, mk.month - 2, 1));
    prevTo = endOfDay(new Date(mk.year, mk.month - 1, 0));
  } else {
    var fd = parseDayKey(s.from) || new Date();
    var td = parseDayKey(s.to) || new Date();
    if (fd > td) { var t0 = fd; fd = td; td = t0; }
    from = startOfDay(fd); to = endOfDay(td);
    var len = to - from + 1;
    prevTo = from - 1; prevFrom = prevTo - len + 1;
  }
  if (to > now && (s.period === 'month' || s.period === 'period')) to = Math.max(from, now);
  res.from = from;
  res.to = to;
  res.prevFrom = prevFrom;
  res.prevTo = prevTo;
  res.length = to - from;
  res.days = Math.max(1, Math.round((startOfDay(new Date(to)) - startOfDay(new Date(from))) / 86400000) + 1);
  res.label = rangeTitle(s, from, to);
  res.sub = rangeSubLabel(s, from, to);
  return res;
}

function rangeTitle(sel, from, to) {
  var s = normalizePeriodSel(sel);
  if (s.period === 'today') {
    return dayKey(new Date()) === s.date ? 'Сегодня' : fmtRangeHuman(from, to);
  }
  if (s.period === 'week') return '7 дней';
  if (s.period === 'month') {
    var mk = parseMonthKey(s.month) || { year: new Date().getFullYear(), month: new Date().getMonth() + 1 };
    return MONTHS_NOM[mk.month - 1] + ' ' + mk.year;
  }
  return 'Свой период';
}

function rangeSubLabel(sel, from, to) {
  var s = normalizePeriodSel(sel);
  if (s.period === 'today') return 'за ' + fmtDateHuman(from).replace(/^[^,]+, /, '');
  return fmtRangeHuman(from, to);
}

function periodRange(period) {
  if (period === 'week' || period === 'month' || period === 'today') {
    return resolveRange({ period: period });
  }
  return resolveRange({ period: period || 'today' });
}

function periodLabel(period) {
  if (period === 'week') return '7 дней';
  if (period === 'month') return '30 дней';
  return 'Сегодня';
}

function periodSubLabel(period, from, to) {
  if (period === 'today') return 'за ' + fmtDate(from);
  return fmtDateShort(from) + ' — ' + fmtDateShort(to);
}

function deltaPct(current, previous) {
  if (!previous) return current > 0 ? 100 : 0;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function scopePointId(user) {
  return user && user.role === 'seller' ? activePointId(user) : null;
}

/* ---------- Точки пользователя ----------
   pointIds — все точки, к которым у сотрудника есть доступ.
   pointId  — «текущая» точка (для совместимости и подсказок).
   Активная точка на устройстве живёт в DB.session.pointId и не уходит на сервер,
   поэтому переключение точки не смешивает данные. */
function userPointIds(user) {
  if (!user) return [];
  var list = Array.isArray(user.pointIds) ? user.pointIds.filter(Boolean) : [];
  if (!list.length && user.pointId) list = [user.pointId];
  return list;
}

function userPoints(user) {
  var ids = userPointIds(user);
  return DB.points.filter(function (p) { return ids.indexOf(p.id) !== -1; });
}

function userHasPoint(user, pointId) {
  if (!pointId) return false;
  if (!user) return false;
  if (user.role === 'admin' || user.role === 'dev') return !!getPoint(pointId);
  return userPointIds(user).indexOf(pointId) !== -1;
}

function activePointId(user) {
  if (!user) return null;
  if (user.role === 'admin' || user.role === 'dev') {
    var savedAdmin = DB.session && DB.session.pointId;
    return savedAdmin && getPoint(savedAdmin) ? savedAdmin : (DB.points[0] ? DB.points[0].id : null);
  }
  var ids = userPointIds(user);
  var saved = DB.session && DB.session.pointId;
  if (saved && ids.indexOf(saved) !== -1) return saved;
  return ids[0] || null;
}

function setActivePoint(user, pointId) {
  if (!userHasPoint(user, pointId)) return false;
  DB.session = DB.session || { userId: user.id, at: Date.now() };
  DB.session.pointId = pointId;
  if (user.role === 'seller') user.pointId = pointId;   // чтобы касса/склад открывались на этой точке после входа
  saveDB();
  return true;
}

function userPointsLabel(user) {
  var names = userPoints(user).map(function (p) { return p.name; });
  if (!names.length) return 'Точка не назначена';
  if (names.length === 1) return names[0];
  return names.length + ' ' + plural(names.length, 'точка', 'точки', 'точек') + ': ' + names.join(', ');
}

function salesBetween(from, to, opts) {
  opts = opts || {};
  return DB.sales.filter(function (s) {
    if (s.createdAt < from || s.createdAt > to) return false;
    if (opts.pointId && s.pointId !== opts.pointId) return false;
    if (opts.userId && s.userId !== opts.userId) return false;
    if (s.cancelled && !opts.includeCancelled) return false;
    return true;
  });
}

function expensesBetween(from, to, opts) {
  opts = opts || {};
  return DB.expenses.filter(function (e) {
    if (e.createdAt < from || e.createdAt > to) return false;
    if (opts.pointId && e.pointId !== opts.pointId) return false;
    if (opts.userId && e.userId !== opts.userId) return false;
    return true;
  });
}

function summarize(from, to, opts) {
  opts = opts || {};
  var sales = salesBetween(from, to, opts);
  var expenses = expensesBetween(from, to, opts);
  var revenue = 0, cashTotal = 0, qrTotal = 0, mixedTotal = 0, itemsSold = 0;
  var mixedCash = 0, mixedQr = 0, mixedCount = 0;
  var byMethod = { cash: 0, qr: 0, mixed: 0 };
  var salesCountTotal = null, profitExtra = 0;

  sales.forEach(function (s) {
    revenue += s.total || 0;
    byMethod[s.payment] = (byMethod[s.payment] || 0) + (s.total || 0);
    if (s.payment === 'cash') cashTotal += s.total || 0;
    else if (s.payment === 'qr') qrTotal += s.total || 0;
    else {
      mixedTotal += s.total || 0;
      mixedCash += s.cashAmount || 0;
      mixedQr += s.qrAmount || 0;
      mixedCount += 1;
      cashTotal += s.cashAmount || 0;
      qrTotal += s.qrAmount || 0;
    }
    (s.items || []).forEach(function (it) { itemsSold += it.qty || 0; });
  });

  var expenseTotal = expenses.reduce(function (sum, e) { return sum + (e.amount || 0); }, 0);

  /* корректировки показателей по дням (разработчик) — только для общей картины */
  if (!opts.pointId && !opts.userId) {
    var adj = dayAdjustmentsInRange(from, to);
    if (adj.length) {
      var buckets = {};
      function bk(key) {
        return buckets[key] || (buckets[key] = { revenue: 0, cash: 0, qr: 0, mixed: 0, mixedCash: 0, mixedQr: 0, mixedCount: 0, count: 0, expenses: 0, profitAdj: 0 });
      }
      sales.forEach(function (s) {
        var b = bk(dayKey(s.createdAt));
        b.revenue += s.total || 0;
        b.count += 1;
        if (s.payment === 'cash') b.cash += s.total || 0;
        else if (s.payment === 'qr') b.qr += s.total || 0;
        else {
          b.mixed += s.total || 0;
          b.mixedCash += s.cashAmount || 0;
          b.mixedQr += s.qrAmount || 0;
          b.mixedCount += 1;
          b.cash += s.cashAmount || 0;
          b.qr += s.qrAmount || 0;
        }
      });
      expenses.forEach(function (e) { bk(dayKey(e.createdAt)).expenses += e.amount || 0; });

      adj.forEach(function (item) {
        var o = item.data || {};
        var b = bk(item.key);
        if (o.revenue != null) b.revenue = o.revenue;
        if (o.cash != null) b.cash = o.cash;
        if (o.qr != null) b.qr = o.qr;
        if (o.mixed != null) b.mixed = o.mixed;
        if (o.expenses != null) b.expenses = o.expenses;
        if (o.avgCheck > 0) b.count = Math.max(1, Math.round((b.revenue || 0) / o.avgCheck));
        if (o.profit != null) b.profitAdj = o.profit - ((b.revenue || 0) - (b.expenses || 0));
      });

      revenue = 0; cashTotal = 0; qrTotal = 0; mixedTotal = 0; mixedCash = 0; mixedQr = 0; mixedCount = 0;
      expenseTotal = 0;
      var countTotal = 0, profitAdjTotal = 0;
      var method = { cash: 0, qr: 0, mixed: 0 };
      Object.keys(buckets).forEach(function (key) {
        var b = buckets[key];
        revenue += b.revenue;
        cashTotal += b.cash;
        qrTotal += b.qr;
        mixedTotal += b.mixed;
        mixedCash += b.mixedCash;
        mixedQr += b.mixedQr;
        mixedCount += b.mixedCount;
        expenseTotal += b.expenses;
        countTotal += b.count;
        profitAdjTotal += b.profitAdj;
        method.cash += b.cash - b.mixedCash;
        method.qr += b.qr - b.mixedQr;
        method.mixed += b.mixed;
      });
      byMethod = method;
      salesCountTotal = countTotal;
      profitExtra = profitAdjTotal;
    }
  }
  var finalCount = salesCountTotal != null ? salesCountTotal : sales.length;
  return {
    revenue: revenue,
    expenses: expenseTotal,
    profit: revenue - expenseTotal + profitExtra,
    salesCount: finalCount,
    avgCheck: finalCount ? revenue / finalCount : 0,
    itemsSold: itemsSold,
    cashTotal: cashTotal,          // всё, что пришло наличными (включая долю смешанных)
    qrTotal: qrTotal,              // всё, что пришло Kaspi QR (включая долю смешанных)
    mixedTotal: mixedTotal,        // общая сумма продаж со смешанной оплатой
    mixedCash: mixedCash,          // из них наличными
    mixedQr: mixedQr,              // из них Kaspi QR
    mixedCount: mixedCount,        // число таких продаж
    cashPure: cashTotal - mixedCash,
    qrPure: qrTotal - mixedQr,
    byMethod: byMethod,
    sales: sales,
    expenseList: expenses
  };
}

function paymentSplit(sales) {
  var split = { cash: 0, qr: 0, mixed: 0 };
  sales.forEach(function (s) { split[s.payment] = (split[s.payment] || 0) + (s.total || 0); });
  return split;
}

function topProducts(sales, limit) {
  var map = {};
  sales.forEach(function (s) {
    (s.items || []).forEach(function (item) {
      var key = item.productId || item.name;
      if (!map[key]) map[key] = { productId: item.productId, name: item.name, qty: 0, revenue: 0 };
      map[key].qty += item.qty || 0;
      map[key].revenue += (item.price || 0) * (item.qty || 0);
    });
  });
  var list = Object.keys(map).map(function (k) { return map[k]; });
  list.sort(function (a, b) { return b.revenue - a.revenue; });
  return limit ? list.slice(0, limit) : list;
}

function salesByPointList(sales) {
  var map = {};
  sales.forEach(function (s) {
    var key = s.pointId || 'none';
    if (!map[key]) map[key] = { pointId: s.pointId, name: s.pointName || pointName(s.pointId), revenue: 0, count: 0 };
    map[key].revenue += s.total || 0;
    map[key].count += 1;
  });
  var list = Object.keys(map).map(function (k) { return map[k]; });
  list.sort(function (a, b) { return b.revenue - a.revenue; });
  return list;
}

function buildBuckets(period, from, to) {
  var buckets = [];
  var start = startOfDay(new Date(from));
  var endDay = startOfDay(new Date(to));
  var days = Math.max(1, Math.round((endDay - start) / 86400000) + 1);
  if (period === 'today' || days <= 1) {
    for (var h = 0; h < 24; h++) {
      buckets.push({
        from: start + h * 3600000,
        to: start + (h + 1) * 3600000 - 1,
        label: h % 3 === 0 ? pad2(h) + ':00' : '',
        full: pad2(h) + ':00 — ' + pad2(h) + ':59'
      });
    }
  } else {
    for (var i = 0; i < days; i++) {
      var d = addDays(new Date(start), i);
      var label = '';
      if (days <= 7) label = WEEKDAYS_SHORT[d.getDay()] + ' ' + d.getDate();
      else if (i % 5 === 0 || i === days - 1) label = pad2(d.getDate()) + '.' + pad2(d.getMonth() + 1);
      buckets.push({
        from: startOfDay(d),
        to: endOfDay(d),
        label: label,
        full: fmtDateShort(d)
      });
    }
  }
  return buckets;
}

function chartData(period, from, to, opts) {
  var buckets = buildBuckets(period, from, to);
  return buckets.map(function (b) {
    var sales = salesBetween(b.from, b.to, opts);
    var expenses = expensesBetween(b.from, b.to, opts);
    return {
      label: b.label,
      full: b.full,
      revenue: sales.reduce(function (s, x) { return s + (x.total || 0); }, 0),
      expenses: expenses.reduce(function (s, x) { return s + (x.amount || 0); }, 0)
    };
  });
}

function countTimeWorkedMs(entry) {
  if (!entry || !entry.arriveAt) return 0;
  var end = entry.leaveAt || Date.now();
  return Math.max(0, end - entry.arriveAt);
}

/* ---------- Тестовые данные (генератор используется автотестами; в интерфейсе демо-режима нет) ---------- */
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

async function loadDemoData(adminUser) {
  if (DB.settings.demoLoaded) return { skipped: true };
  var now = new Date();

  var point1 = {
    id: uid(), name: 'Точка №1 — Центральная', address: 'г. Актобе, пр. Абилкайыр хана, 42',
    lat: 50.2839, lng: 57.1660, createdAt: Date.now() - 30 * 86400000, demo: true
  };
  var point2 = {
    id: uid(), name: 'Точка №2 — Жилгородок', address: 'г. Актобе, ул. Жилгородок, 12',
    lat: 50.2640, lng: 57.2200, createdAt: Date.now() - 24 * 86400000, demo: true
  };
  DB.points.push(point1, point2);

  var cats = {};
  DB.categories.forEach(function (c) { cats[c.name] = c.id; });

  var seller = {
    id: uid(),
    fullName: 'Айгуль Сапарова',
    username: 'aigul',
    pass: await hashPassword('123456'),
    role: 'seller',
    pointIds: [point1.id, point2.id],
    pointId: point1.id,
    workStart: '09:00',
    workEnd: '18:00',
    createdAt: Date.now() - 20 * 86400000,
    updatedAt: Date.now() - 20 * 86400000,
    demo: true
  };
  DB.users.push(seller);

  var productSpecs = [
    ['Кофе американо', 'Напитки', 700], ['Кофе латте', 'Напитки', 950],
    ['Круассан', 'Выпечка', 550], ['Сэндвич с курицей', 'Готовая еда', 1250],
    ['Кола 0.5', 'Напитки', 450], ['Вода 1 л', 'Напитки', 300],
    ['Чипсы Lays', 'Снеки', 550], ['Шоколад Milka', 'Снеки', 600],
    ['Печенье овсяное', 'Выпечка', 350], ['Хот-дог', 'Готовая еда', 900],
    ['Сок Rich 0.3', 'Напитки', 500], ['Батончик Snickers', 'Снеки', 400]
  ];
  var products = productSpecs.map(function (spec, i) {
    return {
      id: uid(),
      name: spec[0],
      categoryId: cats[spec[1]] || DB.categories[0].id,
      price: spec[2],
      photo: null,
      pointIds: i % 3 === 0 ? [point1.id] : [point1.id, point2.id],
      createdAt: Date.now() - 15 * 86400000,
      updatedAt: Date.now() - 15 * 86400000,
      demo: true
    };
  });
  DB.products.push.apply(DB.products, products);

  products.forEach(function (p) {
    [point1, point2].forEach(function (pt) {
      if (p.pointIds.indexOf(pt.id) === -1) return;
      var qty = randInt(6, 32);
      DB.stock.push({
        id: uid(), pointId: pt.id, productId: p.id, qty: qty, demo: true,
        updatedAt: Date.now() - randInt(0, 5) * 86400000,
        history: [{ at: Date.now() - randInt(1, 6) * 86400000, delta: qty, qtyAfter: qty, note: 'Начальный остаток', by: adminUser.fullName }]
      });
    });
  });

  var expenseReasons = ['Закупка воды', 'Расходники для кассы', 'Хлеб и выпечка', 'Молочные продукты', 'Транспорт', 'Мелкий ремонт', 'Интернет', 'Уборка'];
  var users = [adminUser, seller];
  var points = [point1, point2];

  for (var dayOffset = 13; dayOffset >= 0; dayOffset--) {
    var day = addDays(now, -dayOffset);
    var salesCount = dayOffset === 0 ? randInt(2, 4) : randInt(4, 8);
    for (var k = 0; k < salesCount; k++) {
      var point = Math.random() < 0.72 ? point1 : point2;
      var actor = point.id === point1.id ? pick(users) : seller;
      var time = new Date(day);
      time.setHours(randInt(9, 20), randInt(0, 59), 0, 0);
      if (time.getTime() > Date.now()) time = new Date(Date.now() - randInt(5, 90) * 60000);

      var available = products.filter(function (p) { return p.pointIds.indexOf(point.id) !== -1; });
      var itemCount = randInt(1, 3);
      var chosen = [];
      for (var c = 0; c < itemCount; c++) {
        var prod = pick(available);
        if (chosen.some(function (x) { return x.productId === prod.id; })) continue;
        chosen.push({ productId: prod.id, name: prod.name, price: prod.price, qty: randInt(1, 2) });
      }
      if (!chosen.length) continue;
      var total = chosen.reduce(function (s, it) { return s + it.price * it.qty; }, 0);
      var paymentRoll = Math.random();
      var payment = paymentRoll < 0.45 ? 'cash' : (paymentRoll < 0.82 ? 'qr' : 'mixed');
      var cashAmount = payment === 'cash' ? total : (payment === 'mixed' ? Math.round(total * 0.6) : 0);
      var qrAmount = payment === 'qr' ? total : (payment === 'mixed' ? total - cashAmount : 0);

      DB.sales.push({
        id: uid(),
        code: shortId(),
        userId: actor.id,
        userName: actor.fullName,
        pointId: point.id,
        pointName: point.name,
        items: chosen,
        total: total,
        payment: payment,
        cashAmount: cashAmount,
        qrAmount: qrAmount,
        receipt: null,
        createdAt: time.getTime(),
        updatedAt: time.getTime(),
        demo: true
      });
    }

    if (Math.random() < 0.6) {
      var expTime = new Date(day);
      expTime.setHours(randInt(10, 19), randInt(0, 59), 0, 0);
      if (expTime.getTime() > Date.now()) expTime = new Date(Date.now() - randInt(10, 120) * 60000);
      DB.expenses.push({
        id: uid(),
        userId: adminUser.id,
        userName: adminUser.fullName,
        pointId: pick(points).id,
        pointName: point1.name,
        amount: randInt(8, 70) * 100,
        reason: pick(expenseReasons),
        createdAt: expTime.getTime(),
        updatedAt: expTime.getTime(),
        pruned: false,
        demo: true
      });
    }

    if (dayOffset <= 6) {
      var arrive = new Date(day);
      arrive.setHours(9, randInt(0, 12), 0, 0);
      var leave = new Date(day);
      leave.setHours(18, randInt(0, 10), 0, 0);
      DB.time.push({
        id: uid(),
        userId: seller.id,
        date: dayKey(day),
        arriveAt: arrive.getTime(),
        leaveAt: leave.getTime(),
        arriveGeo: { lat: point1.lat + 0.0002, lng: point1.lng - 0.0001, acc: randInt(6, 24) },
        leaveGeo: { lat: point1.lat + 0.0002, lng: point1.lng - 0.0001, acc: randInt(6, 24) },
        updatedAt: arrive.getTime(),
        demo: true
      });
    }
  }

  DB.settings.demoLoaded = true;
  DB.settings.demoCleanupDone = true;
  saveDB();
  return { skipped: false, sellerUsername: 'aigul', sellerPassword: '123456' };
}

/**
 * Выход из демо-режима: удаляет демо-записи и демо-аккаунты, оставляя
 * реальные данные, если они уже есть. Удаления помечаются для облака.
 */
function clearDemoData() {
  var removed = { records: 0, users: 0 };
  function drop(collection) {
    DB[collection] = (DB[collection] || []).filter(function (row) {
      if (row && row.demo === true) {
        if (window.POS_API) window.POS_API.markDeleted(collection, row.id);
        removed.records++;
        return false;
      }
      return true;
    });
  }
  ['sales', 'expenses', 'time', 'stock', 'products', 'points'].forEach(drop);

  var demoUsernames = ['demo', 'aigul'];
  DB.users = (DB.users || []).filter(function (u) {
    var isDemo = u.demo === true || (DB.settings.demoLoaded && demoUsernames.indexOf(String(u.username).toLowerCase()) !== -1);
    if (!isDemo) return true;
    if (window.POS_API) window.POS_API.markDeleted('users', u.id);
    removed.users++;
    return false;
  });

  // если текущий пользователь удалён — сессия закрывается
  if (DB.session && !DB.users.some(function (u) { return u.id === DB.session.userId; })) {
    DB.session = null;
  }
  DB.settings.demoLoaded = false;
  DB.settings.updatedAt = Date.now();
  saveDB();
  return removed;
}


/* ---------- Импорт из старой системы ---------- */
/**
 * Перенос данных из предыдущей кассы.
 * Товары: название + категория + цена.
 * История продаж: в старых выгрузках обычно есть только итоги за период
 * (сумма, количество чеков, разбивка по оплате), поэтому создаются
 * сводные записи без позиций — выручка, средний чек и отчёты по оплатам
 * сходятся с прежней системой, а топ товаров строится по новым продажам.
 */
var CATEGORY_ALIASES = {
  'гримм': 'Грим',
  'акаагримм': 'Аквагримм',
  'аквагрим': 'Аквагримм',
  'косички': 'Косы',
  'не трогать': 'Прочее'
};

function normalizeCategoryName(name) {
  var clean = String(name || '').trim();
  var alias = CATEGORY_ALIASES[clean.toLowerCase()];
  return alias || clean || 'Без категории';
}

function parseProductsCsv(text) {
  var lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/);
  var rows = [];
  lines.forEach(function (line, index) {
    if (!line.trim()) return;
    var cells = line.split(/[;,\t]/).map(function (c) { return c.replace(/^"|"$/g, '').trim(); });
    if (index === 0 && /назван|name|товар/i.test(cells[0])) return;      // заголовок
    var name = cells[0];
    if (!name) return;
    var price = 0;
    for (var i = cells.length - 1; i >= 1; i--) {
      var num = parseFloat(String(cells[i]).replace(/\s|₸|тг\.?/gi, '').replace(',', '.'));
      if (isFinite(num) && num > 0) { price = Math.round(num); break; }
    }
    var category = cells.length >= 3 ? cells[1] : '';
    rows.push({ name: name, category: normalizeCategoryName(category), price: price });
  });
  return rows;
}

function importProducts(rows, options) {
  options = options || {};
  var created = 0, skipped = 0, categoriesCreated = 0;
  var byName = {};
  DB.products.forEach(function (p) { byName[String(p.name).toLowerCase()] = p; });
  var catByName = {};
  DB.categories.forEach(function (c) { catByName[String(c.name).toLowerCase()] = c; });

  (rows || []).forEach(function (row) {
    var name = String(row.name || '').trim();
    if (!name) return;
    var price = Math.max(0, Math.round(Number(row.price) || 0));
    var key = name.toLowerCase();
    if (byName[key]) {
      if (Number(byName[key].price) === price) { skipped++; return; }
      if (byName[(name + ' · ' + price).toLowerCase()]) { skipped++; return; }
      name = name + ' · ' + price;
      key = name.toLowerCase();
    }

    var catName = normalizeCategoryName(row.category);
    var category = catByName[catName.toLowerCase()];
    if (!category) {
      category = { id: uid(), name: catName, createdAt: Date.now(), updatedAt: Date.now() };
      DB.categories.push(category);
      catByName[catName.toLowerCase()] = category;
      categoriesCreated++;
    }

    var product = {
      id: uid(),
      name: name,
      price: price,
      categoryId: category.id,
      photo: null,
      pointIds: options.pointIds || [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      imported: true,
      variant: !!row.variant
    };
    DB.products.push(product);
    byName[key] = product;
    created++;
  });

  if (created || categoriesCreated) saveDB();
  return { created: created, skipped: skipped, categories: categoriesCreated };
}

function splitEvenly(amount, parts) {
  var out = [];
  if (parts <= 0) return out;
  var total = Math.round(Number(amount) || 0);
  var base = Math.floor(total / parts);
  var rest = total - base * parts;
  for (var i = 0; i < parts; i++) out.push(base + (i < rest ? 1 : 0));
  return out;
}

// Чередует записи разных способов оплаты так, чтобы в каждом дне была
// та же пропорция нал/QR/смешанных, что и за весь период.
function interleaveByType(groups) {
  var list = groups.filter(function (g) { return g && g.length; });
  var pos = list.map(function () { return 0; });
  var total = list.reduce(function (n, g) { return n + g.length; }, 0);
  var out = [];
  while (out.length < total) {
    var best = -1, bestFrac = Infinity;
    for (var i = 0; i < list.length; i++) {
      if (pos[i] >= list[i].length) continue;
      var frac = pos[i] / list[i].length;
      if (frac < bestFrac - 1e-9) { bestFrac = frac; best = i; }
    }
    if (best === -1) break;
    out.push(list[best][pos[best]++]);
  }
  return out;
}

function parseDateInput(value, fallback) {
  if (!value) return fallback;
  if (typeof value === 'number') return value;
  var parts = String(value).split('-');
  if (parts.length === 3) {
    var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    if (!isNaN(d.getTime())) return d.getTime();
  }
  var parsed = new Date(value);
  return isNaN(parsed.getTime()) ? fallback : parsed.getTime();
}

/**
 * Создаёт сводные продажи за период, чтобы суммы совпали с прежней кассой.
 * opts: {from, to, count, revenue, cashTotal, qrTotal, mixedCash, mixedQr, pointId, actor}
 */
function importSalesHistory(opts) {
  opts = opts || {};
  var actor = opts.actor || currentUser();
  if (!actor) throw new Error('Сначала войдите в аккаунт');

  var from = startOfDay(parseDateInput(opts.from, Date.now()));
  var to = endOfDay(parseDateInput(opts.to, Date.now()));
  if (to < from) { var tmp = from; from = to; to = tmp; }

  var count = Math.max(0, Math.round(Number(opts.count) || 0));
  if (!count) throw new Error('Укажите количество продаж');

  var revenue = Math.round(Number(opts.revenue) || 0);
  var cashTotal = Math.round(Number(opts.cashTotal) || 0);
  var qrTotal = Math.round(Number(opts.qrTotal) || 0);
  var mixedCash = Math.round(Number(opts.mixedCash) || 0);
  var mixedQr = Math.round(Number(opts.mixedQr) || 0);

  if (cashTotal + qrTotal !== revenue) {
    throw new Error('Наличные + Kaspi QR (' + fmtMoney(cashTotal + qrTotal) + ') не совпадают с выручкой (' + fmtMoney(revenue) + ')');
  }
  mixedCash = Math.max(0, Math.min(mixedCash, cashTotal));
  mixedQr = Math.max(0, Math.min(mixedQr, qrTotal));

  var pureCash = cashTotal - mixedCash;
  var pureQr = qrTotal - mixedQr;
  var mixedTotal = mixedCash + mixedQr;

  var nCash = revenue ? Math.round(count * pureCash / revenue) : Math.round(count / 3);
  var nQr = revenue ? Math.round(count * pureQr / revenue) : Math.round(count / 3);
  var nMixed = count - nCash - nQr;
  if (nMixed < 0) { nQr = Math.max(0, nQr + nMixed); nMixed = 0; }

  var pointId = opts.pointId || (DB.points[0] && DB.points[0].id) || null;
  var point = getPoint(pointId);

  var cashRecs = splitEvenly(pureCash, nCash).map(function (amount) {
    return { total: amount, payment: 'cash', cashAmount: amount, qrAmount: 0 };
  });
  var qrRecs = splitEvenly(pureQr, nQr).map(function (amount) {
    return { total: amount, payment: 'qr', cashAmount: 0, qrAmount: amount };
  });
  var mixedParts = splitEvenly(mixedTotal, nMixed);
  var mixedCashParts = splitEvenly(mixedCash, nMixed);
  var mixedRecs = mixedParts.map(function (amount, i) {
    var cash = mixedCashParts[i] || 0;
    return { total: amount, payment: 'mixed', cashAmount: cash, qrAmount: amount - cash };
  });

  // порядок важен: дни получают пропорциональную смесь оплат, а не «сначала нал, потом QR»
  var records = interleaveByType([cashRecs, qrRecs, mixedRecs]);

  // распределяем по дням периода
  var days = [];
  for (var day = from; day <= to; day = addDays(new Date(day), 1).getTime()) {
    days.push(startOfDay(new Date(day)));
    if (days.length > 400) break;
  }
  if (!days.length) days.push(from);

  var perDay = splitEvenly(records.length, days.length);
  var pointer = 0;
  days.forEach(function (dayStart, dayIndex) {
    var n = perDay[dayIndex];
    for (var i = 0; i < n && pointer < records.length; i++, pointer++) {
      var sale = records[pointer];
      var hour = 10 + Math.floor((i / Math.max(1, n)) * 10);
      var minute = Math.floor((i * 37) % 60);
      var ts = new Date(dayStart);
      ts.setHours(Math.min(hour, 20), minute, 0, 0);
      var record = {
        id: uid(),
        code: shortId(),
        userId: actor.id,
        userName: actor.fullName,
        pointId: pointId,
        pointName: point ? point.name : '',
        items: [],
        total: sale.total,
        payment: sale.payment,
        cashAmount: sale.cashAmount || 0,
        qrAmount: sale.qrAmount || 0,
        receipt: null,
        imported: true,
        note: 'Импорт из старой системы',
        createdAt: ts.getTime(),
        updatedAt: ts.getTime()
      };
      DB.sales.push(record);
    }
  });

  var ranges = Array.isArray(DB.settings.importedRanges) ? DB.settings.importedRanges : [];
  ranges.push(dayKey(from) + '..' + dayKey(to));
  DB.settings.importedRanges = ranges;
  DB.settings.updatedAt = Date.now();
  saveDB();

  return {
    created: records.length,
    revenue: revenue,
    cashTotal: cashTotal,
    qrTotal: qrTotal,
    mixedTotal: mixedTotal,
    from: dayKey(from),
    to: dayKey(to)
  };
}

/** Однократный перенос заготовленных данных (товары + история за октябрь). */
function applyLegacyStarter(options) {
  options = options || {};
  var data = window.POS_IMPORT_DATA;
  if (!data) throw new Error('Нет данных для переноса');
  var actor = options.actor || currentUser();
  if (!actor) throw new Error('Сначала войдите в аккаунт');

  var pointCreated = false;
  if (!DB.points.length) {
    DB.points.push({
      id: uid(),
      name: 'Основная точка',
      address: '',
      lat: null,
      lng: null,
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
    pointCreated = true;
  }
  var pointId = (DB.points[0] && DB.points[0].id) || null;

  var products = importProducts(data.products, { pointIds: [] });

  var imported = Array.isArray(DB.settings.importedRanges) ? DB.settings.importedRanges : [];
  var sales = { created: 0, ranges: [] };
  (data.history || []).forEach(function (chunk) {
    var key = chunk.from + '..' + chunk.to;
    if (imported.indexOf(key) !== -1) return;
    var res = importSalesHistory(Object.assign({}, chunk, { actor: actor, pointId: pointId }));
    sales.created += res.created;
    sales.ranges.push(key);
  });

  return { products: products, sales: sales, pointCreated: pointCreated };
}

/* ---------- История продаж за прошлые дни (сводно, без склада) ---------- */

var MONTH_WORDS_RU = {
  январ: 1, феврал: 2, март: 3, апрел: 4, май: 5, ма: 5, июн: 6, июл: 7, август: 8, сентябр: 9, октябр: 10, ноябр: 11, декабр: 12
};

function monthFromWord(word) {
  var w = String(word || '').toLowerCase();
  var keys = Object.keys(MONTH_WORDS_RU);
  for (var i = 0; i < keys.length; i++) {
    if (w.indexOf(keys[i]) === 0) return MONTH_WORDS_RU[keys[i]];
  }
  return null;
}

/** Вытаскивает суммы из строки: «125 000», «125,000», «125000 ₸» */
function historyNumbers(text) {
  var out = [];
  var re = /\d{1,3}(?:[ \u00A0]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?/g;
  var m;
  while ((m = re.exec(text)) !== null) {
    var raw = m[0].replace(/[ \u00A0]/g, '').replace(',', '.');
    var value = Number(raw);
    if (isFinite(value)) out.push({ value: value, raw: m[0], index: m.index });
  }
  return out;
}

/**
 * Разбор текста с историей: по строке на день.
 * 01.10.2026  125000            → выручка (всё наличными)
 * 01.10.2026  125000  34        → выручка и число чеков
 * 01.10.2026  125000  80000  45000       → выручка, наличные, Kaspi QR
 * 01.10.2026  125000  80000  45000  34   → + число чеков
 * Поддерживаются «1 октября 2026», «2026-10-01», заголовки «Октябрь 2026».
 */
function parseHistoryText(text, opts) {
  opts = opts || {};
  var avgCheck = Math.max(1, Number(opts.avgCheck) || 3000);
  var lines = String(text || '').split(/\r?\n/);
  var days = [], errors = [];
  var ctxMonth = null, ctxYear = new Date().getFullYear();
  var seen = {};

  lines.forEach(function (line, idx) {
    var raw = String(line || '').trim();
    if (!raw) return;
    if (/^[#/]/.test(raw)) return;

    // заголовок месяца: «Октябрь 2026», «Октябрь»
    var monthWord = raw.match(/^([А-Яа-яЁё]+)\s*(\d{4})?$/);
    if (monthWord) {
      var mm = monthFromWord(monthWord[1]);
      if (mm) {
        ctxMonth = mm;
        if (monthWord[2]) ctxYear = Number(monthWord[2]);
        return;
      }
    }
    var numericMonth = raw.match(/^(\d{1,2})[.\/](\d{4})$/);
    if (numericMonth) {
      ctxMonth = Number(numericMonth[1]);
      ctxYear = Number(numericMonth[2]);
      return;
    }

    var dateInfo = null;
    var rest = raw;

    // 1) dd.mm.yyyy | dd/mm/yy | dd-mm-yyyy
    var m1 = raw.match(/(\d{1,2})[.\/\-](\d{1,2})[.\/\-](\d{2,4})/);
    // 2) yyyy-mm-dd
    var m2 = raw.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
    // 3) «1 октября 2026»
    var m3 = raw.match(/(\d{1,2})\s+([А-Яа-яЁё]+)\s*(\d{4})?/);
    // 4) dd.mm без года
    var m4 = raw.match(/(\d{1,2})[.\/](\d{1,2})(?![\d.\/\-])/);

    if (m2) {
      dateInfo = { d: Number(m2[3]), m: Number(m2[2]), y: Number(m2[1]), match: m2[0] };
    } else if (m1) {
      var yy = Number(m1[3]);
      if (yy < 100) yy += 2000;
      dateInfo = { d: Number(m1[1]), m: Number(m1[2]), y: yy, match: m1[0] };
    } else if (m3 && monthFromWord(m3[2])) {
      dateInfo = { d: Number(m3[1]), m: monthFromWord(m3[2]), y: m3[3] ? Number(m3[3]) : ctxYear, match: m3[0] };
    } else if (m4 && ctxMonth) {
      dateInfo = { d: Number(m4[1]), m: Number(m4[2]), y: ctxYear, match: m4[0] };
    }

    if (!dateInfo) {
      if (historyNumbers(raw).length) errors.push('Строка ' + (idx + 1) + ': не понял дату — ' + raw.slice(0, 40));
      return;
    }

    rest = raw.replace(dateInfo.match, ' ');

    if (!dateInfo.m && ctxMonth) dateInfo.m = ctxMonth;
    if (!dateInfo.y && ctxYear) dateInfo.y = ctxYear;
    if (!dateInfo.m) {
      errors.push('Строка ' + (idx + 1) + ': не указан месяц');
      return;
    }

    var date = new Date(dateInfo.y, dateInfo.m - 1, dateInfo.d);
    if (isNaN(date.getTime()) || date.getDate() !== dateInfo.d) {
      errors.push('Строка ' + (idx + 1) + ': некорректная дата');
      return;
    }
    var key = dayKey(date);
    var numbers = historyNumbers(rest).map(function (x) { return Math.round(x.value); }).filter(function (v) { return v >= 0; });
    if (!numbers.length) {
      errors.push('Строка ' + (idx + 1) + ': нет сумм для ' + fmtDate(date));
      return;
    }

    var revenue = numbers[0] || 0;
    var cash = 0, qr = 0, count = 0;

    if (numbers.length === 1) {
      cash = revenue;
    } else if (numbers.length === 2) {
      if (numbers[1] <= 1000 || numbers[1] * 50 < revenue) {           // похоже на число чеков
        count = numbers[1];
        cash = revenue;
      } else {
        cash = numbers[1];
        qr = Math.max(0, revenue - cash);
      }
    } else if (numbers.length === 3) {
      cash = numbers[1];
      qr = numbers[2];
      if (cash + qr !== revenue) {
        // возможно, третье число — количество чеков
        if (numbers[2] <= 1000) {
          qr = Math.max(0, revenue - cash);
          count = numbers[2];
        } else {
          errors.push('Строка ' + (idx + 1) + ': наличные ' + fmtMoney(cash) + ' + QR ' + fmtMoney(qr) + ' ≠ выручка ' + fmtMoney(revenue));
          return;
        }
      }
    } else {
      cash = numbers[1];
      qr = numbers[2];
      count = numbers[3];
      if (cash + qr !== revenue) {
        errors.push('Строка ' + (idx + 1) + ': наличные ' + fmtMoney(cash) + ' + QR ' + fmtMoney(qr) + ' ≠ выручка ' + fmtMoney(revenue));
        return;
      }
    }

    if (cash + qr === 0) { cash = revenue; }
    revenue = cash + qr;
    if (!count) count = Math.max(1, Math.round(revenue / avgCheck));

    if (seen[key]) {
      errors.push('Строка ' + (idx + 1) + ': ' + fmtDate(date) + ' уже указана выше');
      return;
    }
    seen[key] = true;

    days.push({
      key: key,
      date: date.getTime(),
      revenue: revenue,
      cash: cash,
      qr: qr,
      count: count,
      line: idx + 1
    });
  });

  days.sort(function (a, b) { return a.date - b.date; });
  return {
    days: days,
    errors: errors,
    revenue: days.reduce(function (sum, d) { return sum + d.revenue; }, 0),
    receipts: days.reduce(function (sum, d) { return sum + d.count; }, 0)
  };
}

/* ---------- Разбор списка транзакций из старой системы ---------- */

function matchPaymentWord(text) {
  var t = String(text || '').toLowerCase();
  if (/каспи|kaspi|qr/.test(t)) return 'qr';
  if (/смеш|mixed/.test(t)) return 'mixed';
  return 'cash';
}

/** Ищет точку по названию внутри «Услуга/Точка: Гипс. My kids» */
function matchPointFromText(text, points) {
  var t = String(text || '').toLowerCase().replace(/\s+/g, '');
  var found = null;
  (points || []).forEach(function (p) {
    var name = String(p.name || '').toLowerCase().replace(/\s+/g, '');
    if (name && t.indexOf(name) !== -1) {
      if (!found || name.length > String(found.name).length) found = p;
    }
  });
  return found;
}

/** «Аквагримм 1500 × 1 шт, Пряди × 2 шт» → [{name, price, qty}] */
function parseItemsText(text, total) {
  var clean = String(text || '').replace(/\s*шт\.?\s*$/i, '');
  var parts = clean.split(/\s*,\s*/).filter(Boolean);
  var items = [];
  parts.forEach(function (part) {
    var m = part.match(/^(.*?)\s*[×x]\s*(\d+)/i);
    var namePart = m ? m[1] : part;
    var qty = m ? Number(m[2]) : 1;
    var priceMatch = namePart.match(/^(.*?)\s*(\d[\d\s ]*)(?:[.,]\d{1,2})?\s*$/);
    var name = namePart.trim();
    var price = 0;
    if (priceMatch) {
      name = priceMatch[1].trim();
      price = Math.round(Number(String(priceMatch[2]).replace(/\s/g, '').replace(',', '.')) || 0);
    }
    if (!name) return;
    items.push({ name: name, price: price, qty: Math.max(1, Math.round(qty)) });
  });

  // добиваем сумму, чтобы состав совпал с чеком
  if (items.length && total > 0) {
    var known = items.reduce(function (sum, it) { return sum + it.price * it.qty; }, 0);
    var diff = total - known;
    if (diff !== 0) {
      // сначала отдаём остаток позициям без цены («Пряди × 2 шт»), потом остальным
      var zeros = items.filter(function (it) { return !it.price; });
      var withPrice = items.filter(function (it) { return it.price > 0; });
      var target = zeros.length ? zeros : withPrice;
      if (target.length) {
        var perUnit = diff / target.reduce(function (n, it) { return n + it.qty; }, 0);
        target.forEach(function (it) { it.price = Math.max(0, Math.round(it.price + perUnit)); });
      } else {
        var free = items[0];
        free.price = Math.max(0, Math.round(total / free.qty));
      }
      // последняя корректировка до точной суммы
      var sum2 = items.reduce(function (sum, it) { return sum + it.price * it.qty; }, 0);
      if (sum2 !== total) {
        var it0 = items[0];
        it0.price = Math.max(0, it0.price + (total - sum2));
      }
    }
  }
  return items;
}

/**
 * Разбор вставленного списка транзакций:
 * 13:27 — Арина Турланова
 * Услуга/Точка: Аквагримм. Керуен
 * Оплата: Каспи QR
 * Товары: Аквагримм 1500 × 1 шт
 * Сумма: 1 500.00 ₸
 */
function parseTransactionsText(text, opts) {
  opts = opts || {};
  var lines = String(text || '').split(/\r?\n/);
  var transactions = [], errors = [];
  var current = null;
  var dateStr = opts.date || dayKey(new Date());

  function flush() {
    if (!current) return;
    if (!current.total) {
      errors.push('Строка ' + (current.line + 1) + ': не указана сумма — запись «' + current.seller + '» пропущена');
      current = null;
      return;
    }
    var parts = String(dateStr).split('-');
    var ts = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), current.hh, current.mm, 0, 0);
    if (isNaN(ts.getTime())) {
      errors.push('Некорректная дата для записи «' + current.seller + '»');
      current = null;
      return;
    }
    var point = matchPointFromText(current.pointRaw, DB.points);
    transactions.push({
      at: ts.getTime(),
      seller: current.seller,
      pointRaw: current.pointRaw,
      pointId: point ? point.id : null,
      pointName: point ? point.name : (current.pointRaw || ''),
      payment: current.payment,
      items: parseItemsText(current.itemsRaw, current.total),
      total: Math.round(current.total),
      cashAmount: current.payment === 'cash' ? Math.round(current.total) : 0,
      qrAmount: current.payment === 'qr' ? Math.round(current.total) : 0,
      line: current.line
    });
    current = null;
  }

  lines.forEach(function (line, idx) {
    var raw = String(line || '').trim();
    if (!raw) return;

    var timeMatch = raw.match(/^(\d{1,2}):(\d{2})\s*[—–-]\s*(.+)$/);
    if (timeMatch) {
      flush();
      current = {
        hh: Math.min(23, Number(timeMatch[1])),
        mm: Math.min(59, Number(timeMatch[2])),
        seller: timeMatch[3].trim(),
        pointRaw: '', payment: 'cash', itemsRaw: '', total: 0, line: idx
      };
      return;
    }
    if (!current) return;

    var m;
    if ((m = raw.match(/^(?:услуга\s*\/?\s*точка|точка|услуга)\s*:\s*(.+)$/i))) { current.pointRaw = m[1].trim(); return; }
    if ((m = raw.match(/^оплата\s*:\s*(.+)$/i))) { current.payment = matchPaymentWord(m[1]); return; }
    if ((m = raw.match(/^товары\s*:\s*(.+)$/i))) { current.itemsRaw = m[1].trim(); return; }
    if ((m = raw.match(/^сумма\s*:\s*([\d\s ]+(?:[.,]\d{1,2})?)\s*(?:₸|тг|tenge)?$/i))) {
      current.total = Math.round(Number(String(m[1]).replace(/\s/g, '').replace(',', '.')) || 0);
      return;
    }
  });
  flush();

  return {
    transactions: transactions,
    errors: errors,
    revenue: transactions.reduce(function (sum, t) { return sum + t.total; }, 0),
    receipts: transactions.length
  };
}

/** Заносит разобранные транзакции как продажи (склад не трогает) */
function importTransactions(list, opts) {
  opts = opts || {};
  var actor = opts.actor || currentUser();
  if (!actor || (actor.role !== 'admin' && actor.role !== 'dev')) {
    return { error: 'Вносить историю может администратор или разработчик' };
  }
  if (!Array.isArray(list) || !list.length) return { error: 'Нет транзакций для импорта' };

  var todayStart = startOfDay(new Date());
  var replace = opts.replace !== false;
  var daysToClear = {};

  list.forEach(function (t) { if (t.at < todayStart) daysToClear[dayKey(new Date(t.at))] = true; });

  // сводные «заглушки» этих дней убираем всегда — иначе они сложатся с транзакциями
  var removed = DB.sales.filter(function (s) {
    return isHistoryStub(s) && daysToClear[dayKey(s.createdAt)];
  }).length;
  if (removed) {
    DB.sales = DB.sales.filter(function (s) { return !(isHistoryStub(s) && daysToClear[dayKey(s.createdAt)]); });
  }
  if (replace && Object.keys(daysToClear).length) {
    var beforeReplace = DB.sales.length;
    DB.sales = DB.sales.filter(function (s) {
      if (!s.historyImport) return true;
      return !daysToClear[dayKey(s.createdAt)];
    });
    removed += beforeReplace - DB.sales.length;
  }

  var created = 0, skipped = 0, revenue = 0;
  if (!DB.settings.historyImports || typeof DB.settings.historyImports !== 'object') DB.settings.historyImports = {};

  list.forEach(function (t) {
    if (!(t.at < todayStart) || !(t.total > 0)) { skipped++; return; }

    var seller = null;
    var needle = String(t.seller || '').trim().toLowerCase();
    if (needle) {
      seller = DB.users.find(function (u) { return String(u.fullName || '').trim().toLowerCase() === needle; }) || null;
      if (!seller) {
        var short = needle.split(' ')[0];
        var byFirst = DB.users.filter(function (u) { return String(u.fullName || '').toLowerCase().indexOf(short) === 0; });
        if (byFirst.length === 1) seller = byFirst[0];
      }
    }

    var items = (t.items || []).map(function (it) {
      var product = DB.products.find(function (p) { return String(p.name).trim().toLowerCase() === String(it.name).trim().toLowerCase(); });
      return { productId: product ? product.id : null, name: it.name, price: it.price, qty: it.qty };
    });

    DB.sales.push({
      id: uid(),
      code: shortId(),
      userId: seller ? seller.id : actor.id,
      userName: seller ? seller.fullName : (t.seller || actor.fullName),
      pointId: t.pointId || null,
      pointName: t.pointName || '',
      items: items,
      total: Math.round(t.total),
      payment: t.payment === 'qr' ? 'qr' : (t.payment === 'mixed' ? 'mixed' : 'cash'),
      cashAmount: t.cashAmount || 0,
      qrAmount: t.qrAmount || 0,
      receipt: null,
      imported: true,
      historyImport: true,
      note: 'История до внедрения',
      createdAt: t.at,
      updatedAt: Date.now()
    });
    created++;
    revenue += Math.round(t.total);
  });

  rebuildHistoryImports();
  DB.settings.updatedAt = Date.now();
  saveDB();
  return { created: created, removed: removed, skipped: skipped, revenue: revenue };
}

/** Проверяет, похож ли текст на список транзакций */
function looksLikeTransactions(text) {
  return /^\s*\d{1,2}:\d{2}\s*[—–-]/m.test(String(text || '')) && /оплата\s*:/i.test(String(text || ''));
}

/**
 * Заносит историю продаж: каждая строка — день со сводными суммами.
 * Склад не трогается, товары не списываются: это только выручка прошлых дней.
 */
function importHistoryDays(days, opts) {
  opts = opts || {};
  var actor = opts.actor || currentUser();
  if (!actor || (actor.role !== 'admin' && actor.role !== 'dev')) {
    return { error: 'Вносить историю может администратор или разработчик' };
  }
  if (!Array.isArray(days) || !days.length) return { error: 'Нет строк для импорта' };

  var replace = opts.replace !== false;
  var pointId = opts.pointId || null;
  var point = pointId ? getPoint(pointId) : null;
  var todayStart = startOfDay(new Date());
  var created = 0, removed = 0, skipped = 0, revenue = 0, receipts = 0;

  if (!DB.settings.historyImports || typeof DB.settings.historyImports !== 'object') DB.settings.historyImports = {};

  days.forEach(function (day) {
    var key = day.key || dayKey(new Date(day.date));
    var at = startOfDay(new Date(day.date));
    if (at >= todayStart) { skipped++; return; }
    if (!(day.revenue > 0)) { skipped++; return; }

    var had = DB.sales.some(function (s) { return s.historyImport && dayKey(s.createdAt) === key; });
    if (had && !replace) { skipped++; return; }
    if (had) {
      var before = DB.sales.length;
      DB.sales = DB.sales.filter(function (s) { return !(s.historyImport && dayKey(s.createdAt) === key); });
      removed += before - DB.sales.length;
    }

    var count = Math.max(1, Math.min(400, Math.round(day.count || 1)));
    var cash = Math.round(day.cash || 0);
    var qr = Math.round(day.qr || 0);
    var total = cash + qr;
    if (!total) { cash = total = Math.round(day.revenue); }

    var nCash = total ? Math.round(count * cash / total) : count;
    var nQr = count - nCash;
    if (nQr < 0) { nCash = count; nQr = 0; }
    if (!qr) { nCash = count; nQr = 0; }
    if (!cash) { nCash = 0; nQr = count; }

    function spread(totalSum, n) {
      var list = [], base = Math.floor(totalSum / Math.max(1, n));
      for (var i = 0; i < n; i++) list.push(base);
      var rest = totalSum - base * n;
      if (list.length) list[list.length - 1] += rest;
      return list;
    }

    var cashParts = spread(cash, nCash);
    var qrParts = spread(qr, nQr);
    var all = cashParts.map(function (v) { return { total: v, payment: 'cash' }; })
      .concat(qrParts.map(function (v) { return { total: v, payment: 'qr' }; }))
      .filter(function (r) { return r.total > 0; });

    all.forEach(function (rec, i) {
      var ts = new Date(at);
      var step = Math.floor(10 * 60 / Math.max(1, all.length));
      ts.setHours(9 + Math.floor((i * 11 * 60 / Math.max(1, all.length)) / 60), (i * 7) % 60, 0, 0);
      DB.sales.push({
        id: uid(),
        code: shortId(),
        userId: actor.id,
        userName: actor.fullName,
        pointId: pointId,
        pointName: point ? point.name : 'Сводно',
        items: [],
        total: rec.total,
        payment: rec.payment,
        cashAmount: rec.payment === 'cash' ? rec.total : 0,
        qrAmount: rec.payment === 'qr' ? rec.total : 0,
        receipt: null,
        imported: true,
        historyImport: true,
        note: 'История до внедрения',
        createdAt: ts.getTime(),
        updatedAt: Date.now()
      });
      created++;
    });

    revenue += total;
    receipts += count;
    DB.settings.historyImports[key] = { revenue: total, cash: cash, qr: qr, count: count, at: Date.now() };
  });

  rebuildHistoryImports();
  DB.settings.updatedAt = Date.now();
  saveDB();
  return { created: created, removed: removed, skipped: skipped, revenue: revenue, receipts: receipts };
}

/* ---------- Корректировка показателей и удаление продаж (разработчик) ---------- */

/** Править можно только дни строго до этой даты */
var ADJUST_LIMIT_KEY = '2026-10-22';

function canAdjustDay(key) {
  var k = String(key || '');
  if (!parseDayKey(k)) return false;
  return k < ADJUST_LIMIT_KEY;
}

function dayAdjustments() {
  if (!DB.settings.dayAdjustments || typeof DB.settings.dayAdjustments !== 'object') DB.settings.dayAdjustments = {};
  return DB.settings.dayAdjustments;
}

function getDayAdjustment(key) {
  return dayAdjustments()[String(key)] || null;
}

function dayAdjustmentsInRange(from, to) {
  var map = dayAdjustments();
  var out = [];
  Object.keys(map).forEach(function (k) {
    var d = parseDayKey(k);
    if (!d) return;
    var t = startOfDay(d);
    if (t < startOfDay(new Date(from)) || t > endOfDay(new Date(to))) return;
    out.push({ key: k, data: map[k] });
  });
  return out;
}

/** Что за день сейчас: сколько записей, сколько из них история и заглушки */
function dayEditSummary(key) {
  var d = parseDayKey(key);
  if (!d) return null;
  var from = startOfDay(d), to = endOfDay(d);
  var sales = DB.sales.filter(function (s) { return s.createdAt >= from && s.createdAt <= to && !s.cancelled; });
  var history = sales.filter(function (s) { return s.historyImport; });
  var stubs = sales.filter(isHistoryStub);
  var stats = summarize(from, to);
  return {
    key: key,
    canEdit: canAdjustDay(key),
    sales: sales.length,
    history: history.length,
    stubs: stubs.length,
    own: sales.length - history.length,
    revenue: stats.revenue,
    expenses: stats.expenses,
    profit: stats.profit,
    avgCheck: stats.avgCheck,
    cash: stats.cashTotal,
    qr: stats.qrTotal,
    mixed: stats.mixedTotal,
    count: stats.salesCount,
    adjustment: getDayAdjustment(key)
  };
}

/** Сохраняет корректировку показателей за день (только дни до 22.10.2026) */
function setDayAdjustment(actor, key, patch, opts) {
  opts = opts || {};
  if (!actor || actor.role !== 'dev') return { error: 'Менять показатели может только разработчик' };
  if (!canAdjustDay(key)) return { error: 'Можно править только дни до 22.10.2026' };
  var d = parseDayKey(key);
  if (!d) return { error: 'Некорректная дата' };

  var clean = {};
  ['revenue', 'expenses', 'profit', 'avgCheck', 'cash', 'qr', 'mixed'].forEach(function (f) {
    if (patch && patch[f] !== undefined && patch[f] !== null && patch[f] !== '') {
      var v = Math.round(Number(patch[f]));
      if (!isFinite(v)) return;
      clean[f] = v;
    }
  });
  if (!Object.keys(clean).length && !opts.replace) return { error: 'Нечего сохранять — заполните хотя бы одно поле' };

  var map = dayAdjustments();
  var prev = opts.replace ? {} : (map[key] || {});
  var next = {};
  Object.keys(prev).forEach(function (k) { if (k !== 'at' && k !== 'by') next[k] = prev[k]; });
  Object.keys(clean).forEach(function (k) { next[k] = clean[k]; });
  if (!Object.keys(next).length) {
    if (map[key]) delete map[key];
    DB.settings.updatedAt = Date.now();
    saveDB();
    return { ok: true, key: key, adjustment: null };
  }
  next.at = Date.now();
  next.by = actor.fullName || actor.username || 'dev';
  map[key] = next;

  DB.settings.updatedAt = Date.now();
  saveDB();
  return { ok: true, key: key, adjustment: next };
}

function resetDayAdjustment(actor, key) {
  if (!actor || actor.role !== 'dev') return { error: 'Менять показатели может только разработчик' };
  if (!canAdjustDay(key)) return { error: 'Можно править только дни до 22.10.2026' };
  var map = dayAdjustments();
  if (!map[key]) return { removed: 0 };
  delete map[key];
  DB.settings.updatedAt = Date.now();
  saveDB();
  return { removed: 1 };
}

/**
 * Удаляет продажи за день. Склад не трогает — это прошлые данные.
 * opts.onlyHistory — только записи истории (транзакции + заглушки)
 * opts.onlyStubs   — только сводные заглушки
 */
function deleteDaySales(actor, key, opts) {
  opts = opts || {};
  if (!actor || actor.role !== 'dev') return { error: 'Удалять продажи может только разработчик' };
  if (!canAdjustDay(key)) return { error: 'Можно править только дни до 22.10.2026' };
  var d = parseDayKey(key);
  if (!d) return { error: 'Некорректная дата' };
  var from = startOfDay(d), to = endOfDay(d);

  var target = DB.sales.filter(function (s) {
    if (s.createdAt < from || s.createdAt > to) return false;
    if (opts.onlyStubs) return isHistoryStub(s);
    if (opts.onlyHistory) return !!s.historyImport;
    return true;
  });
  if (!target.length) return { removed: 0, revenue: 0 };

  var ids = {};
  target.forEach(function (s) { ids[s.id] = true; });
  var revenue = target.reduce(function (sum, s) { return sum + (s.total || 0); }, 0);
  DB.sales = DB.sales.filter(function (s) { return !ids[s.id]; });

  if (typeof rebuildHistoryImports === 'function') rebuildHistoryImports();
  DB.settings.updatedAt = Date.now();
  saveDB();
  return { removed: target.length, revenue: revenue };
}

/** Сводная запись без состава — «заглушка» из режима «цифры по дням» */
function isHistoryStub(sale) {
  if (!sale) return false;
  if (!sale.historyImport && !sale.imported) return false;
  return !sale.items || !sale.items.length;
}

/** Сколько заглушек и на какую сумму */
function historyStubSummary() {
  var stubs = DB.sales.filter(isHistoryStub);
  var days = {};
  stubs.forEach(function (s) { days[dayKey(s.createdAt)] = true; });
  return {
    count: stubs.length,
    days: Object.keys(days).length,
    revenue: stubs.reduce(function (sum, s) { return sum + (s.total || 0); }, 0)
  };
}

/** Пересобирает индекс внесённой истории по фактическим записям */
function rebuildHistoryImports() {
  var map = {};
  DB.sales.forEach(function (s) {
    if (!s.historyImport) return;
    var key = dayKey(s.createdAt);
    var rec = map[key] || (map[key] = { revenue: 0, cash: 0, qr: 0, count: 0, at: Date.now() });
    rec.revenue += s.total || 0;
    rec.cash += s.cashAmount || 0;
    rec.qr += s.qrAmount || 0;
    rec.count += 1;
  });
  DB.settings.historyImports = map;
  return map;
}

/** Убирает только заглушки (сводные записи без состава), обычные продажи и транзакции остаются */
function clearHistoryStubs(actor) {
  if (!actor || (actor.role !== 'admin' && actor.role !== 'dev')) return { error: 'Нет прав' };
  var before = historyStubSummary();
  if (!before.count) return { removed: 0, revenue: 0 };
  DB.sales = DB.sales.filter(function (s) { return !isHistoryStub(s); });
  if (Array.isArray(DB.settings.importedRanges)) {
    DB.settings.importedRanges = DB.settings.importedRanges.filter(function (range) {
      var parts = String(range).split('..');
      var from = parseDayKey(parts[0]), to = parseDayKey(parts[1] || parts[0]);
      if (!from || !to) return false;
      return DB.sales.some(function (s) {
        return s.imported && s.createdAt >= startOfDay(from) && s.createdAt <= endOfDay(to);
      });
    });
  }
  rebuildHistoryImports();
  DB.settings.updatedAt = Date.now();
  saveDB();
  return { removed: before.count, revenue: before.revenue };
}

/** Сводка по внесённой истории — для карточки в настройках */
function historyImportSummary() {
  var map = (DB.settings && DB.settings.historyImports) || {};
  var keys = Object.keys(map).sort();
  var revenue = keys.reduce(function (sum, k) { return sum + (map[k].revenue || 0); }, 0);
  var receipts = keys.reduce(function (sum, k) { return sum + (map[k].count || 0); }, 0);
  return {
    days: keys.length,
    revenue: revenue,
    receipts: receipts,
    from: keys[0] || null,
    to: keys[keys.length - 1] || null
  };
}

function clearHistoryImports(actor) {
  if (!actor || (actor.role !== 'admin' && actor.role !== 'dev')) return { error: 'Нет прав' };
  var removed = DB.sales.filter(function (s) { return s.historyImport; }).length;
  var revenue = DB.sales.reduce(function (sum, s) { return sum + (s.historyImport ? (s.total || 0) : 0); }, 0);
  DB.sales = DB.sales.filter(function (s) { return !s.historyImport; });
  DB.settings.historyImports = {};
  DB.settings.updatedAt = Date.now();
  saveDB();
  return { removed: removed, revenue: revenue };
}

/* ---------- Перенос остатков склада по точкам ---------- */
function normalizeProductKey(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ').replace(/\.$/, '');
}

function findProductByName(name) {
  var key = normalizeProductKey(name);
  if (!key) return null;
  var exact = DB.products.filter(function (p) { return normalizeProductKey(p.name) === key; });
  if (exact.length) return exact[0];
  var loose = DB.products.filter(function (p) { return normalizeProductKey(p.name).indexOf(key) === 0; });
  return loose.length ? loose[0] : null;
}

function pointNameKey(name) {
  return String(name || '').toLowerCase().replace(/[\s·.,\-–—_]+/g, '');
}

var POINT_NAME_ALIASES = {
  'керуен': ['керуен', 'keruen', 'keruenplaza', 'керуенплаза'],
  'sky': ['sky', 'скай', 'skyplaza'],
  'mykids': ['mykids', 'mýkids', 'майкидс', 'mykid'],
  'dalidaplaza': ['dalidaplaza', 'далидаплаза', 'далида'],
  'elegantpark': ['elegantpark', 'элегантпарк', 'элегант']
};

function pointAliasKeys(name) {
  var key = pointNameKey(name);
  var out = [key];
  Object.keys(POINT_NAME_ALIASES).forEach(function (canon) {
    if (POINT_NAME_ALIASES[canon].indexOf(key) === -1) return;
    out = out.concat(POINT_NAME_ALIASES[canon]);
  });
  return out.filter(function (v, i, arr) { return v && arr.indexOf(v) === i; });
}

function findPointByName(name) {
  var keys = pointAliasKeys(name);
  if (!keys.length) return null;
  for (var i = 0; i < keys.length; i++) {
    var found = DB.points.filter(function (p) { return pointNameKey(p.name) === keys[i]; })[0];
    if (found) return found;
  }
  return null;
}

// какие точки старой системы должны получить эти имена
var LEGACY_POINT_TARGETS = {
  'Керуен · Аквагрим': 'Керуен',
  'Керуен · Косички': 'Керуен',
  'Аквагрим Керуен': 'Керуен',
  'Косички Керуен': 'Керуен',
  'Sky · Косички': 'Sky',
  'Sky · Гипс': 'Sky',
  'Косички Sky': 'Sky',
  'Гипс Sky': 'Sky',
  'My Kids · Косички': 'My Kids',
  'My Kids · Гипс': 'My Kids',
  'Косички MyKids': 'My Kids',
  'Гипс MyKids': 'My Kids',
  'Dalida Plaza': 'Dalida Plaza',
  'Elegant Park': 'Elegant Park'
};

// существующую точку ищем без учёта регистра, пробелов и знаков
function findExistingPoint(name) {
  return findPointByName(name);
}

function ensurePoint(name) {
  var existing = findPointByName(name);
  if (existing) return { point: existing, created: false };
  var point = {
    id: uid(),
    name: name,
    address: '',
    lat: null,
    lng: null,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  DB.points.push(point);
  return { point: point, created: true };
}

function mergePointInto(fromPoint, toPoint) {
  var stamp = Date.now();
  var drop = [];
  DB.stock.forEach(function (row) {
    if (row.pointId !== fromPoint.id) return;
    var target = stockRow(toPoint.id, row.productId);
    if (target && target.id !== row.id) {
      target.qty += row.qty;
      target.history = (target.history || []).concat(row.history || []).sort(function (a, b) { return b.at - a.at; }).slice(0, 150);
      target.updatedAt = stamp;
      drop.push(row.id);
    } else {
      row.pointId = toPoint.id;
      row.updatedAt = stamp;
    }
  });
  if (drop.length) DB.stock = DB.stock.filter(function (r) { return drop.indexOf(r.id) === -1; });

  DB.products.forEach(function (pr) {
    if (!Array.isArray(pr.pointIds)) return;
    var had = pr.pointIds.indexOf(fromPoint.id) !== -1;
    if (!had) return;
    pr.pointIds = pr.pointIds.filter(function (id) { return id !== fromPoint.id; });
    if (pr.pointIds.indexOf(toPoint.id) === -1) pr.pointIds.push(toPoint.id);
    pr.updatedAt = stamp;
  });

  DB.sales.forEach(function (sale) {
    if (sale.pointId !== fromPoint.id) return;
    sale.pointId = toPoint.id;
    sale.pointName = toPoint.name;
  });
  DB.expenses.forEach(function (exp) {
    if (exp.pointId !== fromPoint.id) return;
    exp.pointId = toPoint.id;
    exp.pointName = toPoint.name;
  });
  DB.supplies.forEach(function (sp) {
    if (sp.pointId !== fromPoint.id) return;
    sp.pointId = toPoint.id;
    sp.pointName = toPoint.name;
  });
  DB.users.forEach(function (u) {
    if (Array.isArray(u.pointIds)) {
      u.pointIds = u.pointIds.map(function (id) { return id === fromPoint.id ? toPoint.id : id; })
        .filter(function (id, i, arr) { return arr.indexOf(id) === i; });
    }
    if (u.pointId === fromPoint.id) u.pointId = toPoint.id;
  });
  DB.points = DB.points.filter(function (p) { return p.id !== fromPoint.id; });
}

function migrateLegacyPointNames() {
  var changed = 0;
  Object.keys(LEGACY_POINT_TARGETS).forEach(function (oldName) {
    var target = LEGACY_POINT_TARGETS[oldName];
    var stale = DB.points.filter(function (p) { return pointNameKey(p.name) === pointNameKey(oldName); });
    if (!stale.length) return;

    var main = findPointByName(target);
    stale.forEach(function (point) {
      if (pointNameKey(point.name) === pointNameKey(target)) return; // уже целевая
      if (!main) {
        point.name = target;
        point.updatedAt = Date.now();
        main = point;
        changed++;
        return;
      }
      mergePointInto(point, main);
      changed++;
    });
  });
  if (changed) {
    DB.sales.forEach(function (sale) {
      var point = getPoint(sale.pointId);
      if (point) sale.pointName = point.name;
    });
    DB.supplies.forEach(function (sp) {
      var point = getPoint(sp.pointId);
      if (point) sp.pointName = point.name;
    });
    DB.expenses.forEach(function (exp) {
      var point = getPoint(exp.pointId);
      if (point) exp.pointName = point.name;
    });
    saveDB();
  }
  return changed;
}

function legacyStockSummary() {
  var data = window.POS_IMPORT_DATA;
  var blocks = data && Array.isArray(data.stock) ? data.stock : [];
  var res = { points: blocks.length, positions: 0, qty: 0, date: data ? data.stockDate : null };
  blocks.forEach(function (b) {
    res.positions += b.items.length;
    res.qty += b.items.reduce(function (n, it) { return n + (it.qty || 0); }, 0);
  });
  return res;
}

function applyLegacyStock(options) {
  options = options || {};
  var data = window.POS_IMPORT_DATA;
  var blocks = data && Array.isArray(data.stock) ? data.stock : [];
  if (!blocks.length) throw new Error('Нет данных об остатках');
  var actor = options.actor || currentUser();
  if (!actor) throw new Error('Сначала войдите в аккаунт');

  var reportDay = startOfDay(parseDateInput(data.stockDate, Date.now()));
  var note = 'Перенос остатков из старой системы' + (data.stockDate ? ' (' + fmtDate(reportDay) + ')' : '');
  // остаток из отчёта — это состояние на начало дня отчёта (конец предыдущего дня)
  var stamp = reportDay - 1;
  var res = { pointsCreated: 0, points: 0, rows: 0, qty: 0, skipped: 0, missing: [], hidden: [] };
  var availability = {};
  var hidden = [];

  blocks.forEach(function (block) {
    var point = findPointByName(block.point);
    if (!point) {
      point = {
        id: uid(),
        name: block.point,
        address: '',
        lat: null,
        lng: null,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      DB.points.push(point);
      res.pointsCreated++;
    }
    res.points++;

    block.items.forEach(function (item) {
      var product = findProductByName(item.name);
      if (!product) {
        if (res.missing.indexOf(item.name) === -1) res.missing.push(item.name);
        return;
      }
      if (!availability[product.id]) availability[product.id] = [];
      availability[product.id].push(point.id);

      var row = stockRow(point.id, product.id);
      if (row) { res.skipped++; return; }
      setStockQty(point.id, product.id, item.qty, note, actor, stamp);
      res.rows++;
      res.qty += item.qty;
    });
  });

  // дубли с другой ценой («Пион · 1200») показываем только там, где у них есть свой остаток
  DB.products.forEach(function (product) {
    if (product.variant || availability[product.id]) return;
    var full = String(product.name || '').trim();
    var base = full.split(' · ')[0].trim().toLowerCase();
    if (base === full.toLowerCase()) return;
    DB.products.forEach(function (other) {
      if (other.id === product.id || !availability[other.id]) return;
      if (String(other.name || '').split(' · ')[0].trim().toLowerCase() !== base) return;
      if (!availability[product.id]) availability[product.id] = availability[other.id].slice();
    });
  });

  // товар продаётся только на тех точках, где были остатки в старой системе
  DB.products.forEach(function (product) {
    var ids = availability[product.id];
    if (!ids) {
      if (!product.variant) hidden.push(product.name);
      product.pointIds = [];
      product.stockLimited = true;
      product.updatedAt = Date.now();
      return;
    }
    var merged = [];
    ids.forEach(function (id) { if (merged.indexOf(id) === -1) merged.push(id); });
    product.pointIds = merged;
    product.stockLimited = true;
    product.updatedAt = Date.now();
  });

  // точка-заглушка со сводными продажами старой системы получает понятное имя
  DB.points.forEach(function (p) {
    if (String(p.name || '').trim() !== 'Основная точка') return;
    var hasStock = DB.stock.some(function (r) { return r.pointId === p.id; });
    var hasProducts = DB.products.some(function (pr) {
      return Array.isArray(pr.pointIds) && pr.pointIds.indexOf(p.id) !== -1;
    });
    if (!hasStock && !hasProducts) {
      p.name = 'Старая система (сводно)';
      p.updatedAt = Date.now();
    }
  });

  res.hidden = hidden;
  DB.settings.legacyStockApplied = Date.now();
  DB.settings.legacyStockDate = data.stockDate || null;
  DB.settings.updatedAt = Date.now();
  saveDB();
  return res;
}

/* ---------- Резервные копии ---------- */
function exportBackup() {
  return {
    app: APP_CONFIG.name,
    version: APP_CONFIG.version,
    exportedAt: new Date().toISOString(),
    data: DB
  };
}

function importBackup(payload) {
  var data = payload && payload.data ? payload.data : payload;
  if (!data || !Array.isArray(data.users) || !Array.isArray(data.sales)) {
    throw new Error('Файл резервной копии повреждён или имеет неверный формат');
  }
  DB = normalizeDB(data);
  saveDB();
  return DB;
}

/* ---------- Инициализация ---------- */
function ensureTimestamps() {
  var changed = false;
  ['users', 'points', 'categories', 'products', 'stock', 'sales', 'expenses', 'time'].forEach(function (collection) {
    (DB[collection] || []).forEach(function (row) {
      if (!row.updatedAt) {
        row.updatedAt = row.createdAt || Date.now();
        changed = true;
      }
    });
  });
  (DB.users || []).forEach(function (u) {
    var ids = Array.isArray(u.pointIds) ? u.pointIds.filter(Boolean) : [];
    if (!ids.length && u.pointId) ids = [u.pointId];
    var normalized = ids.filter(function (id) { return DB.points.some(function (p) { return p.id === id; }); });
    var changedUser = false;
    if (!Array.isArray(u.pointIds) || u.pointIds.length !== normalized.length) changedUser = true;
    if (u.pointId !== (normalized[0] || null)) changedUser = true;
    if (changedUser) {
      u.pointIds = normalized;
      u.pointId = normalized[0] || null;
      u.updatedAt = u.updatedAt || Date.now();
      changed = true;
    }
  });
  if (!DB.settings.updatedAt) {
    DB.settings.updatedAt = DB.createdAt || Date.now();
    changed = true;
  }
  if (changed) saveDB();
}

function cleanupLegacyDemoData() {
  if (!DB.settings || !DB.settings.demoLoaded) return false;
  // свежие тестовые данные (генератор автотестов) не трогаем
  if (DB.settings.demoCleanupDone) return false;
  // Демо-режима больше нет: один раз вычищаем оставшиеся демо-записи.
  // Реальные записи не помечены demo:true, их уборка не затрагивает.
  clearDemoData();
  DB.settings.demoLoaded = false;
  DB.settings.demoCleanupDone = true;
  DB.settings.updatedAt = Date.now();
  if (DB.session && !DB.users.some(function (u) { return u.id === DB.session.userId; })) {
    DB.session = null;
  }
  saveDB();
  return true;
}

function initCore() {
  loadDB();
  cleanupExpiredData();
  cleanupLegacyDemoData();
  ensureTimestamps();
  ensureSaleChanges();
  migrateLegacyPointNames();
  migrateUnassignedProducts();
  initTheme();
}

/* Экспорт в Node для тестов */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { APP_CONFIG: APP_CONFIG };
}
