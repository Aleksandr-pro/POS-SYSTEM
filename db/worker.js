/**
 * POS Контроль — API на Cloudflare Workers + D1.
 * Один файл, без зависимостей. Разворачивается вставкой в редактор Worker
 * или командой `wrangler deploy`.
 *
 * Переменные окружения:
 *   DB          — привязка D1 (обязательно)
 *   JWT_SECRET  — секрет подписи токенов (обязательно, длинная случайная строка)
 *   APP_VERSION — необязательно
 */

const API_VERSION = '1.0.0';
const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;      // 30 дней
const MAX_BODY_BYTES = 2 * 1024 * 1024;           // 2 МБ на запрос синхронизации
const SYNC_OVERLAP_MS = 10 * 60 * 1000;           // перекрытие по времени при выборке
const PULL_LIMIT = 1200;

const COLLECTIONS = ['users', 'points', 'categories', 'products', 'stock', 'supplies', 'sales', 'saleChanges', 'expenses', 'time', 'stockChecks', 'settings'];
const SELLER_COLLECTIONS = ['sales', 'saleChanges', 'expenses', 'time', 'stock', 'stockChecks'];
const DEV_FORBIDDEN_COLLECTIONS = ['sales', 'expenses'];

/* ============================ утилиты ============================ */

const enc = new TextEncoder();

function json(data, status, extraHeaders) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: Object.assign({
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }, extraHeaders || {})
  });
}

function corsHeaders(request) {
  const origin = request.headers.get('Origin') || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}

function withCors(response, request) {
  const headers = new Headers(response.headers);
  const extra = corsHeaders(request);
  Object.keys(extra).forEach(function (k) { headers.set(k, extra[k]); });
  return new Response(response.body, { status: response.status, headers: headers });
}

function b64urlEncode(bytes) {
  let binary = '';
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) binary += String.fromCharCode(arr[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(str) {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  const binary = atob(str.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function randomToken(bytes) {
  const buf = new Uint8Array(bytes || 16);
  crypto.getRandomValues(buf);
  return b64urlEncode(buf);
}

function uid(prefix) {
  return (prefix || 'id') + '-' + Date.now().toString(36) + '-' + randomToken(6);
}

function nowMs() { return Date.now(); }

/* ============================ пароли ============================ */

/**
 * Пароль «перчится» HMAC-SHA256 с серверным секретом JWT_SECRET,
 * затем растягивается PBKDF2-SHA256.
 *
 * Почему 10 000 итераций, а не 100 000: бесплатный тариф Workers даёт 10 мс CPU
 * на запрос, а 100 000 итераций занимают ~23 мс — вход падает с ошибкой 1102.
 * Секретный «перец» компенсирует короткую растяжку: без JWT_SECRET по украденной
 * базе пароли не перебрать. Формат pbkdf2$<итерации>$<соль>$<хеш> хранит число
 * итераций, поэтому стоимость можно поднять позже без сброса паролей.
 */
const PBKDF2_ITERATIONS = 10000;

async function pepperPassword(password, env) {
  const secret = (env && env.JWT_SECRET) || 'pos-kontrol-pepper';
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(String(password)));
  return new Uint8Array(mac);
}

async function pbkdf2Bits(passwordBytes, salt, iterations) {
  const keyMaterial = await crypto.subtle.importKey('raw', passwordBytes, 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt, iterations: iterations, hash: 'SHA-256' },
    keyMaterial,
    256
  );
}

async function hashPassword(password, env) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const peppered = await pepperPassword(password, env);
  const bits = await pbkdf2Bits(peppered, salt, PBKDF2_ITERATIONS);
  return 'pbkdf2$' + PBKDF2_ITERATIONS + '$' + b64urlEncode(salt) + '$' + b64urlEncode(bits);
}

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function verifyPassword(password, stored, env) {
  if (!stored || stored.indexOf('pbkdf2$') !== 0) return false;
  const parts = stored.split('$');
  const iterations = parseInt(parts[1], 10);
  if (!iterations || iterations > 100000) return false;
  const salt = b64urlDecode(parts[2]);
  const expected = parts[3];
  const peppered = await pepperPassword(password, env);
  const bits = await pbkdf2Bits(peppered, salt, iterations);
  return timingSafeEqual(b64urlEncode(bits), expected);
}

/* ============================ токены ============================ */

async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

async function signToken(payload, secret) {
  const header = b64urlEncode(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const body = b64urlEncode(enc.encode(JSON.stringify(payload)));
  const data = header + '.' + body;
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return data + '.' + b64urlEncode(sig);
}

async function verifyToken(token, secret) {
  if (!token || token.split('.').length !== 3) return null;
  const parts = token.split('.');
  const data = parts[0] + '.' + parts[1];
  const key = await hmacKey(secret);
  const valid = await crypto.subtle.verify('HMAC', key, b64urlDecode(parts[2]), enc.encode(data));
  if (!valid) return null;
  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[1])));
  } catch (e) {
    return null;
  }
  if (!payload || !payload.exp || payload.exp < Math.floor(nowMs() / 1000)) return null;
  return payload;
}

