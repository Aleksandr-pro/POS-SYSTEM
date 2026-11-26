<!-- Значение JWT_SECRET вырезано при переносе в публичный репозиторий. См. SECURITY.md. -->
# Cloudflare — все данные для проверки

Сервер: https://pos-kontrol-api.my-tt-accaunt235.workers.dev
Воркер: pos-kontrol-api · Поддомен аккаунта: my-tt-accaunt235
База: poskontrol · Привязка: DB · Секрет: JWT_SECRET

---

## 1. Что где лежит

| Что | Файл |
|---|---|
| Код воркера | worker.js (33 507 байт) — в архиве «база-worker-sql-и-данные.zip» |
| SQL для создания таблиц | СХЕМА-БД.sql |
| Сотрудники одним запросом | Сотрудники в базу.sql |
| Пошаговая инструкция | ШАГИ-CLOUDFLARE.md |

Копия кода уже загружена на Cloudflare и работает: /api/health отвечает нашим JSON-ом с правильными CORS-заголовками. Перезаливать код не обязательно; проблема обычно только в привязке базы.

---

## 2. Worker — что должно быть

| Параметр | Значение |
|---|---|
| Имя | pos-kontrol-api |
| Адрес | https://pos-kontrol-api.my-tt-accaunt235.workers.dev |
| Тип | Worker (не Pages) |
| Версия API | 1.0.0 |
| Срок токена входа | 30 дней |
| Лимит тела запроса | 2 МБ |

Проверка: открой https://pos-kontrol-api.my-tt-accaunt235.workers.dev/api/health — если в ответе есть "app":"POS Контроль API", код правильный.

---

## 3. База D1

Имя базы: poskontrol · тип D1 · расположение любое.

SQL: D1 → poskontrol → вкладка Console → вставить целиком → Execute

CREATE TABLE IF NOT EXISTS records (
  collection TEXT NOT NULL,
  id TEXT NOT NULL,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  PRIMARY KEY (collection, id)
);

CREATE INDEX IF NOT EXISTS idx_records_sync ON records (collection, updated_at);
CREATE INDEX IF NOT EXISTS idx_records_deleted ON records (deleted_at);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  user_name TEXT,
  action TEXT NOT NULL,
  collection TEXT,
  entity_id TEXT,
  ip TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_date ON audit_log (created_at DESC);

INSERT OR IGNORE INTO meta (key, value) VALUES ('schema_version', '1');

Если консоль ругается на несколько запросов сразу — выполняй по одному блоку в том же порядке.

Проверка в Console:
SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%';
Ожидаемо 3 строки: audit_log, meta, records.

SELECT COUNT(*) AS n FROM records;
Ожидаемо 0.

---

## 4. Bindings — самое важное

Worker pos-kontrol-api → Settings → Bindings

| Поле | Значение |
|---|---|
| Тип | D1 database |
| Variable name | DB — ровно две заглавные латинские буквы |
| D1 database | poskontrol |

В списке должна быть ровно одна такая строка. Лишние привязки (db, DATABASE, DB1, KV) удалить.

После добавления обязательно нажать Deploy / Save and Deploy. Без деплоя привязка не применяется — это причина 90 % случаев «привязываю, а пишет, что не подключена».

---

## 5. Variables and Secrets

| Имя | Тип | Значение |
|---|---|---|
| JWT_SECRET | Secret (не Plaintext) | <ВСТАВЬТЕ-СЕКРЕТ> |

Больше ничего не нужно. После добавления — снова Deploy.

ВНИМАНИЕ: JWT_SECRET менять после регистрации нельзя — пароли хэшируются с его участием, и все аккаунты перестанут пускать. Если менял — в D1 очистить records или регистрироваться заново.

---

## 6. Проверка сервера

Открыть: https://pos-kontrol-api.my-tt-accaunt235.workers.dev/api/health

Должно быть: {"ok":true,"app":"POS Контроль API","version":"1.0.0","time":1760000000000,"users":0,"hasSecret":true}

| Что видно | Что значит |
|---|---|
| users: 0, hasSecret: true | всё правильно |
| «Не подключена база D1 (binding DB)» | шаг 4: привязки нет / имя не DB / не нажат Deploy |
| «Не задан секрет JWT_SECRET» | шаг 5: секрет не создан / не нажат Deploy |
| users: -1 | база привязана, но таблиц нет — выполни SQL из шага 3 |
| Страница «not found» / 1016 | открыт не тот адрес или воркер не опубликован |

---

## 7. Настройки в приложении

Настройки → Сервер и синхронизация (или «Подключить сервер» на экране входа)

| Поле | Значение |
|---|---|
| Адрес сервера | https://pos-kontrol-api.my-tt-accaunt235.workers.dev — без / в конце |
| Логин | 2–32 символа: буквы, цифры, _ - . |
| Пароль | минимум 6 символов |

Порядок:
1. Проверить связь → «Сервер доступен · версия 1.0.0 · пользователей: 0».
2. Создать аккаунт на сервере → первый аккаунт получает роль Администратор, второй — Разработчик, остальные — Продавец.
3. Синхронизировать → появится дата последней синхронизации.
4. На втором устройстве: тот же адрес → Войти на сервер тем же логином и паролем.

---

## 8. Чего не делать

- Не выполнять wrangler deploy из папки pos-app/cloudflare: в wrangler.toml стоит заглушка database_id — деплой затрёт рабочую привязку. Всё делать через панель Cloudflare.
- Не держать два похожих воркера: приложение ходит строго на pos-kontrol-api.
- Не менять имя привязки с DB на другое.
- Не забывать Deploy после каждого изменения Bindings / Secrets.

---

## 9. Короткий чек-лист

- D1-база poskontrol существует
- SQL из шага 3 выполнен, в базе 3 таблицы
- В Bindings: D1 database, имя DB, база poskontrol → нажат Deploy
- В Variables and Secrets: Secret JWT_SECRET = указанный выше → нажат Deploy
- /api/health отдаёт users: 0, hasSecret: true
- В приложении «Проверить связь» → «Сервер доступен»
- Зарегистрирован первый аккаунт (Администратор)
- Нажата «Синхронизировать», ошибок нет