/* ============================ D1 helpers ============================ */

async function getUserRecord(env, id) {
  const row = await env.DB.prepare(
    "SELECT id, data, updated_at, deleted_at FROM records WHERE collection='users' AND id=?"
  ).bind(id).first();
  if (!row || row.deleted_at) return null;
  try {
    const user = JSON.parse(row.data);
    user.updatedAt = row.updated_at;
    return user;
  } catch (e) {
    return null;
  }
}

async function findUserByUsername(env, username) {
  const row = await env.DB.prepare(
    "SELECT id, data FROM records WHERE collection='users' AND lower(json_extract(data,'$.username'))=lower(?) AND deleted_at IS NULL LIMIT 1"
  ).bind(String(username || '').trim()).first();
  if (!row) return null;
  try {
    return JSON.parse(row.data);
  } catch (e) {
    return null;
  }
}

async function countUsers(env) {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM records WHERE collection='users' AND deleted_at IS NULL"
  ).first();
  return row ? Number(row.n) : 0;
}

async function countAdmins(env) {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM records WHERE collection='users' AND deleted_at IS NULL AND json_extract(data,'$.role')='admin'"
  ).first();
  return row ? Number(row.n) : 0;
}

async function audit(env, actor, action, collection, entityId, ip) {
  try {
    await env.DB.prepare(
      'INSERT INTO audit_log (id, user_id, user_name, action, collection, entity_id, ip, created_at) VALUES (?,?,?,?,?,?,?,?)'
    ).bind(uid('audit'), actor ? actor.id : null, actor ? actor.fullName : null, action,
      collection || null, entityId || null, ip || null, nowMs()).run();
  } catch (e) { /* журнал не должен ломать основной запрос */ }
}

/* ============================ авторизация запроса ============================ */

async function authenticate(request, env) {
  const header = request.headers.get('Authorization') || '';
  const token = header.indexOf('Bearer ') === 0 ? header.slice(7).trim() : '';
  if (!env.JWT_SECRET) return { error: 'На сервере не задан JWT_SECRET', status: 500 };
  const payload = await verifyToken(token, env.JWT_SECRET);
  if (!payload) return { error: 'Требуется авторизация (токен недействителен)', status: 401 };
  const user = await getUserRecord(env, payload.sub);
  if (!user) return { error: 'Пользователь не найден или удалён', status: 401 };
  return { user: user, token: token };
}

/* ============================ регистрация и вход ============================ */

function publicUser(user) {
  const copy = Object.assign({}, user);
  delete copy.pass;
  return copy;
}

async function handleRegister(request, env) {
  const body = await request.json().catch(function () { return null; });
  if (!body) return json({ error: 'Некорректный запрос' }, 400);

  const fullName = String(body.fullName || '').trim();
  const username = String(body.username || '').trim();
  const password = String(body.password || '');

  if (!fullName) return json({ error: 'Укажите полное имя' }, 400);
  if (!/^[A-Za-zА-Яа-яЁё0-9_.\-]{2,32}$/.test(username)) return json({ error: 'Имя пользователя: 2–32 символа (буквы, цифры, _ - .)' }, 400);
  if (password.length < 5) return json({ error: 'Пароль должен содержать минимум 5 символов' }, 400);

  const existing = await findUserByUsername(env, username);
  if (existing) return json({ error: 'Это имя пользователя уже занято' }, 409);

  const total = await countUsers(env);
  const role = total === 0 ? 'admin' : (total === 1 ? 'dev' : 'seller');

  const user = {
    id: uid('user'),
    fullName: fullName,
    username: username,
    pass: await hashPassword(password, env),
    role: role,
    pointId: null,
    workStart: '',
    workEnd: '',
    createdAt: nowMs(),
    updatedAt: nowMs()
  };

  await env.DB.prepare(
    'INSERT INTO records (collection, id, data, updated_at, deleted_at) VALUES (?,?,?,?,NULL)'
  ).bind('users', user.id, JSON.stringify(user), user.updatedAt).run();

  await audit(env, user, 'user.register', 'users', user.id, request.headers.get('CF-Connecting-IP'));

  const token = await signToken({
    sub: user.id,
    role: user.role,
    exp: Math.floor(nowMs() / 1000) + TOKEN_TTL_SECONDS
  }, env.JWT_SECRET);

  return json({ token: token, user: publicUser(user), role: role, firstUser: total === 0 });
}

async function handleLogin(request, env) {
  const body = await request.json().catch(function () { return null; });
  if (!body) return json({ error: 'Некорректный запрос' }, 400);

  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  if (!username || !password) return json({ error: 'Введите имя пользователя и пароль' }, 400);

  const user = await findUserByUsername(env, username);
  if (!user) return json({ error: 'Неверное имя пользователя или пароль' }, 401);

  // защита от подбора: 8 неудачных попыток за 15 минут
  const windowStart = nowMs() - 15 * 60 * 1000;
  try {
    const fails = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM audit_log WHERE action='user.login.failed' AND entity_id=? AND created_at > ?"
    ).bind(user.id, windowStart).first();
    if (fails && fails.n >= 8) {
      return json({ error: 'Слишком много неудачных попыток. Попробуйте через 15 минут' }, 429);
    }
  } catch (e) { /* журнал может быть недоступен — не блокируем вход */ }

  const ok = await verifyPassword(password, user.pass, env);
  if (!ok) {
    await audit(env, user, 'user.login.failed', 'users', user.id, request.headers.get('CF-Connecting-IP'));
    return json({ error: 'Неверное имя пользователя или пароль' }, 401);
  }

  const token = await signToken({
    sub: user.id,
    role: user.role,
    exp: Math.floor(nowMs() / 1000) + TOKEN_TTL_SECONDS
  }, env.JWT_SECRET);

  await audit(env, user, 'user.login', 'users', user.id, request.headers.get('CF-Connecting-IP'));

  return json({ token: token, user: publicUser(user) });
}

async function handleChangePassword(request, env, actor) {
  const body = await request.json().catch(function () { return null; });
  if (!body) return json({ error: 'Некорректный запрос' }, 400);
  const current = String(body.currentPassword || '');
  const next = String(body.newPassword || '');
  if (next.length < 6) return json({ error: 'Новый пароль — минимум 6 символов' }, 400);

  const ok = await verifyPassword(current, actor.pass, env);
  if (!ok) return json({ error: 'Текущий пароль указан неверно' }, 403);

  const updated = Object.assign({}, actor, { pass: await hashPassword(next, env), updatedAt: nowMs() });
  await env.DB.prepare(
    "UPDATE records SET data=?, updated_at=? WHERE collection='users' AND id=?"
  ).bind(JSON.stringify(updated), updated.updatedAt, actor.id).run();

  await audit(env, actor, 'user.password', 'users', actor.id, request.headers.get('CF-Connecting-IP'));
  return json({ ok: true });
}

/** Сброс пароля сотрудника администратором */
async function handleResetPassword(request, env, actor) {
  if (actor.role !== 'admin') return json({ error: 'Недостаточно прав' }, 403);
  const body = await request.json().catch(function () { return null; });
  if (!body) return json({ error: 'Некорректный запрос' }, 400);
  const userId = String(body.userId || '');
  const next = String(body.newPassword || '');
  if (next.length < 6) return json({ error: 'Пароль — минимум 6 символов' }, 400);

  const target = await getUserRecord(env, userId);
  if (!target) return json({ error: 'Пользователь не найден' }, 404);

  const updated = Object.assign({}, target, { pass: await hashPassword(next, env), updatedAt: nowMs() });
  await env.DB.prepare(
    "UPDATE records SET data=?, updated_at=? WHERE collection='users' AND id=?"
  ).bind(JSON.stringify(updated), updated.updatedAt, userId).run();

  await audit(env, actor, 'user.password.reset', 'users', userId, request.headers.get('CF-Connecting-IP'));
  return json({ ok: true });
}


/* ============================ управление пользователями ============================ */

const USER_ROLES = ['admin', 'dev', 'seller'];

function userPointIdList(user) {
  const list = Array.isArray(user && user.pointIds) ? user.pointIds.filter(Boolean) : [];
  if (!list.length && user && user.pointId) list.push(user.pointId);
  return list;
}

function cleanUserPayload(body) {
  const pointIds = Array.isArray(body.pointIds)
    ? body.pointIds.filter(Boolean).slice(0, 50)
    : (body.pointId ? [body.pointId] : []);
  return {
    fullName: String(body.fullName || '').trim(),
    username: String(body.username || '').trim(),
    role: String(body.role || 'seller'),
    pointIds: pointIds,
    pointId: pointIds[0] || null,
    workStart: String(body.workStart || ''),
    workEnd: String(body.workEnd || '')
  };
}

async function handleCreateUser(request, env, actor) {
  if (actor.role !== 'admin') return json({ error: 'Только администратор может создавать пользователей' }, 403);
  const body = await request.json().catch(function () { return null; });
  if (!body) return json({ error: 'Некорректный запрос' }, 400);

  const data = cleanUserPayload(body);
  const password = String(body.password || '');

  if (!data.fullName) return json({ error: 'Укажите полное имя' }, 400);
  if (!/^[A-Za-zА-Яа-яЁё0-9_.\-]{2,32}$/.test(data.username)) return json({ error: 'Имя пользователя: 2–32 символа (буквы, цифры, _ - .)' }, 400);
  if (password.length < 5) return json({ error: 'Пароль — минимум 5 символов' }, 400);
  if (USER_ROLES.indexOf(data.role) === -1) return json({ error: 'Неизвестная роль' }, 400);

  if (await findUserByUsername(env, data.username)) return json({ error: 'Это имя пользователя уже занято' }, 409);

  const user = {
    id: uid('user'),
    fullName: data.fullName,
    username: data.username,
    pass: await hashPassword(password, env),
    role: data.role,
    pointIds: data.pointIds,
    pointId: data.pointId,
    workStart: data.workStart,
    workEnd: data.workEnd,
    createdAt: nowMs(),
    updatedAt: nowMs()
  };

  await env.DB.prepare(
    'INSERT INTO records (collection, id, data, updated_at, deleted_at) VALUES (?,?,?,?,NULL)'
  ).bind('users', user.id, JSON.stringify(user), user.updatedAt).run();

  await audit(env, actor, 'user.create', 'users', user.id, request.headers.get('CF-Connecting-IP'));
  return json({ ok: true, user: publicUser(user) });
}

async function handleUpdateUser(request, env, actor) {
  const body = await request.json().catch(function () { return null; });
  if (!body) return json({ error: 'Некорректный запрос' }, 400);
  const userId = String(body.userId || '');
  if (!userId) return json({ error: 'Не указан пользователь' }, 400);

  const target = await getUserRecord(env, userId);
  if (!target) return json({ error: 'Пользователь не найден' }, 404);

  const isSelf = actor.id === userId;
  if (!isSelf && actor.role !== 'admin') return json({ error: 'Недостаточно прав' }, 403);
  if (target.role === 'admin' && actor.role !== 'admin') return json({ error: 'Недостаточно прав' }, 403);

  const data = cleanUserPayload(body);
  if (!data.fullName) return json({ error: 'Укажите полное имя' }, 400);
  if (!/^[A-Za-zА-Яа-яЁё0-9_.\-]{2,32}$/.test(data.username)) return json({ error: 'Имя пользователя: 2–32 символа (буквы, цифры, _ - .)' }, 400);

  // сменить роль может только администратор, себе — нельзя понизить последнего админа
  if (data.role !== target.role) {
    if (actor.role !== 'admin') return json({ error: 'Роль меняет администратор' }, 403);
    if (target.role === 'admin' && data.role !== 'admin' && (await countAdmins(env)) <= 1) {
      return json({ error: 'Нельзя понизить роль последнего администратора' }, 400);
    }
  }
  if (USER_ROLES.indexOf(data.role) === -1) return json({ error: 'Неизвестная роль' }, 400);

  const dup = await findUserByUsername(env, data.username);
  if (dup && dup.id !== userId) return json({ error: 'Это имя пользователя уже занято' }, 409);

  const patch = {
    fullName: data.fullName,
    username: data.username,
    role: data.role,
    pointIds: data.pointIds,
    pointId: data.pointId,
    workStart: data.workStart,
    workEnd: data.workEnd,
    updatedAt: nowMs()
  };

  const password = String(body.password || '');
  if (password) {
    if (password.length < 5) return json({ error: 'Пароль — минимум 5 символов' }, 400);
    patch.pass = await hashPassword(password, env);
  }

  const updated = Object.assign({}, target, patch);
  await env.DB.prepare(
    "UPDATE records SET data=?, updated_at=? WHERE collection='users' AND id=?"
  ).bind(JSON.stringify(updated), updated.updatedAt, userId).run();

  await audit(env, actor, 'user.update', 'users', userId, request.headers.get('CF-Connecting-IP'));
  return json({ ok: true, user: publicUser(updated) });
}

/* ============================ синхронизация ============================ */

function sanitizeRecord(record) {
  if (!record || typeof record !== 'object' || !record.id) return null;
  const copy = Object.assign({}, record);
  if (typeof copy.updatedAt !== 'number' || !isFinite(copy.updatedAt)) {
    copy.updatedAt = nowMs();
  }
  if (copy.updatedAt > nowMs() + 24 * 60 * 60 * 1000) copy.updatedAt = nowMs();
  return copy;
}

/**
 * Что продавцу разрешено получать с сервера: только его точки, товары этих точек,
 * их склад и его собственные операции. Остальное не уходит на устройство вовсе.
 */
function scopeRecordsForActor(actor, collection, list) {
  if (!actor || actor.role === 'admin' || actor.role === 'dev') return list;
  const allowed = userPointIdList(actor);
  const inScope = function (pointId) {
    if (!pointId) return false;
    return allowed.indexOf(pointId) !== -1;
  };
  if (collection === 'users') return [];
  if (collection === 'categories' || collection === 'settings') return list;
  if (collection === 'points') return list.filter(function (row) { return allowed.indexOf(row.id) !== -1; });
  if (collection === 'products') {
    return list.filter(function (row) {
      const ids = Array.isArray(row.pointIds) ? row.pointIds : [];
      if (!ids.length) return true;
      return ids.some(function (id) { return allowed.indexOf(id) !== -1; });
    });
  }
  if (collection === 'time') return list.filter(function (row) { return row.userId === actor.id; });
  if (collection === 'sales' || collection === 'expenses' || collection === 'stock' || collection === 'supplies' || collection === 'saleChanges' || collection === 'stockChecks') {
    return list.filter(function (row) { return inScope(row.pointId); });
  }
  return [];
}

function canWrite(actor, collection, record) {
  if (actor.role === 'admin') return true;
  if (actor.role === 'dev') {
    if (DEV_FORBIDDEN_COLLECTIONS.indexOf(collection) !== -1) return false;
    if (collection === 'users' && record && record.role === 'admin') return false;
    return true;
  }
  // продавец
  if (SELLER_COLLECTIONS.indexOf(collection) === -1) return false;
  const allowed = userPointIdList(actor);
  if (collection === 'sales' && record && record.userId && record.userId !== actor.id) return false;
  if (collection === 'expenses' && record && record.userId && record.userId !== actor.id) return false;
  if ((collection === 'sales' || collection === 'expenses' || collection === 'stock' || collection === 'saleChanges' || collection === 'stockChecks') &&
      record && record.pointId && allowed.length && allowed.indexOf(record.pointId) === -1) return false;
  if (collection === 'saleChanges' && record && record.userId && record.userId !== actor.id) return false;
  if (collection === 'stockChecks' && record && record.userId && record.userId !== actor.id) return false;
  if (collection === 'time' && record && record.userId !== actor.id) return false;
  return true;
}

async function handleSync(request, env, actor) {
  const body = await request.json().catch(function () { return null; });
  if (!body) return json({ error: 'Некорректный запрос' }, 400);

  const since = Number(body.since) || 0;
  const changes = body.changes || {};
  const deletions = body.deletions || {};
  const accepted = {};
  const rejected = {};
  let written = 0;

  const statements = [];

  for (const collection of Object.keys(changes)) {
    if (COLLECTIONS.indexOf(collection) === -1) continue;
    const list = Array.isArray(changes[collection]) ? changes[collection] : [];
    accepted[collection] = [];
    rejected[collection] = [];

    for (const raw of list.slice(0, 300)) {
      const record = sanitizeRecord(raw);
      if (!record) continue;

      if (!canWrite(actor, collection, record)) {
        rejected[collection].push(record.id);
        continue;
      }

      // Продавцу запрещено менять чужие данные внутри записи
      const sellerPoints = userPointIdList(actor);
      if (actor.role === 'seller' && collection === 'sales') {
        record.userId = actor.id;
        record.userName = actor.fullName;
        if (!record.pointId && sellerPoints.length) record.pointId = sellerPoints[0];
      }
      if (actor.role === 'seller' && collection === 'expenses') {
        record.userId = actor.id;
        record.userName = actor.fullName;
        if (!record.pointId && sellerPoints.length) record.pointId = sellerPoints[0];
      }

      // Пароли: сервер принимает только собственный формат, иначе сохраняет прежний
      if (collection === 'users' && record.pass && String(record.pass).indexOf('pbkdf2$') !== 0) {
        const current = await getUserRecord(env, record.id);
        if (current && current.pass) record.pass = current.pass;
        else delete record.pass;
      }

      statements.push(
        env.DB.prepare(
          `INSERT INTO records (collection, id, data, updated_at, deleted_at)
           VALUES (?,?,?,?,NULL)
           ON CONFLICT(collection, id) DO UPDATE SET
             data = excluded.data,
             updated_at = excluded.updated_at,
             deleted_at = NULL
           WHERE excluded.updated_at >= records.updated_at`
        ).bind(collection, record.id, JSON.stringify(record), record.updatedAt)
      );
      accepted[collection].push(record.id);
      written++;
    }
  }

  const tombstoneTime = nowMs();

  for (const collection of Object.keys(deletions)) {
    if (COLLECTIONS.indexOf(collection) === -1) continue;
    const ids = Array.isArray(deletions[collection]) ? deletions[collection] : [];
    accepted[collection] = accepted[collection] || [];
    rejected[collection] = rejected[collection] || [];

    for (const id of ids.slice(0, 300)) {
      if (!id) continue;

      if (actor.role === 'seller') {
        rejected[collection].push(id);
        continue;
      }
      if (actor.role === 'dev') {
        if (DEV_FORBIDDEN_COLLECTIONS.indexOf(collection) !== -1) { rejected[collection].push(id); continue; }
        if (collection === 'users') {
          const target = await getUserRecord(env, id);
          if (target && target.role === 'admin') { rejected[collection].push(id); continue; }
        }
      }

      if (collection === 'users') {
        const target = await getUserRecord(env, id);
        const demoAdmin = target && (target.demo === true || String(target.username || '').toLowerCase() === 'demo');
        if (target && target.role === 'admin' && !demoAdmin && (await countAdmins(env)) <= 1) {
          rejected[collection].push(id);
          continue;
        }
      }

      statements.push(
        env.DB.prepare(
          "UPDATE records SET deleted_at=?, updated_at=? WHERE collection=? AND id=?"
        ).bind(tombstoneTime, tombstoneTime, collection, id)
      );
      accepted[collection].push(id);
    }
  }

  if (statements.length) {
    // D1 выполняет пакеты атомарно
    for (let i = 0; i < statements.length; i += 50) {
      await env.DB.batch(statements.slice(i, i + 50));
    }
  }

  // ---- отдаём изменения другим устройствам ----
  const pullSince = Math.max(0, since - SYNC_OVERLAP_MS);
  const rows = await env.DB.prepare(
    "SELECT collection, id, data, updated_at FROM records WHERE updated_at > ? AND deleted_at IS NULL ORDER BY updated_at LIMIT ?"
  ).bind(pullSince, PULL_LIMIT).all();

  const serverChanges = {};
  let maxUpdated = since;
  for (const row of (rows.results || [])) {
    try {
      const record = JSON.parse(row.data);
      const scoped = scopeRecordsForActor(actor, row.collection, [record])[0];
      if (!scoped) continue;
      if (!serverChanges[row.collection]) serverChanges[row.collection] = [];
      serverChanges[row.collection].push(scoped);
    } catch (e) { /* пропускаем битую строку */ }
    if (row.updated_at > maxUpdated) maxUpdated = row.updated_at;
  }

  const tombRows = await env.DB.prepare(
    "SELECT collection, id, deleted_at FROM records WHERE deleted_at > ? ORDER BY deleted_at LIMIT ?"
  ).bind(pullSince, PULL_LIMIT).all();

  const serverDeletions = {};
  for (const row of (tombRows.results || [])) {
    if (actor.role === 'seller' && SELLER_COLLECTIONS.indexOf(row.collection) === -1) continue;
    if (!serverDeletions[row.collection]) serverDeletions[row.collection] = [];
    serverDeletions[row.collection].push(row.id);
    if (row.deleted_at > maxUpdated) maxUpdated = row.deleted_at;
  }

  if (written) {
    await audit(env, actor, 'sync.push', null, null, request.headers.get('CF-Connecting-IP'));
  }

  return json({
    ok: true,
    serverTime: nowMs(),
    cursor: Math.max(maxUpdated, nowMs() - 1000),
    accepted: accepted,
    rejected: rejected,
    changes: serverChanges,
    deletions: serverDeletions,
    hasMore: (rows.results || []).length >= PULL_LIMIT,
    written: written,
    user: publicUser(actor)
  });
}

async function handleBootstrap(env, actor) {
  const rows = await env.DB.prepare(
    'SELECT collection, data, updated_at FROM records WHERE deleted_at IS NULL ORDER BY collection, updated_at LIMIT 20000'
  ).all();

  const out = {};
  for (const row of (rows.results || [])) {
    try {
      const record = JSON.parse(row.data);
      const scoped = scopeRecordsForActor(actor, row.collection, [record])[0];
      if (!scoped) continue;
      if (!out[row.collection]) out[row.collection] = [];
      out[row.collection].push(scoped);
    } catch (e) { /* ignore */ }
  }
  return json({ ok: true, serverTime: nowMs(), cursor: nowMs(), changes: out, user: publicUser(actor) });
}

/* ============================ роутер ============================ */

async function route(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = request.method.toUpperCase();

  if (method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }

  if (path === '/' || path === '/api/health') {
    let users = 0;
    try { users = await countUsers(env); } catch (e) { users = -1; }
    return json({
      ok: true,
      app: 'POS Контроль API',
      version: API_VERSION,
      time: nowMs(),
      users: users,
      hasSecret: !!env.JWT_SECRET
    });
  }

  if (path === '/api/register' && method === 'POST') return handleRegister(request, env);
  if (path === '/api/login' && method === 'POST') return handleLogin(request, env);

  const auth = await authenticate(request, env);
  if (auth.error) return json({ error: auth.error }, auth.status);
  const actor = auth.user;

  if (path === '/api/me' && method === 'GET') {
    return json({ ok: true, user: publicUser(actor) });
  }
  if (path === '/api/sync' && method === 'POST') return handleSync(request, env, actor);
  if (path === '/api/bootstrap' && method === 'GET') return handleBootstrap(env, actor);
  if (path === '/api/password' && method === 'POST') return handleChangePassword(request, env, actor);
  if (path === '/api/users/password' && method === 'POST') return handleResetPassword(request, env, actor);
  if (path === '/api/users' && method === 'POST') return handleCreateUser(request, env, actor);
  if (path === '/api/users/update' && method === 'POST') return handleUpdateUser(request, env, actor);

  return json({ error: 'Метод не найден: ' + method + ' ' + path }, 404);
}

export default {
  async fetch(request, env) {
    try {
      if (!env.DB) return withCors(json({ error: 'Не подключена база D1 (binding DB)' }, 500), request);
      if (!env.JWT_SECRET) return withCors(json({ error: 'Не задан секрет JWT_SECRET' }, 500), request);

      const contentLength = Number(request.headers.get('content-length') || 0);
      if (contentLength > MAX_BODY_BYTES) {
        return withCors(json({ error: 'Слишком большой запрос' }, 413), request);
      }

      const response = await route(request, env);
      return withCors(response, request);
    } catch (err) {
      return withCors(json({
        error: 'Внутренняя ошибка сервера',
        details: err && err.message ? String(err.message) : String(err)
      }, 500), request);
    }
  }
};
